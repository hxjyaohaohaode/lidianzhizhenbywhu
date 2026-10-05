"""Pure adverse journey contracts; no browser, server, socket, DB, or supplier.

Reader adapters model geometry and wheel movement only. They are not native
UI evidence and do not establish application eligibility or human readability.
"""
from copy import deepcopy
import csv
import io
from types import SimpleNamespace

import pytest

from scripts import product_action_evidence_journey as journey
from scripts.product_first_use_audit import HEADERS, HarnessContractError


def catalog(later=False):
    rows = []
    for global_scope in (False, True):
        text = journey.GLOBAL_TEXT if global_scope else journey.COMPANY_TEXT
        review = {'company': '' if global_scope else journey.COMPANY, 'global_scope': global_scope,
            'status': 'unreviewed' if global_scope else 'accepted',
            'stance': 'context' if global_scope else 'contradicts' if later else 'supports',
            'note': '' if global_scope else journey.LATER_NOTE if later else journey.ORIGINAL_NOTE,
            'tags': [], 'expires_at': None}
        rows.append({'id': 'global' if global_scope else 'company', 'version': 1,
            'content_hash': journey.canonical_hash(text), 'review_version': 1 if global_scope else 3 if later else 2,
            'review': review, 'review_hash': journey.canonical_hash(review), 'eligible': True, 'excluded_reason': None,
            'payload': {'title': journey.GLOBAL_TITLE if global_scope else journey.COMPANY_TITLE,
                'text': text, 'source_url': journey.GLOBAL_URL if global_scope else journey.COMPANY_URL,
                'published_at': journey.PUBLISHED, 'source_kind': 'user_provided', 'verification': 'unverified'}})
    return rows


def action_pair():
    selected, _ = catalog()
    initial = [{'status': 'open', 'note': '用户创建', 'evidence_ids': [], 'evidence_snapshots': []},
        {'status': 'in_progress', 'note': journey.START_NOTE, 'evidence_ids': [], 'evidence_snapshots': []}]
    prior = {'id': 'action', 'version': 2, 'payload': {'status': 'in_progress', 'history': initial,
        'title': journey.ACTION_TITLE, 'company': journey.COMPANY, 'run_id': 'run', 'dataset_id': 'dataset',
        'acceptance': journey.ACCEPTANCE, 'origin': {'title': journey.ACTION_TITLE}, 'changes': []}}
    frozen = {key: deepcopy(selected[key]) for key in journey.REF_FIELDS}
    frozen.update({'review': deepcopy(selected['review']), 'title': journey.COMPANY_TITLE,
        'source_url': journey.COMPANY_URL, 'text': journey.COMPANY_TEXT,
        'text_length': len(journey.COMPANY_TEXT), 'text_truncated': False, 'captured_at': '2026-10-05T00:00:00Z'})
    completed = deepcopy(prior)
    completed.update(version=3, acceptance_impact={'state': 'current', 'historical_acceptance_preserved': True})
    completed['payload']['status'] = 'done'
    completed['payload']['history'].append({'status': 'done', 'note': journey.DONE_NOTE,
        'evidence_ids': ['company'], 'evidence_snapshots': [frozen], 'action_version': 3})
    completed['object_hash'] = journey.canonical_hash(completed['payload'])
    return prior, completed, selected


def test_native_entry_denies_local_execution_before_any_probe_access(tmp_path, monkeypatch):
    monkeypatch.delenv('GITHUB_ACTIONS', raising=False)
    with pytest.raises(HarnessContractError, match='Local browser execution is restricted'):
        journey.action_evidence_journey(SimpleNamespace(), repository_root=tmp_path, data_dir=tmp_path,
            expected_web_tree='a' * 40, expected_server_tree='b' * 40)


def test_actual_template_reuse_stays_two_quarters_and_does_not_seed_a_company():
    template = (','.join(HEADERS) + '\n').encode('utf-8-sig')
    rows = list(csv.DictReader(io.StringIO(journey.fixture_csv(template).decode('utf-8-sig'))))
    assert [row['季度'] for row in rows] == ['2024-Q1', '2024-Q2']
    assert [(row['营业收入'], row['营业成本']) for row in rows] == [('100000', '80000')] * 2
    assert all(row['总资产'] == '' and row['总负债'] == '' for row in rows)
    with pytest.raises(AssertionError):
        journey.fixture_csv(template + b'2024-Q1,1,1\n')


def test_synthetic_natural_text_is_bounded_complete_and_unambiguous():
    assert 400 < len(journey.ORIGINAL_NOTE) <= 2000
    assert 600 < len(journey.COMPANY_TEXT) < 12000
    for text in (journey.ORIGINAL_NOTE, journey.COMPANY_TEXT):
        parts = text.split('\n')
        assert len(parts) >= 15 and len(set(parts)) == len(parts)
        assert all(10 < len(part) < 70 for part in parts)
    assert journey.COMPANY_URL.endswith('.example/company-synthetic')
    assert journey.GLOBAL_URL.endswith('.example/global-synthetic')


