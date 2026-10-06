"""Prepared native action-evidence reading journey, not a local browser entry.

The existing hosted Probe owns the isolated service, screenshots, trace, video,
raw hashes, finalization, and unchanged 300-second budget. Every business write
uses an actual visible form. GETs corroborate identities and frozen values.
There are no API writes, DB fixtures, response interception, force clicks,
providers, or new application code. A real later review edit is not native
coverage of the separate same-version/stale-hash 409 API contract.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

try:
    from .product_first_use_audit import (
        canonical_hash, download_visible, register_empty_workspace, require_native_contract,
    )
    from .product_integrity_outcomes import _capture_response
    from .product_readout_oracles import _TEXT_GEOMETRY
    from .product_strategy_journey import fixture_csv, _read_groups
    from .product_report_gap_reading import read_original_report_gaps
except ImportError:
    from product_first_use_audit import (
        canonical_hash, download_visible, register_empty_workspace, require_native_contract,
    )
    from product_integrity_outcomes import _capture_response
    from product_readout_oracles import _TEXT_GEOMETRY
    from product_strategy_journey import fixture_csv, _read_groups
    from product_report_gap_reading import read_original_report_gaps

FORM_MS = 10_000
COMPANY = '行动证据合成电池企业（非真实财报）'
QUESTION = '2024-Q1毛利率是多少'
FILE_NAME = 'action-evidence-synthetic-financials.csv'
ACTION_TITLE = '合成验收：核对毛利率输入与资料适用边界'
ACCEPTANCE = '核对合成收入100000元、成本80000元得到20%，逐段阅读资料和人工说明，并明确记录适用边界。'
START_NOTE = '开始人工核对本次合成输入；尚未选择或验收任何资料。'
DONE_NOTE = '已逐段阅读企业资料及完整人工说明，核对20%的合成算式；只选择企业资料，通用未审阅资料未采用，完成不等于事实认证。'
FRESH_NOTE = '后来审阅已改为反向说明；这是重新核对的未提交草稿，原验收保持原判断。'
COMPANY_TITLE = '合成企业资料：毛利率输入核对记录'
GLOBAL_TITLE = '合成通用资料：尚未审阅的方法提示'
COMPANY_URL = 'https://action-evidence.example/company-synthetic'
GLOBAL_URL = 'https://action-evidence.example/global-synthetic'
PUBLISHED = '2024-02-20'
COMPANY_TEXT = '\n'.join([
    '资料说明：以下各段均为隔离验收编写的合成材料，不是企业公告或真实财报。',
    '第一段：本例研究对象是合成电池企业，所有金额只用于核对界面与计算的对应关系。',
    '第二段：2024年第一季度营业收入设为100000元，营业成本设为80000元。',
    '第三段：按收入减去成本再除以收入计算，得到毛利率20%，这里只核对算式。',
    '第四段：净利润另设5000元，经营现金流另设10000元，不能与毛利额混为一谈。',
    '第五段：第二季度使用相同的合成金额，以便测试期间选择，不代表真实经营趋势。',
    '第六段：本例数据按独立单季度输入，不能擅自解释成年初累计口径或年度预测。',
    '第七段：资产、负债和库存等字段没有提供，应保持缺失，不能补成零值或推算余额。',
    '第八段：页面中的来源地址是明确声明的合成地址，本旅程不会访问或抓取该网址。',
    '第九段：保存文本只说明用户提供了这些段落，系统没有独立核实内容的事实真伪。',
    '第十段：人工接受表示审阅者愿意在限定范围内采用材料，不表示系统认证企业。',
    '第十一段：收入和成本发生变化时应重新核对输入，旧报告仍保留生成时的数值。',
    '第十二段：资料适用范围限制在本例企业，不能把企业判断自动推广到所有公司。',
    '第十三段：证据立场来自人工标注，支持标签不自动证明经营原因或投资价值。',
    '第十四段：重新审阅可以保留原文并改变判断，资料版本与审阅版本应分别显示。',
    '第十五段：行动完成仅记录用户申报的核对结果，不证明企业经营已经发生改善。',
    '第十六段：通用方法提示尚未审阅，本次完成不能悄悄把它加入已选依据。',
    '第十七段：后来的反向意见需要重新阅读与明确选择，不能改写此前验收的说明。',
    '资料尾段：核对到此才读完本次完整保存文本；这句仍属于合成材料的适用限制。',
])
ORIGINAL_NOTE = '\n'.join([
    '审阅开头：仅为本企业的合成验收，人工接受不代表系统已经完成事实认证。',
    '范围说明：本次只支持对既有合成输入和毛利率算式的核对，不支持真实商业结论。',
    '期间说明：采用2024年第一季度的独立单季金额，不能与其他季度或累计口径拼接。',
    '金额说明：收入100000元、成本80000元属于声明的测试数据，应同时核对单位。',
    '计算说明：20%来自收入减成本再除收入；毛利额与经营现金流是不同的指标。',
    '缺项说明：资产负债等未提供字段保持缺失，不能为了让结果完整而补造数字。',
    '来源说明：资料地址仅用于核对保存来源标签，没有通过该网址获得真实外部材料。',
    '原文说明：需要读完保存文本的尾段，不能只凭标题或前几句判断全部适用条件。',
    '立场说明：支持标签针对上述算式核对，不表示证明了经营原因、盈利能力或投资价值。',
    '范围限制：这份判断属于指定合成企业，未给所有企业的真实财务情况提供证据。',
    '选择说明：通用方法提示仍待审阅，本次未采用它，展开内容不应替用户勾选资料。',
    '版本说明：提交时应绑定当前资料版本、审阅版本及指纹，不能静默换成后来说明。',
    '历史说明：未来补充反向意见时，应保留本次原始审阅和行动验收，不追溯改写。',
    '完成限制：验收完成表示已执行声明的人工核对，不代表企业经营改善或事实得到认证。',
    '审阅尾段：只有读到这项边界才完成本次说明的核对；后续变化需要重新明确选择。',
])
LATER_NOTE = ('后来审阅：将立场改为反向 / 反驳证据。合成算式依然是20%，但原材料不足以支持真实经营原因；'
              '本次反向意见只指出证据边界，仍不代表系统事实认证。旧行动的人工支持说明必须保留。')
GLOBAL_TEXT = ('通用方法提示：这是明确声明的合成文本，允许所有企业看到，但尚未人工审阅。'
               '核对毛利率时应先明确期间、金额单位与收入成本口径；本段没有提供任何真实企业事实，'
               '也没有经过系统独立核验。本次行动不选择这份资料。')
REF_FIELDS = ('id', 'version', 'content_hash', 'review_version', 'review_hash')
SCROLL_STATE = '(e) => ({top:e.scrollTop,height:e.scrollHeight,client:e.clientHeight})'
ADDRESS_STRUCTURE = r'''(p) => {
 const a=p.querySelector(':scope > a'), svg=a?.querySelector(':scope > svg');
 const shape=e=>e?[...e.childNodes].map(n=>n.nodeType===Node.TEXT_NODE?'#text':n.nodeName.toLowerCase()):[];
 return {tag:p.tagName.toLowerCase(),children:shape(p),prefix:p.firstChild?.textContent,
  href:a?.getAttribute('href'),link_children:shape(a),link_text:a?.firstChild?.textContent,
  svg_count:p.querySelectorAll('svg').length,svg_hidden:svg?.getAttribute('aria-hidden'),
  svg_text:svg?.textContent,forbidden:p.querySelectorAll('[hidden],details,script,style').length,
  text:p.textContent,rendered:p.innerText.trim()};
}'''


def expect_catalog(items, *, later=False):
    """Independently fixed saved contents and review boundaries, not eligibility invention."""
    assert len(items) == 2
    by_title = {row['payload']['title']: row for row in items}
    assert set(by_title) == {COMPANY_TITLE, GLOBAL_TITLE}
    company, global_doc = by_title[COMPANY_TITLE], by_title[GLOBAL_TITLE]
    for row, text, url in [(company, COMPANY_TEXT, COMPANY_URL), (global_doc, GLOBAL_TEXT, GLOBAL_URL)]:
        assert row['version'] == 1 and row['payload']['text'] == text
        # Evidence binds raw UTF-8 text; review/object/history hashes bind JSON.
        assert row['content_hash'] == hashlib.sha256(text.encode('utf-8')).hexdigest()
        assert row['payload']['source_url'] == url and row['payload']['published_at'] == PUBLISHED
        assert row['payload']['source_kind'] == 'user_provided' and row['payload']['verification'] == 'unverified'
        assert 'original_source_url' not in row['payload'], 'No independent original address was captured.'
        assert row['review_hash'] == canonical_hash(row['review'])
        # Observed production catalog has these scoped, non-rejected rows eligible.
        # The unreviewed row is never selected or submitted in this journey.
        assert row['eligible'] is True and row['excluded_reason'] is None
    assert company['review_version'] == (3 if later else 2)
    assert company['review'] == {'company': COMPANY, 'global_scope': False, 'status': 'accepted',
        'stance': 'contradicts' if later else 'supports', 'note': LATER_NOTE if later else ORIGINAL_NOTE,
        'tags': [], 'expires_at': None}
    assert global_doc['review_version'] == 1
    assert global_doc['review'] == {'company': '', 'global_scope': True, 'status': 'unreviewed',
        'stance': 'context', 'note': '', 'tags': [], 'expires_at': None}
    return company, global_doc


def expect_completed(action, prior, selected):
    assert action['id'] == prior['id'] and action['version'] == prior['version'] + 1 == 3
    assert action['payload']['status'] == 'done'
    assert action['payload']['history'][:-1] == prior['payload']['history']
    history = action['payload']['history'][-1]
    assert history['status'] == 'done' and history['note'] == DONE_NOTE
    assert history['evidence_ids'] == [selected['id']] and history['action_version'] == 3
    assert len(history['evidence_snapshots']) == 1
    frozen = history['evidence_snapshots'][0]
    assert {key: frozen[key] for key in REF_FIELDS} == {key: selected[key] for key in REF_FIELDS}
    assert frozen['review'] == selected['review']
    assert frozen['title'] == COMPANY_TITLE and frozen['source_url'] == COMPANY_URL
    assert frozen['text'] == COMPANY_TEXT and frozen['text_length'] == len(COMPANY_TEXT)
    assert frozen['text_truncated'] is False and frozen['captured_at']
    assert action['acceptance_impact']['state'] == 'current'
    for key, value in prior['payload'].items():
        if key not in ('history', 'status'):
            assert action['payload'][key] == value, 'Completion changed original action context: ' + key
    return frozen


def expect_preserved_history(current, completed, original, revised):
    assert current['id'] == completed['id'] and current['version'] == completed['version']
    assert current['payload'] == completed['payload'], 'Later review rewrote saved action or history.'
    assert current['object_hash'] == completed['object_hash'] == canonical_hash(completed['payload'])
    assert current['acceptance_impact']['state'] == 'changed'
    assert current['acceptance_impact']['historical_acceptance_preserved'] is True
    assert revised['id'] == original['id'] and revised['version'] == original['version']
    assert revised['content_hash'] == original['content_hash'] and revised['payload'] == original['payload']
    assert revised['review_version'] == original['review_version'] + 1
    assert revised['review_hash'] != original['review_hash']
    frozen = current['payload']['history'][-1]['evidence_snapshots'][0]
    assert frozen['review'] == original['review'] and frozen['review_hash'] == original['review_hash']
    assert frozen['review'] != revised['review'] and frozen['text'] == COMPANY_TEXT


def expect_mutations(mutations, *, stage_id, plan_id, action_id, evidence_id):
    expected = [
        ('POST', '/api/auth/register'), ('POST', '/api/workspace/imports/file'),
        ('POST', '/api/workspace/imports/' + stage_id + '/commit'),
        ('POST', '/api/workspace/plans'), ('POST', '/api/workspace/plans/' + plan_id + '/execute'),
        ('POST', '/api/workspace/actions'), ('PUT', '/api/workspace/actions/' + action_id + '/status'),
        ('POST', '/api/evidence'), ('PUT', '/api/workspace/evidence/' + evidence_id + '/review'),
        ('POST', '/api/evidence'), ('PUT', '/api/workspace/actions/' + action_id + '/status'),
        ('PUT', '/api/workspace/evidence/' + evidence_id + '/review'),
    ]
    assert [(r['method'], r['path']) for r in mutations] == expected, \
        'Exactly twelve declared UI writes; no automatic selection, rewrite, hidden save, or retry.'


def expect_preserved_form(state, *, note, selected, refs):
    assert state['same_form'] and state['same_note'], 'Reading replaced the original action form or draft node.'
    assert state['note'] == note and state['selected'] == selected
    assert state['refs'] == refs, 'Reading silently refreshed the evidence binding.'


def expect_address_structure(value, *, prefix, url):
    """Permit only safeLink's known decorative SVG, never skip hidden text."""
    text = prefix + url + ' '
    assert value == {'tag': 'p', 'children': ['#text', 'a'], 'prefix': prefix,
        'href': url, 'link_children': ['#text', 'svg'], 'link_text': url + ' ',
        'svg_count': 1, 'svg_hidden': 'true', 'svg_text': '', 'forbidden': 0,
        'text': text, 'rendered': text.rstrip()}, 'Unexpected source text-node/link structure.'
    return text


