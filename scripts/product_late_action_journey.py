"""Prepared native late-action journey; not registered and not executed locally.

The existing isolated native runner owns Probe, original 300-second budget,
trace, video, screenshots, dialogs, and all finalization. All writes below use
visible controls. Declared Playwright routes forward each real request once,
then delay only delivery of its unmodified successful response. No API writes,
DB faults, synthetic results, retries, force clicks, or injected app state.

Closed/reopened research forms are exercised through reachable native controls.
Invoking a detached form is impossible through that UI; its rejection remains
separate production-listener DOM evidence, not a native claim.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
from pathlib import Path
import time
from urllib.parse import urlsplit
import uuid

try:
    from .product_first_use_audit import download_visible, require_native_contract
    from .product_experiment_recovery import (
        COMPANY, TARGET, ASSUMPTIONS, SCENARIO_FIELDS, fixture_csv,
        expect_fixture, expect_saved,
    )
    from .product_readout_oracles import observe_text_by_normal_scroll
except ImportError:
    from product_first_use_audit import download_visible, require_native_contract
    from product_experiment_recovery import (
        COMPANY, TARGET, ASSUMPTIONS, SCENARIO_FIELDS, fixture_csv,
        expect_fixture, expect_saved,
    )
    from product_readout_oracles import observe_text_by_normal_scroll

FORM_MS = 10_000
DELETE_CONFIRM = '删除原始资料？历史报告仍保留当时的引用快照；新任务将不再使用。'
DISCARD_CONFIRM = '当前输入尚未保存。离开后这些修改将丢失，是否继续？'
DELETE_FEEDBACK = '先前的资料删除已完成；保留当前页面和输入，请核对并刷新，无需重复提交。'
SYNC_FEEDBACK = '工作区有已保存的变更。当前未保存输入不会自动覆盖。'
EVIDENCE_TITLE = '迟到回执验收合成资料（非真实来源）'
EVIDENCE_TEXT = '此文仅为隔离验收生成的合成资料，用于测试明确删除后的迟到响应，不代表真实企业信息。'
DRAFT_A = '删除响应到达前的新名称（未保存）'
DRAFT_B = '刷新响应到达前的第二份名称（未保存）'
EXPERIMENT_NAME = '研究窗口验收合成情景（仅本地计算）'
ASSISTANT_QUERY = '2024-Q4毛利率是多少'
OBSOLETE_QUERY = '关闭前的研究草稿：2024-Q4毛利率'
RESEARCH_QUERY = '深入核查2024-Q4毛利率与经营现金流变化'
RESEARCH_FORM = '#modal form[data-service-form="proposal"][data-kind="research"]'
CONFIRM_FORM = '#modal form[data-service-form="confirm-proposal"]'
REFRESH_PATHS = ('/api/datasets', '/api/capabilities', '/api/services/identities', '/api/auth/me')


class DelayedResponses:
    """One upstream fetch per declared native request; delay response only.

    Returning from a route callback without fulfilling keeps browser delivery
    pending. The host's synchronous Playwright loop stays available for native
    clicks/input; release later fulfills the saved original APIResponse object.
    Unit adapters for this contract are doubles, never browser evidence.
    """
    def __init__(self, p, *, requests, label):
        if not requests or len(set(requests)) != len(requests):
            raise ValueError('Declare unique method/path pairs.')
        for method, path in requests:
            if method not in ('GET', 'DELETE') or not path.startswith('/api/') or '://' in path or '..' in path:
                raise ValueError('Only exact same-origin GET or DELETE responses can be delayed.')
        self.p = p
        self.expected = {(method, p.base_url + path) for method, path in requests}
        self.urls = sorted({url for _, url in self.expected})
        self.held = {}
        self.seen = set()
        self.error = None
        self.record = {'label': label, 'fault': 'delay_delivery_of_original_successful_response',
                       'expected_requests': [{'method': m, 'path': path} for m, path in requests],
                       'responses': []}
        self.handler = self._route

    def _route(self, route):
        key = (route.request.method, route.request.url)
        if key not in self.expected:
            route.continue_()
            return
        row = {'method': key[0], 'path': key[1][len(self.p.base_url):],
               'upstream_fetches': 0, 'delivered': False, 'aborted': False}
        self.record['responses'].append(row)
        try:
            assert key not in self.seen, 'A declared response was requested more than once; never replay it.'
            self.seen.add(key)
            row['upstream_fetches'] = 1
            response = route.fetch(timeout=FORM_MS, max_redirects=0, max_retries=0)
            row['status'] = response.status
            assert response.status == 200, 'Delay only an actual successful server response.'
            body = response.body()
            row['body_sha256'] = hashlib.sha256(body).hexdigest()
            if key[0] == 'DELETE':
                payload = response.json()
                assert payload.get('ok') is True, 'The actual DELETE must already have succeeded.'
                row['response'] = deepcopy(payload)
            # Never record /auth/me bodies, CSRF tokens, or response headers.
            self.held[key] = (route, response, row)
        except BaseException as error:
            self.error = error
            route.abort('failed')
            row['aborted'] = True
            raise

    def ready(self):
        deadline = time.monotonic() + FORM_MS / 1000
        while set(self.held) != self.expected:
            if self.error is not None:
                raise self.error
            if time.monotonic() >= deadline:
                raise AssertionError('The declared real upstream responses did not complete in time.')
            # Pump Playwright events only; no arbitrary response-delay sleeps.
            self.p.page.wait_for_timeout(20)
        if self.error is not None:
            raise self.error
        return self.record

    def release(self):
        assert not (self.seen == self.expected and not self.held), 'Original responses were already released.'
        self.ready()
        for key in sorted(self.held):
            route, response, row = self.held[key]
            route.fulfill(response=response)
            row['delivered'] = True
        self.held.clear()

    def __enter__(self):
        self.p.observations.setdefault('declared_response_delays', []).append(self.record)
        for url in self.urls:
            self.p.page.route(url, self.handler)
        return self

    def __exit__(self, exc_type, exc, traceback):
        cleanup_errors = []
        for route, _, row in self.held.values():
            if not row['delivered']:
                try:
                    route.abort('failed')
                    row['aborted'] = True
                except Exception as error:
                    cleanup_errors.append(str(error))
        self.held.clear()
        # Abort any already-forwarded unresolved request before removing its
        # interceptor. Cleanup must never release it as a fresh browser send.
        for url in self.urls:
            try:
                self.p.page.unroute(url, self.handler)
            except Exception as error:
                cleanup_errors.append(str(error))
        if cleanup_errors:
            self.record['cleanup_errors'] = cleanup_errors
        if exc_type is None:
            if self.error is not None:
                raise self.error
            assert not cleanup_errors, 'Response-delay cleanup failed: ' + '; '.join(cleanup_errors)
            assert self.seen == self.expected
            assert len(self.record['responses']) == len(self.expected)
            assert all(r['upstream_fetches'] == 1 and r['delivered'] and not r['aborted']
                       for r in self.record['responses']), 'All original responses must be released exactly once.'
        return False


def _get(p, path, label):
    value = p.get(path)
    p.observations.setdefault('corroborating_gets', []).append(
        {'label': label, 'method': 'GET', 'path': path, 'response': deepcopy(value)})
    return value


def _read(p, locator, required, label):
    text = locator.text_content().strip()
    assert text and all(part in text for part in required), (label, text)
    observe_text_by_normal_scroll(p, locator, text, label)
    p.observations.setdefault('visible_readings', []).append(
        {'label': label, 'text': text, 'manual_pixel_review': 'pending'})
    return text


def _read_experiment_provenance(p, section, label):
    # Read the entire visible title/assumptions/revision group, stopping before
    # the separately collapsed fingerprint disclosure. Hidden JSON is not proof.
    parts = [section.locator(':scope > h3').text_content()]
    parts += section.locator(':scope > p').all_text_contents()
    text = ''.join(parts)
    assert all(part in text for part in (EXPERIMENT_NAME, ASSUMPTIONS, TARGET, '原始实验 v1'))
    observe_text_by_normal_scroll(p, section, text, label)
    p.observations.setdefault('visible_readings', []).append(
        {'label': label, 'text': text, 'manual_pixel_review': 'pending'})


def _preserved_editor(p, original, name):
    current = p.visible('#dataset-editor [name="name"]')
    assert current.input_value() == name
    assert original.evaluate('(old, current) => old.isConnected && old === current', current.element_handle())
    assert p.visible('#main').get_attribute('data-page') == 'data'
    assert urlsplit(p.page.url).fragment == 'data'
    return {'name': current.input_value(), 'same_input_node': True, 'page': 'data', 'saved': False}


def _setup(p):
    def landing():
        response = p.page.goto(p.base_url, wait_until='domcontentloaded')
        assert response is not None and response.status == 200
        csp = response.headers.get('content-security-policy', '')
        assert "script-src 'self'" in csp and "'unsafe-eval'" not in csp
        p.observations['landing_csp'] = csp
    p.step('打开原生隔离工作区，保留原始品牌与安全策略', landing)
    p.await_registration_ready()
    def register():
        p.visible('[data-action="auth-toggle"]').click()
        p.visible('#auth-form [name="email"]').fill('late-' + uuid.uuid4().hex + '@test.example')
        p.visible('#auth-form [name="password"]').fill('Synthetic-only-late-action-2026')
        p.visible('#auth-form [name="name"]').fill('迟到回执隔离验收用户')
        p.submit_form(p.page, '#auth-form')
        p.visible('#main[data-page="brief"]')
    p.step('使用真实注册表单建立独立合成工作区', register)
    assert _get(p, '/api/datasets', '初始空数据集')['items'] == []
    assert _get(p, '/api/evidence', '初始空资料库')['items'] == []
    assert not any(row['configured'] for row in p.get('/api/capabilities')['providers'])
    p.navigate('data')
    p.click('#main [data-action="import-dialog"]', after='#import-file-form')
    template = download_visible(p, p.visible('#import-file-form a[href="/api/import/template"]'),
                                'late-actions-template.csv', '下载实际空白CSV模板')
    path = Path(p.directory) / 'late-actions-synthetic-input.csv'
    path.write_bytes(fixture_csv(template))
    p.record_artifact(path, kind='synthetic-input')
    p.observations['fixture'] = {'synthetic': True, 'company': COMPANY,
        'csv_sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    def import_file():
        p.visible('#import-file-form [name="company"]').fill(COMPANY)
        p.visible('#import-file-form [name="amount_unit"]').select_option('yuan')
        p.visible('#import-file-form [name="basis"]').select_option('standalone_quarter')
        p.visible('#import-file-form [name="file"]').set_input_files(str(path))
        p.submit_form(p.page, '#import-file-form')
        p.visible('#modal [data-action="commit-stage"]')
        assert '尚未写入财务库' in p.visible('#modal').inner_text()
    p.step('真实导入十二季度合成输入并核对待确认预览', import_file)
    assert p.get('/api/datasets')['items'] == []
    p.click('#modal [data-action="commit-stage"]', after='#dataset-editor[data-version="1"]', label='明确确认保存唯一合成数据集')
    rows = _get(p, '/api/datasets', '导入后独立读取完整数据集')['items']
    assert len(rows) == 1
    saved = rows[0]
    expect_fixture(saved)
    p.dataset_id = saved['id']
    p.observations['fixture']['dataset_id'] = saved['id']
    assert p.visible('#active-dataset').input_value() == saved['id']
    return saved


def _save_experiment(p, saved):
    p.navigate('lab')
    def fill():
        for name, value in {'name': EXPERIMENT_NAME, 'target_period': TARGET,
                            'assumptions': ASSUMPTIONS, **SCENARIO_FIELDS}.items():
            p.visible('#experiment-form [name="' + name + '"]').fill(value)
        p.visible('#experiment-form [name="kind"]').select_option('scenario')
        p.submit_form(p.page, '#experiment-form')
        p.visible('#main [data-experiment-source]')
    p.step('通过数学实验表单保存一个可供研究窗口明确选择的合成情景', fill)
    listing = _get(p, '/api/workspace/experiments', '读取真实保存的研究依据')
    assert listing['has_more'] is False and len(listing['items']) == 1
    experiment = _get(p, '/api/workspace/experiments/' + listing['items'][0]['id'], '核对完整实验实体')
    expect_saved(experiment, saved, name=EXPERIMENT_NAME, kind='scenario')
    return experiment


def _save_evidence(p):
    p.navigate('evidence')
    p.click('#main .page-heading [data-action="evidence-dialog"]', after='#evidence-form')
    def fill():
        p.visible('#evidence-form [name="title"]').fill(EVIDENCE_TITLE)
        p.visible('#evidence-form [name="text"]').fill(EVIDENCE_TEXT)
        p.visible('#evidence-form [name="company"]').fill(COMPANY)
        p.submit_form(p.page, '#evidence-form')
        p.page.locator('#modal').wait_for(state='hidden', timeout=FORM_MS)
    p.step('通过真实表单保存仅用于删除回执验收的合成资料', fill)
    rows = _get(p, '/api/evidence', '删除前读取独立保存的合成资料')['items']
    assert len(rows) == 1
    row = rows[0]
    assert row['payload']['title'] == EVIDENCE_TITLE and row['payload']['text'] == EVIDENCE_TEXT
    p.observations['native_created_synthetic_evidence'] = {
        'target': {'id': row['id'], 'version': row['version']},
        'synthetic': True, 'created_through_visible_form': True, 'title': EVIDENCE_TITLE}
    return row


def _delete_then_navigate(p, saved, evidence, mutations):
    target = {'id': evidence['id'], 'version': evidence['version']}
    path = '/api/evidence/' + evidence['id'] + '?version=' + str(evidence['version'])
    selector = '#main [data-action="delete-evidence"][data-id="' + evidence['id'] + '"]'
    with DelayedResponses(p, requests=[('DELETE', path)], label='真实删除已成功，仅延迟响应交付') as delay:
        def delete():
            p.with_expected_dialog(dialog_type='confirm', message=DELETE_CONFIRM,
                evidence_target=target, action=lambda: p.visible(selector).click())
            delay.ready()
            assert p.visible(selector).get_attribute('data-pending') == 'true'
        p.step('明确确认一次删除，服务器已成功但原响应暂未交付', delete)
        assert _get(p, '/api/evidence', '在原响应交付前，独立GET确认资料已实际删除')['items'] == []
        p.navigate('data')
        original = p.visible('#dataset-editor [name="name"]').element_handle()
        p.fill('#dataset-editor [name="name"]', DRAFT_A, '在新页面自然键入一份未保存的数据集名称')
        def release():
            delay.release()
            feedback = p.page.locator('#notifications .toast').filter(has_text=DELETE_FEEDBACK)
            feedback.wait_for(state='visible', timeout=FORM_MS)
            assert feedback.inner_text() == DELETE_FEEDBACK
            _preserved_editor(p, original, DRAFT_A)
            # Capture the short-lived actual toast in the original viewport now.
            p.observations['earlier_deletion_feedback'] = feedback.inner_text()
            p.screenshot('earlier-deletion-feedback')
        p.step('释放原成功响应，阅读明确归属于先前资料删除的反馈', release)
        p.observations['after_delete'] = _preserved_editor(p, original, DRAFT_A)
        _read(p, p.visible('#sync-notice .sync-bar'), [SYNC_FEEDBACK, '核对并刷新'], '阅读保留未保存输入的待刷新提示')
    assert [row for row in mutations if row['method'] == 'DELETE'] == [{'method': 'DELETE', 'path': path}]
    assert _get(p, '/api/datasets/' + saved['id'], '迟到删除后完整数据集仍等于原始保存') == saved


def _refresh_then_edit(p, saved, mutations):
    before = deepcopy(mutations)
    original = p.visible('#dataset-editor [name="name"]').element_handle()
    with DelayedResponses(p, requests=[('GET', path) for path in REFRESH_PATHS], label='普通工作区四个GET响应延迟') as delay:
        def start():
            p.with_expected_dialog(dialog_type='confirm', message=DISCARD_CONFIRM,
                action=lambda: p.visible('#sync-notice [data-action="sync-refresh"]').click())
            delay.ready()
        p.step('明确允许刷新旧草稿，普通工作区GET已成功但暂缓交付', start)
        p.fill('#dataset-editor [name="name"]', DRAFT_B, '刷新尚在读取时，在同一输入框写入新的未保存名称')
        def release():
            delay.release()
            p.page.locator('#sync-notice [data-action="sync-refresh"]:not([data-pending]):not([aria-busy])').wait_for(state='visible', timeout=FORM_MS)
            _preserved_editor(p, original, DRAFT_B)
        p.step('交付原四个GET响应，原节点、新草稿、页面与待刷新提示均保留', release)
        _read(p, p.visible('#sync-notice .sync-bar'), [SYNC_FEEDBACK, '核对并刷新'], '读取刷新完成后仍保留的新草稿与待刷新提示')
    p.observations['after_refresh'] = _preserved_editor(p, original, DRAFT_B)
    assert mutations == before, 'Typing and refresh must not save the draft or mutate any entity.'
    assert _get(p, '/api/datasets/' + saved['id'], '普通刷新后数据集内容、版本及时间均未变化') == saved


def expect_proposal(proposal, plan, saved, experiment, *, message_id, request_id):
    payload = proposal['payload']
    request = payload['request']
    assert payload['kind'] == 'research' and payload['status'] == 'draft'
    assert payload['text'] == RESEARCH_QUERY and request['text'] == RESEARCH_QUERY
    assert request['source_message_id'] == payload['source_message_id'] == message_id
    assert request['request_id'] == request_id and request['execution']['depth'] == 'deep'
    assert request['experiment'] == {'id': experiment['id'], 'version': experiment['version'], 'hash': experiment['experiment_hash']}
    assert request['use_llm'] is False and request['max_calls'] == 0
    assert payload['external_calls'] == 0 and payload['result'] is None
    binding = payload['binding']
    assert binding['dataset_id'] == saved['id'] and binding['dataset_version'] == saved['version']
    assert binding['dataset_hash'] == saved['content_hash']
    assert payload['plan_id'] == plan['id']
    data = plan['payload']
    assert data['request']['query'] == RESEARCH_QUERY and data['request']['execution']['depth'] == 'deep'
    assert data['max_calls'] == 0 and data['request']['use_llm'] is False
    assert data['snapshot']['experiment'] == {
        'id': experiment['id'], 'version': experiment['version'],
        'hash': experiment['experiment_hash'], 'payload': experiment['payload']}
    assert data['snapshot']['research_scope']['period'] == TARGET


def expect_mutations(mutations, *, evidence, thread_id):
    expected = [
        ('POST', '/api/workspace/experiments'), ('POST', '/api/evidence'),
        ('DELETE', '/api/evidence/' + evidence['id'] + '?version=' + str(evidence['version'])),
        ('POST', '/api/services/threads'),
        ('POST', '/api/services/threads/' + thread_id + '/messages'),
        ('POST', '/api/services/threads/' + thread_id + '/proposals'),
    ]
    assert sorted((row['method'], row['path']) for row in mutations) == sorted(expected), \
        'Only the six explicit native writes after import are allowed; no duplicate or hidden save.'


def _research_reopen_and_submit(p, saved, experiment, proposal_posts):
    p.step('明确离开尚未保存的数据草稿，进入真实研究助手', lambda:
        p.with_expected_dialog(dialog_type='confirm', message=DISCARD_CONFIRM,
            action=lambda: p.visible('#sidebar button[data-route="copilot"]').click()))
    p.visible('#main[data-page="copilot"]')
    turn = p.ask(ASSISTANT_QUERY)
    message_id = turn.get_attribute('data-message')
    source = '#assistant-answer [data-message="' + message_id + '"] [data-x-action="chat-propose"][data-kind="research"]'
    p.click(source, after=RESEARCH_FORM, label='从实际助手答复交给Agent深入研判')
    old = p.visible(RESEARCH_FORM)
    old_handle = old.element_handle()
    old_key = old.get_attribute('data-key')
    assert old.locator('[name="text"]').input_value() == ASSISTANT_QUERY
    p.fill(RESEARCH_FORM + ' [name="text"]', OBSOLETE_QUERY, '编辑第一份研究草稿但不提交')
    def reopen():
        p.visible('#modal [data-action="close-modal"]').click()
        p.page.locator('#modal').wait_for(state='hidden', timeout=FORM_MS)
        assert old_handle.is_visible() is False
        assert proposal_posts == []
        p.visible(source).click()
        current = p.visible(RESEARCH_FORM)
        assert current.get_attribute('data-key') != old_key
        assert old_handle.evaluate('(old) => !old.isConnected')
        assert current.locator('[name="text"]').input_value() == ASSISTANT_QUERY
        assert proposal_posts == []
    p.step('自然关闭并重开研究窗口：旧表单不可操作，未发送任何提案', reopen)
    current = p.visible(RESEARCH_FORM)
    current_key = current.get_attribute('data-key')
    def edit():
        p.visible(RESEARCH_FORM + ' [name="text"]').fill(RESEARCH_QUERY)
        p.visible(RESEARCH_FORM + ' [name="depth"]').select_option('deep')
        control = p.visible(RESEARCH_FORM + ' [name="experiment_id"]')
        assert EXPERIMENT_NAME in control.locator('option[value="' + experiment['id'] + '"]').inner_text()
        control.select_option(experiment['id'])
        details = p.visible(RESEARCH_FORM).locator('details').filter(has=p.page.get_by_text('模型参与与数学工具', exact=True))
        if details.get_attribute('open') is None:
            details.locator('summary').click()
        p.visible(RESEARCH_FORM + ' [name="max_calls"]').fill('0')
        assert not p.visible(RESEARCH_FORM + ' [name="use_llm"]').is_checked()
        assert p.visible(RESEARCH_FORM + ' [name="text"]').input_value() == RESEARCH_QUERY
        assert p.visible(RESEARCH_FORM + ' [name="depth"]').input_value() == 'deep'
        assert p.visible(RESEARCH_FORM + ' [name="experiment_id"]').input_value() == experiment['id']
    p.step('编辑当前研究问题、深入深度和实际可选实验依据，外部调用上限为零', edit)
    _read_experiment_provenance(p, p.visible('#copilot-experiment-details > section.subpanel'), '阅读当前所选实验的真实名称、季度和假设')
    p.observations['research_current_form'] = {'question': RESEARCH_QUERY, 'depth': 'deep',
        'experiment_id': experiment['id'], 'request_id': current_key, 'obsolete_request_id': old_key,
        'old_form_detached': True, 'old_form_native_submission_claimed': False}
    p.submit(RESEARCH_FORM, after=CONFIRM_FORM)
    assert len(proposal_posts) == 1 and proposal_posts[0]['request_id'] == current_key
    assert proposal_posts[0]['request_id'] != old_key
    assert p.visible('#modal-title').inner_text() == '核对后确认'
    modal = p.visible('#modal')
    _read(p, modal.locator('.dialog-body > p').first, [RESEARCH_QUERY], '阅读真实生成提案保留的当前研究问题')
    section = modal.locator('section.subpanel').filter(has=p.page.get_by_role('heading', name='本次研判目标与冻结输入', exact=True))
    _read(p, section.locator(':scope > p').first, [TARGET], '确认页阅读本次研判目标季度')
    _read_experiment_provenance(p, section.locator(':scope > section.subpanel'), '确认页阅读已选实验名称、季度和假设')
    _read(p, p.visible(CONFIRM_FORM), ['本任务不会调用模型或自动检索网络。', '批准并执行'], '阅读仅到提案审核、仍待明确执行的状态')
    proposal_id = p.visible(CONFIRM_FORM).get_attribute('data-id')
    proposal = _get(p, '/api/services/proposals/' + proposal_id, '独立读取当前唯一提案')
    plan = _get(p, '/api/workspace/plans/' + proposal['payload']['plan_id'], '独立读取当前提案所绑定计划')
    expect_proposal(proposal, plan, saved, experiment, message_id=message_id, request_id=current_key)
    thread = p.thread()
    assert len(thread['proposals']) == 1 and thread['proposals'][0]['id'] == proposal_id
    assert thread['runs'] == []
    return proposal


def late_action_journey(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    require_native_contract(p, repository_root=repository_root, data_dir=data_dir,
                            expected_web_tree=expected_web_tree, expected_server_tree=expected_server_tree)
    saved = _setup(p)
    mutations, proposal_posts = [], []
    def record(request):
        url = urlsplit(request.url)
        if url.path.startswith('/api/') and request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            mutations.append({'method': request.method, 'path': url.path + ('?' + url.query if url.query else '')})
        if url.path.startswith('/api/services/threads/') and url.path.endswith('/proposals') and request.method == 'POST':
            proposal_posts.append(deepcopy(request.post_data_json))
    p.page.on('request', record)
    p.observations['native_mutations_after_import'] = mutations
    p.observations['native_proposal_posts'] = proposal_posts
    try:
        experiment = _save_experiment(p, saved)
        evidence = _save_evidence(p)
        _delete_then_navigate(p, saved, evidence, mutations)
        _refresh_then_edit(p, saved, mutations)
        proposal = _research_reopen_and_submit(p, saved, experiment, proposal_posts)
        assert _get(p, '/api/evidence', '最终确认已删除资料没有恢复')['items'] == []
        assert _get(p, '/api/datasets/' + saved['id'], '最终完整数据集与原始保存逐字段相同') == saved
        assert _get(p, '/api/workspace/experiments/' + experiment['id'], '最终实验未变更') == experiment
        assert _get(p, '/api/runs', '未批准执行，运行记录仍为空')['items'] == []
        assert not any(row['configured'] for row in p.get('/api/capabilities')['providers'])
        assert len([m for m in mutations if m['method'] == 'DELETE']) == 1
        assert not any(m['method'] in ('PUT', 'PATCH') or m['path'].endswith(('/confirm', '/execute')) for m in mutations)
        assert len(proposal_posts) == 1
        assert len([m for m in mutations if m == {'method': 'POST', 'path': '/api/workspace/experiments'}]) == 1
        expect_mutations(mutations, evidence=evidence, thread_id=proposal['payload']['thread_id'])
        p.no_external()
        p.observations['late_actions_outcome'] = {
            'delete_count': 1, 'deleted_evidence_absent': True, 'dataset_unchanged': True,
            'preserved_drafts': [DRAFT_A, DRAFT_B], 'delayed_refresh_gets': len(REFRESH_PATHS),
            'proposal_count': 1, 'proposal_id': proposal['id'], 'proposal_status': 'draft',
            'research_question': RESEARCH_QUERY, 'research_depth': 'deep',
            'selected_experiment': experiment['id'], 'execution_approved': False,
            'external_supplier_calls': 0, 'runner_cap_seconds': 300,
            'detached_form_submit_rejection': 'separate DOM evidence only; not invoked natively',
        }
    finally:
        p.page.remove_listener('request', record)
