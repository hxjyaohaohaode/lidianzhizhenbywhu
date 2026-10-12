"""One registered-metric contract for local forecasts and approved execution.

Validation never rewrites historical requests or chooses a substitute metric.
Only a new preview may bind an implicit form default to an explicit target.
"""
import re
from typing import get_args
from .autonomy_contracts import ExecutionOptions
from .question_scope import TOPICS, PERIOD_PATTERNS, matches

FORECAST_METRICS = frozenset(get_args(ExecutionOptions.model_fields['forecast_metric'].annotation))
# Whole metric-free commands only. An overview/workspace word elsewhere in an
# unsupported request is not evidence that its actual target can be discarded.
_GENERIC_COMMANDS = frozenset(('', '经营', '经营概览', '企业经营概览', '企业经营核查',
    '经营核查', '经营诊断', '企业经营诊断', '经营研判', '概览', '诊断', '整体经营',
    '数据质量', '数据缺口', '核查指标', '复核数学实验', '复核选中的数学实验',
    '执行选中的数学实验', '请执行选中的数学实验', 'overview', 'summary',
    'businessoverview', 'financialoverview', 'businesssummary', 'financialsummary'))


def forecast_requested(text, execution=None):
    return bool((execution or {}).get('forecast') or any(w in text.lower() for w in ('预测', '回测', 'forecast')))


def forecast_topics(scope, text):
    projected = forecast_clause(text)
    # Every conjunct is a request, including an unregistered target. Aggregating
    # recognized topics alone would silently discard the unknown conjunct.
    from .question_scope import topics_for
    parts=re.split(r'以及|与|和|及|、|(?<![a-z0-9])(?:and|or)(?![a-z0-9])',projected.lower())
    if len(parts)>1 and any(not topics_for(part) for part in parts):
        # Keep this projection total for the direct assistant: require_metric
        # rejects the explicit marker inside its existing guarded tool call.
        return ['未识别的并列预测目标']
    if projected != text:
        topics = topics_for(projected)
    else:
        topics = list(scope['topics'])
    # The cash ratio accompanying a cash-flow fact is not a second request.
    if ('cash_flow' in topics and 'cash_ratio' in topics
            and not any(matches(projected.lower(), term) for term in dict(TOPICS)['cash_ratio'])):
        topics.remove('cash_ratio')
    return topics


def forecast_clause(text):
    """Separate a bounded, explicitly labelled analysis clause, not any topic."""
    candidates=[]
    for split in re.finditer(r'以及|与|和|及|(?<![a-z0-9])and(?![a-z0-9])',text.lower()):
        left,right=text[:split.start()].strip(),text[split.end():].strip()
        for prediction,analysis in ((left,right),(right,left)):
            if (forecast_requested(prediction) and not forecast_requested(analysis)
                    and re.search(r'(?:核查|分析|复核|analysis|check)\s*[。.!！?？]*$',analysis,re.I)
                    and re.search(r'(?:预测|回测|forecast)\s*[。.!！?？]*$',prediction,re.I)):
                candidates.append(prediction)
    return candidates[0] if len(candidates)==1 else text


def require_metric(topics):
    if len(topics) != 1 or topics[0] not in FORECAST_METRICS:
        from .analytics import METRIC_LABELS
        requested = '、'.join(METRIC_LABELS.get(key, key) for key in topics) or '未明确指标'
        raise ValueError(f'本次预测范围（{requested}）不受支持或包含多个指标。'
                         '本地预测一次仅支持明确的单个指标：营业收入、营业成本、经营现金流或毛利率；'
                         '请单独指定其中一项，不会用其他指标替代。')
    return topics[0]


def forecast_metric(scope, text, selected=None, *, explicit=False):
    topics = forecast_topics(scope, text)
    # A deliberately chosen form/verified saved forecast can supply the target
    # for a metric-free question. Unsupported financial wording cannot do so.
    remaining=text.lower()
    for pattern in PERIOD_PATTERNS:
        remaining=re.sub(pattern,'',remaining)
    remaining=re.sub(r'预测|回测|(?<![a-z0-9])forecast(?![a-z0-9])|[\s，。！？,.!?：:;；]','',remaining)
    generic=remaining in _GENERIC_COMMANDS
    if scope.get('status') in ('needs_clarification','period_unavailable'):
        raise ValueError('本次预测目标或季度需要澄清，请统一明确后重新预览，不会用其他范围替代。')
    if not topics and explicit and generic and not scope.get('unsupported_financial_operation'):
        topics = [selected]
    metric = require_metric(topics)
    if explicit and selected != metric:
        raise ValueError('问题中的预测指标与已选择的预测参数或数学实验不一致；请统一后重新预览，不会用另一指标替代。')
    return metric


