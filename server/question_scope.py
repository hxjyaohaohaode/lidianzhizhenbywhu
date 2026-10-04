"""Explicit deterministic question scope shared by both local research assistants.

This is a bounded router, not language understanding or an external data source.
Unrecognized topics and ambiguous periods must not silently become latest-quarter
margin/cash answers. The original saved dataset is never mutated.
"""
from __future__ import annotations
import re

TOPICS = (
    ('gross_margin', ('毛利', 'gross margin', 'gross profit margin', 'gross-profit margin')),
    ('cash_flow', ('现金流', '现金', '回款', 'cash flow')),
    ('cash_ratio', ('现金收入比', '现金流收入比', 'cash ratio')),
    ('leverage', ('负债率', '负债比率', '负债比例', '杠杆', '偿债', 'leverage')),
    ('revenue', ('收入', '营收', '销售额', 'revenue')),
    ('cost', ('成本', 'cost')),
    ('net_margin', ('净利率', '净利润率', '净利润比率', '盈利能力', 'net margin', 'net profit margin')),
    ('net_profit', ('净利润', '利润额', 'net profit')),
    ('inventory_turnover', ('库存', '存货', 'inventory turnover')),
    ('rd_ratio', ('研发', 'r&d')),
    ('roe', ('净资产收益', 'roe')),
    ('asset_turnover', ('资产周转', 'asset turnover')),
)
PERIOD_PATTERNS = (r'(?<!\d)((?:19|20)\d{2})\s*年\s*第?\s*([1-4一二三四])\s*季度',
                   r'(?<!\d)((?:19|20)\d{2})\s*[-/]?\s*q([1-4])(?!\d|\.\d)')
CASH_BALANCE_TERMS = ('现金余额', '现金的余额', '期末现金', '期初现金', '账上现金', '货币资金', '库存现金',
                      '现金等价物', 'cash balance', 'cash balances', 'cash equivalents', 'cash and equivalents', 'cash on hand')
CASH_BALANCE_PATTERN = (r'现金\s*(?:的\s*)?(?:期初|期末|账面|账户)?\s*余额|现金\s*(?:及|和|与)\s*(?:现金\s*)?等价物'
                        r'|(?<![a-z0-9])cash\s+(?:beginning|ending|opening|closing)\s+balances?(?![a-z0-9])')
MONEY_QUESTION = r'(?:是|为|有)?\s*多少\s*(?:钱|(?:万|亿)?元)'
RD_RATIO_PATTERN = (r'研发\s*(?:的\s*)?(?:总?(?:费用|费|支出|开支|成本|投入|金额)\s*(?:的\s*)?)?'
    r'(?:费率|比率|比例|占比|强度|率|(?:(?:占|与|和|对)\s*)?(?:营业)?收入\s*(?:(?:的|之)\s*)?(?:占比|比率|比例|比|率))'
    r'|(?<![a-z0-9])r&d\s+(?:(?:expenses?|expenditure|spending|amount|costs?)\s+)?ratio(?![a-z0-9])')
REVENUE_GROWTH_PATTERN = (r'(?:营业收入|收入|营收|销售额)\s*(?:的\s*)?'
    r'(?:(?:同比|环比)\s*(?:增长率?|增速)?|增长率?|增速)'
    r'|(?<![a-z0-9])(?:revenue\s+(?:growth(?:\s+rate)?|year over year|quarter over quarter)'
    r'|growth(?:\s+rate)?\s+(?:in\s+)?revenue)(?![a-z0-9])')
AMOUNT_TOPICS = {'revenue', 'cost', 'net_profit', 'cash_flow'}
RATIO_TOPICS = {key for key, _ in TOPICS} - AMOUNT_TOPICS


def _term_pattern(term):
    return r'(?<![a-z0-9])' + re.escape(term) + r'(?![a-z0-9])' if term.isascii() else re.escape(term)


def matches(text, term):
    return bool(re.search(_term_pattern(term), text))


