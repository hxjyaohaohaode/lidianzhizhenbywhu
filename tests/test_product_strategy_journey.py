"""Pure adverse reader oracles plus real in-process API contract, never native UI."""
from copy import deepcopy
import csv
import io
from types import SimpleNamespace

import pytest

from scripts import product_strategy_journey as journey
from scripts.product_first_use_audit import HEADERS, HarnessContractError


def test_local_native_entry_stops_before_any_browser_or_request(tmp_path, monkeypatch):
    monkeypatch.delenv('GITHUB_ACTIONS', raising=False)
    with pytest.raises(HarnessContractError, match='Local browser execution is restricted'):
        journey.strategy_consent_journey(SimpleNamespace(), repository_root=tmp_path, data_dir=tmp_path,
            expected_web_tree='a' * 40, expected_server_tree='b' * 40)


def test_actual_blank_template_yields_one_file_with_only_two_ended_quarters():
    template = (','.join(HEADERS) + '\n').encode('utf-8-sig')
    rows = list(csv.DictReader(io.StringIO(journey.fixture_csv(template).decode('utf-8-sig'))))
    assert len(rows) == 2 and [r['季度'] for r in rows] == ['2024-Q1', '2024-Q2']
    assert all([r[k] for k in ['营业收入', '营业成本', '净利润', '经营现金流']] ==
        ['100000', '80000', '5000', '10000'] for r in rows)
    assert all(r[k] == '' for r in rows for k in HEADERS if k not in
        {'季度', '营业收入', '营业成本', '净利润', '经营现金流'})
    with pytest.raises(AssertionError):
        journey.fixture_csv(template + b'2024-Q1,100000,80000\n')


def readable():
    completed = '已计划\n已执行 · 完成\n满足已标注要求\n依据 / 缺口：本地执行产物与保存的人工需求覆盖记录'
    return {'query': '原问题：' + journey.QUESTION,
        'source': '企业：' + journey.COMPANY + '\n目标季度：2024-Q1\n原数据修订：第 1 次修订',
        'partition': '保留组',
        'capability_rows': [['数据核验', completed, completed], ['量化计算', completed, completed],
            ['反向对照', '未计划\n未记录实际执行\n未满足\n依据 / 缺口：未计划此能力，也未记录本地执行产物',
             '已计划\n已执行 · 缺少所需资料\n未满足\n依据 / 缺口：缺少反向资料']],
        'evidence_cells': ['支持资料：未记录\n反向资料：未记录\n背景资料：未记录\n未记录反向分组执行，不能据此推断资料数量',
            '支持资料：0 条（未提供此类资料）\n反向资料：0 条（未提供此类资料）\n背景资料：1 条'],
        'math_rows': [['数学结果', '与原报告一致', '与原报告一致'],
            ['已选企业对照', '原任务未选企业对照（不适用）', '原任务未选企业对照（不适用）']]}


def test_complete_human_table_with_explicit_missing_counterevidence_passes():
    journey.expect_readable_case(**readable())


@pytest.mark.parametrize('damage', [None, 'missing_rendered_word', 'hidden_child', 'missing_range', 'empty_original'])
def test_reading_group_keeps_rendered_block_breaks_separate_from_full_range(damage):
    """Reproduce the real L9 table's innerText/textContent distinction, no browser."""
    rendered = '数据核验\n已计划\n\n已执行 · 完成\n\n满足已标注要求'
    original = '数据核验已计划已执行 · 完成满足已标注要求'
    required = ['数据核验', '已计划\n\n已执行 · 完成\n\n满足已标注要求']
    geometry_calls = []
    screenshots = []

    class Locator:
        def count(self): return 1
        def is_visible(self): return True
        def locator(self, selector):
            assert selector == 'svg, pre, details:not([open]), [hidden]'
            return SimpleNamespace(count=lambda: int(damage == 'hidden_child'))
        def inner_text(self):
            return rendered.replace('满足已标注要求', '') if damage == 'missing_rendered_word' else rendered
        def text_content(self): return '' if damage == 'empty_original' else original
        def evaluate(self, script, text):
            assert script == journey._TEXT_GEOMETRY and text == original
            geometry_calls.append(text)
            return {'found': damage != 'missing_range', 'visible': True}

    p = SimpleNamespace(observations={}, step=lambda label, work: work(),
        screenshot=lambda name: screenshots.append(name) or name)
    if damage:
        with pytest.raises(AssertionError): journey._read_groups(p, [(Locator(), required)], '完整能力行')
        assert not screenshots and not p.observations
    else:
        journey._read_groups(p, [(Locator(), required)], '完整能力行')
        assert geometry_calls == [original, original]
        assert screenshots == ['reader-1']
        row = p.observations['complete_text_groups'][0]
        assert row['text'] == original and row['required'] == required