def test_full_catalog_and_later_review_preserve_scope_and_unverified_sources():
    first, other = journey.expect_catalog(catalog())
    revised, same_other = journey.expect_catalog(catalog(True), later=True)
    assert first['id'] == revised['id'] and other == same_other
    assert revised['payload'] == first['payload'] and revised['review_hash'] != first['review_hash']


@pytest.mark.parametrize('damage', ['missing_tail', 'note_tail', 'wrong_company', 'auto_accept_global',
    'global_not_explicit', 'wrong_stance', 'text_hash', 'review_hash', 'review_version', 'source_url',
    'invented_origin', 'fact_checked', 'source_kind', 'extra_document', 'missing_document', 'ineligible'])
def test_catalog_oracle_rejects_incomplete_or_misrepresented_reader_values(damage):
    rows = catalog(); company, global_doc = rows
    if damage == 'missing_tail': company['payload']['text'] = journey.COMPANY_TEXT[:-10]
    elif damage == 'note_tail': company['review']['note'] = journey.ORIGINAL_NOTE[:-10]
    elif damage == 'wrong_company': company['review']['company'] = 'unrelated company'
    elif damage == 'auto_accept_global': global_doc['review']['status'] = 'accepted'
    elif damage == 'global_not_explicit': global_doc['review']['global_scope'] = False
    elif damage == 'wrong_stance': company['review']['stance'] = 'context'
    elif damage == 'text_hash': company['content_hash'] = '0' * 64
    elif damage == 'review_hash': company['review_hash'] = '0' * 64
    elif damage == 'review_version': company['review_version'] = 3
    elif damage == 'source_url': company['payload']['source_url'] = journey.GLOBAL_URL
    elif damage == 'invented_origin': company['payload']['original_source_url'] = journey.COMPANY_URL
    elif damage == 'fact_checked': company['payload']['verification'] = 'verified'
    elif damage == 'source_kind': company['payload']['source_kind'] = 'public_document'
    elif damage == 'extra_document': rows.append(deepcopy(company))
    elif damage == 'missing_document': rows.pop()
    elif damage == 'ineligible': global_doc['eligible'] = False
    with pytest.raises(AssertionError): journey.expect_catalog(rows)


def test_real_completion_contract_requires_exact_one_explicit_frozen_source():
    prior, completed, selected = action_pair()
    frozen = journey.expect_completed(completed, prior, selected)
    assert frozen['review']['note'] == journey.ORIGINAL_NOTE


@pytest.mark.parametrize('damage', ['wrong_id', 'wrong_version', 'old_history', 'state', 'draft', 'extra_selection',
    'missing_snapshot', 'text_tail', 'note_tail', 'source_url', 'review_hash', 'text_hash', 'review_version',
    'text_length', 'truncation', 'missing_time', 'original_title', 'acceptance', 'source_impact'])
def test_completion_oracle_rejects_wrong_frozen_binding_or_rewritten_action(damage):
    prior, completed, selected = action_pair()
    last = completed['payload']['history'][-1]; frozen = last['evidence_snapshots'][0]
    if damage == 'wrong_id': completed['id'] = 'other-action'
    elif damage == 'wrong_version': completed['version'] = 4
    elif damage == 'old_history': completed['payload']['history'][0]['note'] = 'rewritten'
    elif damage == 'state': completed['payload']['status'] = 'in_progress'
    elif damage == 'draft': last['note'] = 'discarded draft'
    elif damage == 'extra_selection': last['evidence_ids'].append('global')
    elif damage == 'missing_snapshot': last['evidence_snapshots'] = []
    elif damage == 'text_tail': frozen['text'] = journey.COMPANY_TEXT[:-10]
    elif damage == 'note_tail': frozen['review']['note'] = journey.ORIGINAL_NOTE[:-10]
    elif damage == 'source_url': frozen['source_url'] = journey.GLOBAL_URL
    elif damage == 'review_hash': frozen['review_hash'] = '0' * 64
    elif damage == 'text_hash': frozen['content_hash'] = '0' * 64
    elif damage == 'review_version': frozen['review_version'] = 3
    elif damage == 'text_length': frozen['text_length'] -= 1
    elif damage == 'truncation': frozen['text_truncated'] = True
    elif damage == 'missing_time': frozen['captured_at'] = ''
    elif damage == 'original_title': completed['payload']['title'] = 'changed title'
    elif damage == 'acceptance': completed['payload']['acceptance'] = 'changed criteria'
    elif damage == 'source_impact': completed['acceptance_impact']['state'] = 'changed'
    with pytest.raises(AssertionError): journey.expect_completed(completed, prior, selected)


