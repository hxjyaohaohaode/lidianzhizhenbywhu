"""L6 real seven-plan history retrieval; no API mutations or DB fixture writes."""
from copy import deepcopy
import re
try:
    from .product_first_use_audit import require_native_contract
    from .product_integrity_outcomes import _capture_response
    from .product_readout_oracles import observe_text_by_normal_scroll
except ImportError:
    from product_first_use_audit import require_native_contract
    from product_integrity_outcomes import _capture_response
    from product_readout_oracles import observe_text_by_normal_scroll


def plan_history_retrieval(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    require_native_contract(p, repository_root=repository_root, data_dir=data_dir, expected_web_tree=expected_web_tree, expected_server_tree=expected_server_tree)
    p.bootstrap()
    owner=p.get('/api/auth/me')['user']
    assert owner['email'].endswith('@test.example')
    originals=[]
    for number in range(1,8):
        query=f'2024-Q4毛利率是多少（历史找回第 {number} 份）'
        p.navigate('agents')
        p.fill('#plan-form [name="query"]',query)
        assert not p.visible('#use-llm').is_checked()
        status,row=_capture_response(p,'POST','/api/workspace/plans',lambda:p.submit('#plan-form',after='#execute-plan-form'))
        assert status==201 and row['payload']['request']['query']==query
        assert row['user_id']==owner['id'] and row['payload']['request']['dataset_id']==p.dataset_id
        assert row['payload']['status']=='draft' and row['payload']['run_id'] is None
        originals.append(deepcopy(row))
    assert len({x['id'] for x in originals})==7
    assert p.get('/api/runs')['items']==[]
    p.navigate('agents')
    p.click('#main [data-route="agents:plans"]',after='[data-plan-history]',label='从第七份计划后仍可见的全部计划入口找回历史')
    assert p.visible('[data-plan-range]').inner_text()=='1–6 / 7 份'
    assert p.page.locator('[data-plan-history] [data-route^="agents:plan-"]').count()==6
    p.click('[data-plan-history] [data-route="agents:plans-1"]',after='[data-plan-history]',label='点击下一页，寻找第一份未执行的原计划')
    p.page.get_by_text('7–7 / 7 份',exact=True).wait_for()
    target=p.visible('[data-plan-history]').locator('button.list-link').filter(has_text=originals[0]['payload']['request']['query'])
    assert target.count()==1 and target.get_attribute('data-route')=='agents:plan-'+originals[0]['id']
    observe_text_by_normal_scroll(p,target.locator('strong'),originals[0]['payload']['request']['query'],'第一份原始问题仍可读且可打开')
    p.step('按原始问题标题打开第一份计划',lambda:target.click())
    p.page.locator('#execute-plan-form').wait_for()
    assert p.visible('#execute-plan-form').get_attribute('data-id')==originals[0]['id']
    assert p.get('/api/workspace/plans/'+originals[0]['id'])==originals[0]
    p.step('浏览器返回仍停留在原计划历史第二页',lambda:p.page.go_back())
    p.page.get_by_text('7–7 / 7 份',exact=True).wait_for()
    p.click('[data-route="agents:plans-0"]',after='[data-plan-history]',label='上一页回到较新的六份原计划')
    p.page.get_by_text('1–6 / 7 份',exact=True).wait_for()
    p.click('#sidebar [data-action="logout"]',after='#auth-form',label='退出账户，验证计划历史不是仅存于页面内存')
    if p.page.locator('#auth-form [name="name"]').count():
        p.click('[data-action="auth-toggle"]',after='#auth-form',label='在账户入口选择已有账户登录')
    p.fill('#auth-form [name="email"]',owner['email'])
    p.fill('#auth-form [name="password"]','Synthetic-only-audit-password-2026','重新登录同一隔离合成账号')
    p.submit('#auth-form',after='#main')
    p.navigate('agents')
    p.click('#main [data-route="agents:plans"]',after='[data-plan-history]')
    p.click('[data-plan-history] [data-route="agents:plans-1"]',after='[data-plan-history]')
    p.page.get_by_text('7–7 / 7 份',exact=True).wait_for()
    assert p.visible('[data-plan-history]').locator('button.list-link').filter(has_text=originals[0]['payload']['request']['query']).count()==1
    for old in originals:
        assert p.get('/api/workspace/plans/'+old['id'])==old,'Reading/relogin must not refill or execute old authorization.'
    assert p.get('/api/runs')['items']==[] and p.get('/api/conversations')['items']==[]
    p.observations['history_retrieval']={'plans':[{'id':r['id'],'query':r['payload']['request']['query'],'fingerprint':r['payload']['fingerprint']} for r in originals],
        'all_seven_unchanged':True,'oldest_opened_from_visible_history':True,'browser_back_preserved_page':True,'found_after_relogin':True,'runs_created':0,'external_calls':0}
    p.no_external()