def _get(p, path, label):
    value = p.get(path)
    p.observations.setdefault('corroborating_gets', []).append(
        {'label': label, 'method': 'GET', 'path': path, 'response': deepcopy(value)})
    return value


def _full_read(p, locator, expected, label, *, require_inner=False):
    """Read every natural paragraph using real pointer wheels and clipped ranges.

    Geometry and scrollTop are read-only observations. No text truncation,
    style mutation, DOM bridge, keyboard injection, or programmatic scrollTop.
    Each reached viewport keeps its original screenshot and all visible parts.
    """
    def read():
        assert locator.count() == 1 and locator.is_visible()
        assert locator.text_content() == expected, 'The reader must contain the complete exact saved value.'
        parts = expected.split('\n')
        assert parts and all(parts) and len(set(parts)) == len(parts), 'Each reading range must be unambiguous.'
        initial = locator.evaluate(SCROLL_STATE)
        if require_inner:
            assert initial['height'] > initial['client'] + 100, 'Declared long text must require inner scrolling.'
        locator.scroll_into_view_if_needed()
        pending, readings, moves = [], [], []
        frames = 0
        def capture():
            nonlocal frames
            if pending:
                frames += 1
                file = p.screenshot('complete-reader-' + str(frames))
                for item in pending:
                    item['screenshot'] = file
                    readings.append(item)
                pending.clear()
        for part in parts:
            for attempt in range(24):
                geometry = locator.evaluate(_TEXT_GEOMETRY, part)
                assert geometry.get('found'), 'Saved paragraph is missing from its original node.'
                if geometry['visible']:
                    pending.append({'text': part, 'geometry': geometry})
                    break
                capture()
                box, clip = geometry['root'], geometry['clip']
                assert box['right'] > box['left'] and box['bottom'] > box['top'], 'No unobscured scroll target.'
                dx = (max(-140, geometry['left'] - clip['left'] - 8) if geometry['left'] < clip['left']
                      else min(140, max(0, geometry['right'] - clip['right'] + 8)) if geometry['right'] > clip['right'] else 0)
                dy = (max(-140, geometry['top'] - clip['top'] - 8) if geometry['top'] < clip['top']
                      else min(140, geometry['bottom'] - clip['bottom'] + 8) if geometry['bottom'] > clip['bottom'] else 0)
                before = locator.evaluate(SCROLL_STATE)
                pointer = {'x': (box['left'] + box['right']) / 2, 'y': (box['top'] + box['bottom']) / 2}
                p.page.mouse.move(pointer['x'], pointer['y'])
                p.page.mouse.wheel(dx, dy)
                p.page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
                moves.append({'text': part, 'before_geometry': geometry, 'before_scroll': before,
                    'pointer': pointer, 'wheel': {'x': dx, 'y': dy}, 'after_scroll': locator.evaluate(SCROLL_STATE)})
            else:
                raise AssertionError('Complete paragraph is unreadable through bounded ordinary scroll: ' + part)
        capture()
        assert [r['text'] for r in readings] == parts
        if require_inner:
            assert any(m['after_scroll']['top'] > m['before_scroll']['top'] for m in moves), \
                'Actual inner-wheel movement, not DOM text presence, must expose the long tail.'
        p.observations.setdefault('complete_evidence_readings', []).append({'label': label,
            'text': expected, 'text_sha256': hashlib.sha256(expected.encode()).hexdigest(),
            'require_inner_scroll': require_inner, 'initial_scroll': initial,
            'parts': readings, 'ordinary_wheels': moves, 'manual_pixel_review': 'pending'})
    p.step(label, read)