def scroll_reader(bounds, *, clip=None, position=(0, 0), limits=(30, 2000), max_motion=None):
    """Stateful scroll physics only: no browser, server, DOM writes or UI claim."""
    clip = clip or {'left': 970, 'right': 1470, 'top': 100, 'bottom': 900}
    current = dict(bounds)
    position = list(position)
    wheels, pointers, frames, geometry_calls = [], [], [], []
    original = '数据核验已计划已执行 · 完成满足已标注要求'
    rendered = '数据核验\n已计划\n已执行 · 完成\n满足已标注要求'
    required = rendered.splitlines()

    class Locator:
        scroll_into_view_calls = 0
        def count(self): return 1
        def is_visible(self): return True
        def locator(self, selector):
            assert selector == 'svg, pre, details:not([open]), [hidden]'
            return SimpleNamespace(count=lambda: 0)
        def inner_text(self): return rendered
        def text_content(self): return original
        def scroll_into_view_if_needed(self):
            # Like the real table row: its element is in view, but text clips.
            self.scroll_into_view_calls += 1
        def evaluate(self, script, text):
            assert script == journey._TEXT_GEOMETRY and text == original
            geometry_calls.append(text)
            return {'found': True, **current, 'clip': dict(clip), 'root': {
                key: (max if key in ('left', 'top') else min)(current[key], clip[key])
                for key in current},
                'visible': current['right'] > current['left'] and current['bottom'] > current['top']
                    and all(current[k] >= clip[k] - 1 for k in ('left', 'top'))
                    and all(current[k] <= clip[k] + 1 for k in ('right', 'bottom'))}

    def wheel(dx, dy):
        wheels.append((dx, dy))
        for axis, delta, edges in ((0, dx, ('left', 'right')), (1, dy, ('top', 'bottom'))):
            if max_motion is not None:
                delta = min(max_motion, max(-max_motion, delta))
            target = min(limits[axis], max(0, position[axis] + delta))
            for edge in edges:
                current[edge] -= target - position[axis]
            position[axis] = target

    def settle(script):
        assert script == '() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        frames.append(script)

    screenshots = []
    p = SimpleNamespace(observations={}, step=lambda label, work: work(),
        screenshot=lambda name: screenshots.append(name) or name,
        page=SimpleNamespace(mouse=SimpleNamespace(move=lambda x, y: pointers.append((x, y)), wheel=wheel),
            evaluate=settle), wheels=wheels, pointers=pointers, frames=frames,
        screenshots=screenshots, geometry_calls=geometry_calls)
    return p, Locator(), required


@pytest.mark.parametrize('bounds,position,expected', [
    ({'left': 986, 'right': 1484, 'top': 300, 'bottom': 439}, (0, 0), (14, 0)),
    ({'left': 956, 'right': 1454, 'top': 300, 'bottom': 439}, (30, 0), (-14, 0)),
    ({'left': 986, 'right': 1400, 'top': 850, 'bottom': 920}, (0, 0), (0, 280)),
    ({'left': 986, 'right': 1400, 'top': 80, 'bottom': 150}, (0, 300), (0, -280)),
    ({'left': 986, 'right': 1484, 'top': 850, 'bottom': 920}, (0, 0), (14, 280)),
    ({'left': 956, 'right': 1454, 'top': 80, 'bottom': 150}, (30, 300), (-14, -280)),
])
def test_reader_scrolls_only_clipped_axes_and_records_actual_movement(bounds, position, expected):
    p, locator, required = scroll_reader(bounds, position=position)
    journey._read_groups(p, [(locator, required)], '完整能力行')
    assert locator.scroll_into_view_calls == 1
    assert p.wheels == [expected] and len(p.frames) == 1
    assert p.screenshots == ['reader-1']
    record = p.observations['reading_group_scrolls'][0]
    assert len(record['attempts']) == 1
    attempt = record['attempts'][0]
    assert attempt['attempt'] == 1 and attempt['before']['visible'] is False
    assert attempt['wheel'] == dict(zip(('delta_x', 'delta_y'), expected))
    assert attempt['range_movement'] == dict(zip(('x', 'y'), (-expected[0], -expected[1])))
    assert attempt['after']['visible'] is True
    assert attempt['after']['clip'] == attempt['before']['clip']
    assert p.pointers == [(attempt['pointer']['x'], attempt['pointer']['y'])]
    for axis, first, last in [('x', 'left', 'right'), ('y', 'top', 'bottom')]:
        assert attempt['before']['root'][first] < attempt['pointer'][axis] < attempt['before']['root'][last]
    completed = p.observations['complete_text_groups'][0]
    assert completed['geometry'] == attempt['after'] and completed['required'] == required
    assert completed['text'] == record['text'] == locator.text_content()
    assert completed['manual_pixel_review'] == 'pending'


