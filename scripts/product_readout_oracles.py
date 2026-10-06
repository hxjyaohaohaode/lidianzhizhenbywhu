"""Independent L1 acceptance helpers; import is pure and never starts a browser.

Use with the already-authorized native CI Probe. Business expectations remain
independent from report formatting and new implementation calculations.
"""
import hashlib
import json
import math
import re


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
        separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def expect_first_use_readout(result, saved, receipt, corrected_bytes, corrected_name):
    readout = result['readout']
    assert readout['schema_version'] == 1
    assert readout['scope_recorded'] is True and readout['period'] == '2024-Q1'
    assert readout['amount_unit'] in {'yuan', 'wan', 'yi'}
    facts = {fact['id']: fact for fact in readout['facts']}
    assert len(facts) == len(readout['facts']), 'A metric must not have ambiguous duplicate answers.'
    margin, flow, ratio = (facts[key] for key in ('gross_margin', 'cash_flow', 'cash_ratio'))
    assert margin['unit'] == 'ratio' and margin['status'] == 'available'
    assert math.isclose(margin['value'], .2, rel_tol=0, abs_tol=1e-12)
    assert margin['formula'] == '(收入−成本)/收入'
    inputs = {row['path']: row for row in margin['inputs']}
    for key, expected in [('revenue', 100000), ('cost', 80000)]:
        row = inputs['periods/2024-Q1/' + key]
        assert row['value'] == expected and row['unit'] == 'CNY'
    assert flow['unit'] == 'CNY' and ratio['unit'] == 'ratio'
    for fact in [flow, ratio]:
        assert fact['status'] == 'missing' and fact['value'] is None
        assert isinstance(fact['reason'], str) and fact['reason'].strip()
    assert '经营现金流' in flow['label'] and '比' not in flow['label'], 'The requested amount is not its derived ratio.'
    source = readout['input_source']
    assert source['status'] == 'recorded'
    assert source['dataset_id'] == saved['id']
    assert source['dataset_version'] == saved['version'] == 1
    assert source['dataset_hash'] == saved['content_hash'] == canonical_hash(saved['payload'])
    assert source['receipt_hash'] == canonical_hash(receipt)
    assert source['file'] == {'name': corrected_name, 'sha256': hashlib.sha256(corrected_bytes).hexdigest(), 'bytes': len(corrected_bytes)}
    assert source['input_amount_unit'] == 'wan' and source['input_basis'] == 'standalone_quarter'
    assert source['confirmed_at'], 'A file identity alone is not an approved import receipt.'
    assert any(item['period'] == '2024-Q1' and 'cash_flow' in item['fields'] and item['action'].strip()
        for item in readout['next_steps']), 'Give the missing target-period input, not only an unrelated baseline.'
    return readout


def expect_reader_first_markdown(md_bytes, *, file_name, file_hash):
    text = md_bytes.decode('utf-8')
    assert text.count('## 技术附录') == 1
    prefix = text.split('## 技术附录', 1)[0]
    assert '```' not in prefix, 'Human answer/source/next action precede raw execution JSON.'
    literal = re.sub(r'\\([\\`*_{}\[\]()#+.!|~-])', r'\1', prefix)
    for label in ['本次问题的回答', '输入来源与保存范围', '下一步需要补充什么', '2024-Q1', file_name, file_hash, '万元']:
        assert label in literal, label
    assert re.search(r'20(?:\.0+)?\s*%', literal), 'The reader sees 20%, not raw ratio 0.2.'
    # Accept an equivalent honest wording, not a particular sentence template.
    assert any('经营现金流' in line and re.search(r'未提供|缺失|缺少|不能给出|未填写', line)
               for line in literal.splitlines()), 'Direct requested amount must be explicitly unavailable.'
    assert re.search(r'独立单季|单季度实际|独立季度', literal)
    assert re.search(r'未.{0,5}核验|未经.{0,5}核验', literal)
    return {'human_prefix_chars': len(prefix), 'technical_appendix_retained': True}