def _form_state(p, form_handle, note_handle, note, selected, refs, label):
    form = p.visible('#action-transition-form')
    field = form.locator('[name="note"]')
    state = {'same_form': form_handle.evaluate('(old, current) => old.isConnected && old === current', form.element_handle()),
        'same_note': note_handle.evaluate('(old, current) => old.isConnected && old === current', field.element_handle()),
        'note': field.input_value(),
        'selected': form.locator('[name="evidence_ids"]:checked').evaluate_all('(xs) => xs.map(x => x.value)'),
        'refs': json.loads(form.get_attribute('data-evidence-refs'))}
    expect_preserved_form(state, note=note, selected=selected, refs=refs)
    p.observations.setdefault('preserved_action_drafts', []).append({'label': label, **state})


def _setup(p):
    register_empty_workspace(p)
    p.navigate('data')
    p.click('#main [data-action="import-dialog"]', after='#import-file-form')
    template = download_visible(p, p.visible('#import-file-form a[href="/api/import/template"]'),
        'action-evidence-empty-template.csv', '下载真实空白模板并核对合成财务文件格式')
    path = Path(p.directory) / FILE_NAME
    path.write_bytes(fixture_csv(template))
    p.record_artifact(path, kind='synthetic-input')
    def fill():
        p.visible('#import-file-form [name="company"]').fill(COMPANY)
        p.visible('#import-file-form [name="amount_unit"]').select_option('yuan')
        p.visible('#import-file-form [name="basis"]').select_option('standalone_quarter')
        p.visible('#import-file-form [name="file"]').set_input_files(str(path))
    p.step('通过真实文件表单填写声明的两季度合成输入', fill)
    status, stage = _capture_response(p, 'POST', '/api/workspace/imports/file',
        lambda: p.submit('#import-file-form', after='#modal [data-action="commit-stage"]'))
    assert status == 201 and p.get('/api/datasets')['items'] == []
    _read_groups(p, [(p.visible('#modal .import-readable').locator(':scope > p').first,
        ['单季度值'])], '核对真实待保存的季度口径')
    assert '尚未写入财务库' in p.visible('#modal').inner_text()
    status, dataset = _capture_response(p, 'POST', '/api/workspace/imports/' + stage['id'] + '/commit',
        lambda: p.click('#modal [data-action="commit-stage"]', after='#dataset-editor[data-version="1"]'))
    assert status == 201
    assert dataset['payload']['company'] == COMPANY and dataset['version'] == 1
    assert dataset['content_hash'] == canonical_hash(dataset['payload'])
    assert [(q['period'], q['revenue'], q['cost']) for q in dataset['payload']['periods']] == [
        ('2024-Q1', 100000, 80000), ('2024-Q2', 100000, 80000)]
    p.dataset_id = dataset['id']
    assert p.visible('#active-dataset').input_value() == dataset['id']
    p.observations['fixture'] = {'synthetic': True, 'company': COMPANY,
        'csv_sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'dataset_id': dataset['id'],
        'source_addresses_are_synthetic_and_never_visited': [COMPANY_URL, GLOBAL_URL]}
    return stage, dataset


