"""L4 native tracking intent, units, cancellation and immutable alert outcomes.

All writes use visible controls in the host's isolated synthetic CI account.
The existing native runner owns browser, server, trace and lifecycle. Tracking
GET responses come from actual page navigation, since they evaluate rules.
"""
from __future__ import annotations
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
import csv
import io
try:
    from .product_first_use_audit import require_native_contract, register_empty_workspace, download_visible, csv_headers, canonical_hash
    from .product_integrity_outcomes import _capture_response
    from .product_readout_oracles import observe_text_by_normal_scroll
except ImportError:
    from product_first_use_audit import require_native_contract, register_empty_workspace, download_visible, csv_headers, canonical_hash
    from product_integrity_outcomes import _capture_response
    from product_readout_oracles import observe_text_by_normal_scroll

COMPANY='L4跟踪量纲合成企业（非真实财报）'
MARGIN_TITLE='L4合成毛利率阈值核对'
AMOUNT_TITLE='L4合成经营现金流金额核对'
FORM='form[data-service-form="watch"]'


def last_closed_quarter(today):
    quarter=(today.month-1)//3+1
    return f'{today.year if quarter>1 else today.year-1}-Q{quarter-1 if quarter>1 else 4}'


def fixture_csv(template, period):
    headers=csv_headers(template)
    values={'季度':period,'营业收入':'100000','营业成本':'80000','净利润':'5000','经营现金流':'12345.67'}
    out=io.StringIO(newline='');writer=csv.writer(out,lineterminator='\n')
    writer.writerow(headers);writer.writerow([values.get(key,'') for key in headers])
    return out.getvalue().encode('utf-8-sig')


def one(rows, predicate):
    matches=[row for row in rows if predicate(row)]
    assert len(matches)==1, f'Expected one concrete saved record, found {len(matches)}'
    return matches[0]


def frozen(row):
    return deepcopy({key:value for key,value in row.items() if key!='source_impact'})


def card(p,title):
    row=p.visible('#main').locator('.watch-card').filter(has=p.page.get_by_role('heading',name=title,exact=True))
    assert row.count()==1 and row.is_visible()
    return row


def read_tracking(p, label):
    status,body=_capture_response(p,'GET','/api/services/tracking',lambda:p.navigate('tracking'))
    assert status==200 and body['external_calls']==0
    p.observations.setdefault('tracking_reads',[]).append({'label':label,'response':body,'origin':'actual visible sidebar navigation; evaluating GET, not a supplemental API mutation'})
    return body


def observe_rule(p,title,threshold_text,current_text,period,state):
    row=card(p,title)
    state_label={'clear':'未触发','triggered':'已触发'}[state]
    assert row.get_by_text(state_label,exact=True).is_visible()
    threshold=row.locator(':scope > p').filter(has_text='低于').locator('strong')
    assert threshold.count()==1 and threshold.inner_text().strip()==threshold_text
    observe_text_by_normal_scroll(p,threshold,threshold_text,title+'：可读的阈值与单位')
    current=row.locator(':scope > p.micro').filter(has_text='当前值')
    assert current.count()==1 and period in current.inner_text() and current_text in current.inner_text()
    observe_text_by_normal_scroll(p,current,current_text,title+'：可读的当前值与单位')
    p.observations.setdefault('readable_rules',[]).append({'title':title,'threshold':threshold_text,'current':current_text,'period':period,'state':state})
    return row


def edit(p,title):
    p.step('通过保存规则的调整按钮重新读取 '+title,lambda:card(p,title).get_by_role('button',name='调整',exact=True).click())
    p.visible(FORM)


def close_edit(p,label):
    p.click('#modal [data-action="close-modal"]',label=label)
    p.page.locator('#modal').wait_for(state='hidden')


def create_rule(p,title,metric,value):
    p.click('#main [data-x-action="watch-new"]',after=FORM,label='新建有明确指标和量纲的规则 '+title)
    p.fill(FORM+' [name="title"]',title)
    if metric!='gross_margin':p.select(FORM+' [name="metric"]',metric)
    assert p.visible(FORM+' [name="operator"]').input_value()=='lt'
    label='阈值（%）' if metric=='gross_margin' else '阈值（人民币元）'
    assert p.visible(FORM+' [data-watch-threshold-label]').inner_text()==label
    p.fill(FORM+' [name="threshold"]',value)
    status,row=_capture_response(p,'POST','/api/services/watches',lambda:p.submit(FORM))
    assert status==201 and row['version']==1
    assert p.page.locator('#modal').get_attribute('open') is None
    return row