def unsupported_modifier(text):
    """Reject unregistered units/operations on the finite metric catalog.

    Mask whole supported compounds locally before inspecting amount aliases;
    an independently requested amount elsewhere in the sentence remains visible.
    """
    remainder=re.sub(RD_RATIO_PATTERN,' ',text)
    for key in ('net_margin','cash_ratio'):
        for term in dict(TOPICS)[key]:
            remainder=re.sub(_term_pattern(term),' ',remainder)
    remainder=re.sub(REVENUE_GROWTH_PATTERN,' ',remainder)
    if re.search(r'增长率|增速|(?<![a-z0-9])growth\s+rate(?![a-z0-9])',remainder):
        return '当前问答仅支持收入增长率；其他指标的增长率或增速不能用原始金额、原比率或比较差额替代，请单独提问已支持的指标。'
    for key,terms in TOPICS:
        if key not in AMOUNT_TOPICS:continue
        for term in terms:
            suffix=r'\s*(?:的\s*)?(?:余额|比率|比例|占比|率|(?<![a-z0-9])(?:balance|ratio|rate)(?![a-z0-9]))'
            if re.search(_term_pattern(term)+suffix,remainder):
                return '当前问答不支持该金额指标的余额或比率口径，不能用原始期间金额替代。请单独提问已支持的金额或明确比率指标。'
    ratio_patterns=[]
    for key,terms in TOPICS:
        if key not in RATIO_TOPICS:continue
        for term in terms:
            suffix=(r'(?:\s*(?:的\s*)?周转)?(?:率)?' if key=='inventory_turnover' else r'(?:率)?') if not term.isascii() else ''
            ratio_patterns.append(_term_pattern(term)+suffix)
    money=r'\s*(?:的\s*)?(?:金额|余额|总额|数额|额|'+MONEY_QUESTION+r'|(?<![a-z0-9])(?:amount|balance)(?![a-z0-9]))'
    compounds='(?:'+RD_RATIO_PATTERN+'|'+REVENUE_GROWTH_PATTERN+')'
    compound_amount=any(re.match(money,text[match.end():]) for match in re.finditer(compounds,text))
    ratio_text=re.sub(compounds,' ',text)
    if compound_amount or re.search('(?:'+'|'.join(ratio_patterns)+')'+money,ratio_text):
        return '当前问答不支持把该比率、增长率或周转指标解释为金额或余额；不同单位不能互相替代，请单独提问已支持的指标。'
    if re.search(r'(?:投资|筹资|融资|自由)\s*(?:活动)?\s*(?:产生的|的)?\s*现金流'
        r'|(?<![a-z0-9])(?:(?:free|investing|financing|investment)\s+cash\s+flow'
        r'|cash\s+flow\s+from\s+(?:investing|financing|investment))(?![a-z0-9])',text):
        return '当前现金流指标只支持经营现金流；投资、筹资或自由现金流不能用经营现金流替代，请单独提问已支持的指标。'
    return ''


def topics_for(text):
    q=text.lower()
    # An amount alias inside a named ratio is not a second metric request.
    # Mask only those occurrences so an explicit amount elsewhere still counts.
    profit_text=q
    for term in dict(TOPICS)['net_margin']:
        profit_text=re.sub(_term_pattern(term),' ',profit_text)
    cash_text=q
    for term in dict(TOPICS)['cash_ratio']:
        cash_text=re.sub(_term_pattern(term),' ',cash_text)
    amount_text=re.sub(RD_RATIO_PATTERN,' ',cash_text)
    source_text={'net_profit':profit_text,'cash_flow':cash_text,'revenue':amount_text,'cost':amount_text}
    topics=[key for key, words in TOPICS
            if any(matches(source_text.get(key,q),word) for word in words)]
    # A comparison word selects the baseline; it does not identify revenue.
    revenue_growth = re.search(REVENUE_GROWTH_PATTERN, q)
    if revenue_growth and 'revenue' in topics:
        topics.insert(topics.index('revenue'), 'revenue_growth')
    if 'cash_flow' in topics and 'cash_ratio' not in topics:
        topics.insert(topics.index('cash_flow')+1,'cash_ratio')
    if not topics and matches(q,'cash'):topics=['cash_flow']
    return topics


