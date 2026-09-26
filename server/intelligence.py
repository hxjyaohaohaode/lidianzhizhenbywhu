"""Evidence-scoped proactive rules and explicit assistant routing, not simulated LLM chat."""
from __future__ import annotations
from datetime import date
from .analytics import calculate, quality_report, period_end, lineage, METRIC_LABELS
from .store import digest
from . import workspace_store as ws


def profile_for(store,user,company):
    row=ws.keyed(store,user,'profile',company)
    return row['payload'] if row else {'company':company,'focus':['margin','cash'],'objective':'',
        'stale_after_days':180,'margin_floor':None,'cash_floor':None,'leverage_ceiling':None}


def evidence_catalog(store,user):
    reviews={r['natural_key']:r for r in ws.objects(store,user,'evidence_review')}
    rows=store.items('evidence',user)
    today=date.today().isoformat()
    out=[]
    for row in rows:
        rv=reviews.get(row['id']);review=rv['payload'] if rv else {'status':'unreviewed','company':'','tags':[],'stance':'context','note':'','expires_at':None}
        eligible=review['status']!='rejected' and not (review.get('expires_at') and review['expires_at']<today)
        out.append({**row,'review':review,'review_version':rv['version'] if rv else 0,
            'eligible':eligible,'excluded_reason': 'rejected' if review['status']=='rejected' else 'expired' if not eligible else None})
    return out


def scoped_retrieve(store,user,query,company='',limit=6):
    # Filter in SQL BEFORE FTS top-k. An unrelated document must not crowd out a scoped one.
    from .retrieval import retrieve_indexed
    return retrieve_indexed(store,user,query,limit,company=company)