def _report_and_action(p, dataset):
    p.navigate('agents')
    p.fill('#plan-form [name="query"]', QUESTION)
    assert not p.visible('#use-llm').is_checked()
    status, plan = _capture_response(p, 'POST', '/api/workspace/plans',
        lambda: p.submit('#plan-form', after='#execute-plan-form'))
    assert status == 201 and plan['payload']['max_calls'] == 0
    assert plan['payload']['request']['use_llm'] is False
    assert plan['payload']['snapshot']['dataset'] == dataset['payload']
    assert p.page.locator('#execute-plan-form [name="external_consent"]').count() == 0
    _read_groups(p, [(p.visible('#execute-plan-form').locator(':scope > p.micro'),
        ['本计划不会调用外部模型'])], '核对本次计划没有外部模型调用')
    status, accepted = _capture_response(p, 'POST', '/api/workspace/plans/' + plan['id'] + '/execute',
        lambda: p.submit('#execute-plan-form', after='#run-tab-summary [data-report-readout]'))
    assert status == 202
    run = _get(p, '/api/runs/' + accepted['id'], '实际执行后的唯一原始报告')
    assert run['state'] in ('succeeded', 'degraded') and run['payload']['query'] == QUESTION
    assert run['snapshot']['dataset'] == dataset['payload'] and run['result']['dataset_hash'] == dataset['content_hash']
    assert run['result']['llm']['state'] == 'not_requested' and run['result']['llm']['calls'] == []
    facts = run['result']['readout']['facts']
    assert len(facts) == 1 and facts[0]['id'] == 'gross_margin' and facts[0]['value'] == .2
    assert facts[0]['period'] == '2024-Q1' and run['result']['citations'] == []
    readout = p.visible('#run-tab-summary [data-report-readout]')
    _read_groups(p, [(readout.locator(':scope > p.preserve-lines'), [QUESTION]),
        (readout.locator('table').first.locator('tbody tr'), ['2024-Q1', '20%', '(收入−成本)/收入'])],
        '读到实际零外部报告的原问题、目标季度与20%')
    read_original_report_gaps(p, run)
    p.click('#main [data-action="action-from-report"]', after='#action-form')
    def fill():
        p.visible('#action-form [name="title"]').fill(ACTION_TITLE)
        p.visible('#action-form [name="acceptance"]').fill(ACCEPTANCE)
        assert not p.visible('#action-form [name="allow_historical"]').is_checked()
    p.step('从原报告创建有明确人工验收标准的唯一行动', fill)
    status, action = _capture_response(p, 'POST', '/api/workspace/actions', lambda: p.submit('#action-form'))
    assert status == 201 and action['payload']['run_id'] == run['id']
    assert action['payload']['company'] == COMPANY and action['payload']['dataset_id'] == dataset['id']
    assert action['payload']['status'] == 'open' and action['version'] == 1
    p.navigate('actions')
    _open_action(p, action['id'])
    assert p.visible('#action-transition-form').locator('[name="evidence_ids"]').count() == 0
    def start():
        p.visible('#action-transition-form [name="status"]').select_option('in_progress')
        p.visible('#action-transition-form [name="note"]').fill(START_NOTE)
    p.step('明确开始核对，尚未关联或验收资料', start)
    status, active = _capture_response(p, 'PUT', '/api/workspace/actions/' + action['id'] + '/status',
        lambda: p.submit('#action-transition-form'))
    assert status == 200 and active['version'] == 2 and active['payload']['status'] == 'in_progress'
    assert active['payload']['history'][-1]['evidence_snapshots'] == []
    return plan, run, active


