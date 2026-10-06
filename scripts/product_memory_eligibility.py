"""I8 normal consent withdrawal through actual UI; no database fault or API write."""
from pathlib import Path
import re
try:
    from .product_first_use_audit import require_native_contract, canonical_hash
    from .product_integrity_outcomes import _capture_response, _error_submit, _open_report_from_list
    from .product_source_integrity import _execute_local_report, _visible_response_error
    from .product_readout_oracles import observe_text_by_normal_scroll
    from .product_browser_audit import FIXTURE_COMPANY
except ImportError:
    from product_first_use_audit import require_native_contract, canonical_hash
    from product_integrity_outcomes import _capture_response, _error_submit, _open_report_from_list
    from product_source_integrity import _execute_local_report, _visible_response_error
    from product_readout_oracles import observe_text_by_normal_scroll
    from product_browser_audit import FIXTURE_COMPANY

QUERY='2024-Q4毛利率是多少'
OLD_ACTION='I8停用记忆前的原行动'
OLD_WATCH='I8停用记忆前的原规则'
NEW_ACTION='I8明确保留可信历史的行动'
NOTE='I8独立合成记忆：核对本企业原始收入与成本，不推断投资收益。'
WATCH='form[data-service-form="watch"]'


def one(rows, key):
    result=[row for row in rows if row['id']==key]
    assert len(result)==1
    return result[0]


def unchanged(row, old):
    for key in ('id','user_id','kind','natural_key','payload','version','created_at','updated_at'):
        if key in old:assert row[key]==old[key], 'Saved original changed: '+key


def changed(row):
    impact=row['source_impact']
    assert impact['state']=='changed'
    reasons=[r for r in impact['reasons'] if r['code']=='memory_withdrawn']
    assert len(reasons)==1 and '记忆' in reasons[0]['message']
    return reasons[0]['message']


def original_report(p, run):
    current=p.get('/api/runs/'+run['id'])
    assert current['result']==run['result'] and current['snapshot']==run['snapshot']
    audit=p.get('/api/workspace/runs/'+run['id']+'/audit')
    assert audit['report_integrity']['valid']
    return audit


def tracking(p):
    status,body=_capture_response(p,'GET','/api/services/tracking',lambda:p.navigate('tracking'))
    assert status==200 and body['external_calls']==0
    p.observations.setdefault('tracking_reads',[]).append(body)
    return body


def open_action(p, row):
    p.navigate('actions')
    card=p.visible('#main').locator('.action-card').filter(has=p.page.get_by_role('heading',name=row['payload']['title'],exact=True))
    assert card.count()==1 and card.get_attribute('data-id')==row['id']
    p.step('按保存的原行动标题打开其来源',lambda:card.click())
    panel=p.visible('#inspector .business-source')
    assert '来源已有变化' in panel.inner_text()
    reason=changed(row)
    observe_text_by_normal_scroll(p,panel.get_by_text(reason,exact=True),reason,'行动明确说明记忆当前不再适用')
    return panel