def resolve_question(text, data, defaults):
    q=text.lower();topics=topics_for(text)
    modifier_notice=unsupported_modifier(q)
    negated_metrics=bool(topics and re.search(r'不要|不看|不分析|不核查|排除|别看'
        r'|(?<![a-z0-9])(?:not|without|excluding|except)(?![a-z0-9])',q))
    balance_text=q
    for term in ('现金流', '现金收入比', 'cash flow', 'cash ratio'):
        balance_text=re.sub(_term_pattern(term),' ',balance_text)
    unsupported_cash_balance=bool(re.search(CASH_BALANCE_PATTERN,balance_text)) or any(matches(balance_text,term) for term in CASH_BALANCE_TERMS)
    # A liability subject is not a request for the liabilities/assets ratio.
    # Mask supported ratio wording only; remaining amounts also block mixed
    # requests instead of silently returning their other recognized metrics.
    liability_text=q.replace('资产负债表',' ')  # A document name does not request its liability amount.
    for term in ('负债率','负债比率','负债比例'):
        liability_text=re.sub(_term_pattern(term),' ',liability_text)
    unsupported_liability=(any(matches(liability_text,term) for term in ('负债','债务','liability','liabilities','debt'))
        or bool(re.search(r'(?:偿债|杠杆)\s*(?:的\s*)?(?:金额|余额|总额|'+MONEY_QUESTION+r')',liability_text)))
    inventory_text=re.sub(r'(?:库存|存货)\s*(?:的\s*)?周转(?:率)?'
        r'|(?<![a-z0-9])inventory\s+turnover(?![a-z0-9])',' ',q)
    unsupported_inventory_amount=bool(re.search(
        r'(?:库存|存货)\s*(?:的\s*)?(?:(?:总|账面)?(?:金额|余额|价值)|总额|存量|'+MONEY_QUESTION+r')'
        r'|(?<![a-z0-9])inventory\s+(?:amount|balance|value)(?![a-z0-9])',inventory_text))
    # Expenses/amounts inside an explicit R&D ratio remain ratio wording.
    # Mask each occurrence locally so a separate expense request is retained.
    rd_text=re.sub(RD_RATIO_PATTERN,' ',q)
    unsupported_rd_amount=bool(re.search(
        r'研发\s*(?:的\s*)?(?:总?(?:费用|费|支出|开支|成本)|(?:投入\s*)?(?:金额|总额|'+MONEY_QUESTION+r'))'
        r'|(?<![a-z0-9])r&d\s+(?:expenses?|expenditure|spending|amount|costs?)(?![a-z0-9])',rd_text))
    unsupported_cost_ratio=bool(re.search(r'成本\s*(?:的\s*)?(?:比率|比例|占比|率)'
        r'|(?<![a-z0-9])cost\s+ratio(?![a-z0-9])',rd_text))
    margin_text=q
    for term in (*dict(TOPICS)['gross_margin'],*dict(TOPICS)['net_margin']):
        margin_text=re.sub(_term_pattern(term),' ',margin_text)
    unsupported_margin=matches(margin_text,'margin') or bool(re.search(r'利润(?:率|比率|比例)',margin_text))
    overview=any(w in q for w in ('经营','诊断','概览','全景','整体','数据质量','数据缺口','核查指标','overview','summary'))
    if not topics and overview:topics=list(defaults)
    # Remove only named supported turnover phrases. Any remaining turnover
    # request is unsupported, even alongside another recognized metric.
    turnover_remainder=re.sub(r'(?:库存|存货|资产)\s*(?:的\s*)?周转'
        r'|(?<![a-z0-9])(?:inventory|asset)\s+turnover(?![a-z0-9])','',q)
    # Named rate capabilities do not include a different asset denominator or days.
    turnover_subtype=re.search(r'(?:固定|流动)资产\s*(?:的\s*)?周转'
        r'|周转\s*(?:率\s*)?(?:天数|天|周期)'
        r'|(?<![a-z0-9])(?:fixed|current)\s+asset\s+turnover(?![a-z0-9])'
        r'|(?<![a-z0-9])turnover\s+(?:days|period)(?![a-z0-9])',q)
    unsupported_turnover=bool(turnover_subtype) or '周转' in turnover_remainder or matches(turnover_remainder,'turnover')
    gross_profit_amount=bool(re.search(r'毛利(?:润)?\s*(?:的\s*)?(?:总?金额|总额|数额|额|'+MONEY_QUESTION+r')|毛利润(?!\s*(?:率|比率))'
        r'|(?<![a-z0-9])gross[\s-]+profit(?![\s-]+margin\b)(?![a-z0-9])',q))
    previous=any(w in q for w in ('环比','上一季度','上季','previous quarter'))
    yearly=any(w in q for w in ('同比','上年同季','去年同季','year over year'))
    comparison='previous' if previous else 'year_over_year'
    quarters=[]; spans=[]
    for pattern in PERIOD_PATTERNS:
        for match in re.finditer(pattern,q):
            year,quarter=match.groups()
            value=f"{year}-Q{dict(zip('一二三四','1234')).get(quarter,quarter)}"
            if value not in quarters:quarters.append(value)
            spans.append(match.span())
    remainder=list(q)
    for start,end in spans:remainder[start:end]=' '*(end-start)
    unresolved=''.join(remainder)
    partial_period=bool(re.search(r'(?<![a-z])q\d+|第?\s*[0-9一二三四五六七八九十]+\s*季度|[0-9一二三四五六七八九十]+\s*月|(?:去年|今年|前年|上年|本年|明年)(?!同季)|上半年|下半年|半年度|年度|全年|本月|上月|下月|annual|yearly|last year|this year',unresolved))
    extra_years=re.findall(r'(?<!\d)(?:19|20)\d{2}(?!\d)',''.join(remainder))
    available=sorted(p['period'] for p in data['periods'])
    period=quarters[0] if len(quarters)==1 else available[-1]
    status='supported';notice=''
    if any(word in q for word in ('不继续','不要继续','停止继续','别继续')):
        status='needs_clarification';notice='已停止沿用上一轮范围；请单独写明新的指标与目标季度，避免把被否定的指标仍作为核查对象。'
    elif negated_metrics:
        status='needs_clarification';notice='问题包含被否定或排除的指标，本地助手不会把它们仍当作核查对象；请单独写明需要核查的指标和季度。'
    elif (previous and yearly) or '同环比' in q:
        status='needs_clarification';notice='一次计划使用一个比较基期；请明确同比或环比，避免静默选择。'
    elif len(quarters)>1:
        status='needs_clarification';notice='本地助手一次核查一个目标季度及其同/环比基期；请指定一个目标季度，或在企业对照工作区选择比较范围。'
    elif extra_years or partial_period:
        status='needs_clarification';notice='当前数据按单季度保存；年度、月份、无效季度或额外年份不会擅自当作最近一季或自动汇总，请明确单个目标季度。'
    elif quarters and period not in available:
        status='period_unavailable';notice=f'已保存输入没有{period}，不能用最近一季代替；请先补充该季度原始数据。'
    elif unsupported_cash_balance:
        status='unsupported_topic';notice='当前不支持现金余额、货币资金或现金及现金等价物余额：当前现金相关原始字段只有经营现金流，不能用期间流量或经营现金收入比代替时点余额。请核对资产负债表等原始来源；如需核查已支持的现金流或其他指标，请单独提问。'
    elif unsupported_liability:
        status='unsupported_topic';notice='当前问答不支持负债金额、余额或存量，也不能把未明确口径的负债问题当作资产负债率。金额与比例不能互相替代，请核对资产负债表等原始来源；如需核查已支持的资产负债率或其他指标，请单独提问。'
    elif unsupported_inventory_amount:
        status='unsupported_topic';notice='当前问答不支持库存或存货金额、余额和存量，不能用库存周转率代替金额。请核对原始财务表；如需核查已支持的库存周转率或其他指标，请单独提问。'
    elif unsupported_rd_amount:
        status='unsupported_topic';notice='当前问答不支持研发费用金额或研发支出金额，不能用研发费用率或研发占比代替。请核对原始财务表；如需核查已支持的研发费用率或其他指标，请单独提问。'
    elif unsupported_cost_ratio:
        status='unsupported_topic';notice='当前问答不支持该成本比率，不能用营业成本金额替代比例。请单独提问已支持的营业成本金额或研发费用率。'
    elif unsupported_margin:
        status='unsupported_topic';notice='当前问答仅支持明确的毛利率（gross margin）与净利率（net profit margin）；未明确口径或不支持的 margin 指标不能用毛利率替代。请单独提问已支持的指标。'
    elif gross_profit_amount:
        status='unsupported_topic';notice='毛利额或毛利润是金额；当前问答没有提供该金额指标，不能用毛利率百分比替代。请核对原始财务表中的收入与成本，或明确改问已支持的毛利率。'
    elif unsupported_turnover:
        status='unsupported_topic';notice='当前不支持该周转指标或未明确对象的周转问题；本地仅可核查存货/库存周转率与总资产周转率，不支持应收账款、固定/流动资产周转或周转天数。请将受支持指标单独提问，不用另一指标或单位代替。'
    elif modifier_notice:
        status='unsupported_topic';notice=modifier_notice
    elif not topics and any(w in q for w in ('证据','资料','记忆','偏好','任务','执行','断点','行动','待办','跟进','截止','情景','敏感','假设','涨价','跌价')):
        status='workspace_query';notice='已按当前企业与工作身份查询相关资料或工作记录；本问题没有指定财务指标，因此不附加无关指标结论。'
    elif not topics:
        status='unsupported_topic';notice='当前问题未匹配可计算的财务指标。本地助手可核查收入、成本、利润、现金流、比率及其同/环比；请明确指标。资料匹配仅作为待审阅候选。'
    if status!='supported':topics=[]
    return {'status':status,'notice':notice,'topics':topics,'comparison':comparison,'period':period,
            'available_periods':available,'period_explicit':bool(quarters),'default_overview':overview,
            'comparison_explicit':previous or yearly,'period_basis':'single_quarter','can_calculate':status=='supported'}