def _open_action(p, action_id):
    p.click('#main [data-action="action-detail"][data-id="' + action_id + '"]',
        after='#inspector #action-transition-form', label='从真实行动卡打开当前资料选择与原验收历史')
    assert p.visible('#action-transition-form').get_attribute('data-id') == action_id


def _create_evidence(p, *, global_scope=False):
    title, text, url = (GLOBAL_TITLE, GLOBAL_TEXT, GLOBAL_URL) if global_scope else (COMPANY_TITLE, COMPANY_TEXT, COMPANY_URL)
    p.click('#main > header.page-heading [data-action="evidence-dialog"]', after='#evidence-form')
    def fill():
        for key, value in {'title': title, 'text': text, 'source_url': url, 'published_at': PUBLISHED,
                           'company': '' if global_scope else COMPANY}.items():
            p.visible('#evidence-form [name="' + key + '"]').fill(value)
        checkbox = p.visible('#evidence-form [name="global_scope"]')
        assert not checkbox.is_checked()
        if global_scope:
            checkbox.check()
    p.step('在真实表单明确保存' + ('通用未审阅' if global_scope else '企业范围') + '合成资料', fill)
    status, doc = _capture_response(p, 'POST', '/api/evidence',
        lambda: p.submit('#evidence-form', after='#main[data-page="evidence"]'))
    assert status == 201 and doc['version'] == 1 and doc['payload']['text'] == text
    return doc