def test_reader_exact_l9_trace_range_needs_fourteen_pixel_native_horizontal_move():
    # Hosted 7e7ebe step 61, call@3539: the 498px range fits the unchanged 500px clip.
    p, locator, required = scroll_reader(
        {'left': 986, 'right': 1484, 'top': 870.390625, 'bottom': 1009.359375},
        clip={'left': 970, 'right': 1470, 'top': 824.09375, 'bottom': 1080})
    journey._read_groups(p, [(locator, required)], '完整能力行')
    assert p.wheels == [(14, 0)]
    final = p.observations['complete_text_groups'][0]['geometry']
    assert (final['left'], final['right']) == (972, 1470)
    assert (final['top'], final['bottom']) == (870.390625, 1009.359375)


@pytest.mark.parametrize('left,right,position,expected', [
    (986, 1884, (0, 0), 280), (556, 1054, (500, 0), -280),
])
def test_reader_caps_each_horizontal_wheel_at_280(left, right, position, expected):
    p, locator, required = scroll_reader(
        {'left': left, 'right': right, 'top': 300, 'bottom': 439},
        position=position, limits=(2000, 2000))
    if right - left > 502:
        with pytest.raises(AssertionError, match='cannot fit through normal scrolling'):
            journey._read_groups(p, [(locator, required)], '完整能力行')
    else:
        journey._read_groups(p, [(locator, required)], '完整能力行')
    assert p.wheels[0] == (expected, 0)
    assert all(abs(dx) <= 280 and dy == 0 for dx, dy in p.wheels)


@pytest.mark.parametrize('right,limits', [(1484, (0, 0)), (1534, (30, 2000))])
def test_reader_stalled_or_truly_wider_group_fails_after_twelve_native_attempts(right, limits):
    p, locator, required = scroll_reader(
        {'left': 986, 'right': right, 'top': 300, 'bottom': 439}, limits=limits)
    with pytest.raises(AssertionError, match='cannot fit through normal scrolling'):
        journey._read_groups(p, [(locator, required)], '完整能力行')
    assert len(p.wheels) == len(p.frames) == 12
    assert not p.screenshots and 'complete_text_groups' not in p.observations
    attempts = p.observations['reading_group_scrolls'][0]['attempts']
    assert [item['attempt'] for item in attempts] == list(range(1, 13))
    for attempt in attempts:
        before, after = attempt['before'], attempt['after']
        assert before['visible'] is after['visible'] is False
        assert after['clip'] == before['clip']
        assert after['right'] - after['left'] == right - 986
        assert attempt['range_movement'] == {'x': after['left'] - before['left'], 'y': 0}
    if limits == (0, 0):
        assert all(item['range_movement'] == {'x': 0, 'y': 0} for item in attempts)
    else:
        assert attempts[0]['wheel']['delta_x'] == 64
        assert attempts[0]['range_movement']['x'] == -30  # Real movement can be less than requested.


def test_reader_records_and_accepts_visibility_reached_on_last_bounded_attempt():
    p, locator, required = scroll_reader(
        {'left': 985, 'right': 1483, 'top': 300, 'bottom': 439}, max_motion=1)
    journey._read_groups(p, [(locator, required)], '完整能力行')
    assert len(p.wheels) == 12
    attempts = p.observations['reading_group_scrolls'][0]['attempts']
    assert not any(item['after']['visible'] for item in attempts[:-1])
    assert attempts[-1]['after']['visible']
    assert p.observations['complete_text_groups'][0]['geometry'] == attempts[-1]['after']


@pytest.mark.parametrize('damage', ['question', 'company', 'quarter', 'revision', 'partition',
    'missing_row', 'planned_as_completed', 'false_coverage', 'false_reverse_count',
    'baseline_invented_count', 'changed_math', 'unknown_math', 'invented_comparison'])