def memory_preference_withdrawal(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    require_native_contract(p,repository_root=repository_root,data_dir=data_dir,
        expected_web_tree=expected_web_tree,expected_server_tree=expected_server_tree)
    p.bootstrap();p.record_artifact(Path(p.directory)/'synthetic-financial-input.csv',kind='synthetic-input')
    if not p.visible('#preferences-form [name="memory_enabled"]').is_checked():
        p.step('明确允许已批准记忆用于本地研究',lambda:p.visible('#preferences-form [name="memory_enabled"]').check())
        p.submit('#preferences-form',after='#preferences-form')
    p.navigate('memory');p.click('#main > header.page-heading [data-action="memory-dialog"]',after='#memory-form')
    p.fill('#memory-form [name="text"]',NOTE);p.fill('#memory-form [name="company"]',FIXTURE_COMPANY)
    p.select('#memory-form [name="role"]','all')
    p.step('由隔离合成用户明确批准这条企业记忆',lambda:p.visible('#memory-form [name="approved"]').check())
    p.submit('#memory-form',after='#main[data-page="memory"]')
    memories=p.get('/api/memories')['items'];assert len(memories)==1
    memory=memories[0];assert memory['payload']['text']==NOTE and memory['payload']['approved']
    dataset=p.get('/api/datasets/'+p.dataset_id)
    p.navigate('agents');p.fill('#plan-form [name="query"]',QUERY)
    assert not p.visible('#use-llm').is_checked()
    status,plan=_capture_response(p,'POST','/api/workspace/plans',lambda:p.submit('#plan-form',after='#execute-plan-form'))
    assert status==201
    selected=p.page.locator('#main summary').filter(has_text=re.compile(r'^已选记忆 · 1 条$'))
    assert selected.count()==1
    p.step('实际展开并阅读计划使用的已批准记忆',lambda:selected.click())
    observe_text_by_normal_scroll(p,selected.locator('..').get_by_text(NOTE,exact=False),NOTE,'计划记忆原文可读')
    old_memory=plan['payload']['snapshot']['memory']
    assert len(old_memory)==1 and old_memory[0]['id']==memory['id']
    assert old_memory[0]['payload_hash']==canonical_hash(memory['payload'])
    run=_execute_local_report(p,plan,dataset,plan['user_id'])
    assert run['result']['query']==QUERY and run['result']['llm']['calls']==[]
    assert run['snapshot']['memory']==old_memory
    p.observations['baseline_report']=p.observations.pop('recovered_report')
    assert original_report(p,run)['source_impact']['state']=='current'
    p.click('#main [data-action="action-from-report"]',after='#action-form')
    p.fill('#action-form [name="title"]',OLD_ACTION);p.fill('#action-form [name="acceptance"]','人工核对原始收入成本与本次批准记忆，记录复核依据。')
    status,action=_capture_response(p,'POST','/api/workspace/actions',lambda:p.submit('#action-form'))
    assert status==201 and action['source_impact']['state']=='current'
    _open_report_from_list(p,run,QUERY)
    p.click('#main [data-x-action="watch-from-report"]',after=WATCH)
    p.fill(WATCH+' [name="title"]',OLD_WATCH);p.fill(WATCH+' [name="threshold"]','10')
    status,watch=_capture_response(p,'POST','/api/services/watches',lambda:p.submit(WATCH))
    assert status==201 and watch['source_impact']['state']=='current' and watch['payload']['threshold']==.1
    p.navigate('settings');assert p.visible('#preferences-form [name="memory_enabled"]').is_checked()
    p.step('在真实偏好页关闭记忆使用，保留原记忆记录',lambda:p.visible('#preferences-form [name="memory_enabled"]').uncheck())
    p.submit('#preferences-form',after='#preferences-form')
    assert p.get('/api/auth/me')['user']['preferences']['memory_enabled'] is False
    assert p.get('/api/memories')['items']==memories
    p.navigate('agents');p.fill('#plan-form [name="query"]',QUERY+'（停用记忆后重新预览）')
    status,new_plan=_capture_response(p,'POST','/api/workspace/plans',lambda:p.submit('#plan-form',after='#execute-plan-form'))
    assert status==201 and new_plan['payload']['snapshot']['memory']==[]
    assert new_plan['payload']['status']=='draft' and new_plan['payload']['run_id'] is None
    none=p.page.locator('#main summary').filter(has_text=re.compile(r'^已选记忆 · 0 条$'));assert none.count()==1
    observe_text_by_normal_scroll(p,none,'已选记忆 · 0 条','新预览不再包含已停用的记忆')
    _open_report_from_list(p,run,QUERY)
    audit=original_report(p,run);reason=changed(audit)
    warning=p.visible('#main').locator('.notice.warm').filter(has_text='当前适用性需复核')
    assert warning.count()==1 and reason in warning.inner_text()
    observe_text_by_normal_scroll(p,warning.locator('span'),reason,'旧报告说明当前记忆选择已变化，保留原冻结内容')
    rows=p.get('/api/workspace/actions')['items'];assert len(rows)==1
    current_action=one(rows,action['id']);unchanged(current_action,action);changed(current_action)
    panel=open_action(p,current_action)
    original=panel.get_by_role('button',name='查看原始报告',exact=True)
    assert original.get_attribute('data-route')=='agents:run-'+run['id']
    p.step('从原行动的真实来源链接返回原报告',lambda:original.click());p.visible('#run-tab-summary')
    body=tracking(p);assert len(body['rules'])==1 and body['alerts']==[]
    current_watch=one(body['rules'],watch['id']);unchanged(current_watch,watch);reason=changed(current_watch)
    card=p.visible('#main').locator('.watch-card').filter(has=p.page.get_by_role('heading',name=OLD_WATCH,exact=True))
    assert card.count()==1 and '来源已有变化' in card.inner_text()
    observe_text_by_normal_scroll(p,card.locator('.business-source').get_by_text(reason,exact=True),reason,'原规则来源变化提示可读，阈值保持原值')
    link=card.get_by_role('button',name='查看原始报告',exact=True)
    assert link.get_attribute('data-route')=='agents:run-'+run['id']
    p.step('从原跟踪规则的来源链接返回原报告',lambda:link.click());p.visible('#run-tab-summary')
    p.click('#main [data-action="action-from-report"]',after='#action-form')
    p.fill('#action-form [name="title"]',NEW_ACTION);p.fill('#action-form [name="acceptance"]','我明确采用原报告的历史记忆上下文，人工核对当前适用性并记录依据。')
    assert not p.visible('#action-form [name="allow_historical"]').is_checked()
    rejected=_error_submit(p,'#action-form','/api/workspace/actions','SOURCE_CHANGED')
    error=_visible_response_error(p,'#action-form',rejected['error']['message'])
    observe_text_by_normal_scroll(p,error,rejected['error']['message'],'当前拒绝原因在真实表单中可读')
    assert len(p.get('/api/workspace/actions')['items'])==1
    assert p.visible('#action-form [name="title"]').input_value()==NEW_ACTION
    assert p.visible('#action-form [name="acceptance"]').input_value()=='我明确采用原报告的历史记忆上下文，人工核对当前适用性并记录依据。'
    checkbox=p.visible('#action-form [name="allow_historical"]')
    observe_text_by_normal_scroll(p,checkbox.locator('..'),'我明确选择仍以这份历史报告','拒绝后用户必须阅读并选择历史依据')
    p.step('明确确认使用通过完整性核验的历史报告',lambda:checkbox.check())
    status,new_action=_capture_response(p,'POST','/api/workspace/actions',lambda:p.submit('#action-form'))
    assert status==201 and new_action['id']!=action['id'];changed(new_action)
    provenance=new_action['payload']['provenance']
    assert provenance['run_id']==run['id'] and provenance['report_hash']==canonical_hash(run['result'])
    assert provenance['historical_acknowledged'] is True
    rows=p.get('/api/workspace/actions')['items'];assert len(rows)==2
    unchanged(one(rows,action['id']),action)
    final_tracking=tracking(p);assert len(final_tracking['rules'])==1 and final_tracking['alerts']==[]
    unchanged(one(final_tracking['rules'],watch['id']),watch)
    open_action(p,new_action)
    assert original_report(p,run)['report_integrity']['valid']
    assert p.get('/api/memories')['items']==memories and p.get('/api/datasets/'+p.dataset_id)==dataset
    assert len(p.get('/api/runs')['items'])==1
    assert p.get('/api/workspace/plans/'+new_plan['id'])==new_plan
    p.observations['memory_preference_outcome']={'run_id':run['id'],'memory_id':memory['id'],
        'original_action_id':action['id'],'original_watch_id':watch['id'],'historical_action_id':new_action['id'],
        'new_unexecuted_plan_id':new_plan['id'],'old_report_memory_count':1,'new_plan_memory_count':0,
        'memory_record_and_approval_unchanged':True,'original_business_payloads_unchanged':True,
        'preference_memory_enabled':False,'implicit_reuse_rejected':'SOURCE_CHANGED',
        'historical_choice_explicit':True,'model_calls':0,'database_faults':0}
    p.no_external()
