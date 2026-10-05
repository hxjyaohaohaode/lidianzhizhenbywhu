"""Current reading notices over authentic old API captures; no history repair."""
import copy
import hashlib
import json
from urllib.parse import urlencode

import pytest

from conftest import Actor
from server.historical_question_scope import question_warning, saved_message_warning
from server.store import encode
from test_legacy_execution_scope import approve, frozen, old_actor
from test_percentage_execution_scope import captured_actor, objects
from test_services import ok

CAPTURES = ['percentage-execution-scope-80defc9.json', 'bare-percentage-scope-80defc9.json']


def saved_tables(store, fixture):
    return {table: [tuple(r) for r in store.db.execute('SELECT * FROM '+table+' ORDER BY rowid')]
            for table in fixture['tables']}


@pytest.mark.parametrize('captured_actor', CAPTURES, indirect=True)
def test_completed_old_reports_warn_without_changing_any_record_or_export(captured_actor):
    actor = captured_actor; store = actor.client.app.state.store
    before = saved_tables(store, actor.scope_capture); changes = store.db.total_changes
    for key in actor.scope_capture['cases']:
        if not key.endswith('completed'):
            continue
        _, case, plan, run = objects(actor, key)
        for _ in range(2):
            audit = ok(actor.get('/workspace/runs/'+run['id']+'/audit'))
            warning = audit['question_compatibility']
            assert audit['report_integrity']['valid'] and audit['ledger']['valid']
            assert warning['status'] == 'unsupported_operation'
            assert warning['question'] == plan['payload']['scope_query']
            assert '原记录未改写，未重新计算' in warning['history_notice']
            assert '不能作为' in warning['history_notice']
            assert ('分母' in warning['notice']) == key.startswith('bare_')
            assert ok(actor.get('/runs/'+run['id']))['result'] == run['result']
            assert 'question_compatibility' not in run['result']
            for kind, expected in case['export_sha256'].items():
                exported = actor.get('/runs/'+run['id']+'/export?format='+kind)
                assert exported.status_code == 200
                assert hashlib.sha256(exported.content).hexdigest() == expected
    assert store.db.total_changes == changes and saved_tables(store, actor.scope_capture) == before


@pytest.mark.parametrize('captured_actor', CAPTURES, indirect=True)
def test_actual_saved_messages_warn_and_unsupported_trace_stops_before_calculation(captured_actor, monkeypatch):
    actor = captured_actor; store = actor.client.app.state.store
    originals = store.all('SELECT * FROM copilot_messages ORDER BY id')
    before = saved_tables(store, actor.scope_capture); changes = store.db.total_changes
    for source in originals:
        loaded = ok(actor.get('/services/threads/'+source['thread_id']))
        saved = next(m for m in loaded['messages'] if m['id'] == source['id'])
        assert saved['payload'] == source['payload']
        params = urlencode({'identity_id':'', 'dataset_id':source['payload']['response']['context']['dataset_id']})
        url = '/services/threads/'+source['thread_id']+'/messages/'+source['id']+'/trace?'+params
        if '成本金额' in source['payload']['question']:
            assert 'question_compatibility' not in saved
            result = ok(actor.get(url))
            assert result['facts'][0]['value'] == 100000 and result['external_calls'] == 0
        else:
            assert saved['question_compatibility']['question'] == source['payload']['question']
            with monkeypatch.context() as patch:
                patch.setattr('server.copilot.assistant_answer', lambda *a, **k: pytest.fail('Unsupported original operation must not calculate a substitute'))
                result = ok(actor.get(url), 409)['error']
            assert result['code'] == 'TRACE_QUESTION_UNSUPPORTED'
            assert source['payload']['question'] in result['message'] and '原记录未改写' in result['message']
    assert store.db.total_changes == changes and saved_tables(store, actor.scope_capture) == before


@pytest.mark.parametrize('captured_actor', CAPTURES, indirect=True)
def test_saved_trace_keeps_current_data_integrity_gate_before_operation_warning(captured_actor, monkeypatch):
    actor = captured_actor; store = actor.client.app.state.store
    source = next(s for s in store.all('SELECT * FROM copilot_messages') if '成本金额' not in s['payload']['question'])
    dataset_id = source['payload']['response']['context']['dataset_id']
    d = store.owned('datasets', actor.user['id'], dataset_id)
    damaged = copy.deepcopy(d['payload']); damaged['periods'][0]['cost'] += 1
    with store.transaction() as db:
        db.execute('UPDATE datasets SET payload=? WHERE id=?', (encode(damaged), dataset_id))
    monkeypatch.setattr('server.copilot.assistant_answer', lambda *a, **k: pytest.fail('Corrupt data must not reach calculations'))
    params = urlencode({'identity_id':'', 'dataset_id':dataset_id})
    result = ok(actor.get('/services/threads/'+source['thread_id']+'/messages/'+source['id']+'/trace?'+params), 409)['error']
    assert result['code'] == 'SOURCE_INTEGRITY'