def test_reader_oracle_rejects_substituted_scope_false_coverage_or_missing_math(damage):
    data = readable()
    if damage == 'question': data['query'] = '原问题：最新季度收入是多少'
    elif damage == 'company': data['source'] = data['source'].replace(journey.COMPANY, '另一个企业')
    elif damage == 'quarter': data['source'] = data['source'].replace('2024-Q1', '2024-Q2')
    elif damage == 'revision': data['source'] = data['source'].replace('第 1', '第 2')
    elif damage == 'partition': data['partition'] = '开发组'
    elif damage == 'missing_row': data['capability_rows'].pop()
    elif damage == 'planned_as_completed': data['capability_rows'][2][2] = '已计划'
    elif damage == 'false_coverage': data['capability_rows'][2][2] = data['capability_rows'][2][2].replace('未满足', '满足已标注要求')
    elif damage == 'false_reverse_count': data['evidence_cells'][1] = data['evidence_cells'][1].replace('反向资料：0', '反向资料：1')
    elif damage == 'baseline_invented_count': data['evidence_cells'][0] = data['evidence_cells'][0].replace('反向资料：未记录', '反向资料：0 条')
    elif damage == 'changed_math': data['math_rows'][0][2] = '与原报告不一致'
    elif damage == 'unknown_math': data['math_rows'][0][1] = '无法核对（摘要缺失或格式无效）'
    else: data['math_rows'][1][2] = '与原报告一致'
    with pytest.raises(AssertionError):
        journey.expect_readable_case(**data)


@pytest.fixture
def offline_oracle(tmp_path):
    from in_process_oracle import offline_test_client
    from server.app import make_app
    from server.config import Settings

    def build_app(providers):
        return make_app(Settings(data_dir=tmp_path, origin='http://testserver'),
                        providers=providers, worker_enabled=False)

    with offline_test_client(build_app) as oracle:
        yield oracle


@pytest.fixture
def actual_single_input_case(offline_oracle):
    """Real routes + real local execution in process; no app network or supplier calls."""
    from conftest import Actor

    client, providers, attempts = offline_oracle
    a = Actor(client)
    def ok(response, status=200):
        assert response.status_code == status, response.text
        return response.json()
    assert ok(a.get('/datasets'))['items'] == []
    assert ok(a.get('/runs'))['items'] == []
    template = a.get('/import/template')
    assert template.status_code == 200
    blob = journey.fixture_csv(template.content)
    staged = ok(a.post('/workspace/imports/file', data={'company': journey.COMPANY,
        'amount_unit': 'yuan', 'basis': 'standalone_quarter', 'target_id': '',
        'target_version': '0', 'merge_mode': 'replace'}, files={
            'file': (journey.FILE_NAME, blob, 'text/csv')}), 201)
    assert ok(a.get('/datasets'))['items'] == []
    dataset = ok(a.post('/workspace/imports/' + staged['id'] + '/commit', json={
        'version': staged['version'], 'fingerprint': staged['payload']['fingerprint']}), 201)
    journey.expect_fixture(dataset)
    document = ok(a.post('/evidence', json={'title': journey.EVIDENCE_TITLE,
        'text': journey.EVIDENCE_TEXT, 'company': journey.COMPANY, 'global_scope': False}), 201)
    ok(a.put('/workspace/evidence/' + document['id'] + '/review', json={
        'version': 1, 'company': journey.COMPANY, 'global_scope': False, 'status': 'accepted',
        'stance': 'context', 'note': journey.REVIEW_NOTE}))
    plan = ok(a.post('/workspace/plans', json={'dataset_id': dataset['id'], 'query': journey.QUESTION,
        'use_llm': False, 'execution': {'depth': 'balanced'}}), 201)
    assert plan['payload']['max_calls'] == 0
    queued = ok(a.post('/workspace/plans/' + plan['id'] + '/execute', json={'version': plan['version'],
        'fingerprint': plan['payload']['fingerprint'], 'external_consent': False}), 202)
    run = a.execute(queued)
    journey.expect_report(run, dataset)
    plan = ok(a.get('/workspace/plans/' + plan['id']))
    yield SimpleNamespace(actor=a, ok=ok, dataset=dataset, run=run, plan=plan,
        document=document, providers=providers, attempts=attempts)
    assert providers.calls == [] and attempts == []


def assessment(c, version, consent):
    return c.ok(c.actor.post('/workspace/runs/' + c.run['id'] + '/assessment', json={
        'version': version, 'verdict': 'needs_revision', 'note': journey.ASSESSMENT_NOTE,
        'expected_capabilities': journey.EXPECTED_CAPABILITIES, 'consent_replay': consent}))


def propose(c):
    return c.ok(c.actor.post('/workspace/evolution/propose', json={}), 201)