def expect_old_report_unchanged(first_export, second_export, original_run, current_dataset):
    before, after = json.loads(first_export), json.loads(second_export)
    for key, value in original_run['result'].items():
        assert before[key] == value and after[key] == value, 'Saved historical result changed: ' + key
    assert before['readout'] == after['readout']
    assert before['dataset_version'] == after['dataset_version'] == 1
    assert before['dataset_hash'] == after['dataset_hash'] != current_dataset['content_hash']
    assert current_dataset['version'] == 2
    q1 = next(row for row in current_dataset['payload']['periods'] if row['period'] == '2024-Q1')
    assert q1['cost'] == 70000 and q1['cash_flow'] is None
    margin = next(row for row in after['lineage'] if row['id'] == 'gross_margin')
    assert margin['value'] == .2
    assert next(row for row in margin['inputs'] if row['path'].endswith('/cost'))['value'] == 80000
    # export_context may truthfully expose the later current-data state. Do not
    # force byte-identical wrappers or prohibit honest stale warnings.


_TEXT_GEOMETRY = r'''(element, needle) => {
 const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT), nodes=[];let node,text='';
 while(node=walker.nextNode()){nodes.push({node,start:text.length});text+=node.textContent||'';}
 const start=text.indexOf(needle);if(start<0)return {found:false};const end=start+needle.length;
 const a=nodes.find(x=>x.start+(x.node.textContent||'').length>start), b=[...nodes].reverse().find(x=>x.start<end);
 const range=document.createRange();range.setStart(a.node,start-a.start);range.setEnd(b.node,end-b.start);
 const r=range.getBoundingClientRect(), root=element.getBoundingClientRect();
 let clip={left:0,top:0,right:innerWidth,bottom:innerHeight};
 for(let p=element;p;p=p.parentElement){const s=getComputedStyle(p),q=p.getBoundingClientRect();
 if(s.overflowX!=='visible'){clip.left=Math.max(clip.left,q.left);clip.right=Math.min(clip.right,q.right);}
 if(s.overflowY!=='visible'){clip.top=Math.max(clip.top,q.top);clip.bottom=Math.min(clip.bottom,q.bottom);}}
 const dialog=element.closest('dialog'),head=dialog?.querySelector('.dialog-head');if(head)clip.top=Math.max(clip.top,head.getBoundingClientRect().bottom);
 // The application topbar is a sibling overlay, not an overflow ancestor.
 // It visibly covered the heading in original 3433 frame072 despite old geometry.
 const bar=!dialog&&document.querySelector('.topbar');if(bar){const br=bar.getBoundingClientRect();if(br.bottom>0&&br.top<innerHeight&&r.left<br.right&&r.right>br.left)clip.top=Math.max(clip.top,br.bottom);}
 const rootClip={left:Math.max(root.left,clip.left),right:Math.min(root.right,clip.right),top:Math.max(root.top,clip.top),bottom:Math.min(root.bottom,clip.bottom)};
 return {found:true,top:r.top,bottom:r.bottom,left:r.left,right:r.right,clip,root:rootClip,
 visible:r.width>0&&r.height>0&&r.top>=clip.top-1&&r.bottom<=clip.bottom+1&&r.left>=clip.left-1&&r.right<=clip.right+1};
}'''


def observe_text_by_normal_scroll(p, locator, needle, label):
    """Read-only text geometry plus actual pointer wheel, never changing DOM/style.

    DOM text alone is not a visual pass. Save the untouched previous viewport,
    then bounded ordinary scrolling and the reached frame for independent review.
    """
    p.step(label + '：先将真实内容区滚入视野', lambda: locator.scroll_into_view_if_needed())
    frames = []
    for attempt in range(12):
        geometry = locator.evaluate(_TEXT_GEOMETRY, needle)
        frames.append(geometry)
        assert geometry.get('found'), 'Expected human-readable text is absent: ' + needle
        if geometry['visible']:
            p.step(label + '：记录实际入视野文本', lambda: None)
            p.observations.setdefault('visible_text_ranges', []).append({'label':label,'text':needle,'geometry':frames,'manual_pixel_review':'pending'})
            return
        box = geometry['root']
        assert box['right'] > box['left'] and box['bottom'] > box['top'], 'No unobscured pointer target for ordinary scroll.'
        delta = -280 if geometry['top'] < geometry['clip']['top'] else 280
        def wheel():
            p.page.mouse.move((box['left']+box['right'])/2, (box['top']+box['bottom'])/2)
            p.page.mouse.wheel(0, delta)
            p.page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        p.step(label + '：普通滚轮 ' + str(attempt+1), wheel)
    raise AssertionError('Text did not become unobscured through bounded normal scroll: ' + needle)