def _review(p, evidence_id, *, later=False):
    p.click('#main [data-action="review-evidence"][data-id="' + evidence_id + '"]', after='#evidence-review-form')
    form = p.visible('#evidence-review-form')
    assert form.get_attribute('data-version') == ('2' if later else '1')
    def fill():
        assert form.locator('[name="company"]').input_value() == COMPANY
        assert not form.locator('[name="global_scope"]').is_checked()
        if later:
            assert form.locator('[name="note"]').input_value() == ORIGINAL_NOTE
            assert form.locator('[name="stance"]').input_value() == 'supports'
        form.locator('[name="status"]').select_option('accepted')
        form.locator('[name="stance"]').select_option('contradicts' if later else 'supports')
        form.locator('[name="note"]').fill(LATER_NOTE if later else ORIGINAL_NOTE)
    p.step('明确保存后来反向意见，保留原文' if later else '明确保存完整企业审阅依据和支持立场', fill)
    status, review = _capture_response(p, 'PUT', '/api/workspace/evidence/' + evidence_id + '/review',
        lambda: p.submit('#evidence-review-form', after='#main[data-page="evidence"]'))
    assert status == 200 and review['version'] == (3 if later else 2)


def _choice(p, doc):
    return p.visible('#action-transition-form [data-action-evidence="' + doc['id'] + '"]')


def _read_choice(p, doc, *, later=False):
    choice = _choice(p, doc)
    global_scope = doc['payload']['title'] == GLOBAL_TITLE
    _read_groups(p, [(choice.locator(':scope > label'),
        [GLOBAL_TITLE if global_scope else COMPANY_TITLE, '尚未审阅' if global_scope else '人工接受']),
        (choice.locator(':scope > p').nth(0), ['适用范围：' + ('通用资料 / 所有企业' if global_scope else COMPANY)]),
        (choice.locator(':scope > p').nth(1), ['背景资料' if global_scope else '反向 / 反驳证据' if later else '支持某项判断', '未设置']),
        (choice.locator(':scope > p').nth(2), ['资料版本 1', '审阅版本 ' + str(doc['review_version'])])],
        '逐项阅读' + ('通用未审阅资料' if global_scope else '后来企业审阅' if later else '企业已审阅资料') + '的范围、状态、立场与版本')
    if global_scope:
        _read_groups(p, [(choice.locator(':scope > div > p'), ['尚未填写审阅依据，请先核对原文与适用范围。'])],
            '未审阅资料明确说明没有审阅依据')
    else:
        _full_read(p, choice.locator('.action-evidence-note'), LATER_NOTE if later else ORIGINAL_NOTE,
            '完整阅读后来反向审阅' if later else '普通内层滚动读完全部原始审阅说明', require_inner=not later)
    return choice


def _expand_and_read_source(p, choice, doc, *, long_text=False):
    detail = choice.locator('details.action-evidence-source')
    assert detail.get_attribute('open') is None
    p.step('通过原生摘要展开来源与完整保存文本', lambda: detail.locator(':scope > summary').click())
    assert detail.get_attribute('open') is not None
    paragraphs = detail.locator(':scope > p')
    # safeLink contains one decorative SVG. Keep the shared group's blanket
    # hidden/SVG guard intact; verify these two exact production text nodes and
    # read their entire joined range, including the original-address caveat.
    for index, prefix in enumerate(('来源地址：', '原始采集地址：未单独记录；当前记录地址：')):
        paragraph = paragraphs.nth(index)
        assert paragraph.is_visible() and paragraph.locator(':scope > a').is_visible()
        structure = paragraph.evaluate(ADDRESS_STRUCTURE)
        text = expect_address_structure(structure, prefix=prefix, url=doc['payload']['source_url'])
        p.observations.setdefault('source_address_structures', []).append(structure)
        _full_read(p, paragraph, text, '完整阅读来源字段、地址及原始地址记录边界')
    _read_groups(p, [(paragraphs.nth(2), ['发布日期：' + PUBLISHED, '采集时间：未记录']),
        (paragraphs.nth(3), ['来源类型：用户提供文本', '核验状态：未经独立核验'])],
        '核对人工接受与来源未核验的区别，不将当前地址伪称独立原始地址')
    _full_read(p, detail.locator('.action-evidence-text'), doc['payload']['text'],
        '普通内层滚动读完完整企业原文' if long_text else '完整阅读通用未审阅资料原文', require_inner=long_text)
    _read_groups(p, [(paragraphs.nth(4), ['已保存文本指纹：', doc['content_hash']]),
        (paragraphs.nth(5), ['审阅指纹：', doc['review_hash']])], '核对同次目录的文本与审阅指纹')
    return detail