def scoped_dataset(data, scope):
    return {**data,'periods':[p for p in data['periods'] if p['period']<=scope['period']]} if scope['can_calculate'] else data


def resolve_followup(text, data, defaults, previous=None):
    """Inherit only a bounded continuation's normalized scope, never prior prose.

    The immediately preceding response is authoritative for continuity. We do not
    skip unrelated/unsupported turns to discover a convenient older question.
    Explicit ambiguous periods remain unresolved instead of being repaired here.
    """
    scope = resolve_question(text, data, defaults)
    q = text.strip().lower()
    if (not previous or not previous.get('can_calculate') or len(q) > 80
            or scope['status'] in ('needs_clarification', 'period_unavailable')
            or any(word in q for word in ('最新', '最近', '换个', '新问题', '重新开始', 'latest'))):
        return scope
    cue = any(word in q for word in ('继续', '刚才', '接着', '那么', '那', '还有'))
    frame=q
    for pattern in PERIOD_PATTERNS:frame=re.sub(pattern,'',frame)
    for term in ('previous quarter','year over year','上一季度','上年同季','去年同季','同比','环比','上季'):
        frame=frame.replace(term,'')
    bare = re.fullmatch(r'(?:请|继续|再|接着|展开|分析|解释|核查|看|说说|刚才|上述|这些|之前|那么|那|还有|的|为什么|原因|依据|内容|结果|问题|吧|呢|一下|与|比较|[？?。！!，、\s])*', frame)
    if not ((cue and scope['topics']) or (bare and q and (cue or any(w in q for w in ('为什么', '展开', '这些'))))):
        return scope
    inherited = []
    if not scope['period_explicit']:
        scope['period'] = previous['period']; scope['period_explicit'] = True
        inherited.append('period')
    if not scope['comparison_explicit']:
        scope['comparison'] = previous['comparison']; scope['comparison_explicit'] = True
        inherited.append('comparison')
    # In a scope-only follow-up, “同比” chooses the baseline, not revenue growth.
    if bare or not scope['topics']:
        scope['topics'] = list(previous['topics']); inherited.append('topics')
    scope['inherited_fields'] = inherited
    if scope['period'] not in scope['available_periods']:
        scope.update(status='period_unavailable', can_calculate=False, topics=[],
            notice='追问所指的原季度已不在当前数据中，请补充原始输入或明确新的季度。')
    else:
        scope.update(status='supported', can_calculate=True, notice='')
    return scope


