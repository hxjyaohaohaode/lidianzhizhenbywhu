"""Real isolated TestClient + SQLite contracts, never native browser evidence."""
import importlib
import json
from html import unescape
from pathlib import Path
import re
import socket
import subprocess
from types import SimpleNamespace

import pytest

from conftest import Actor
from scripts import native_historical_fixture as fixture
from scripts import product_historical_warning_journey as journey
from scripts.product_first_use_audit import HarnessContractError
from test_currency_comparison_scope import ForbiddenProviders
from test_services import ok, thread, message

ROOT = Path(__file__).resolve().parents[1]


def frozen(db, owner):
    selected, manifest, _ = fixture.verified_closure(ROOT)
    return fixture._read_closed_rows(db, selected, manifest, owner)


def verify_counts(db, owner, **allowed):
    selected, manifest, _ = fixture.verified_closure(ROOT)
    return fixture._verify_rows_and_counts(db, selected=selected, manifest=manifest, owner=owner, **allowed)


@pytest.fixture
def empty_actor(factory):
    providers = ForbiddenProviders()
    actor = Actor(factory(providers=providers))
    yield actor
    assert providers.calls == []


def restore(actor, write_receipt=None):
    receipts = []
    receipt = fixture._restore_closed_report(actor.client.app.state.store.db,
        owner_id=actor.user['id'], repository_root=ROOT, write_receipt=write_receipt or receipts.append,
        admission_scope=fixture.SCOPE)
    if write_receipt is None:
        assert len(receipts) == 1 and receipts[0]['receipt_phase'] == 'validated_before_commit'
        assert 'commit_confirmed' not in receipts[0] and receipt['commit_confirmed'] is True
    return receipt


def test_original_fixture_closed_selection_excludes_real_queued_rows_and_preserves_manifest():
    selected, manifest, source = fixture.verified_closure(ROOT)
    assert sum(map(len, selected.values())) == 49
    assert {table: len(rows) for table, rows in selected.items()} == fixture.COUNTS
    assert source['commit'] == '80defc9b54159155000ac7564fbdd1247c0f0403'
    assert source['tree'] == 'e2ef9e3e482aeebc57e6b63db1fa3058ddfe91d7'
    original = json.loads((ROOT / 'tests/fixtures' / fixture.FIXTURE_NAME).read_bytes())
    assert any(row['state'] == 'queued' for row in original['tables']['runs'])
    assert [row['state'] for row in selected['runs']] == ['succeeded']
    assert selected['copilot_messages'] == [] and manifest['case_references']['proposal_id'] is None
    assert [r['event_seq'] for r in selected['event_integrity']] == list(range(2, 20))


@pytest.mark.parametrize('name', [fixture.FIXTURE_NAME, fixture.MANIFEST_NAME])
def test_changed_source_or_review_manifest_cannot_gain_admission(tmp_path, name):
    target = tmp_path / 'tests/fixtures'; target.mkdir(parents=True)
    for filename in (fixture.FIXTURE_NAME, fixture.MANIFEST_NAME):
        (target / filename).write_bytes((ROOT / 'tests/fixtures' / filename).read_bytes())
    with (target / name).open('ab') as stream:
        stream.write(b'\n')
    with pytest.raises(RuntimeError, match='hash differs'):
        fixture.verified_closure(tmp_path)