@pytest.mark.parametrize('captured_actor', CAPTURES, indirect=True)
def test_edited_supported_target_is_not_replaced_by_bad_source_question(captured_actor):
    actor = captured_actor
    key = 'bare_source_good_draft' if 'bare_source_good_draft' in actor.scope_capture['cases'] else 'source_good_draft'
    store, case, plan, _ = objects(actor, key)
    original = frozen(store, case)
    approved = ok(approve(actor, case, plan))
    run_id = approved['payload']['result']['run_id']
    run = actor.execute(ok(actor.get('/runs/'+run_id)))
    assert run['result'] and run['state'] in ('succeeded', 'degraded')
    audit = ok(actor.get('/workspace/runs/'+run_id+'/audit'))
    assert audit['report_integrity']['valid'] and audit['question_compatibility'] is None
    proposal = original['proposal']; payload = json.loads(proposal['payload'])
    loaded = ok(actor.get('/services/threads/'+payload['thread_id']))
    assert loaded['runs'][0]['question_compatibility'] is None
    assert loaded['runs'][0]['result'] == run['result']
    source = next(m for m in loaded['messages'] if m['id'] == payload['source_message_id'])
    assert source['question_compatibility']['status'] == 'unsupported_operation'


@pytest.mark.parametrize('captured_actor', CAPTURES, indirect=True)
@pytest.mark.parametrize('damage', ['report', 'plan'])
def test_bad_integrity_cannot_be_presented_as_a_normal_compatibility_notice(captured_actor, damage):
    actor = captured_actor; store = actor.client.app.state.store
    key = next(k for k in actor.scope_capture['cases'] if k.endswith('completed'))
    _, case, plan, run = objects(actor, key)
    with store.transaction() as db:
        if damage == 'report':
            result = copy.deepcopy(run['result']); result['query'] += '篡改'
            db.execute('UPDATE runs SET result=? WHERE id=?', (encode(result), run['id']))
        else:
            p = copy.deepcopy(plan['payload']); p['scope_query'] = '2024-Q2收入环比'
            db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(p), plan['id']))
    audit = ok(actor.get('/workspace/runs/'+run['id']+'/audit'))
    assert audit['question_compatibility'] is None
    if damage == 'report':
        assert not audit['report_integrity']['valid']
        assert ok(actor.get('/runs/'+run['id']+'/export'), 409)['error']['code'] == 'REPORT_INTEGRITY'
    other = Actor(actor.client)
    assert other.get('/workspace/runs/'+run['id']+'/audit').status_code == 404


@pytest.mark.parametrize('key', ['qoq_legacy_completed', 'qoq_adaptive_completed'])
def test_older_revenue_growth_is_not_labelled_an_unsupported_percentage(old_actor, key):
    actor = old_actor
    from test_legacy_execution_scope import objects as older_objects
    store, case, plan, run = older_objects(actor, key)
    assert 'scope_query' not in plan['payload']
    before = frozen(store, case); changes = store.db.total_changes
    audit = ok(actor.get('/workspace/runs/'+run['id']+'/audit'))
    assert audit['report_integrity']['valid'] and audit['question_compatibility'] is None
    assert frozen(store, case) == before and store.db.total_changes == changes


@pytest.mark.parametrize('question', ['2024-Q2成本金额', '2024-Q2净利润是多少元', '2024-Q2收入环比百分之多少',
    '2024-Q2毛利率环比增加多少个百分点', '2024-Q2成本金额与毛利率是多少百分比', '2024-Q2净利润率是多少百分比'])
def test_supported_question_wording_never_gets_a_percentage_warning(question):
    assert question_warning(question) is None


def test_absent_modern_scope_and_current_refusals_are_not_relabelled():
    for context in [{}, {'question_scope':{}}, {'question_scope':{'status':'unsupported_topic','can_calculate':False}}]:
        message = {'payload':{'question':'成本百分比是多少', 'response':{'context':context}}}
        assert saved_message_warning(message) is None


def test_authentic_supported_pre_readout_report_keeps_partial_integrity_contract(actor):
    from test_legacy_comparison_shape import restore_true_legacy
    store, run_id = restore_true_legacy(actor)
    run = store.owned('runs', actor.user['id'], run_id)
    assert 'research_scope' not in run['snapshot'] and 'readout' not in run['result']
    before = copy.deepcopy(run); changes = store.db.total_changes
    audit = ok(actor.get('/workspace/runs/'+run_id+'/audit'))
    assert audit['report_integrity']['valid'] and audit['report_hash_valid'] is None
    assert audit['question_compatibility'] is None
    assert store.db.total_changes == changes and store.owned('runs', actor.user['id'], run_id) == before
