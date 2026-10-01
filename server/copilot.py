"""Persistent research copilot backed by real local tools and approved proposals.

No local response pretends to be a language-model inference. Open-ended reasoning
is a proposal to the same consent-gated Agent engine used by the main workspace.
"""
from __future__ import annotations
import time
from datetime import date, datetime, timezone
from . import workspace_store as ws
from .store import uid, now, digest, encode
from .security import fail
from .identities import resolve_identity, identity_binding, identity_context, context_user
from .analytics import calculate, quality_report, forecast_baselines, lineage, period_end, closed_quarter, METRIC_LABELS
from .intelligence import scoped_retrieve, build_insights
from .service_contracts import WatchSpec
from .business_provenance import resolve_source, assert_source_current, with_source_impact, report_impact


def migrate(store):
    with store.transaction() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS copilot_messages(
            id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES workspace_objects(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            request_key TEXT NOT NULL, request_hash TEXT NOT NULL, payload TEXT NOT NULL,
            created_at TEXT NOT NULL, UNIQUE(thread_id,request_key))''')
        db.execute('''CREATE TABLE IF NOT EXISTS tracking_receipts(
            rule_id TEXT NOT NULL REFERENCES workspace_objects(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            rule_version INTEGER NOT NULL, dataset_version INTEGER NOT NULL, created_at TEXT NOT NULL,
            PRIMARY KEY(rule_id,rule_version,dataset_version))''')
        db.execute('CREATE INDEX IF NOT EXISTS copilot_messages_thread ON copilot_messages(user_id,thread_id,created_at,id)')


def thread_context(store,user,thread_id):
    thread=ws.get(store,user['id'],'assistant_thread',thread_id)
    p=thread['payload']
    identity=resolve_identity(store,user['id'],p['identity_id'],p['dataset_id'])
    data=store.owned('datasets',user['id'],p['dataset_id']) if p['dataset_id'] else None
    if p['dataset_id'] and not data:
        fail('DATA_REMOVED','该会话的数据已删除，请创建新的研究会话',409)
    return thread,identity,data


def make_thread(store,user,body):
    with store.transaction() as db:
        identity=resolve_identity(store,user['id'],body.identity_id,body.dataset_id)
        if body.dataset_id and not store.owned('datasets',user['id'],body.dataset_id):
            fail('NOT_FOUND','企业数据不存在或无权访问',404)
        creation=body.model_dump(mode='json',exclude={'request_id'})
        request_hash=digest(creation)
        key='request:'+body.request_id if body.request_id else None
        old=ws.keyed(store,user['id'],'assistant_thread',key) if key else None
        if old:
            if old['payload'].get('creation_request_hash')!=request_hash:
                fail('IDEMPOTENCY_CONFLICT','同一会话提交标识不能对应不同范围或标题',409)
            return old
        return ws.save(store,db,user['id'],'assistant_thread',{
            **creation,'identity_snapshot':identity_context(identity),'creation_request_hash':request_hash},key=key)


def read_thread(store,user,id):
    # Historical conversations remain readable after their live scope is revoked.
    # Frozen context is display-only and never authorizes a new message or dispatch.
    from fastapi import HTTPException
    t=ws.get(store,user['id'],'assistant_thread',id)
    data=store.owned('datasets',user['id'],t['payload']['dataset_id']) if t['payload']['dataset_id'] else None
    writable=True;reason='';identity=None
    try:
        _,identity,_=thread_context(store,user,id)
    except HTTPException as exc:
        writable=False;reason=exc.detail.get('message','当前范围已失效')
    messages=store.all('SELECT id,payload,created_at FROM copilot_messages WHERE user_id=? AND thread_id=? ORDER BY created_at,id',(user['id'],id))
    proposals=store.all("SELECT * FROM workspace_objects WHERE user_id=? AND kind='assistant_proposal' AND json_extract(payload,'$.thread_id')=? ORDER BY created_at,id",(user['id'],id))
    runs=[]
    for p in proposals:
        r=p['payload'].get('result') or {}
        if r.get('run_id'):
            run=store.owned('runs',user['id'],r['run_id'])
            if run:
                runs.append({'id':run['id'],'state':run['state'],'error':run['error'],'result':run['result'],
                    'updated_at':run['updated_at'],'proposal_id':p['id'],
                    'dataset_version':run['snapshot']['dataset_version'],
                    'source_impact':report_impact(store,user['id'],run),
                    'current_dataset_version':data['version'] if data else None})
    return {'thread':t,'identity':identity_context(identity) if identity else t['payload'].get('identity_snapshot'),
            'messages':messages,'proposals':[with_source_impact(store,user['id'],p) for p in proposals],'runs':runs,
            'archived_mode':not writable,'read_only':not writable,
            'context':{'dataset_id':data['id'] if data else '', 'dataset_version':data['version'] if data else None,
                       'writable':writable,'unavailable_reason':reason}}


from .question_scope import resolve_followup, scoped_dataset, scoped_handoff_query


_RATIO_METRICS = {'gross_margin', 'net_margin', 'cash_ratio', 'leverage', 'revenue_growth', 'rd_ratio', 'roe', 'margin_change'}
_AMOUNT_METRICS = {'revenue', 'cost', 'net_profit', 'cash_flow'}
_DEFAULT_TOPICS = {
    'operator': ['gross_margin', 'cash_ratio', 'leverage'],
    'executive': ['revenue', 'revenue_growth', 'cash_ratio'],
    'investor': ['revenue_growth', 'net_margin', 'cash_ratio'],
    'researcher': ['revenue_growth', 'gross_margin', 'rd_ratio'],
    'auditor': ['cash_ratio', 'leverage', 'gross_margin'],
    'custom': ['gross_margin', 'cash_ratio', 'leverage'],
}


def _metric_text(value, key, *, difference=False):
    if value is None:
        return '缺少可用输入'
    if key in _RATIO_METRICS:
        return f'{value * 100:,.2f}' + ('个百分点' if difference else '%')
    return f'{value:,.2f}' + ('元' if key in _AMOUNT_METRICS else '次')


def _grounded_facts(data, result, topics, dataset, links, trend_limit):
    """Present the existing calculator's values, without a second financial engine."""
    series = result['series']; current = series[-1]
    baseline = next((p for p in series if p['period'] == result['baseline_period']), None)
    facts = []
    for key in topics:
        link = links.get(key, {})
        value = current.get(key) if key in _AMOUNT_METRICS else result['metrics'].get(key)
        inputs = link.get('inputs', [])
        formula = link.get('formula', '')
        if key in _AMOUNT_METRICS:
            inputs = [{'path': f"periods/{current['period']}/{key}", 'field': key, 'value': value, 'unit': 'CNY'}]
            formula = '已保存的单季度原始输入（标准化为元）'
        elif key == 'revenue_growth':
            formula = '本期收入 ÷ 指定同/环比基期收入 − 1；基期收入必须大于0'
            inputs = [{'path': f"periods/{p['period']}/revenue", 'field': 'revenue', 'value': p['revenue'], 'unit': 'CNY'}
                      for p in [current, baseline] if p]
        trend = []
        for point in series[-trend_limit:]:
            if key == 'revenue_growth':
                prefix = {**data, 'periods': [p for p in data['periods'] if p['period'] <= point['period']]}
                point_value = calculate(prefix, result['comparison'])['metrics'][key]
            else:
                point_value = point.get(key)
            trend.append({'period': point['period'], 'value': point_value})
        base_value = baseline.get(key) if baseline and key != 'revenue_growth' else None
        change = value - base_value if value is not None and base_value is not None else None
        facts.append({'id': key, 'label': METRIC_LABELS.get(key, key), 'value': value,
            'display_value': _metric_text(value, key), 'unit': 'ratio' if key in _RATIO_METRICS else 'CNY' if key in _AMOUNT_METRICS else 'times',
            'period': result['current_period'], 'dataset_id': dataset['id'], 'dataset_version': dataset['version'],
            'input_hash': dataset['content_hash'], 'formula': formula, 'inputs': inputs, 'trend': trend,
            'source_url': data.get('source_url', ''), 'verification': data.get('verification', 'unverified_user_input'),
            'status': 'missing' if value is None else 'available',
            'comparison': {'kind': result['comparison'], 'period': result['baseline_period'], 'value': base_value,
                           'change': change, 'change_unit': 'ratio_points' if key in _RATIO_METRICS else 'CNY' if key in _AMOUNT_METRICS else 'times'}})
    return facts


def answer_with_tools(store, user, identity, data, text, history):
    traces = []; cards = []; facts = []; citations = []; warnings = []; actions = []; next_steps = []
    started = time.perf_counter()
    ip = identity['payload'] if identity else {}
    context = {'identity': identity_context(identity), 'dataset_id': data['id'] if data else '',
        'dataset_version': data['version'] if data else None, 'dataset_hash': data['content_hash'] if data else None,
        'identity_binding': identity_binding(identity),
        'history_message_ids': [h['id'] for h in history[-4:]], 'history_used_for_topics': False}

    def tool(name, fn, inputs):
        t = time.perf_counter()
        try:
            result = fn()
        except ValueError as exc:
            result = {'status': 'blocked', 'reason': str(exc)[:300]}
        traces.append({'tool': name, 'state': 'blocked' if isinstance(result, dict) and result.get('status') == 'blocked' else 'succeeded',
            'milliseconds': round((time.perf_counter() - t) * 1000, 3), 'input': inputs,
            'output_hash': digest(result), 'engine': 'local_deterministic'})
        return result

    brief = {'intent': 'workspace_navigation', 'evidence_state': 'not_searched', 'causal_claims_supported': False}
    if not data:
        ids = ip.get('dataset_ids', [])
        lens = identity['id'] if identity else ''
        items = tool('workspace_inventory', lambda: {
            'datasets': len([d for d in store.items('datasets', user['id']) if not ids or d['id'] in ids]),
            'actions': len([a for a in ws.objects(store, user['id'], 'action') if a['payload'].get('identity_id', '') == lens]),
            'reports': store.one("SELECT count(*) AS n FROM runs WHERE user_id=? AND result IS NOT NULL AND COALESCE(json_extract(snapshot,'$.identity.id'),'')=?", (user['id'], lens))['n']}, {})
        cards.append({'kind': 'inventory', 'title': '当前服务身份的已保存内容', 'data': items})
        answer = '先选择企业，然后可在这里连续核查指标、查证据、看数据缺口和任务进展。没有数据时，不生成经营结论。'
        actions = [{'kind': 'navigate', 'label': '导入企业数据', 'route': 'data'}, {'kind': 'navigate', 'label': '管理服务身份', 'route': 'services'}]
    else:
        d = data['payload']; q = text.lower(); company = d['company']
        comparison = 'previous' if any(w in q for w in ('环比', '上一季度', '上季', 'previous quarter')) else 'year_over_year'
        effective_query = text
        previous=history[-1]['payload']['response'].get('context',{}).get('question_scope') if history else None
        question_scope=resolve_followup(text,d,_DEFAULT_TOPICS.get(ip.get('perspective','operator'),_DEFAULT_TOPICS['operator']),previous)
        if question_scope.get('inherited_fields'):
            context['history_used_for_topics']='topics' in question_scope['inherited_fields']
            context['history_scope_message_id']=history[-1]['id']
            effective_query=scoped_handoff_query(text,question_scope)
        topics=question_scope['topics'];comparison=question_scope['comparison'];d=scoped_dataset(d,question_scope)
        context['question_scope']=question_scope
        depth = ip.get('depth', 'balanced'); detail_limit = 3 if depth == 'concise' else 6 if depth == 'balanced' else 8
        topics = topics[:detail_limit]
        result = tool('financial_calculation', lambda: calculate(d, comparison), {'dataset_id': data['id'], 'version': data['version'], 'comparison': comparison})
        rows = tool('metric_lineage', lambda: lineage(d, result), {'metric_ids': topics})
        facts = _grounded_facts(d, result, topics, data, {r['id']: r for r in rows}, 4 if depth == 'concise' else 8)
        quality = tool('data_quality', lambda: quality_report(d), {'dataset_id': data['id'], 'version': data['version']})
        citations = tool('scoped_evidence_search', lambda: scoped_retrieve(store, user['id'], effective_query + ' ' + company, company, detail_limit), {'company': company, 'query': effective_query})
        insights = tool('proactive_findings', lambda: build_insights(store, user['id'], [data], identity_id=identity['id'] if identity else ''), {'dataset_id': data['id']})
        causal = any(w in q for w in ('为什么', '原因', '归因', '导致', '证明', 'why', 'cause'))
        warnings.extend(result['warnings'])
        if causal:
            warnings.append('数值变化和词法匹配资料不能证明原因；以下只给出已算事实与待核查路径，没有把相关性写成因果。')
        if not citations:
            warnings.append('当前问题未检索到适用的已保存资料；不能把未查到当成事实不存在。')
        elif any(c['review_state'] != 'accepted' for c in citations):
            warnings.append('检索片段包含尚未人工通过审阅的资料，匹配不等于结论成立。')
        if any(c['stale'] for c in citations):
            warnings.append('部分资料缺少发布日期或距今超过365天，请先核对时效。')
        observations = []
        for f in facts:
            sentence = f"{f['label']}为{f['display_value']}" if f['value'] is not None else f"{f['label']}缺少可用输入，保持空值"
            cmp = f['comparison']
            if cmp['change'] is not None:
                sentence += f"，较{cmp['period']}{'增加' if cmp['change'] > 0 else '减少' if cmp['change'] < 0 else '变化'}{_metric_text(abs(cmp['change']), f['id'], difference=True)}"
            observations.append(sentence)
        answer = f"{company} {result['current_period']}：" + '；'.join(observations[:detail_limit]) + '。'
        answer += '这些数值来自当前已保存输入，未经独立真实性核验。'
        if question_scope['notice']:answer=question_scope['notice']
        if causal and question_scope['can_calculate']:
            answer += '目前不能仅凭这些数据确定原因，需逐项核对原始凭证与相反证据。'
        if question_scope['can_calculate']:cards.append({'kind': 'quality', 'title': '输入质量与缺口', 'data': quality})
        if any(w in q for w in ('来源', '怎么算', '公式', '血缘', '依据', 'trace')) or ip.get('output_style') == 'evidence_first':
            cards.append({'kind': 'lineage', 'title': '字段来源与计算路径', 'data': [r for r in rows if r['id'] in topics]})
        if insights['items'] and question_scope['can_calculate'] and not question_scope['period_explicit']:
            cards.append({'kind': 'findings', 'title': '需要跟进的事项', 'data': insights['items'][:detail_limit]})
        next_steps = [{'title': item['title'], 'reason': item['message'], 'route': item['target'], 'acceptance': item['acceptance']}
                      for item in insights['items'][:3] if question_scope['can_calculate'] and not question_scope['period_explicit']]
        if not citations and not any(s['route'] == 'evidence' for s in next_steps):
            next_steps.append({'title': '补齐本问题的原始证据', 'reason': '当前检索没有适用资料', 'route': 'evidence',
                               'acceptance': '补充同企业、同期间原始资料，记录来源与支持/反向关系，并人工审阅'})
        if not next_steps:
            next_steps.append({'title': '核对数值与原始报表', 'reason': '计算一致性不能代替来源真实性', 'route': 'data',
                               'acceptance': '逐项核对本次指标的输入字段、期间、单位及来源，记录差异'})
        brief = {'intent': question_scope['status'] if not question_scope['can_calculate'] else 'causal_review' if causal else 'grounded_review', 'scope': {'company': company, 'period': result['current_period'] if question_scope['can_calculate'] else None,
            'comparison': comparison, 'baseline_period': result['baseline_period'], 'question_scope':question_scope, 'dataset_version': data['version'], 'depth': depth},
            'evidence_state': 'retrieved_candidates' if citations else 'no_matching_saved_evidence',
            'retrieval_method': 'owner_and_company_scoped_lexical_search', 'source_verification': quality['source_state'],
            'matched_document_count': len({c['document_id'] for c in citations}),
            'missing_metric_ids': [f['id'] for f in facts if f['value'] is None],
            'stance_counts': {stance: len({c['document_id'] for c in citations if c['stance'] == stance}) for stance in ('supports', 'contradicts', 'context')},
            'causal_claims_supported': False, 'objective': ip.get('objective', '')}
        if question_scope['can_calculate'] and any(w in q for w in ('预测', '回测', 'forecast')):
            metric = 'cash_flow' if '现金' in q else 'gross_margin' if '毛利' in q else 'cost' if '成本' in q else 'revenue'
            forecast = tool('forecast_baselines', lambda: forecast_baselines(d, metric, 2), {'metric': metric, 'horizon': 2, 'dataset_version': data['version']})
            cards.append({'kind': 'forecast', 'title': '透明基线回测', 'data': forecast})
            warnings.append('这是本地基线和明确的两步预测，不是因果模型或投资收益承诺。需要其他步数时在建模工作区设置。')
        if any(w in q for w in ('记忆', '偏好', '目标', '个性')):
            from .studio import selected_memory
            memory, excluded = tool('approved_identity_memory', lambda: selected_memory(store, context_user(user, identity), company, True), {'identity_id': identity['id'] if identity else ''})
            cards.append({'kind': 'memory', 'title': '本次允许使用的记忆', 'data': {'included': memory, 'excluded': excluded, 'identity': identity_context(identity)}})
        if any(w in q for w in ('进度', '任务', '报告', '执行', '状态', '断点')):
            runs = tool('run_status', lambda: store.all("SELECT id,state,error,updated_at FROM runs WHERE user_id=? AND dataset_id=? AND COALESCE(json_extract(snapshot,'$.identity.id'),'')=? ORDER BY created_at DESC LIMIT 8", (user['id'], data['id'], identity['id'] if identity else '')), {'dataset_id': data['id']})
            cards.append({'kind': 'runs', 'title': '真实运行记录', 'data': runs})
            actions.extend({'kind': 'navigate', 'label': '查看任务 ' + r['id'][:6], 'route': 'agents:run-' + r['id']} for r in runs[:2])
        if any(w in q for w in ('行动', '待办', '跟进', '截止')):
            active = [r for r in ws.objects(store, user['id'], 'action') if r['payload'].get('dataset_id') == data['id']
                      and r['payload'].get('identity_id', '') == (identity['id'] if identity else '')]
            cards.append({'kind': 'actions', 'title': '当前身份的跟进行动', 'data': active})
        if any(w in q for w in ('情景', '敏感', '假设', '涨价', '跌价')):
            warnings.append('情景变化幅度与固定成本占比需要你填写；没有从自然语言猜测参数后直接执行。')
            actions.append({'kind': 'navigate', 'label': '填写情景假设', 'route': 'lab'})
        actions.extend([{'kind': 'navigate', 'label': '补充或审阅资料', 'route': 'evidence'},
            {'kind': 'proposal', 'type': 'research', 'label': '交给 Agent 深入研判'},
            {'kind': 'proposal', 'type': 'action', 'label': '整理为跟进行动'},
            {'kind': 'proposal', 'type': 'watch', 'label': '建立指标跟踪'},
            {'kind': 'proposal', 'type': 'memory', 'label': '确认后保存为记忆'}])
    return {'answer': answer, 'engine': 'local_tool_copilot', 'facts': facts, 'cards': cards, 'citations': citations,
        'warnings': list(dict.fromkeys(warnings)), 'actions': actions, 'next_steps': next_steps, 'research_brief': brief,
        'receipts': traces, 'context': context, 'external_calls': 0,
        'milliseconds': round((time.perf_counter() - started) * 1000, 3)}

def send_message(store,user,thread_id,body):
    # The lock spans this short local computation and commit. No provider/network call
    # is made here. Concurrent submissions cannot observe the same thread revision.
    with store.transaction() as db:
        thread,identity,data=thread_context(store,user,thread_id)
        request_hash=digest({'text':body.text})
        old=store.one('SELECT * FROM copilot_messages WHERE user_id=? AND thread_id=? AND request_key=?',(user['id'],thread_id,body.request_id))
        if old:
            if old['request_hash']!=request_hash:
                fail('IDEMPOTENCY_CONFLICT','同一提交标识不能对应不同问题',409)
            return {'message':old,'thread':thread,'replayed':True}
        if body.version!=thread['version']:
            fail('VERSION_CONFLICT','此会话已在其他窗口更新，请读取后重发',409)
        history=store.all('SELECT * FROM copilot_messages WHERE user_id=? AND thread_id=? ORDER BY created_at,id',(user['id'],thread_id))
        if len(history)>=100:
            fail('THREAD_FULL','单个会话已达100轮，请新建会话；旧记录可导出',409)
        response=answer_with_tools(store,user,identity,data,body.text,history)
        mid=uid();payload={'question':body.text,'response':response}
        db.execute('INSERT INTO copilot_messages VALUES(?,?,?,?,?,?,?)',(mid,thread_id,user['id'],body.request_id,request_hash,encode(payload),now()))
        p=thread['payload'];p['title']=body.text[:60] if len(history)==0 else p['title']
        updated=ws.save(store,db,user['id'],'assistant_thread',p,key=thread['natural_key'],expected=thread['version'])
        return {'message':store.one('SELECT * FROM copilot_messages WHERE id=?',(mid,)), 'thread':updated,'replayed':False}


def proposal_binding(thread,identity,data):
    return {'thread_id':thread['id'],'identity':identity_binding(identity),
        'dataset_id':data['id'] if data else '', 'dataset_version':data['version'] if data else None,
        'dataset_hash':data['content_hash'] if data else None}


def propose(store,user,thread_id,body,settings,providers):
    # Preview and proposal persist as one unit. A failed save or process exit
    # cannot leave even a non-executable preview orphan behind.
    with store.transaction():
        return with_source_impact(store,user['id'],_propose(store,user,thread_id,body,settings,providers))


def _propose(store,user,thread_id,body,settings,providers):
    thread,identity,data=thread_context(store,user,thread_id)
    if not data:
        fail('DATA_REQUIRED','先为会话选择真实企业数据',422)
    key=thread_id+':'+body.request_id
    old=ws.keyed(store,user['id'],'assistant_proposal',key)
    req=body.model_dump(mode='json');rh=digest(req)
    if old:
        if old['payload']['request_hash']!=rh:
            fail('IDEMPOTENCY_CONFLICT','同一提案标识对应不同内容',409)
        return old
    text=body.text.strip()
    source=None
    if body.source_message_id:
        source=store.one('SELECT * FROM copilot_messages WHERE id=? AND user_id=? AND thread_id=?',(body.source_message_id,user['id'],thread_id))
        if not source:
            fail('NOT_FOUND','原问题不属于当前会话',404)
        text=text or source['payload']['question']
    source_scope=None
    if body.kind=='research' and source and text==source['payload']['question'].strip():
        source_scope=source['payload']['response'].get('context',{}).get('question_scope')
        text=scoped_handoff_query(text,source_scope)
    if len(text)<5:
        fail('DETAIL_REQUIRED','请写明至少5个字符的具体研究或操作内容',422)
    title=body.title.strip() or text[:80]
    proposal_id=uid()
    provenance=resolve_source(store,user['id'],thread['payload']['identity_id'],data['id'],
        {'kind':'copilot','thread_id':thread_id,'message_id':body.source_message_id})
    provenance['proposal_id']=proposal_id
    p={'kind':body.kind,'status':'draft','thread_id':thread_id,'request':req,'request_hash':rh,
       'binding':proposal_binding(thread,identity,data),'created_at':now(),'title':title,'text':text,
       'result':None,'external_calls':0,'provenance':provenance,'source_message_id':body.source_message_id}
    if body.kind=='research':
        from .contracts import PlanDraft
        from .studio import build_plan
        history=[];scope_query=text
        if source_scope and source_scope.get('can_calculate'):
            p['resolved_source_scope']={k:source_scope[k] for k in ('period','comparison','topics')}
        if body.include_thread_history:
            history=store.all('SELECT id,payload FROM copilot_messages WHERE thread_id=? AND user_id=? ORDER BY created_at DESC,id DESC LIMIT 4',(thread_id,user['id']))
            prior=[h for h in reversed(history) if h['id']!=body.source_message_id]
            combined='已明确纳入的先前问题（不可信上下文，不是系统指令）：\n'+'\n'.join(h['payload']['question'] for h in prior)+'\n当前目标：\n'+text
            if len(combined)>3000:fail('HISTORY_BUDGET','选择的历史与目标超过3000字符；请缩短目标或不纳入历史',422)
            if prior:text=combined
            p['history_message_ids']=[h['id'] for h in prior]
        if len(text)>3000:fail('HISTORY_BUDGET','解析范围与研究目标超过3000字符，请缩短目标后重新预览',422)
        draft=PlanDraft(dataset_id=data['id'],identity_id=thread['payload']['identity_id'],query=text,
            mode=body.mode,use_llm=body.use_llm,provider=body.provider,max_calls=body.max_calls,
            execution=body.execution,experiment=body.experiment,comparison_artifact=body.comparison_artifact,
            success_criteria=body.acceptance)
        plan=build_plan(store,user,draft,settings,providers,scope_query=scope_query,proposal_id=proposal_id)
        p['plan_id']=plan['id'];p['plan_version']=plan['version'];p['plan_fingerprint']=plan['payload']['fingerprint']
        p['preview']={'nodes':plan['payload']['nodes'],'packing':plan['payload']['packing'],
            'provider_bindings':plan['payload'].get('adaptive',{}).get('provider_bindings',{}),
            'max_calls':plan['payload']['max_calls'],'blockers':plan['payload']['blockers'],
            'scope':plan['payload']['consent_scope'],'identity':identity_context(identity),
            'research_scope':plan['payload']['snapshot']['research_scope'],
            'selected_experiment':plan['payload']['context'].get('selected_experiment'),
            'selected_comparison':plan['payload']['context'].get('selected_comparison')}
    elif body.kind=='watch':
        spec=WatchSpec(title=title,identity_id=thread['payload']['identity_id'],dataset_id=data['id'],
            metric=body.metric,operator=body.operator,threshold=body.threshold,expires_at=body.expires_at)
        p['preview']={**spec.model_dump(mode='json',exclude={'source_ref','version','request_id'}),'provenance':provenance,'evaluation_revision':1}
    elif body.kind=='action':
        if len(body.acceptance.strip())<5:
            fail('ACCEPTANCE_REQUIRED','请填写具体的行动验收标准',422)
        p['preview']={'title':title,'description':text,'company':data['payload']['company'],'dataset_id':data['id'],
            'run_id':'','source_key':'','priority':'normal','owner':'','due_at':body.due_at.isoformat() if body.due_at else None,
            'acceptance':body.acceptance,'identity_id':thread['payload']['identity_id'],'provenance':provenance}
    else:
        if len(text)>1500:
            fail('MEMORY_TOO_LONG','记忆最多1500个字符，请整理后保存',422)
        p['preview']={'text':text,'kind':'note','company':data['payload']['company'],'role':'all',
            'identity_id':thread['payload']['identity_id'],'approved':True,'expires_at':None,'source':'copilot_explicit_confirmation'}
    p['fingerprint']=digest(p)
    with store.transaction() as db:
        # Re-check scope/version and idempotency after preview construction.
        current,ci,cd=thread_context(store,user,thread_id)
        if proposal_binding(current,ci,cd)!=p['binding']:
            fail('PROPOSAL_STALE','预览期间输入已变化，请重新生成提案',409)
        concurrent=ws.keyed(store,user['id'],'assistant_proposal',key)
        if concurrent:
            if concurrent['payload']['request_hash']!=rh:
                fail('IDEMPOTENCY_CONFLICT','提案提交冲突',409)
            return concurrent
        assert_source_current(store,user['id'],provenance)
        return with_source_impact(store,user['id'],ws.save(store,db,user['id'],'assistant_proposal',p,key=key,id=proposal_id))


def confirm_proposal(store,user,id,body,settings,providers):
    # Serialize confirmation with discard/update, and commit the approved run
    # and executed proposal together. No external request occurs in this unit.
    with store.transaction():
        return with_source_impact(store,user['id'],_confirm_proposal(store,user,id,body,settings,providers))


def cancel_proposal_preview(store,db,user_id,proposal):
    """Revoke linked legacy previews too, while retaining independent runs."""
    plan_id=proposal['payload'].get('plan_id')
    if not plan_id:return
    plan=store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='plan' AND id=?",(user_id,plan_id))
    if plan and plan['payload']['status'] not in ('dispatched','cancelled'):
        ws.save(store,db,user_id,'plan',{**plan['payload'],'status':'cancelled'},key=plan['natural_key'],expected=plan['version'])


def _confirm_proposal(store,user,id,body,settings,providers):
    row=ws.get(store,user['id'],'assistant_proposal',id);p=row['payload']
    if body.fingerprint!=p['fingerprint']:
        fail('PROPOSAL_MISMATCH','提案指纹不匹配',409)
    if p['status']=='executed':
        return row
    if p['status']!='draft' or body.version!=row['version']:
        fail('VERSION_CONFLICT','提案版本或状态已变化',409)
    if digest({k:v for k,v in p.items() if k!='fingerprint'})!=p['fingerprint']:
        fail('PROPOSAL_CORRUPT','提案内容与批准指纹不一致，未执行',409)
    t,i,d=thread_context(store,user,p['thread_id'])
    if proposal_binding(t,i,d)!=p['binding']:
        fail('PROPOSAL_STALE','数据或服务身份已变化，请重新预览',409)
    assert_source_current(store,user['id'],p.get('provenance'))
    if (datetime.now(timezone.utc)-datetime.fromisoformat(p['created_at'])).total_seconds()>86400:
        fail('PROPOSAL_EXPIRED','提案超过24小时，请重新预览',409)
    if p['kind']=='research':
        from .contracts import PlanConsent
        from .studio import dispatch_plan
        run=dispatch_plan(store,user,p['plan_id'],PlanConsent(version=p['plan_version'],fingerprint=p['plan_fingerprint'],external_consent=body.external_consent),settings,providers,proposal_id=id)
        result={'run_id':run['id'],'route':'agents:run-'+run['id']}
        # Nested saves remain inside confirm_proposal's outer transaction.
        with store.transaction() as db:
            current=ws.get(store,user['id'],'assistant_proposal',id)
            if current['payload']['status']=='executed':
                return current
            return ws.save(store,db,user['id'],'assistant_proposal',{**p,'status':'executed','result':result},key=row['natural_key'],expected=current['version'])
    with store.transaction() as db:
        row=ws.get(store,user['id'],'assistant_proposal',id);p=row['payload']
        if p['status']=='executed':
            return row
        if p['status']!='draft' or body.version!=row['version']:
            fail('VERSION_CONFLICT','提案已改变，未执行后续写入',409)
        t,i,d=thread_context(store,user,p['thread_id'])
        if proposal_binding(t,i,d)!=p['binding']:
            fail('PROPOSAL_STALE','输入已变化',409)
        assert_source_current(store,user['id'],p.get('provenance'))
        if p['kind']=='watch':
            value=ws.save(store,db,user['id'],'watch',p['preview'])
            result={'watch_id':value['id'],'route':'tracking'}
        elif p['kind']=='action':
            v={**p['preview'],'origin':dict(p['preview']),'origin_kind':'copilot','changes':[],'status':'open',
                'history':[{'at':now(),'status':'open','from':None,'to':'open','note':'用户在研究助手中明确批准创建','evidence_ids':[],'evidence_snapshots':[]}]}
            value=ws.save(store,db,user['id'],'action',v)
            result={'action_id':value['id'],'route':'actions'}
        else:
            if store.one('SELECT count(*) AS n FROM memories WHERE user_id=?',(user['id'],))['n']>=200:
                fail('RESOURCE_LIMIT','记忆数量达到上限',409)
            mid=uid();at=now()
            db.execute('INSERT INTO memories VALUES(?,?,?,?,?,?)',(mid,user['id'],encode(p['preview']),1,at,at))
            store.audit(db,user['id'],'memories',mid,'created',{'source':'assistant_explicit_confirmation'})
            result={'memory_id':mid,'route':'memory'}
        return ws.save(store,db,user['id'],'assistant_proposal',{**p,'status':'executed','result':result},key=row['natural_key'],expected=row['version'])


def evaluate_watches(store,user_id,*,today=None):
    """Local rule evaluation: on explicit reads and once per minute while server runs.

Each material evaluation revision + input version gets at most one alert. The
legacy receipt column is named rule_version; it stores this semantic revision.
Missing or outdated
inputs are visible evaluations, never silently converted into safe values.
"""
    today=today or datetime.now(timezone.utc).date();evaluations=[]
    with store.transaction() as db:
        for rule in ws.objects(store,user_id,'watch'):
            p=rule['payload']
            if not p['active']:
                continue
            d=store.owned('datasets',user_id,p['dataset_id'])
            evaluation_revision=p.get('evaluation_revision',rule['version'])
            entry={'rule_id':rule['id'],'title':p['title'],'state':'unknown','reason':'数据已删除',
                   'expires_at':p.get('expires_at'),'rule_version':rule['version'],'evaluation_revision':evaluation_revision,
                   'dataset_id':p['dataset_id'],'dataset_version':d['version'] if d else None,
                   'dataset_hash':d['content_hash'] if d else None,'threshold':p['threshold'],'operator':p['operator']}
            if p.get('expires_at') and today.isoformat()>p['expires_at']:
                evaluations.append({**entry,'state':'expired','reason':'已超过跟踪结束日期，不再生成提醒'});continue
            if d:
                identity=None
                if p.get('identity_id'):
                    identity=store.one("SELECT * FROM workspace_objects WHERE user_id=? AND id=? AND kind='identity'",(user_id,p['identity_id']))
                    if not identity or (identity['payload']['dataset_ids'] and d['id'] not in identity['payload']['dataset_ids']):
                        evaluations.append({**entry,'reason':'服务身份已删除或企业已不在范围'});continue
                a=calculate(d['payload']);latest=d['payload']['periods'][-1]
                value=latest.get(p['metric']) if p['metric'] in ('revenue','cash_flow') else a['metrics'].get(p['metric'])
                stale=(today-period_end(latest['period'])).days>p['stale_after_days']
                entry.update({'value':value,'metric':p['metric'],'period':latest['period'],'dataset_version':d['version'],'dataset_id':d['id'],'dataset_hash':d['content_hash']})
                if not closed_quarter(latest['period'],today):
                    entry['reason']='最新输入属于尚未结束或未来季度，不能判断完成季度指标'
                    entry['state']='incomplete'
                elif value is None:
                    entry['reason']='所需指标缺失，不判断安全或触发'
                elif stale:
                    entry['reason']='输入超过规则时效上限，请更新数据'
                    entry['state']='stale'
                else:
                    hit=value<p['threshold'] if p['operator']=='lt' else value>p['threshold']
                    entry.update({'state':'triggered' if hit else 'clear','reason':'已按用户阈值核对'})
                    if hit:
                        key=f"{rule['id']}:{evaluation_revision}:{d['version']}"
                        receipt=store.one('SELECT 1 AS present FROM tracking_receipts WHERE rule_id=? AND rule_version=? AND dataset_version=?',(rule['id'],evaluation_revision,d['version']))
                        old=ws.keyed(store,user_id,'alert',key)
                        if old:
                            entry['alert_id']=old['id']
                        elif receipt:
                            entry['reason']='该输入对应的提醒已归档，不重复推送'
                        elif len(ws.objects(store,user_id,'alert',200))<200:
                            alert=ws.save(store,db,user_id,'alert',{**entry,'identity_id':p.get('identity_id',''),
                                'threshold':p['threshold'],'operator':p['operator'],'acknowledged':False,'evaluated_at':now(),
                                'identity_binding':identity_binding(identity),
                                'provenance':{'schema_version':1,'kind':'watch_evaluation','captured_at':now(),
                                    'dataset_id':d['id'],'dataset_version':d['version'],'dataset_hash':d['content_hash'],
                                    'company':d['payload']['company'],'identity_id':p.get('identity_id',''),
                                    'identity_binding':identity_binding(identity),'rule_id':rule['id'],'rule_version':rule['version'],
                                    'evaluation_revision':evaluation_revision,
                                    'rule_origin':p.get('provenance'),'evidence':[]}},key=key)
                            entry['alert_id']=alert['id']
                            db.execute('INSERT OR IGNORE INTO tracking_receipts VALUES(?,?,?,?,?)',(rule['id'],user_id,evaluation_revision,d['version'],now()))
                        else:
                            entry['reason']='已触发但历史提醒达到上限，请整理；没有丢弃原提醒'
            evaluations.append(entry)
    return {'evaluations':evaluations,'evaluated_at':now(),'engine':'local_rules','external_calls':0}
