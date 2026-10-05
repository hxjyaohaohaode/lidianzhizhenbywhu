"""Real guarded ASGI catalog -> compiled renderer -> bound action submission.

Synthetic data, no listener/browser/supplier; rendered HTML is not native UI evidence.
"""
from copy import deepcopy
from html import unescape
import json
from pathlib import Path
import re
import subprocess

from conftest import Actor
from server.store import digest, encode
from test_action_evidence_binding import capture, selection
from test_current_viewed_bindings import actor, business_state, complete_action, viewed_action
from test_services import ok

ROOT = Path(__file__).resolve().parents[1]


def rendered_selection(action, catalog):
    result = subprocess.run(['node', '--input-type=module', '-e', '''
import {readFileSync} from 'node:fs';
import {actionDetail} from './web/dist/views-analysis.js';
import {state} from './web/dist/state.js';
globalThis.fetch=()=>{throw new Error('Rendering must not make a request');};
state.identities=[];
const {action,catalog}=JSON.parse(readFileSync(0,'utf8'));
process.stdout.write(actionDetail(action,catalog));
'''], input=json.dumps({'action': action, 'catalog': catalog}, ensure_ascii=False),
        cwd=ROOT, encoding='utf-8', capture_output=True, timeout=15, check=True)
    html = result.stdout
    refs = json.loads(unescape(re.search(r'data-evidence-refs="([^"]*)"', html).group(1)))
    return html, refs


def test_real_catalog_displays_exact_complete_review_and_source_before_explicit_selection(actor):
    action, doc, viewed, _ = viewed_action(actor)
    reviewed = ok(actor.put('/workspace/evidence/' + doc['id'] + '/review', json={
        **viewed['review'], 'version': viewed['review_version'], 'stance': 'contradicts',
        'note': '适用范围开始\n' + '仍需核对成本确认边界。' * 140 + '\n审阅说明尾部',
        'expires_at': '2027-01-01'}))
    ok(actor.put('/evidence/' + doc['id'] + '/metadata', json={
        'version': doc['version'], 'title': '已查看的修订来源',
        'source_url': 'https://example.test/current-display', 'published_at': '2026-10-01'}))
    pending = capture(actor, '尚未审阅')
    foreign = capture(Actor(actor.client), '其他账户绝不可见')
    catalog = ok(actor.get('/workspace/evidence'))['items']
    current = next(e for e in catalog if e['id'] == doc['id'])
    assert current['review_version'] == reviewed['version'] + 1  # Metadata edit also advances the review binding.
    store = actor.client.app.state.store
    before = business_state(store)
    html, refs = rendered_selection(action, catalog)
    assert business_state(store) == before
    for text in (current['review']['note'], current['payload']['text'],
                 '反向 / 反驳证据', '资料版本 2', f'审阅版本 {current["review_version"]}',
                 '适用范围：测试企业', '2027-01-01', '未经独立核验', '尚未审阅'):
        assert text in html
    assert foreign['id'] not in html and pending['id'] in html
    assert current['review_hash'] == digest(current['review'])
    chosen = next(r for r in refs if r['id'] == doc['id'])
    saved = ok(complete_action(actor, action, [chosen]))
    frozen = saved['payload']['history'][-1]['evidence_snapshots'][0]
    assert frozen['review'] == current['review']
    assert frozen['text'] == current['payload']['text']
    assert {key: frozen[key] for key in chosen} == chosen
    assert saved['payload']['history'][:-1] == action['payload']['history']


def test_later_same_version_review_requires_new_readable_selection_and_never_rewrites_history(actor):
    action, doc, viewed, _ = viewed_action(actor)
    old_html, old_refs = rendered_selection(action, [viewed])
    store = actor.client.app.state.store
    row = store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='evidence_review' AND natural_key=?",
                    (actor.user['id'], doc['id']))
    updated = {**row['payload'], 'note': '后来保存的反向说明，必须重新阅读并明确选择', 'stance': 'contradicts'}
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET payload=? WHERE id=?', (encode(updated), row['id']))
    before = business_state(store)
    response = complete_action(actor, action, old_refs)
    assert response.status_code == 409 and response.json()['error']['code'] == 'ACTION_EVIDENCE_CHANGED'
    assert business_state(store) == before
    fresh = selection(actor, doc)
    html, refs = rendered_selection(action, [fresh])
    assert updated['note'] not in old_html and viewed['review']['note'] in old_html
    assert updated['note'] in html and '反向 / 反驳证据' in html
    assert fresh['review_version'] == viewed['review_version'] and refs != old_refs
    assert business_state(store) == before  # Reading/rendering never reselects or accepts.
    saved = ok(complete_action(actor, action, refs))
    assert saved['payload']['history'][:-1] == action['payload']['history']
    assert saved['payload']['history'][-1]['evidence_snapshots'][0]['review'] == updated