def build_insights(store,user,datasets=None,today=None):
    today=today or date.today();datasets=datasets if datasets is not None else store.items('datasets',user)
    docs=evidence_catalog(store,user);items=[];focus_by_company={d['payload']['company']:profile_for(store,user,d['payload']['company']).get('focus',[]) for d in datasets}
    dismissed={o['natural_key'] for o in ws.objects(store,user,'dismissal')}
    actions={o['payload'].get('source_key'):o['id'] for o in ws.objects(store,user,'action',1000)}
    def add(row,code,title,message,priority,proof,target,acceptance):
        key=f"{row['id']}:{row['version']}:{code}"
        if key in dismissed:return
        items.append({'key':key,'code':code,'title':title,'message':message,'priority':priority,
            'company':row['payload']['company'],'dataset_id':row['id'],'dataset_version':row['version'],
            'proof':proof,'target':target,'acceptance':acceptance,'action_id':actions.get(key),
            'engine':'deterministic_rule'})
    for d in datasets:
        data=d['payload'];company=data['company'];a=calculate(data);m=a['metrics'];p=profile_for(store,user,company)
        q=quality_report(data,today);fields=q['field_coverage']['missing']
        if fields:
            add(d,'missing','补齐诊断关键输入','缺少'+ '、'.join(METRIC_LABELS.get(f,f) for f in fields),'normal',
                {'fields':fields},'data','补齐原始财务数据、保留来源并重新运行诊断')
        mismatches=[f for f in q['findings'] if f['code']=='BALANCE_MISMATCH']
        if mismatches:
            add(d,'balance','资产口径存在待核对差异','资产−负债与净资产不一致；先检查合并口径与单位','high',
                {'findings':mismatches},'data','核对原始财报口径，记录原因并保存修订或证据')
        for key,field,bound,op,title in [('margin','gross_margin','margin_floor','below','毛利率低于自定目标'),
            ('cash','cash_ratio','cash_floor','below','现金回流低于自定目标'),('leverage','leverage','leverage_ceiling','above','杠杆超过自定上限')]:
            value=m.get(field);threshold=p.get(bound)
            if value is not None and threshold is not None and ((value<threshold) if op=='below' else (value>threshold)):
                add(d,key,title,'按企业工作目标触发，不改变底层财务计算或行业评分','high',
                    {'metric':field,'value':value,'threshold':threshold,'operator':op},'agents','列出原因假设、支持/反向证据及负责人可执行措施')
        latest=data['periods'][-1]
        if latest.get('cash_flow') is not None and latest['cash_flow']<0:
            add(d,'negative_cash','核查经营现金流净流出','本期经营现金流小于零，需要结合回款与付款时点审阅','high',
                {'field':'cash_flow','value':latest['cash_flow'],'period':latest['period']},'agents','核查现金流量表与回款变化，并附原始凭证或分析说明')
        age=(today-period_end(latest['period'])).days
        if age>p.get('stale_after_days',180):
            add(d,'stale','更新最近一期经营数据',f'最近季度结束至今已{age}天，超过自定时效阈值','normal',
                {'age_days':age,'threshold_days':p.get('stale_after_days',180)},'data','核实是否存在更新的完整季度报告并补充')
        eligible=[doc for doc in docs if doc['eligible'] and doc['review'].get('company') in ('',company)]
        if not eligible:
            add(d,'evidence','为诊断补充原始证据','尚无可用于当前企业的证据文件；行业解释将保持空缺','normal',
                {'eligible_document_count':0},'evidence','录入相关原始资料，标注企业和来源并完成人工审阅')
        stances={doc['review'].get('stance') for doc in eligible}
        if {'supports','contradicts'}<=stances:
            add(d,'counterevidence','对照支持与反向证据','存在人工标为支持和反驳的资料；这不自动证明语义矛盾','normal',
                {'document_ids':[doc['id'] for doc in eligible if doc['review'].get('stance') in ('supports','contradicts')]},
                'evidence','核对不同证据是否针对相同论点、期间与业务范围')
        last_run=store.one('SELECT * FROM runs WHERE user_id=? AND dataset_id=? AND result IS NOT NULL ORDER BY created_at DESC LIMIT 1',(user,d['id']))
        if last_run and last_run['snapshot']['dataset_version']!=d['version']:
            add(d,'report_stale','数据已更新，旧报告不自动改写','最近诊断使用了较早的数据修订，需要显式重跑','normal',
                {'run_id':last_run['id'],'report_version':last_run['snapshot']['dataset_version'],'current_version':d['version']},
                'agents','用当前数据创建新计划并对照新旧报告差异')
    order={'high':0,'normal':1,'low':2}
    items.sort(key=lambda x:(order[x['priority']],0 if x['code'] in focus_by_company[x['company']] else 1,x['company'],x['code']))
    return {'items':items,'evaluated_at':today.isoformat(),'engine':'deterministic_rules',
        'evaluated_datasets':len(datasets),'autonomous_external_calls':0}


ASSISTANT_TOPICS=(
    ('gross_margin',('毛利','成本','margin')),
    ('cash_ratio',('现金','回款','cash')),
    ('leverage',('负债','杠杆','偿债')),
    ('revenue_growth',('增长','增速','同比','growth')),
    ('revenue',('收入','营收','销售额','revenue')),
    ('net_margin',('净利率','盈利能力')),
    ('net_profit',('净利润','利润额')),
    ('inventory_turnover',('库存','存货','周转')),
    ('rd_ratio',('研发','rd')),
)

ROLE_QUESTIONS={
    'enterprise':['哪些经营指标偏离自定目标？','现金流和毛利的变化依据是什么？'],
    'investor':['收入增长与现金回流是否一致？','有哪些相反证据需要核查？'],
    'analyst':['哪些指标缺少输入或基期？','请展示毛利率的计算血缘。'],
    'advisor':['当前最值得跟进的行动是什么？','现有证据能支持哪些判断？'],
}