def verify_frozen_report_after_later_input(p, original_run, first_json, first_markdown, download_visible):
    """Continue via real sidebar/editor/report list, with no synthetic API writes."""
    old_id = original_run['id']
    old_hash = original_run['result']['dataset_hash']
    p.navigate('data')
    form = p.visible('#dataset-editor')
    assert form.get_attribute('data-id') == original_run['dataset_id']
    assert form.get_attribute('data-version') == '1'
    assert p.visible('#dataset-editor [name="amount_unit"]').input_value() == 'yuan'
    row = p.page.locator('#dataset-editor [data-period-row]').filter(has=p.page.locator('[name="period"][value="2024-Q1"]'))
    assert row.count() == 1
    assert row.locator('[name="cost"]').input_value() == '80000'
    p.step('在真实资料表将当前Q1成本改为70000元，历史报告仍应冻结', lambda: row.locator('[name="cost"]').fill('70000'))
    p.submit('#dataset-editor', after='#modal [data-action="commit-stage"]')
    preview = p.visible('#modal')
    assert '70000' in preview.inner_text() and '80000' in preview.inner_text()
    p.click('#modal [data-action="commit-stage"]', after='#dataset-editor[data-version="2"]', label='明确确认当前资料修订2')
    rows = p.get('/api/datasets')['items']
    current = next(item for item in rows if item['id'] == original_run['dataset_id'])
    assert current['version'] == 2 and current['content_hash'] != old_hash
    assert next(item for item in current['payload']['periods'] if item['period']=='2024-Q1')['cost'] == 70000
    p.navigate('reports')
    button = p.page.locator('#main button[data-route]').filter(has_text='2024-Q1毛利率和经营现金流是多少')
    assert button.count() == 1, 'Find the old report by its visible original question, not a known-ID URL.'
    assert button.get_attribute('data-route') == 'agents:run-' + old_id
    def open_report():
        button.click()
        p.page.locator('#run-tab-summary').wait_for(state='visible', timeout=30000)
    p.step('从真实报告列表按原问题打开旧报告', open_report)
    section = p.visible('[data-report-readout]')
    assert '2024-Q1' in section.inner_text()
    assert re.search(r'20(?:\.0+)?\s*%', section.inner_text())
    j2 = download_visible(p, p.visible('#main a[href$="export?format=json"]'), 'opened-report-after-revision.json', '当前资料变化后实际下载同一旧报告JSON')
    m2 = download_visible(p, p.visible('#main a[href$="export?format=md"]'), 'opened-report-after-revision.md', '当前资料变化后实际下载同一旧报告Markdown')
    expect_old_report_unchanged(first_json, j2, original_run, current)
    source = original_run['result']['readout']['input_source']['file']
    expect_reader_first_markdown(first_markdown, file_name=source['name'], file_hash=source['sha256'])
    expect_reader_first_markdown(m2, file_name=source['name'], file_hash=source['sha256'])
    current_run = p.get('/api/runs/' + old_id)
    assert current_run['result'] == original_run['result']
    assert current_run['snapshot'] == original_run['snapshot']
    p.observations['later_input_does_not_rewrite_old_report'] = {
        'run_id': old_id, 'current_dataset_version': 2, 'old_report_dataset_version': 1,
        'current_cost_CNY': 70000, 'frozen_report_cost_CNY': 80000,
        'frozen_margin_ratio': .2, 'visible_list_navigation': True,
        'frozen_file_sha256': source['sha256'], 'actual_redownloads_opened': True,
        'old_database_migration_claimed': False,
    }
    p.no_external()