def test_native_entry_is_pure_separately_admitted_and_local_execution_still_denied(tmp_path, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail('No browser, API, process or socket is allowed in this admission test.')
    monkeypatch.setattr(socket, 'socket', forbidden)
    monkeypatch.setattr(subprocess, 'Popen', forbidden)
    importlib.reload(journey)
    monkeypatch.delenv('GITHUB_ACTIONS', raising=False)
    p = SimpleNamespace(base_url='http://127.0.0.1:8000', get=forbidden, artifact_kinds=('fault-injection',))
    for scope in (None, 'copilot-integrity', fixture.SCOPE):
        with pytest.raises(RuntimeError, match='Separate historical fixture admission'):
            fixture.prepare_native_history(p, data_dir=tmp_path, repository_root=ROOT,
                registration_owner='unused', admission_scope=scope)
        with pytest.raises(RuntimeError, match='Separate historical fixture admission'):
            journey.historical_warning_journey(p, data_dir=tmp_path, repository_root=ROOT,
                expected_web_tree='a' * 40, expected_server_tree='b' * 40, admission_scope=scope)
    p.artifact_kinds = (fixture.ARTIFACT_KIND,)
    with pytest.raises(RuntimeError, match='Separate historical fixture admission'):
        fixture.prepare_native_history(p, data_dir=tmp_path, repository_root=ROOT, registration_owner='unused')
    with pytest.raises(RuntimeError, match='GitHub runner only'):
        fixture.prepare_native_history(p, data_dir=tmp_path, repository_root=ROOT,
            registration_owner='unused', admission_scope=fixture.SCOPE)
    with pytest.raises(HarnessContractError, match='Local browser execution is restricted'):
        journey.historical_warning_journey(p, data_dir=tmp_path, repository_root=ROOT,
            expected_web_tree='a' * 40, expected_server_tree='b' * 40, admission_scope=fixture.SCOPE)
    assert list(tmp_path.iterdir()) == []


def test_real_api_single_old_report_current_refusal_exports_and_frozen_rows(empty_actor):
    actor = empty_actor; db = actor.client.app.state.store.db
    auth_before = {table: [tuple(row) for row in db.execute('SELECT * FROM ' + table)]
                   for table in ('users', 'auth_sessions')}
    receipt = restore(actor)
    assert receipt['selected_row_count'] == 49 and receipt['row_counts'] == fixture.COUNTS
    assert receipt['owner_mapping'] == {'from': fixture.SOURCE_OWNER, 'to': actor.user['id']}
    assert receipt['all_other_columns_exact'] and receipt['revision_created_by_unchanged_trigger']
    assert receipt['authentication_rows_copied'] == receipt['queued_or_running'] == 0
    assert receipt['assistant_proposal_binding'] is None
    assert {table: [tuple(row) for row in db.execute('SELECT * FROM ' + table)]
            for table in auth_before} == auth_before
    before = frozen(db, actor.user['id'])
    before_hashes = verify_counts(db, actor.user['id'])
    catalog = ok(actor.get('/workspace/reports?identity_id=&dataset_id=' + fixture.DATASET_ID))
    assert catalog['total'] == 1 and [row['id'] for row in catalog['items']] == [fixture.RUN_ID]
    assert catalog['items'][0]['query'] == journey.QUESTION
    run = ok(actor.get('/runs/' + fixture.RUN_ID))
    plan = ok(actor.get('/workspace/plans/' + fixture.PLAN_ID))
    exports = {}
    for _ in range(2):
        journey.expect_historical_api(ok(actor.get('/workspace/runs/' + fixture.RUN_ID + '/audit')), run, plan)
        for kind in fixture.EXPORT_SHA256:
            exported = actor.get('/runs/' + fixture.RUN_ID + '/export?format=' + kind)
            assert exported.status_code == 200
            journey.expect_export(exported.content, kind)
            exports[kind] = exported.content
    dataset = ok(actor.get('/datasets/' + fixture.DATASET_ID))
    t = thread(actor, dataset)
    saved = ok(message(actor, t, journey.QUESTION), 201)
    journey.expect_current_refusal(saved['message'], saved['thread'])
    assert verify_counts(db, actor.user['id'], current_thread_id=t['id'],
                         current_message_id=saved['message']['id']) == before_hashes
    with pytest.raises(RuntimeError, match='Unexpected business rows'):
        verify_counts(db, actor.user['id'])
    loaded = ok(actor.get('/services/threads/' + t['id']))
    assert loaded['proposals'] == loaded['runs'] == []
    assert len(loaded['messages']) == 1 and not loaded['messages'][0].get('question_compatibility')
    assert frozen(db, actor.user['id']) == before
    for kind, original in exports.items():
        assert actor.get('/runs/' + fixture.RUN_ID + '/export?format=' + kind).content == original
    assert [row['id'] for row in ok(actor.get('/runs'))['items']] == [fixture.RUN_ID]
    assert db.execute('SELECT count(*) FROM copilot_messages').fetchone()[0] == 1
    assert db.execute("SELECT count(*) FROM workspace_objects WHERE kind='assistant_proposal'").fetchone()[0] == 0
    other = Actor(actor.client)
    assert other.get('/runs/' + fixture.RUN_ID).status_code == 404
    assert other.get('/workspace/runs/' + fixture.RUN_ID + '/audit').status_code == 404
    assert other.get('/runs/' + fixture.RUN_ID + '/export?format=json').status_code == 404
    assert frozen(db, actor.user['id']) == before


def test_preparation_is_single_use_and_refuses_occupied_history(empty_actor):
    actor = empty_actor; db = actor.client.app.state.store.db
    restore(actor)
    before = frozen(db, actor.user['id'])
    with pytest.raises(RuntimeError, match='empty capture tables'):
        restore(actor)
    assert frozen(db, actor.user['id']) == before


def test_another_owners_existing_business_rows_cannot_be_merged(empty_actor):
    actor = empty_actor
    other = Actor(actor.client); original = other.dataset()
    with pytest.raises(RuntimeError, match='empty capture tables'):
        restore(actor)
    assert ok(other.get('/datasets/' + original['id'])) == original
    assert ok(actor.get('/datasets'))['items'] == []


@pytest.mark.parametrize('owner', ['missing', fixture.SOURCE_OWNER, 'nonsynthetic'])
def test_only_current_distinct_synthetic_owner_is_accepted(empty_actor, owner):
    actor = empty_actor
    if owner == 'nonsynthetic':
        owner = Actor(actor.client, email='owner@example.org').user['id']
    with pytest.raises(RuntimeError, match='newly registered, distinct synthetic owner'):
        fixture._restore_closed_report(actor.client.app.state.store.db, owner_id=owner,
            repository_root=ROOT, write_receipt=lambda _: pytest.fail('Must not emit receipt'), admission_scope=fixture.SCOPE)
    assert ok(actor.get('/datasets'))['items'] == []


@pytest.mark.parametrize('damage', ['missing_trigger', 'changed_trigger', 'receipt_failure'])
def test_preparation_rolls_back_every_row_if_trigger_or_receipt_fails(empty_actor, damage):
    actor = empty_actor; db = actor.client.app.state.store.db
    if damage != 'receipt_failure':
        db.execute('DROP TRIGGER dataset_insert_revision')
        if damage == 'changed_trigger':
            db.execute('''CREATE TRIGGER dataset_insert_revision AFTER INSERT ON datasets BEGIN
                INSERT INTO dataset_revisions VALUES(new.id,new.user_id,new.version,new.payload,new.content_hash,'changed'); END''')
    def fail_receipt(_):
        raise OSError('Receipt storage unavailable')
    with pytest.raises((RuntimeError, OSError)):
        restore(actor, fail_receipt if damage == 'receipt_failure' else None)
    assert {table: db.execute('SELECT count(*) FROM ' + table).fetchone()[0] for table in fixture.COUNTS} == dict.fromkeys(fixture.COUNTS, 0)
    assert db.execute('PRAGMA foreign_key_check').fetchall() == []


def test_transaction_core_also_refuses_unadmitted_scope_before_database_access():
    for scope in (None, 'copilot-integrity', 'fault-injection'):
        with pytest.raises(RuntimeError, match='Separate historical fixture scope'):
            fixture._restore_closed_report(None, owner_id='unused', repository_root=ROOT,
                write_receipt=lambda _: pytest.fail('Must not emit receipt'), admission_scope=scope)


@pytest.mark.parametrize('column,value', [('state', 'queued'), ('result', '{}'), ('updated_at', 'altered')])
def test_closure_verification_refuses_any_undeclared_nonowner_edit(empty_actor, column, value):
    actor = empty_actor; db = actor.client.app.state.store.db
    restore(actor)
    db.execute('UPDATE runs SET ' + column + '=? WHERE id=?', (value, fixture.RUN_ID))
    with pytest.raises(RuntimeError, match='Frozen row changed'):
        frozen(db, actor.user['id'])


def test_current_supported_amount_control_is_not_relabelled_or_substituted(empty_actor):
    actor = empty_actor
    restore(actor)
    dataset = ok(actor.get('/datasets/' + fixture.DATASET_ID))
    t = thread(actor, dataset)
    result = ok(message(actor, t, '2024-Q2成本金额是多少元'), 201)['message']
    response = result['payload']['response']
    assert response['context']['question_scope']['status'] == 'supported'
    assert len(response['facts']) == 1
    fact = response['facts'][0]
    assert (fact['id'], fact['value'], fact['unit']) == ('cost', 100000, 'CNY')
    assert response['external_calls'] == 0 and 'question_compatibility' not in result


def test_final_verification_refuses_missing_bindings_and_additional_current_questions(empty_actor):
    actor = empty_actor; db = actor.client.app.state.store.db
    restore(actor)
    dataset = ok(actor.get('/datasets/' + fixture.DATASET_ID)); t = thread(actor, dataset)
    saved = ok(message(actor, t, journey.QUESTION), 201)
    with pytest.raises(RuntimeError, match='IDs are required together'):
        verify_counts(db, actor.user['id'], current_thread_id=t['id'])
    with pytest.raises(RuntimeError, match='actual one new current thread and message'):
        verify_counts(db, actor.user['id'], current_thread_id='wrong', current_message_id=saved['message']['id'])
    ok(message(actor, saved['thread'], journey.QUESTION, key='second-question'), 201)
    with pytest.raises(RuntimeError, match='Unexpected business rows'):
        verify_counts(db, actor.user['id'], current_thread_id=t['id'], current_message_id=saved['message']['id'])


@pytest.mark.parametrize('table', ['memories', 'evidence', 'feedback'])
@pytest.mark.parametrize('with_current_question', [False, True])
def test_real_extra_business_creation_cannot_pass_final_history_oracle(empty_actor, table, with_current_question):
    actor = empty_actor; db = actor.client.app.state.store.db
    restore(actor)
    allowed = {}
    if with_current_question:
        dataset = ok(actor.get('/datasets/' + fixture.DATASET_ID)); t = thread(actor, dataset)
        saved = ok(message(actor, t, journey.QUESTION), 201)
        allowed = {'current_thread_id': t['id'], 'current_message_id': saved['message']['id']}
    before = frozen(db, actor.user['id'])
    verify_counts(db, actor.user['id'], **allowed)
    bodies = {
        'memories': {'text': '仅用于终态oracle反例的额外合成记忆', 'kind': 'note', 'approved': False},
        'evidence': {'title': '终态oracle额外合成资料', 'text': '仅用于隔离终态反例的原文，不是真实财报。' * 4,
                     'company': journey.COMPANY},
        'feedback': {'run_id': fixture.RUN_ID, 'rating': 'unclear', 'comment': '仅用于终态oracle反例的额外合成反馈'},
    }
    # Real authenticated API writes exercise the previously missed tables.
    # They are adverse controls, never evidence of an actual UI side effect.
    response = actor.post('/' + table, json=bodies[table])
    assert response.status_code == 201, response.text
    assert db.execute('SELECT count(*) FROM ' + table).fetchone()[0] == 1
    assert frozen(db, actor.user['id']) == before
    with pytest.raises(RuntimeError, match='required-empty table: ' + table):
        verify_counts(db, actor.user['id'], **allowed)
    # Detection must not silently delete the extra row or repair old history.
    assert db.execute('SELECT count(*) FROM ' + table).fetchone()[0] == 1
    assert frozen(db, actor.user['id']) == before


def test_real_current_question_and_normal_login_audit_remain_allowed(empty_actor):
    actor = empty_actor; db = actor.client.app.state.store.db
    restore(actor)
    before = verify_counts(db, actor.user['id'])
    sessions = db.execute('SELECT count(*) FROM auth_sessions').fetchone()[0]
    audits = db.execute('SELECT count(*) FROM audit').fetchone()[0]
    login = actor.client.post('/api/auth/login', json={'email': actor.email, 'password': actor.password})
    assert login.status_code == 200, login.text
    assert db.execute('SELECT count(*) FROM auth_sessions').fetchone()[0] == sessions + 1
    dataset = ok(actor.get('/datasets/' + fixture.DATASET_ID)); t = thread(actor, dataset)
    saved = ok(message(actor, t, journey.QUESTION), 201)
    assert db.execute('SELECT count(*) FROM audit').fetchone()[0] > audits
    assert verify_counts(db, actor.user['id'], current_thread_id=t['id'],
                         current_message_id=saved['message']['id']) == before


@pytest.mark.parametrize('kind', ['result', 'plan'])
def test_actual_api_corruption_does_not_pass_as_ordinary_old_warning(empty_actor, kind):
    actor = empty_actor; db = actor.client.app.state.store.db
    restore(actor)
    if kind == 'result':
        row = db.execute('SELECT result FROM runs WHERE id=?', (fixture.RUN_ID,)).fetchone()
        changed = json.loads(row['result']); changed['readout']['facts'][0]['value'] = 999
        db.execute('UPDATE runs SET result=? WHERE id=?', (json.dumps(changed), fixture.RUN_ID))
    else:
        row = db.execute('SELECT payload FROM workspace_objects WHERE id=?', (fixture.PLAN_ID,)).fetchone()
        changed = json.loads(row['payload']); changed['scope_query'] = '2024-Q2成本金额是多少元'
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (json.dumps(changed), fixture.PLAN_ID))
    audit = ok(actor.get('/workspace/runs/' + fixture.RUN_ID + '/audit'))
    assert audit['question_compatibility'] is None
    with pytest.raises(AssertionError):
        journey.expect_historical_api(audit, ok(actor.get('/runs/' + fixture.RUN_ID)),
                                     ok(actor.get('/workspace/plans/' + fixture.PLAN_ID)))
    if kind == 'result':
        assert actor.get('/runs/' + fixture.RUN_ID + '/export?format=json').status_code == 409