def tracking_units_outcome(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    require_native_contract(p,repository_root=repository_root,data_dir=data_dir,expected_web_tree=expected_web_tree,expected_server_tree=expected_server_tree)
    register_empty_workspace(p)
    owner=p.get('/api/auth/me')['user'];assert owner['email'].endswith('@test.example')
    period=last_closed_quarter(datetime.now(timezone.utc).date())
    writes=[]
    def record(request):
        path=urlsplit(request.url).path
        if path.startswith('/api/services/watches') and request.method in ('POST','PUT','DELETE'):
            writes.append({'method':request.method,'path':path})
    p.page.on('request',record)
    try:
        p.navigate('data');p.click('#main [data-action="import-dialog"]',after='#import-file-form')
        template=download_visible(p,p.visible('#import-file-form a[href="/api/import/template"]'),'L4-header-only.csv','下载真实空模板核对列名')
        path=Path(p.directory)/'L4-synthetic-yuan-input.csv';path.write_bytes(fixture_csv(template,period));p.record_artifact(path,kind='synthetic-input')
        p.fill('#import-file-form [name="company"]',COMPANY);p.select('#import-file-form [name="amount_unit"]','yuan');p.select('#import-file-form [name="basis"]','standalone_quarter')
        p.step('选择明确标为合成的人民币元季度文件',lambda:p.visible('#import-file-form [name="file"]').set_input_files(str(path)))
        p.submit('#import-file-form',after='#modal [data-action="commit-stage"]')
        assert COMPANY in p.visible('#modal').inner_text() and '文件金额单位：元' in p.visible('#modal').inner_text()
        quarter=p.visible('#modal').locator('[data-preview-period="'+period+'"]')
        for key,text in [('revenue','100,000'),('cost','80,000'),('cash_flow','12,345.67')]:
            row=quarter.locator('[data-preview-field="'+key+'"]');assert row.count()==1
            assert row.locator('td').nth(1).inner_text()==text and row.locator('td').nth(2).inner_text()=='元'
        assert p.get('/api/datasets')['items']==[]
        p.click('#modal [data-action="commit-stage"]',after='#dataset-editor[data-version="1"]')
        rows=p.get('/api/datasets')['items'];assert len(rows)==1;data=rows[0];p.dataset_id=data['id']
        assert data['payload']['company']==COMPANY and data['version']==1
        assert data['content_hash']==canonical_hash(data['payload'])
        value=data['payload']['periods'][0]
        assert value['period']==period and value['revenue']==100000 and value['cost']==80000 and value['cash_flow']==12345.67
        p.navigate('settings');p.select('#preferences-form [name="amount_unit"]','wan');p.submit('#preferences-form')
        assert p.get('/api/auth/me')['user']['preferences']['amount_unit']=='wan'
        initial=read_tracking(p,'空跟踪页');assert initial['rules']==initial['alerts']==[]
        margin=create_rule(p,MARGIN_TITLE,'gross_margin','15')
        assert margin['user_id']==owner['id'] and margin['payload']['threshold']==.15
        assert margin['payload']['dataset_id']==data['id'] and margin['payload']['provenance']['dataset_version']==1
        body=read_tracking(p,'15%初始规则')
        assert len(body['rules'])==1 and body['alerts']==[]
        evaluation=one(body['evaluations'],lambda r:r['rule_id']==margin['id'])
        assert evaluation['state']=='clear' and evaluation['value']==.2 and evaluation['threshold']==.15 and evaluation['period']==period
        observe_rule(p,MARGIN_TITLE,'15%','20%',period,'clear')
        edit(p,MARGIN_TITLE);assert p.visible(FORM+' [name="threshold"]').input_value()=='15'
        p.fill(FORM+' [name="threshold"]','25');close_edit(p,'取消25%编辑，不提交规则')
        assert writes==[{'method':'POST','path':'/api/services/watches'}], 'Cancel must not emit a write.'
        edit(p,MARGIN_TITLE);assert p.visible(FORM+' [name="threshold"]').input_value()=='15'
        assert p.visible(FORM).get_attribute('data-version')=='1'
        p.fill(FORM+' [name="threshold"]','25')
        status,changed=_capture_response(p,'PUT','/api/services/watches/'+margin['id'],lambda:p.submit(FORM))
        assert status==200 and changed['id']==margin['id'] and changed['version']==2 and changed['payload']['threshold']==.25
        assert changed['payload']['provenance']==margin['payload']['provenance']
        body=read_tracking(p,'明确保存25%触发')
        assert len(body['rules'])==1 and len(body['alerts'])==1
        evaluation=one(body['evaluations'],lambda r:r['rule_id']==margin['id'])
        assert evaluation['state']=='triggered' and evaluation['value']==.2 and evaluation['threshold']==.25
        alert=body['alerts'][0];assert alert['payload']['value']==.2 and alert['payload']['threshold']==.25
        assert alert['payload']['period']==period and alert['payload']['dataset_version']==1
        observe_rule(p,MARGIN_TITLE,'25%','20%',period,'triggered')
        repeated=read_tracking(p,'重复读取不得重复提醒')
        assert len(repeated['alerts'])==1 and frozen(repeated['alerts'][0])==frozen(alert)
        alert_card=p.visible('#main').locator('.alert-card').filter(has=p.page.get_by_role('heading',name=MARGIN_TITLE,exact=True))
        assert alert_card.count()==1
        for text in ['20%','25%']:
            assert text in alert_card.inner_text()
        p.step('打开真实提醒历史依据',lambda:alert_card.get_by_role('button',name='核对历史提醒',exact=True).click())
        inspector=p.visible('#inspector[open]');cells=inspector.locator('tbody tr').first.locator('td').all_text_contents()
        assert cells==[period,'1','20%','低于 25%'],cells
        observe_text_by_normal_scroll(p,inspector.locator('tbody tr').first.locator('td').nth(2),'20%','历史观测值带百分比')
        observe_text_by_normal_scroll(p,inspector.locator('tbody tr').first.locator('td').nth(3),'25%','历史阈值带百分比')
        p.click('#inspector [data-action="close-inspector"]')
        # A later non-triggering threshold never rewrites the older alert basis.
        edit(p,MARGIN_TITLE);p.fill(FORM+' [name="threshold"]','15')
        status,returned=_capture_response(p,'PUT','/api/services/watches/'+margin['id'],lambda:p.submit(FORM))
        assert status==200 and returned['version']==3 and returned['payload']['threshold']==.15
        body=read_tracking(p,'规则改回15%，历史提醒仍按原25%保留')
        assert len(body['alerts'])==1 and frozen(body['alerts'][0])==frozen(alert)
        observe_rule(p,MARGIN_TITLE,'15%','20%',period,'clear')
        prior=p.visible('#main').locator('.alert-card').filter(has=p.page.get_by_role('heading',name=MARGIN_TITLE,exact=True))
        observe_text_by_normal_scroll(p,prior.get_by_text('历史阈值：低于 25%',exact=True),'25%','当前规则改变后，原提醒仍显示历史25%')
        amount=create_rule(p,AMOUNT_TITLE,'cash_flow','15000.25')
        assert amount['payload']['threshold']==15000.25 and amount['payload']['metric']=='cash_flow'
        body=read_tracking(p,'金额规则使用人民币元，不跟万元偏好缩放')
        assert len(body['rules'])==2 and len(body['alerts'])==2
        evaluation=one(body['evaluations'],lambda r:r['rule_id']==amount['id'])
        assert evaluation['state']=='triggered' and evaluation['value']==12345.67 and evaluation['threshold']==15000.25
        observe_rule(p,AMOUNT_TITLE,'15000.25 元（人民币）','12345.67 元（人民币）',period,'triggered')
        old_amount=one(body['rules'],lambda r:r['id']==amount['id']);old_amount_alert=one(body['alerts'],lambda r:r['payload']['metric']=='cash_flow')
        cash_alert=p.visible('#main').locator('.alert-card').filter(has=p.page.get_by_role('heading',name=AMOUNT_TITLE,exact=True))
        assert cash_alert.count()==1
        observe_text_by_normal_scroll(p,cash_alert.get_by_text('历史阈值：低于 15000.25 元（人民币）',exact=True),'15000.25 元（人民币）','金额提醒保留明确人民币元阈值')
        p.step('打开金额提醒的原始判定依据',lambda:cash_alert.get_by_role('button',name='核对历史提醒',exact=True).click())
        inspector=p.visible('#inspector[open]');cells=inspector.locator('tbody tr').first.locator('td').all_text_contents()
        assert cells==[period,'1','12345.67 元（人民币）','低于 15000.25 元（人民币）'],cells
        observe_text_by_normal_scroll(p,inspector.locator('tbody tr').first.locator('td').nth(2),'12345.67 元（人民币）','历史现金流保留人民币元和小数')
        observe_text_by_normal_scroll(p,inspector.locator('tbody tr').first.locator('td').nth(3),'15000.25 元（人民币）','历史金额阈值不随万元偏好缩放')
        p.click('#inspector [data-action="close-inspector"]')
        edit(p,AMOUNT_TITLE);assert p.visible(FORM+' [name="threshold"]').input_value()=='15000.25'
        before_writes=deepcopy(writes)
        p.select(FORM+' [name="metric"]','gross_margin')
        assert p.visible(FORM+' [name="threshold"]').input_value()==''
        assert p.visible(FORM+' [data-watch-threshold-label]').inner_text()=='阈值（%）'
        assert '旧阈值已清空，请重新填写' in p.visible(FORM+' [data-watch-threshold-hint]').inner_text()
        close_edit(p,'取消量纲切换，不将金额阈值重新解释成百分比')
        # The existing shared dirty-draft guard asks once when leaving this
        # cancelled synthetic form. Record the real decision, never clear state.
        cancelled=p.with_expected_dialog(dialog_type='confirm',
            message='当前输入尚未保存。离开后这些修改将丢失，是否继续？',
            action=lambda:read_tracking(p,'明确离开取消的草稿，再读保存的原规则'))
        assert one(cancelled['rules'],lambda r:r['id']==amount['id'])==old_amount
        assert writes==before_writes
        edit(p,AMOUNT_TITLE)
        assert p.visible(FORM+' [name="metric"]').input_value()=='cash_flow'
        assert p.visible(FORM+' [name="threshold"]').input_value()=='15000.25' and p.visible(FORM).get_attribute('data-version')=='1'
        assert writes==before_writes
        close_edit(p,'关闭未改动的原金额规则')
        p.step('暂停原金额规则，保留阈值与历史提醒',lambda:card(p,AMOUNT_TITLE).get_by_role('button',name='暂停',exact=True).click())
        p.page.get_by_role('button',name='启用',exact=True).wait_for()
        edit(p,AMOUNT_TITLE)
        assert p.visible(FORM+' [name="threshold"]').input_value()=='15000.25'
        assert p.visible(FORM+' [name="metric"]').input_value()=='cash_flow'
        assert not p.visible(FORM+' [name="active"]').is_checked()
        close_edit(p,'取消查看暂停规则')
        p.step('重新启用同一金额规则',lambda:card(p,AMOUNT_TITLE).get_by_role('button',name='启用',exact=True).click())
        p.page.locator('.watch-card').filter(has=p.page.get_by_role('heading',name=AMOUNT_TITLE,exact=True)).get_by_role('button',name='暂停',exact=True).wait_for()
        # Pausing/re-enabling follows the existing versioned endpoint; unchanged
        # financial evaluation revision must not manufacture another alert.
        body=read_tracking(p,'重新启用后保持原阈值和两份原提醒')
        assert len(body['rules'])==2 and len(body['alerts'])==2
        final=one(body['rules'],lambda r:r['id']==amount['id'])
        assert final['version']==3 and final['payload']['active'] is True and final['payload']['threshold']==15000.25
        assert final['payload']['provenance']==old_amount['payload']['provenance']
        assert frozen(one(body['alerts'],lambda r:r['id']==old_amount_alert['id']))==frozen(old_amount_alert)
        assert frozen(one(body['alerts'],lambda r:r['id']==alert['id']))==frozen(alert)
        assert p.get('/api/datasets/'+data['id'])==data
        assert p.get('/api/runs')['items']==[] and p.get('/api/workspace/actions')['items']==[]
        p.observations['tracking_unit_outcome']={'period':period,'dataset_id':data['id'],'dataset_version':1,'margin_rule_id':margin['id'],'amount_rule_id':amount['id'],'margin_canonical_thresholds':[.15,.25,.15],'margin_value':.2,'amount_threshold':15000.25,'amount_value':12345.67,'global_amount_preference':'wan','display_units':['%','人民币元'],'cancelled_edits_emitted_no_write':True,'alert_ids':[alert['id'],old_amount_alert['id']],'alerts_after_repeat_pause_resume':2,'dataset_unchanged':True,'model_calls':0,'watch_writes':writes}
        p.no_external()
    finally:
        p.page.remove_listener('request',record)