def _read_frozen_history(p, completed):
    inspector = p.visible('#inspector')
    history = inspector.locator('.dialog-body > .stack > details').filter(
        has=p.page.get_by_text('状态历史 · 3 条', exact=True))
    assert history.count() == 1 and history.get_attribute('open') is None
    p.step('展开实际三条状态历史', lambda: history.locator(':scope > summary').click())
    entries = history.locator(':scope > .timeline-entry')
    assert entries.count() == 3
    latest = entries.last
    _read_groups(p, [(latest.locator(':scope > div > p'), [DONE_NOTE])], '阅读实际验收完成时的原处理记录')
    detail = latest.locator('details')
    assert detail.count() == 1 and detail.get_attribute('open') is None
    p.step('明确打开本次验收冻结的一份原始证据', lambda: detail.locator(':scope > summary').click())
    frozen = completed['payload']['history'][-1]['evidence_snapshots'][0]
    article = detail.locator(':scope > article')
    _read_groups(p, [(article.locator('h4'), [COMPANY_TITLE]),
        (article.locator(':scope > p.micro').first,
         ['原文版本 1', '审阅版本 2', frozen['content_hash']])], '核对旧验收仍为原始资料和审阅版本')
    _full_read(p, article.locator(':scope > p.preserve-lines'), COMPANY_TEXT, '逐段读完旧行动冻结的完整原文')
    _full_read(p, article.locator(':scope > p.micro').last, '当时审阅：' + ORIGINAL_NOTE,
        '后来意见已变化，仍逐段读到旧行动冻结的原始支持说明')
    assert LATER_NOTE not in detail.text_content()


