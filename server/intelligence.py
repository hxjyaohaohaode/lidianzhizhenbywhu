"""Evidence-scoped proactive rules and explicit assistant routing, not simulated LLM chat."""
from __future__ import annotations
from datetime import date
from .analytics import calculate, quality_report, period_end, METRIC_LABELS
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


def assistant_answer(store,user,query,dataset_id=''):
    datasets=store.items('datasets',user)
    d=next((x for x in datasets if x['id']==dataset_id),None) if dataset_id else (datasets[0] if len(datasets)==1 else None)
    if dataset_id and d is None:
        from .security import fail
        fail('NOT_FOUND','数据不存在或无权访问',404)
    if not d:
        return {'engine':'local_navigation','answer':'先选择企业数据，我再根据已保存内容列出可执行的核查步骤。不会自动导入或编造经营数据。',
            'facts':[],'actions':[{'label':'添加经营数据','route':'data'}]}
    analysis=calculate(d['payload']);q=query.lower();facts=[]
    topics=[('cash_ratio',['现金','回款','cash']),('gross_margin',['毛利','成本','margin']),('leverage',['负债','杠杆']),('revenue_growth',['收入','营收','growth'])]
    selected=[field for field,words in topics if any(w in q for w in words)] or ['gross_margin','cash_ratio']
    for f in selected:
        facts.append({'id':f,'label':METRIC_LABELS[f],'value':analysis['metrics'].get(f),'period':analysis['current_period'],
            'dataset_id':d['id'],'dataset_version':d['version'],'input_hash':d['content_hash']})
    tasks=build_insights(store,user,[d])['items']
    return {'engine':'local_grounded_router','answer':f"已读取{d['payload']['company']}的已保存财务指标。下面是可核验事实和待办入口；需要开放式解释时，请在协同工作台确认模型计划。",
        'facts':facts,'insights':tasks[:4], 'actions':[{'label':'创建针对性诊断','route':'agents','query':query,'dataset_id':d['id']},
            {'label':'查看数据与计算口径','route':'data','dataset_id':d['id']},
            {'label':'打开情景实验','route':'lab','dataset_id':d['id']}], 'external_calls':0}