def test_later_review_changes_only_live_impact_and_leaves_entire_action_frozen():
    _, completed, original = action_pair()
    current = deepcopy(completed); current['acceptance_impact']['state'] = 'changed'
    revised = catalog(True)[0]
    journey.expect_preserved_history(current, completed, original, revised)


@pytest.mark.parametrize('damage', ['history_note', 'history_review', 'current_version', 'live_impact',
    'silent_acceptance', 'no_new_hash', 'new_text', 'new_document_version', 'original_action', 'wrong_object_hash'])
def test_later_review_oracle_rejects_silent_history_rewrite_or_false_revision(damage):
    _, completed, original = action_pair()
    current = deepcopy(completed); current['acceptance_impact']['state'] = 'changed'
    revised = catalog(True)[0]
    if damage == 'history_note': current['payload']['history'][-1]['note'] = journey.FRESH_NOTE
    elif damage == 'history_review': current['payload']['history'][-1]['evidence_snapshots'][0]['review'] = revised['review']
    elif damage == 'current_version': current['version'] = 4
    elif damage == 'live_impact': current['acceptance_impact']['state'] = 'current'
    elif damage == 'silent_acceptance': current['payload']['status'] = 'open'
    elif damage == 'no_new_hash': revised['review_hash'] = original['review_hash']
    elif damage == 'new_text': revised['payload']['text'] += 'changed'
    elif damage == 'new_document_version': revised['version'] = 2
    elif damage == 'original_action': current['payload']['acceptance'] = 'different acceptance'
    elif damage == 'wrong_object_hash': current['object_hash'] = '0' * 64
    with pytest.raises(AssertionError): journey.expect_preserved_history(current, completed, original, revised)


def writes():
    return [{'method': method, 'path': '/api/' + path} for method, path in [
        ('POST', 'auth/register'), ('POST', 'workspace/imports/file'), ('POST', 'workspace/imports/stage/commit'),
        ('POST', 'workspace/plans'), ('POST', 'workspace/plans/plan/execute'), ('POST', 'workspace/actions'),
        ('PUT', 'workspace/actions/action/status'), ('POST', 'evidence'),
        ('PUT', 'workspace/evidence/company/review'), ('POST', 'evidence'),
        ('PUT', 'workspace/actions/action/status'), ('PUT', 'workspace/evidence/company/review')]]


def test_exact_ordered_twelve_ui_writes_have_no_auto_reacceptance():
    journey.expect_mutations(writes(), stage_id='stage', plan_id='plan', action_id='action', evidence_id='company')


@pytest.mark.parametrize('damage', ['duplicate', 'drop', 'wrong_id', 'reorder', 'query', 'hidden_write'])
def test_write_contract_rejects_undeclared_or_missing_mutations(damage):
    rows = writes()
    if damage == 'duplicate': rows.append(deepcopy(rows[-1]))
    elif damage == 'drop': rows.pop()
    elif damage == 'wrong_id': rows[-1]['path'] = '/api/workspace/evidence/global/review'
    elif damage == 'reorder': rows[8], rows[9] = rows[9], rows[8]
    elif damage == 'query': rows[0]['path'] += '?hidden=1'
    elif damage == 'hidden_write': rows.append({'method': 'POST', 'path': '/api/evidence/fetch'})
    with pytest.raises(AssertionError):
        journey.expect_mutations(rows, stage_id='stage', plan_id='plan', action_id='action', evidence_id='company')


@pytest.mark.parametrize('damage', [None, 'replaced_form', 'replaced_note', 'lost_note', 'extra_selected', 'lost_selected', 'fresh_refs'])
def test_original_form_note_selection_and_read_binding_are_all_preserved(damage):
    refs = [{key: row[key] for key in journey.REF_FIELDS} for row in catalog()]
    state = {'same_form': True, 'same_note': True, 'note': journey.DONE_NOTE, 'selected': ['company'], 'refs': deepcopy(refs)}
    if damage == 'replaced_form': state['same_form'] = False
    elif damage == 'replaced_note': state['same_note'] = False
    elif damage == 'lost_note': state['note'] = ''
    elif damage == 'extra_selected': state['selected'].append('global')
    elif damage == 'lost_selected': state['selected'] = []
    elif damage == 'fresh_refs': state['refs'][0]['review_hash'] = '0' * 64
    if damage:
        with pytest.raises(AssertionError):
            journey.expect_preserved_form(state, note=journey.DONE_NOTE, selected=['company'], refs=refs)
    else:
        journey.expect_preserved_form(state, note=journey.DONE_NOTE, selected=['company'], refs=refs)