def read_preview_table(p, table, expected_rows, label):
    """Check every displayed cell and record normal-scroll reading, not hidden DOM."""
    p.step(label + '：正常滚动查看中文字段表', lambda: table.scroll_into_view_if_needed())
    observations = []
    for key, expected in expected_rows:
        row = table.locator(f'tr[data-preview-field="{key}"]')
        assert row.count() == 1
        cells = [cell.inner_text().strip() for cell in row.locator('td').all()]
        assert cells == expected, f'{key}: expected exact human value/unit {expected}, observed {cells}'
        needle = ''.join(cells)
        geometry = row.evaluate(_TEXT_GEOMETRY, needle)
        if not geometry.get('visible'):
            observe_text_by_normal_scroll(p, row, needle, label + ' ' + key)
            geometry = row.evaluate(_TEXT_GEOMETRY, needle)
        assert geometry.get('visible'), 'A value outside the reading viewport does not pass human review.'
        observations.append({'field':key,'cells':cells,'reading_geometry':geometry})
    p.observations.setdefault('human_preview_tables', []).append({'label':label,'rows':observations,'pixel_review':'pending_independent_review'})


def inspect_human_import_values(p, *, corrected):
    section = p.visible('#modal section.import-readable')
    assert '逐季度核对将保存的数据' in section.inner_text()
    assert '单季度值' in section.inner_text() and '未提供与数值 0 分开显示' in section.inner_text()
    first = section.locator('details[data-preview-period="2024-Q1"]')
    second = section.locator('details[data-preview-period="2024-Q2"]')
    assert first.get_attribute('open') is not None and second.get_attribute('open') is None
    read_preview_table(p, first.locator(':scope > .preview-values'), [
        ('revenue',['营业收入','10','万元']),('cost',['营业成本','8' if corrected else '9','万元']),
        ('cash_flow',['经营现金流','未提供','万元']),('net_profit',['净利润','0.5','万元']),
        ('assets',['总资产','50','万元']),('liabilities',['总负债','20','万元']),('inventory',['库存金额','2','万元']),
    ], ('修正后' if corrected else '原文件') + 'Q1基础字段')
    supplement = first.locator(':scope > details.preview-supplement')
    assert supplement.get_attribute('open') is None
    p.step('真实展开Q1产销与补充指标', lambda: supplement.locator(':scope > summary').click())
    read_preview_table(p, supplement.locator('.preview-values'), [
        ('equity_begin',['期初净资产','30','万元']),('equity_end',['期末净资产','30','万元']),
        ('sales_volume',['销量（统一单位）','100','原填数量']),
        ('production_volume',['产量（相同单位）','120','原填数量']),
        ('manufacturing_cost',['制造费用','0.2','万元']),('rd_expense',['研发费用','0.3','万元']),
        ('lithium_price',['锂价 / 元每吨','100,000','元/吨']),
        ('industry_volatility',['行业波动率 / 比值','0.15','比值']),
    ], ('修正后' if corrected else '原文件') + 'Q1补充字段与量纲')
    p.step('收起已核对的Q1补充字段', lambda: supplement.locator(':scope > summary').click())
    p.step('实际打开另一个季度，不用Q1值替代Q2', lambda: second.locator(':scope > summary').click())
    read_preview_table(p, second.locator(':scope > .preview-values'), [
        ('revenue',['营业收入','12','万元']),('cost',['营业成本','10','万元']),
        ('cash_flow',['经营现金流','未提供','万元']),('net_profit',['净利润','0.6','万元']),
        ('assets',['总资产','55','万元']),('liabilities',['总负债','22','万元']),('inventory',['库存金额','2.2','万元']),
    ], ('修正后' if corrected else '原文件') + 'Q2基础字段')
    supplement2 = second.locator(':scope > details.preview-supplement')
    p.step('真实展开Q2补充字段，核对不会复制Q1数值', lambda: supplement2.locator(':scope > summary').click())
    read_preview_table(p, supplement2.locator('.preview-values'), [
        ('equity_begin',['期初净资产','30','万元']),('equity_end',['期末净资产','33','万元']),
        ('sales_volume',['销量（统一单位）','110','原填数量']),('production_volume',['产量（相同单位）','130','原填数量']),
        ('manufacturing_cost',['制造费用','0.25','万元']),('rd_expense',['研发费用','0.35','万元']),
        ('lithium_price',['锂价 / 元每吨','110,000','元/吨']),('industry_volatility',['行业波动率 / 比值','0.16','比值']),
    ], ('修正后' if corrected else '原文件') + 'Q2补充字段与量纲')
    p.step('收起已核对的Q2补充字段', lambda: supplement2.locator(':scope > summary').click())
    p.step('收起已核对的Q2', lambda: second.locator(':scope > summary').click())