def test_separately_registered_journey_does_not_expand_other_suites_or_fault_permissions():
    from scripts.product_audit_config import AUDIT_SUITES
    from scripts.product_browser_audit import Probe
    assert journey.SCENARIO not in AUDIT_SUITES
    assert fixture.ARTIFACT_KIND not in Probe.artifact_kinds
    admitted = [name for name, suite in AUDIT_SUITES.items()
                if journey.SCENARIO in [item[0] for item in suite['scenarios']]]
    assert admitted == ['historical-warning']
    assert AUDIT_SUITES[admitted[0]]['legacy_history_preparation'] == fixture.SCOPE
    assert not AUDIT_SUITES[admitted[0]].get('database_fault_injection')


def render_actual_api(actor, current_message):
    """Compiled renderer consumes actual authenticated API results, no browser."""
    audit_path = '/api/workspace/runs/' + fixture.RUN_ID + '/audit'
    review_path = '/api/workspace/runs/' + fixture.RUN_ID + '/reviews'
    responses = {
        audit_path: ok(actor.get(audit_path[4:])), review_path: ok(actor.get(review_path[4:])),
        '/api/workspace/reports': ok(actor.get('/workspace/reports?identity_id=&dataset_id=' + fixture.DATASET_ID)),
    }
    rendered = subprocess.run(['node', '--input-type=module', '-e', '''
import {readFileSync} from 'node:fs';
const input=JSON.parse(readFileSync(0,'utf8')), calls=[];
globalThis.document={addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};
const savedInterval=globalThis.setInterval;globalThis.setInterval=()=>0;
const {messageView}=await import('./web/dist/copilot-ui.js');globalThis.setInterval=savedInterval;
const {runPage}=await import('./web/dist/views-studio.js');
const {reportsPage}=await import('./web/dist/views-analysis.js');
const {state}=await import('./web/dist/state.js');
Object.assign(state,{user:input.user,active:input.dataset,identity:'',identities:[],cache:{}});
globalThis.fetch=async(url,init)=>{
 if(init?.method&&init.method!=='GET')throw Error('Renderer attempted a mutation');
 const path=url.split('?')[0];if(!(path in input.responses))throw Error('Uncaptured API read '+url);
 calls.push(url);return new Response(JSON.stringify(input.responses[path]),{status:200,headers:{'content-type':'application/json'}});
};
process.stdout.write(JSON.stringify({report_html:await runPage(input.run),list_html:await reportsPage('0'),
 message_html:messageView(input.message),calls}));
'''], input=json.dumps({'responses': responses, 'message': current_message, 'user': actor.user,
                       'dataset': fixture.DATASET_ID, 'run': fixture.RUN_ID}, ensure_ascii=False),
        cwd=ROOT, encoding='utf-8', capture_output=True, timeout=15, check=True)
    return json.loads(rendered.stdout)