def scoped_handoff_query(text, scope):
    """Make a sourced question's normalized scope explicit in the approval text."""
    if not scope or not scope.get('can_calculate'):
        return text
    from .analytics import METRIC_LABELS
    topics = '、'.join(METRIC_LABELS.get(key, key) for key in scope['topics'])
    comparison = '环比' if scope['comparison'] == 'previous' else '同比'
    return f"核查范围：{scope['period']}，{comparison}，{topics}。\n当前目标：{text}"


def analysis_dataset(snapshot):
    """Apply an approved financial-period selection while retaining the full audit snapshot."""
    data=snapshot['dataset'];scope=snapshot.get('research_scope')
    if not scope or scope.get('status')!='selected':return data
    return {**data,'periods':[p for p in data['periods'] if p['period']<=scope['period']]}


def plan_scope(query, data):
    resolved=resolve_question(query,data,[])
    blocked=resolved['status'] in ('needs_clarification','period_unavailable')
    return {'status':'blocked' if blocked else 'selected','period':resolved['period'],
            'explicit':resolved['period_explicit'],'requested_comparison':resolved['comparison'] if resolved['comparison_explicit'] else None,'available_periods':resolved['available_periods'],
            'notice':resolved['notice'] if blocked else '限定财务输入截至目标季度；证据资料仍按本次检索范围，不声称历史当时已可获得。'}