def assistant_answer(store,user,query,dataset_id=''):
    owner=user['id'];datasets=store.items('datasets',owner)
    d=next((x for x in datasets if x['id']==dataset_id),None) if dataset_id else (datasets[0] if len(datasets)==1 else None)
    if dataset_id and d is None:
        from .security import fail
        fail('NOT_FOUND','数据不存在或无权访问',404)
    role=user['preferences'].get('role','enterprise')
    if not d:
        has_data=bool(datasets)
        return {'engine':'local_navigation','answer':('请选择一家企业；多个数据集不会被助手擅自合并。' if has_data else '先添加真实企业数据，助手才能核查指标与来源。'),
            'facts':[],'insights':[],'evidence_matches':[],'quality':[],'followups':ROLE_QUESTIONS.get(role,ROLE_QUESTIONS['enterprise']),
            'actions':[{'label':'选择企业数据' if has_data else '添加经营数据','route':'data'}], 'external_calls':0}
    data=d['payload'];analysis=calculate(data);q=query.lower()
    selected=[field for field,words in ASSISTANT_TOPICS if any(w in q for w in words)]
    if not selected:selected=['gross_margin','cash_ratio']
    selected=selected[:5];latest=data['periods'][-1];links={x['id']:x for x in lineage(data,analysis)}
    baseline=next((p for p in data['periods'] if p['period']==analysis['baseline_period']),None)
    facts=[]
    for f in selected:
        link=links.get(f)
        if f in ('revenue','cost','net_profit','cash_flow'):
            value=latest.get(f);formula='原始季度录入值';inputs=[{'path':f"periods/{latest['period']}/{f}",'value':value}]
        elif f=='revenue_growth':
            value=analysis['metrics'][f];formula='本期收入 ÷ 去年同季收入 − 1'
            inputs=[{'path':f"periods/{latest['period']}/revenue",'value':latest['revenue']}]
            if baseline:inputs.append({'path':f"periods/{baseline['period']}/revenue",'value':baseline['revenue']})
        elif link:
            value=link['value'];formula=link['formula'];inputs=[{'path':x['path'],'value':x['value']} for x in link['inputs']]
        else:
            value=analysis['metrics'].get(f);formula='由季度财务字段计算；详情见数据与计算口径';inputs=[]
        trend=[]
        for period in analysis['series'][-8:]:
            prior=next((p for p in data['periods'] if p['period']==f"{int(period['period'][:4])-1}{period['period'][4:]}"),None)
            point=(period['revenue']/prior['revenue']-1 if prior and prior['revenue']>0 else None) if f=='revenue_growth' else period.get(f)
            trend.append({'period':period['period'],'value':point})
        facts.append({'id':f,'label':METRIC_LABELS[f],'value':value,'period':analysis['current_period'],
            'dataset_id':d['id'],'dataset_version':d['version'],'input_hash':d['content_hash'],
            'formula':formula,'inputs':inputs,'trend':trend,'source_url':data.get('source_url',''),
            'verification':data.get('verification','unverified_user_input')})
    quality=quality_report(data)
    evidence=scoped_retrieve(store,owner,query,data['company'],3)
    tasks=build_insights(store,owner,[d])['items']
    causal=any(w in q for w in ('为什么','原因','归因','导致','证明'))
    answer=(f"已核对{data['company']}的{analysis['current_period']}已保存输入与计算口径。"
            +(' 指标和检索片段不能单独证明原因；请在协同研判中提出假设并核对反向证据。' if causal else ' 指标来自用户录入，资料片段仅是待核实候选。'))
    return {'engine':'local_grounded_router','answer':answer,'scope':{'company':data['company'],'dataset_id':d['id'],
            'dataset_version':d['version'],'input_hash':d['content_hash'],'source_state':quality['source_state'],
            'role':role,'objective':profile_for(store,owner,data['company']).get('objective','')},
        'facts':facts,'insights':tasks[:4],'evidence_matches':[{'document_id':x['document_id'],'title':x['title'],
            'excerpt':x['excerpt'][:300],'source_url':x['url'],'verification':x['verification'],
            'review_state':x['review_state'],'stance':x['stance'],'content_hash':x['content_hash']} for x in evidence],
        'quality':quality['findings'][:5],'quality_total':len(quality['findings']),
        'followups':ROLE_QUESTIONS.get(role,ROLE_QUESTIONS['enterprise']),
        'actions':[{'label':'按此问题创建诊断计划','route':'agents','query':query,'dataset_id':d['id']},
            {'label':'核对原始数据与公式','route':'data','dataset_id':d['id']},
            {'label':'审阅资料及来源','route':'evidence','dataset_id':d['id']},
            {'label':'设定情景假设','route':'lab','dataset_id':d['id']}], 'external_calls':0}