def test_actual_feedback_consent_blocked_replay_withdrawal_and_zero_case_replay(actual_single_input_case):
    c = actual_single_input_case
    a, ok = c.actor, c.ok
    first = assessment(c, 0, False)
    assert first['version'] == 1 and first['payload']['consent_replay'] is False
    assert ok(a.get('/workspace/evolution'))['observations']['consented_cases'] == 0
    # Explicit API adverse proof; no claim that the native UI clicked this.
    denied = a.post('/workspace/evolution/propose', json={})
    assert denied.status_code == 409 and denied.json()['error']['code'] == 'NO_CONSENTED_CASES'
    allowed = assessment(c, 1, True)
    assert allowed['version'] == 2
    assert ok(a.get('/workspace/evolution'))['observations']['consented_cases'] == 1
    proposal = propose(c)
    candidate, evaluation = proposal['candidate'], proposal['evaluation']
    assert proposal['automatic_activation'] is False and proposal['external_calls'] == 0
    assert proposal['held_out_inputs'] == 0, 'One-input proposal construction is explicitly not independently held out.'
    assert candidate['payload']['require_counterevidence'] is True
    journey.expect_blocked_evaluation(evaluation, candidate, c.run)
    denied = a.post('/workspace/strategies/' + candidate['id'] + '/activate', json={
        'evaluation_id': evaluation['id'], 'expected_active_version': 0})
    assert denied.status_code == 409 and denied.json()['error']['code'] == 'EVALUATION_BLOCKED'
    original = deepcopy(evaluation['payload'])
    for _ in range(2):
        view = ok(a.get('/workspace/evolution'))
        assert view['active'] is None and len(view['evaluations']) == len(view['candidates']) == 1
        journey.expect_unchanged(view['evaluations'][0]['payload'], original)
    withdrawn = assessment(c, 2, False)
    assert withdrawn['version'] == 3 and withdrawn['payload']['consent_replay'] is False
    view = ok(a.get('/workspace/evolution'))
    assert view['observations']['consented_cases'] == 0 and view['active'] is None
    empty = ok(a.post('/workspace/strategies/' + candidate['id'] + '/evaluate', json={}), 201)
    journey.expect_blocked_evaluation(empty, candidate)
    view = ok(a.get('/workspace/evolution'))
    assert [e['id'] for e in view['evaluations']] == [empty['id'], evaluation['id']]
    journey.expect_unchanged(view['evaluations'][1]['payload'], original)
    journey.expect_unchanged(view['candidates'], [candidate])
    journey.expect_unchanged(ok(a.get('/runs/' + c.run['id']))['result'], c.run['result'])
    journey.expect_unchanged(ok(a.get('/runs/' + c.run['id']))['snapshot'], c.run['snapshot'])
    journey.expect_unchanged(ok(a.get('/workspace/plans/' + c.plan['id']))['payload'], c.plan['payload'])
    journey.expect_unchanged(ok(a.get('/datasets'))['items'], [c.dataset])
    assert len(ok(a.get('/runs'))['items']) == len(ok(a.get('/workspace/plans'))['items']) == 1
    assert ok(a.get('/workspace/runs/' + c.run['id'] + '/audit'))['report_integrity']['valid']
    assert view['active'] is None


def test_actual_replay_oracle_rejects_fabricated_samples_coverage_math_and_scope(actual_single_input_case):
    c = actual_single_input_case
    assessment(c, 0, True)
    result = propose(c)
    candidate, original = result['candidate'], result['evaluation']
    journey.expect_blocked_evaluation(original, candidate, c.run)
    changes = [
        lambda p: p.update(unique_inputs=3),
        lambda p: p.update(improvements=[c.run['id']]),
        lambda p: p.update(eligible=True),
        lambda p: p.update(active_version=1),
        lambda p: p.update(external_calls=1),
        lambda p: p['cases'][0]['source'].update(company='another company'),
        lambda p: p['cases'][0]['source'].update(target_period='2024-Q2'),
        lambda p: p['cases'][0].update(partition='development'),
        lambda p: p['cases'][0]['candidate'].update(covered=journey.EXPECTED_CAPABILITIES, missing=[]),
        lambda p: p['cases'][0]['candidate'].update(math_hash='f' * 64),
        lambda p: p['cases'][0]['candidate']['computations']['counterevidence'].update(status='completed'),
        lambda p: p['cases'][0]['candidate']['computations']['counterevidence']['group_counts'].update(contradicts=1),
    ]
    for change in changes:
        broken = deepcopy(original)
        change(broken['payload'])
        with pytest.raises(AssertionError):
            journey.expect_blocked_evaluation(broken, candidate, c.run)
    changed = deepcopy(c.run)
    changed['result']['analysis']['metrics']['gross_margin'] = .9
    with pytest.raises(AssertionError):
        journey.expect_report(changed, c.dataset)
    with pytest.raises(AssertionError):
        journey.expect_unchanged(changed['result'], c.run['result'])