def test_real_authenticated_api_to_compiled_list_warning_and_current_refusal_reader(empty_actor):
    actor = empty_actor; db = actor.client.app.state.store.db
    restore(actor)
    dataset = ok(actor.get('/datasets/' + fixture.DATASET_ID))
    t = thread(actor, dataset)
    saved = ok(message(actor, t, journey.QUESTION), 201)['message']
    before = frozen(db, actor.user['id'])
    rendered = render_actual_api(actor, saved)
    html = rendered['report_html']; current_html = rendered['message_html']
    assert '<small>' + journey.QUESTION + '</small>' in rendered['list_html']
    assert 'data-route="agents:run-' + fixture.RUN_ID + '"' in rendered['list_html']
    warning = re.search(r'<section[^>]*data-historical-question-warning.*?</section>', html).group()
    value = re.search(r'<section[^>]*data-report-readout.*?</section>', html).group()
    for text in (journey.WARNING_TITLE, '原问题：' + journey.QUESTION, journey.NOTICE,
                 journey.HISTORY_NOTICE, journey.EXPORT_NOTICE):
        assert text in unescape(warning)
    assert html.index(warning) < html.index(value)
    for text in (journey.VALUE_TITLE, '<strong>10 万元</strong>', journey.SOURCE_NOTICE,
                 '当时未记录或目标季度未绑定文件', '本页金额展示单位：万元。'):
        assert text in unescape(value)
    assert '<h2>本次问题的回答</h2>' not in html
    assert '记录一致性通过' in html
    assert 'data-historical-question-warning' not in current_html and 'class="fact-grid"' not in current_html
    assert '<p class="research-answer">' + journey.NOTICE + '</p>' in current_html
    assert frozen(db, actor.user['id']) == before
    # A real corrupt result from the actual API cannot become a green warning.
    original = db.execute('SELECT result FROM runs WHERE id=?', (fixture.RUN_ID,)).fetchone()['result']
    changed = json.loads(original); changed['readout']['facts'][0]['value'] = 999
    db.execute('UPDATE runs SET result=? WHERE id=?', (json.dumps(changed), fixture.RUN_ID))
    corrupt = render_actual_api(actor, saved)['report_html']
    assert 'data-report-unverified' in corrupt and 'data-report-export-unavailable' in corrupt
    assert 'data-historical-question-warning' not in corrupt and 'data-report-readout' not in corrupt