def test_rendered_mixed_refs_roll_back_atomically_and_missing_review_is_not_reconstructed(actor):
    action, first, viewed, _ = viewed_action(actor)
    second = capture(actor, '第二份独立资料')
    missing = capture(actor, '审阅记录缺失')
    store = actor.client.app.state.store
    with store.transaction() as db:
        db.execute("DELETE FROM workspace_objects WHERE user_id=? AND kind='evidence_review' AND natural_key=?",
                   (actor.user['id'], missing['id']))
    catalog = ok(actor.get('/workspace/evidence'))['items']
    html, refs = rendered_selection(action, catalog)
    assert missing['id'] not in html
    assert {r['id'] for r in refs} == {first['id'], second['id']}
    selection_snapshot = deepcopy(refs)
    current = selection(actor, second)
    ok(actor.put('/workspace/evidence/' + second['id'] + '/review', json={
        **current['review'], 'version': current['review_version'], 'status': 'accepted',
        'note': '另一份资料已有新审阅，旧选择不能静默替换'}))
    before = business_state(store)
    result = complete_action(actor, action, refs)
    assert result.status_code == 409 and result.json()['error']['code'] == 'ACTION_EVIDENCE_CHANGED'
    assert refs == selection_snapshot and business_state(store) == before
    existing = next(a for a in ok(actor.get('/workspace/actions'))['items'] if a['id'] == action['id'])
    assert existing['payload'] == action['payload']


def test_new_source_then_metadata_edit_distinguishes_recorded_origin_and_preserves_frozen_acceptance(actor):
    action, _, _, _ = viewed_action(actor)
    original_url = 'https://example.test/source-at-creation'
    current_url = 'https://example.test/later-display-address'
    doc = ok(actor.post('/evidence', json={
        'title': '初次保存的地址', 'text': '隔离原文保持不变，修改标题和展示地址不表示原文发生变化。' * 3,
        'company': '测试企业', 'source_url': original_url}), 201)
    initial = selection(actor, doc)
    ok(actor.put('/workspace/evidence/' + doc['id'] + '/review', json={
        **initial['review'], 'version': initial['review_version'], 'status': 'accepted',
        'note': '核对当前保存文本，仅记录人工判断，并非独立事实认证'}))
    viewed = selection(actor, doc)
    assert viewed['version'] == 1 and 'original_source_url' not in viewed['payload']
    store = actor.client.app.state.store
    before = business_state(store)
    initial_html, initial_refs = rendered_selection(action, [viewed])
    assert '原始采集地址：未单独记录；当前记录地址：' in initial_html
    assert original_url in initial_html and '资料版本 1' in initial_html
    assert business_state(store) == before
    accepted = ok(complete_action(actor, action, initial_refs))
    initial_history = deepcopy(accepted['payload']['history'])
    frozen = initial_history[-1]['evidence_snapshots'][0]
    assert frozen['source_url'] == original_url and frozen['version'] == 1

    ok(actor.put('/evidence/' + doc['id'] + '/metadata', json={
        'version': 1, 'title': '仅标题和展示地址已修改', 'source_url': current_url}))
    edited = selection(actor, doc)
    assert edited['version'] == 2 and edited['review_version'] == viewed['review_version'] + 1
    assert edited['payload']['text'] == viewed['payload']['text']
    assert edited['content_hash'] == viewed['content_hash']
    assert edited['review'] == viewed['review'] and edited['review_hash'] == viewed['review_hash']
    assert edited['payload']['original_source_url'] == original_url
    assert edited['payload']['source_url'] == current_url
    before = business_state(store)
    updated_html, updated_refs = rendered_selection(accepted, [edited])
    assert '资料版本 2' in updated_html and '原文版本 2' not in updated_html
    assert f'<p>原始采集地址：<a href="{original_url}"' in updated_html
    assert f'<p>来源地址：<a href="{current_url}"' in updated_html
    assert '未单独记录' not in updated_html and business_state(store) == before
    reread = next(a for a in ok(actor.get('/workspace/actions'))['items'] if a['id'] == action['id'])
    assert reread['payload']['history'] == initial_history

    reopened = ok(actor.put('/workspace/actions/' + action['id'] + '/status', json={
        'version': accepted['version'], 'status': 'open', 'note': '明确重新打开后核对修改后的展示信息'}))
    active = ok(actor.put('/workspace/actions/' + action['id'] + '/status', json={
        'version': reopened['version'], 'status': 'in_progress', 'note': '重新核对本次已展示的资料版本'}))
    before = business_state(store)
    stale = complete_action(actor, active, initial_refs)
    assert stale.status_code == 409 and stale.json()['error']['code'] == 'ACTION_EVIDENCE_CHANGED'
    assert business_state(store) == before
    saved = ok(complete_action(actor, active, updated_refs))
    assert saved['payload']['history'][:len(initial_history)] == initial_history
    assert saved['payload']['history'][-1]['evidence_snapshots'][0]['source_url'] == current_url