def address_structure(prefix='来源地址：'):
    url = journey.COMPANY_URL
    return {'tag': 'p', 'children': ['#text', 'a'], 'prefix': prefix,
        'href': url, 'link_children': ['#text', 'svg'], 'link_text': url + ' ',
        'svg_count': 1, 'svg_hidden': 'true', 'svg_text': '', 'forbidden': 0,
        'text': prefix + url + ' ', 'rendered': prefix + url}


@pytest.mark.parametrize('prefix', ['来源地址：', '原始采集地址：未单独记录；当前记录地址：'])
def test_source_text_range_keeps_complete_address_and_original_address_caveat(prefix):
    value = address_structure(prefix)
    assert journey.expect_address_structure(value, prefix=prefix, url=journey.COMPANY_URL) == value['text']


@pytest.mark.parametrize('damage', ['hidden', 'extra_element', 'wrong_url', 'short_address', 'lost_caveat',
    'svg_text', 'visible_svg', 'extra_svg', 'extra_text_node', 'not_rendered', 'missing_prefix'])
def test_source_text_reader_rejects_hidden_or_unaccounted_content(damage):
    prefix = '原始采集地址：未单独记录；当前记录地址：'
    value = address_structure(prefix)
    if damage == 'hidden': value['forbidden'] = 1
    elif damage == 'extra_element': value['children'].append('span')
    elif damage == 'wrong_url': value['href'] = journey.GLOBAL_URL
    elif damage == 'short_address': value['link_text'] = '查看来源 '
    elif damage == 'lost_caveat': value['text'] = '原始采集地址：' + journey.COMPANY_URL + ' '
    elif damage == 'svg_text': value['svg_text'] = 'hidden content'
    elif damage == 'visible_svg': value['svg_hidden'] = None
    elif damage == 'extra_svg': value['svg_count'] = 2
    elif damage == 'extra_text_node': value['link_children'].append('#text')
    elif damage == 'not_rendered': value['rendered'] = prefix
    elif damage == 'missing_prefix': value['prefix'] = ''
    with pytest.raises(AssertionError): journey.expect_address_structure(value, prefix=prefix, url=journey.COMPANY_URL)


def reader_double(*, damage=None):
    """Stateful clipped paragraph/wheel adapter, explicitly not native evidence."""
    parts = [f'合成段落{i}：本段必须完整可见。' for i in range(12)]
    text = '\n'.join(parts)
    top = 0
    frames, wheels = [], []
    class Locator:
        def count(self): return 1
        def is_visible(self): return True
        def text_content(self): return text[:-1] if damage == 'missing_tail' else text
        def scroll_into_view_if_needed(self): pass
        def evaluate(self, script, needle=None):
            if script == journey.SCROLL_STATE:
                return {'top': top, 'height': 480 if damage != 'not_long' else 100, 'client': 100}
            assert script == journey._TEXT_GEOMETRY
            index = parts.index(needle)
            y = index * 40 - top
            return {'found': damage != 'missing_range', 'top': y, 'bottom': y + 35,
                'left': 20, 'right': 180,
                'clip': {'top': 0, 'bottom': 100, 'left': 0, 'right': 200},
                'root': {'top': 0, 'bottom': 100, 'left': 0, 'right': 200},
                'visible': y >= 0 and y + 35 <= 100 and damage != 'never_visible'}
    def wheel(x, y):
        nonlocal top
        wheels.append((x, y))
        if damage != 'no_motion': top = max(0, min(380, top + y))
    p = SimpleNamespace(observations={}, step=lambda label, work: work(),
        screenshot=lambda name: frames.append((name, top)) or name,
        page=SimpleNamespace(mouse=SimpleNamespace(move=lambda x, y: None, wheel=wheel),
            evaluate=lambda script: None))
    return p, Locator(), text, frames, wheels


def test_full_reader_captures_every_paragraph_and_requires_observed_inner_wheels():
    p, locator, text, frames, wheels = reader_double()
    journey._full_read(p, locator, text, 'adapter contract', require_inner=True)
    reading = p.observations['complete_evidence_readings'][0]
    assert [r['text'] for r in reading['parts']] == text.split('\n')
    assert all(r['geometry']['visible'] and r['screenshot'] for r in reading['parts'])
    assert len(frames) > 1 and wheels and reading['ordinary_wheels']
    assert reading['manual_pixel_review'] == 'pending'
    assert any(m['after_scroll']['top'] > m['before_scroll']['top'] for m in reading['ordinary_wheels'])


@pytest.mark.parametrize('damage', ['missing_tail', 'not_long', 'missing_range', 'never_visible', 'no_motion'])
def test_full_reader_refuses_dom_only_tail_or_absent_real_scroll(damage):
    p, locator, text, _, _ = reader_double(damage=damage)
    with pytest.raises(AssertionError): journey._full_read(p, locator, text, 'damaged adapter', require_inner=True)
    assert p.observations.get('complete_evidence_readings', []) == []