class ForecastUnavailable(ValueError):
    """An optional forecast lacks authority; other approved research can run."""


def selected_forecast(snapshot, execution):
    """Read immutable choice evidence, never infer authority from defaults."""
    selected=None
    if 'forecast_selection' in snapshot:
        selection=snapshot['forecast_selection']
        if (not isinstance(selection,dict) or set(selection)!={'schema_version','source','metric','horizon'}
                or type(selection['schema_version']) is not int or selection['schema_version']!=1
                or selection['source']!='explicit_form' or not isinstance(selection['metric'],str)
                or selection['metric'] not in FORECAST_METRICS
                or type(selection['horizon']) is not int or not 1<=selection['horizon']<=4):
            raise ValueError('已批准预测模型选择凭据无法核验，请重新预览；不会使用默认指标。')
        selected=selection['metric'],selection['horizon']
    frozen=snapshot.get('experiment')
    if frozen:
        from .saved_experiments import verify_payload_seal
        from .store import digest
        try:
            p=frozen['payload'];verify_payload_seal(p,frozen['version'])
            if digest(p)!=frozen['hash']:raise ValueError('实验指纹不一致')
            if p['request']['kind']=='forecast':
                saved=p['request']['metric'],p['request']['horizon']
                if selected and selected!=saved:raise ValueError('选择与实验参数不一致')
                selected=saved
        except (KeyError,TypeError,ValueError) as exc:
            raise ValueError('已批准预测实验凭据无法核验；不会使用默认指标。') from exc
    if selected:
        if (execution.get('forecast') is not True or
                selected!=(execution.get('forecast_metric'),execution.get('horizon'))):
            raise ValueError('执行预测参数与已批准模型选择不一致，请重新预览。')
        return selected[0]
    return None


def forecast_choice(scope, text, execution, snapshot, *, bind_target=False, explicit_metric=False):
    selected=selected_forecast(snapshot,execution)
    # Preserve the existing stock-only capability boundary. An unchecked form
    # default cannot turn recorded period-end balances into a forecast target;
    # a separately approved supported model remains a distinct typed choice.
    from .question_scope import BALANCE_TOPICS
    if selected is None and execution.get('forecast') is True and BALANCE_TOPICS.intersection(scope['topics']):
        raise ValueError('总资产、总负债仅支持已保存的期末金额；本次金额问题不能启用预测并默认生成收入预测。请关闭预测，或单独明确受支持的预测指标后重新预览。')
    if not forecast_requested(text):
        if selected:return selected
        raise ForecastUnavailable('预测不可用：普通研究未明确选择单个预测模型；其他已批准分析仍可运行，不会默认预测营业收入。')
    metric=forecast_metric(scope,text,execution.get('forecast_metric'),
        explicit=selected is not None or explicit_metric)
    if not bind_target and metric!=execution.get('forecast_metric'):
        raise ValueError('原问题的预测指标与冻结参数不一致，请重新预览；不会替换指标。')
    return metric


def validate_frozen_forecast(scope, text, execution, snapshot):
    """Check only frozen target/choice; never repair an old default in place."""
    return forecast_choice(scope,text,execution,snapshot)


def forecast_target(snapshot, request, target=None):
    """Read only server-bound intent; never parse a caller's scope-title syntax."""
    intent=snapshot.get('forecast_intent')
    if 'forecast_intent' in snapshot:
        if (not isinstance(intent,dict) or set(intent)!={'schema_version','query','message_id','message_hash'}
                or type(intent['schema_version']) is not int or intent['schema_version']!=1
                or not isinstance(intent['query'],str) or not intent['query'].strip() or len(intent['query'])>3000
                or not isinstance(intent['message_id'],str) or not 1<=len(intent['message_id'])<=80
                or not isinstance(intent['message_hash'],str) or not re.fullmatch('[0-9a-f]{64}',intent['message_hash'])):
            raise ValueError('原预测目标来源无法核验，请重新预览；不会从自动标题或历史文本猜测。')
        return intent['query']
    return target if target is not None else snapshot.get('scope_query',request.get('query',''))


def frozen_forecast_scope(snapshot, request, target=None):
    from .question_scope import resolve_question
    text=forecast_target(snapshot,request,target)
    scope=resolve_question(text,snapshot['dataset'],[])
    if 'forecast_intent' in snapshot:
        period=snapshot['research_scope']['period']
        if (period not in scope['available_periods'] or
                (scope['period_explicit'] and scope['period']!=period)):
            raise ValueError('原预测目标季度与已批准来源不一致，请重新预览；不会改为最新季度。')
        scope['period']=period
    return text,scope