def action_evidence_journey(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    require_native_contract(p, repository_root=repository_root, data_dir=data_dir,
        expected_web_tree=expected_web_tree, expected_server_tree=expected_server_tree)
    p.observations['scope'] = {'synthetic_only': True, 'native_budget_seconds': 300,
        'financial_inputs': 1, 'reports': 1, 'actions': 1, 'documents': 2,
        'completed_selected_evidence': 1, 'global_unreviewed_evidence_selected': False,
        'mixed_selected_completion_claimed': False, 'unreviewed_completion_claimed': False,
        'same_version_stale_hash_409_native_claimed': False, 'manual_pixel_review': 'pending'}
    mutations, transition_bodies, catalog_reads = [], [], []
    p.observations['native_mutations'] = mutations
    p.observations['native_action_transition_bodies'] = transition_bodies
    def record(request):
        parsed = urlsplit(request.url)
        path = parsed.path + ('?' + parsed.query if parsed.query else '')
        if parsed.path.startswith('/api/') and request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            mutations.append({'method': request.method, 'path': path})
        if request.method == 'PUT' and parsed.path.startswith('/api/workspace/actions/') and parsed.path.endswith('/status'):
            transition_bodies.append(deepcopy(request.post_data_json))
        if request.method == 'GET' and parsed.path == '/api/workspace/evidence':
            catalog_reads.append(path)
    p.page.on('request', record)
    try:
        stage, dataset = _setup(p)
        plan, run, active = _report_and_action(p, dataset)
        p.navigate('evidence')
        company_doc = _create_evidence(p)
        _review(p, company_doc['id'])
        _create_evidence(p, global_scope=True)
        company, global_doc = expect_catalog(_get(p, '/api/workspace/evidence', '明确创建与审阅后的真实目录')['items'])
        p.navigate('actions')
        _open_action(p, active['id'])
        form = p.visible('#action-transition-form')
        assert form.get_attribute('data-version') == '2'
        refs = json.loads(form.get_attribute('data-evidence-refs'))
        assert {r['id']: r for r in refs} == {d['id']: {key: d[key] for key in REF_FIELDS} for d in (company, global_doc)}
        assert form.locator('[name="evidence_ids"]:checked').count() == 0
        form_handle, note_handle = form.element_handle(), form.locator('[name="note"]').element_handle()
        p.step('填写待验收记录并保持两份资料最初都未选择', lambda: form.locator('[name="note"]').fill(DONE_NOTE))
        _read_groups(p, [(form.locator('fieldset > p.micro'), ['人工接受仅记录审阅意见，不代表系统已验证资料真实',
            '展开详情不会选中证据'])], '阅读人工接受、事实核验与明确选择的区别')
        before_read = (len(mutations), len(catalog_reads))
        company_choice = _read_choice(p, company)
        source = _expand_and_read_source(p, company_choice, company, long_text=True)
        _form_state(p, form_handle, note_handle, DONE_NOTE, [], refs, '读完整企业说明及原文后仍未自动选择')
        p.step('阅读后明确勾选唯一企业依据', lambda: company_choice.locator('[name="evidence_ids"]').check())
        def toggle():
            source.locator(':scope > summary').click()
            assert source.get_attribute('open') is None
            source.locator(':scope > summary').click()
            assert source.get_attribute('open') is not None
        p.step('已勾选资料保持原窗口，原生收起并重新展开', toggle)
        _full_read(p, source.locator('.action-evidence-text'), COMPANY_TEXT,
            '保留行动草稿与唯一已选依据，再次普通滚动核对全文', require_inner=True)
        _form_state(p, form_handle, note_handle, DONE_NOTE, [company['id']], refs, '展开收起与全文滚动后保全同一草稿和选择')
        global_choice = _read_choice(p, global_doc)
        global_source = _expand_and_read_source(p, global_choice, global_doc)
        p.step('收起已读的通用未审阅资料，仍不选择', lambda: global_source.locator(':scope > summary').click())
        _form_state(p, form_handle, note_handle, DONE_NOTE, [company['id']], refs, '通用资料展开与收起保持一选一不选')
        assert (len(mutations), len(catalog_reads)) == before_read, 'Reading must not write or silently fetch a new catalog.'
        p.step('明确选择验收完成', lambda: form.locator('[name="status"]').select_option('done'))
        status, completed = _capture_response(p, 'PUT', '/api/workspace/actions/' + active['id'] + '/status',
            lambda: p.submit('#action-transition-form'))
        assert status == 200
        expect_completed(completed, active, company)
        assert transition_bodies[-1] == {'version': 2, 'status': 'done', 'note': DONE_NOTE,
            'evidence_ids': [company['id']], 'evidence_refs': [{key: company[key] for key in REF_FIELDS}]}
        saved = _get(p, '/api/workspace/actions', '读取实际已完成行动及原始冻结快照')['items']
        assert len(saved) == 1 and saved[0] == completed
        p.navigate('evidence')
        _review(p, company['id'], later=True)
        revised, unchanged_global = expect_catalog(_get(p, '/api/workspace/evidence', '后来明确修改审阅后的新目录')['items'], later=True)
        assert unchanged_global == global_doc
        p.navigate('actions')
        current = _get(p, '/api/workspace/actions', '后来审阅变化不能改写已完成行动')['items'][0]
        expect_preserved_history(current, completed, company, revised)
        _open_action(p, current['id'])
        _read_groups(p, [(p.visible('#inspector').locator('.notice').filter(has_text='验收证据的当前状态已有变化').locator('span'),
            ['请核对原始验收记录；不会自动撤销或重新验收。'])], '读到来源变化提示，同时保留原验收完成状态')
        fresh_form = p.visible('#action-transition-form')
        fresh_refs = json.loads(fresh_form.get_attribute('data-evidence-refs'))
        assert {r['id']: r for r in fresh_refs} == {d['id']: {key: d[key] for key in REF_FIELDS} for d in (revised, global_doc)}
        assert fresh_form.locator('[name="evidence_ids"]:checked').count() == 0
        fresh_choice = _read_choice(p, revised, later=True)
        _expand_and_read_source(p, fresh_choice, revised, long_text=True)
        _read_frozen_history(p, completed)
        fresh_handle = fresh_form.element_handle()
        fresh_note = fresh_form.locator('[name="note"]').element_handle()
        def draft_fresh():
            fresh_form.locator('[name="note"]').fill(FRESH_NOTE)
            fresh_choice.locator('[name="evidence_ids"]').check()
        p.step('重新阅读后明确选择新版审阅，仅保留未提交草稿', draft_fresh)
        _form_state(p, fresh_handle, fresh_note, FRESH_NOTE, [revised['id']], fresh_refs,
            '新版选择仍需明确提交，不自动重新验收或覆盖历史')
        final = _get(p, '/api/workspace/actions', '选择新版但不提交，旧验收仍保持不变')['items']
        assert len(final) == 1
        expect_preserved_history(final[0], completed, company, revised)
        assert _get(p, '/api/runs/' + run['id'], '资料审阅变化后原报告仍冻结')['result'] == run['result']
        assert p.get('/api/runs/' + run['id'])['snapshot'] == run['snapshot']
        assert p.get('/api/workspace/runs/' + run['id'] + '/audit')['report_integrity']['valid']
        assert p.get('/api/datasets')['items'] == [dataset]
        assert len(p.get('/api/runs')['items']) == len(p.get('/api/workspace/plans')['items']) == 1
        expect_mutations(mutations, stage_id=stage['id'], plan_id=plan['id'], action_id=active['id'], evidence_id=company['id'])
        p.observations['saved_identity'] = {'dataset_id': dataset['id'], 'plan_id': plan['id'], 'run_id': run['id'],
            'action_id': active['id'], 'company_evidence_id': company['id'], 'global_evidence_id': global_doc['id'],
            'frozen_review_hash': company['review_hash'], 'current_review_hash': revised['review_hash'],
            'frozen_history_sha256': canonical_hash(completed['payload']['history']), 'completed_action_version': 3,
            'completed_selected_count': 1, 'unselected_global_status': 'unreviewed', 'fresh_selection_submitted': False,
            'declared_write_count': 12, 'observed_write_count': len(mutations), 'catalog_reads': len(catalog_reads),
            'report_and_history_unchanged': True, 'manual_pixel_review': 'pending'}
        p.no_external()
    finally:
        p.page.remove_listener('request', record)
