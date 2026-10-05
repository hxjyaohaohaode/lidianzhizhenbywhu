"""Readable exports of persisted report values; never recompute historical results."""
from __future__ import annotations
import json
import math
import re


def text(value):
    """Keep supplied prose literal in Markdown, including hostile HTML and links."""
    value = str(value if value is not None else '未提供').replace('\r', '')
    value = value.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    return re.sub(r'([\\`*_{}\[\]()#+.!|~-])', r'\\\1', value)


def code(value):
    body = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)
    longest = max((len(x) for x in re.findall(r'`+', body)), default=0)
    fence = '`' * max(3, longest + 1)
    return f'{fence}json\n{body}\n{fence}'


def number(value, ratio=False):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        return '不可计算 / 未提供'
    return f'{value * 100:,.4f}%' if ratio else f'{value:,.4f}'


def table(headers, rows):
    return '\n'.join(['| ' + ' | '.join(text(x).replace('\n', ' ') for x in headers) + ' |',
                      '| ' + ' | '.join('---' for _ in headers) + ' |',
                      *['| ' + ' | '.join(text(x).replace('\n', ' ') for x in row) + ' |' for row in rows]])


def report_payload(run, events, reviews, assessment=None, *, unavailable_reviews=()):
    snapshot = run.get('snapshot') or {}
    return {**run['result'], 'execution_events': events,
        'export_context': {'run_id': run['id'], 'execution_state': run['state'],
            'identity': snapshot.get('identity'), 'research_goal': snapshot.get('profile', {}).get('objective', ''),
            'success_criteria': snapshot.get('studio', {}).get('success_criteria', ''),
            'human_reviews_at_export': reviews, 'assessment_at_export': assessment,
            **({'unavailable_human_reviews_at_export':list(unavailable_reviews)} if unavailable_reviews else {}),
            'readout_notice':'原问题级事实与来源摘要随报告冻结。' if run['result'].get('readout') else '此历史报告当时未记录问题级答案或原文件回执；不从当前数据回填。',
            'review_notice': '人工审阅为导出时保存的意见；不改写原始报告与输入快照。'}}


def math_markdown(kind, output):
    names = {'forecast': '时间序列预测与回测', 'sensitivity': '情景与敏感性',
             'counterevidence': '支持与反向证据对照', 'gaps': '数据缺口与补充计划', 'comparison': '已批准企业对照'}
    parts = ['### ' + names.get(kind, text(kind))]
    if output.get('status') in {'blocked', 'failed', 'unknown', 'unavailable'}:
        parts += ['状态：' + text(output['status']), text(output.get('reason', '未产生可用结果'))]
    elif kind == 'forecast':
        ratio = output.get('metric') == 'gross_margin'
        unit = '%' if ratio else '元'
        parts += [f"指标：{text(output.get('metric'))}；方法：{text(output.get('selected_label'))}；单位：{unit}",
                  text(output.get('selection')), table(['季度', '点估计', '经验误差带下界', '经验误差带上界'],
                  [[f.get('period'), number(f.get('value'), ratio), number(f.get('lower'), ratio), number(f.get('upper'), ratio)] for f in output.get('forecast', [])]),
                  '#### 相同滚动起点回测', table(['方法', 'MAE', 'RMSE', 'WAPE', '验证折数'],
                  [[b.get('label'), number(b.get('mae'), ratio), number(b.get('rmse'), ratio), number(b.get('wape'), True), len(b.get('folds', []))] for b in output.get('backtests', [])]),
                  'MAE / RMSE：毛利率使用百分比尺度（数值相当于百分点），金额指标使用元；未提供的误差带不填零。',
                  '#### 锁定方法保留检验', code(output.get('locked_holdout'))]
    elif kind == 'sensitivity':
        base = output.get('baseline', {}); result = output.get('result', {})
        parts += ['情景是明确假设的机械计算，不是预测或因果证明。',
                  '#### 已批准假设', code(output.get('approved_assumptions', output.get('assumptions'))),
                  text(output.get('formula')), table(['指标', '基准', '情景'],
                  [[label, number(base.get(k), k == 'gross_margin'), number(result.get(k), k == 'gross_margin')]
                   for k, label in [('revenue', '营业收入（元）'), ('cost', '营业成本（元）'), ('gross_profit', '毛利额（元）'), ('gross_margin', '毛利率')]]),
                  '毛利额变化（元）：' + number(output.get('delta_gross_profit')),
                  '盈亏平衡销量 / 基准销量：' + number(output.get('break_even_volume_multiplier')),
                  table(['参数', '−5个百分点毛利额（元）', '当前毛利额（元）', '+5个百分点毛利额（元）'],
                  [[s.get('label'), number(s.get('minus_five_pp')), number(s.get('center')), number(s.get('plus_five_pp'))] for s in output.get('sensitivity', [])])]
    elif kind == 'comparison':
        parts += ['共同季度：'+text(output.get('period'))+'；比较基期：'+text(output.get('comparison')),
                  '人工可比性说明：'+text(output.get('comparability_note')), text(output.get('warning')),
                  table(['企业 / 数据集', '毛利率', '现金收入比', '负债率', '收入增速', '净利率'],
                    [[item['company']+' / '+item['id'], *[number(item['analysis']['metrics'].get(key),True)
                       for key in ('gross_margin','cash_ratio','leverage','revenue_growth','net_margin')]]
                     for item in output.get('items',[])])]
    elif kind == 'counterevidence':
        parts += [text(output.get('reason')) if output.get('reason') else '',
                  text(output.get('limitation', '标签对照不是语义矛盾认证')),
                  table(['立场', '原始引用 ID'], [[label, '、'.join(output.get('groups', {}).get(key, [])) or '未提供']
                    for key, label in [('supports', '支持'), ('contradicts', '反向'), ('context', '背景')]])]
    elif kind == 'gaps':
        parts += [table(['缺失字段', '待补充工作'], [[i.get('field'), i.get('action')] for i in output.get('items', [])])
                  if output.get('items') else '本节点没有列出缺失字段，不代表全部业务事实已核验。']
    parts += ['#### 方法边界', *[text(x) for x in output.get('limitations', [])],
              '#### 完整已保存产物（包含输入、逐折与网格，未重新计算）', code(output)]
    return '\n\n'.join(parts)


def readable_front(result):
    from .report_readout import display_number, UNIT_LABELS, BASIS_LABELS
    readout=result.get('readout')
    if not readout:return []
    unit=readout['amount_unit'];source=readout['input_source']
    # Labels are sourced from the existing finite calculator catalog.
    from .report_readout import FIELD_LABELS
    def input_text(fact):
        return '；'.join(FIELD_LABELS.get(p.get('field') or p['path'].rsplit('/',1)[-1],p.get('field','原字段'))+' '+(p['display_value'] if p.get('field') in ('assets','liabilities') and isinstance(p.get('display_value'),str) else display_number(p.get('value'),p.get('unit','CNY'),unit)) for p in fact['inputs']) or '原输入路径未记录'
    parts=['# '+text(result.get('title')),'## 本次问题的回答',text(result.get('query')),text(readout['notice'])]
    if readout['facts']:
        parts.append(table(['目标季度','所问指标','已保存结果','原输入与公式'],[[f['period'],f['label'],(f['display_value'] if f.get('id') in ('assets','liabilities') and isinstance(f.get('display_value'),str) else display_number(f['value'],f['unit'],unit))+(('；'+f['reason']) if f['reason'] else ''),input_text(f)+'；'+f['formula']] for f in readout['facts']]))
    else:parts.append('本次问题未映射到已支持的确定性指标；一般计算不能冒充原问题的直接答案。' if readout['scope_recorded'] else '当时未记录可逐项对应的问题指标；不重新解析历史问题或生成替代答案。')
    parts+=['## 输入来源与保存范围',table(['项目','本报告保存值'],[
        ['目标季度',readout['period']],['数据修订',result.get('dataset_version')],
        ['确认使用的文件',source.get('file',{}).get('name','当时未记录或目标季度未绑定文件')],
        ['原文件 SHA256',source.get('file',{}).get('sha256','当时未记录')],
        ['导入确认时间',source.get('confirmed_at','当时未记录')],
        ['原文件金额单位' if source.get('status')=='recorded' else '输入金额单位（冻结声明）',UNIT_LABELS.get(source.get('input_amount_unit'),'当时未记录')],
        ['原文件期间口径' if source.get('status')=='recorded' else '输入期间口径（冻结声明）',BASIS_LABELS.get(source.get('input_basis'),'当时未记录')],
        ['系统保存口径','金额归一为元；独立单季度'],['本页金额展示单位',UNIT_LABELS.get(unit,'元')],
        ['数据 SHA256',result.get('dataset_hash')],['回执 SHA256',source.get('receipt_hash','当时未记录')]]),text(source['notice']),
        '## 下一步需要补充什么',table(['期间','条件','具体操作'],[[s['period'],'仅在需要该项进一步核查时' if s['conditional'] else '补全所问指标',s['action']] for s in readout['next_steps']])]
    llm=result.get('llm',{})
    parts+=['## 本次解释边界',('本次未请求外部模型；没有外部模型解释，以上为已保存输入与本地计算。' if llm.get('state')=='not_requested' else '模型解释须结合已关联资料与人工复核；调用回执保留在技术附录。'),
        '缺失指标不按零值补齐；尚无指定基期时不能把本期水平当作同比或环比变化。' if any(s['conditional'] and not s['fields'] for s in readout['next_steps']) else '数值来自冻结输入；用户提供的内容仍需原始资料核验。']
    return parts


def markdown_report(result):
    ctx = result.get('export_context', {}); analysis = result.get('analysis', {})
    parts = ['# ' + text(result.get('title')), '## 任务与归档依据',
        table(['项目', '保存值'], [['原始研究问题', result.get('query')], ['执行状态', ctx.get('execution_state')],
            ['报告保存时间', result.get('created_at')], ['归档模型 / 规则版本', result.get('model_version', '历史记录未提供')],
            ['财务目标季度', result.get('research_scope', {}).get('period') if result.get('research_scope') else analysis.get('current_period')],
            ['期间范围边界', (result.get('research_scope') or {}).get('notice')], ['数据版本', result.get('dataset_version')], ['数据哈希', result.get('dataset_hash')],
            ['快照哈希', result.get('snapshot_hash')], ['企业研究目标', ctx.get('research_goal')],
            ['人工验收标准', ctx.get('success_criteria')]]),
        '工作身份（执行时快照）：', code(ctx.get('identity')), '## 已保存计算结论',
        *[text(x) for x in result.get('findings', [])], '## 数据与方法边界',
        *[text(x) for x in [*result.get('warnings', []), *result.get('limitations', [])]],
        '## 指标、规则与输入血缘', code(analysis), code(result.get('lineage', []))]
    for kind, value in result.get('adaptive', {}).get('mathematical_outputs', {}).items():
        parts.append(math_markdown(kind, value))
    if result.get('experiment'):
        parts += ['## 已批准数学实验来源', code(result['experiment']),
                  '原始假设、目标季度、实验版本与指纹随批准计划冻结；不随当前实验或财务输入变化改写。']
    if result.get('comparison_artifact'):
        parts += ['## 企业比较来源与全部冻结输入', code(result['comparison_provenance']),
                  '以下为本地归档的完整成员输入；专家仅接收计划披露的有限派生指标，未自动外发这些财务快照。',
                  code(result['comparison_artifact'])]
    parts += ['## 模型解释与人工复核', '结构门禁与引用关联不等于事实核验。']
    reviews = ctx.get('human_reviews_at_export', [])
    if ctx.get('unavailable_human_reviews_at_export'):
        parts += ['部分已保存人工审阅当前无法校验；不代表没有审阅，不推断原意见。',
                  code(ctx['unavailable_human_reviews_at_export'])]
    for claim in result.get('llm', {}).get('review', {}).get('claims', []):
        parts += [text(claim.get('text')), '指标：' + text('、'.join(claim.get('metric_ids', []))),
                  '引用：' + text('、'.join(claim.get('citation_ids', []))),
                  '数学依据（仅显示已保存的逐调用核对结果）：',
                  table(['依据', '期间', '数值', '单位', '产物引用', '产物 SHA256'],
                    [[ref.get('label'), ref.get('period'), number(ref.get('value'), ref.get('unit') == 'ratio'),
                      '%' if ref.get('unit') == 'ratio' else ref.get('unit'), ref.get('id'), ref.get('output_hash')]
                     for ref in claim.get('tool_references', [])]),
                  code([r['payload'] for r in reviews if r.get('payload', {}).get('claim_id') == claim.get('id')])]
    parts += ['模型调用状态：' + text(result.get('llm', {}).get('state')), '## 原始证据与定位']
    for c in result.get('citations', []):
        parts += ['### ' + text(c.get('title')), table(['项目', '保存值'],
            [['采集方式', {'search_snippet':'搜索摘要（非全文）','uploaded_document':'上传文档提取内容','public_document':'公开来源获取内容','user_provided':'用户提供文本'}.get(c.get('source_kind'),'来源类型未记录')],
             ['来源类型标识', c.get('source_kind')], ['核验状态（不随人工审阅改写）', c.get('verification')],
             ['当前展示来源地址', c.get('url')], ['原始采集来源地址', c.get('original_source_url')],
             ['搜索摘要采集时间', c.get('retrieved_at')], ['公开原文获取时间', c.get('fetched_at')],
             ['引用 ID', c.get('id')], ['字符起点', c.get('start')], ['字符终点', c.get('end')],
             ['内容 SHA256', c.get('content_hash')], ['发布日期（元数据）', c.get('published_at')], ['人工审阅状态', c.get('review_state')]]),
             '更正展示来源地址或人工接受资料，不改变原始采集方式、时间或真实性核验状态。', text(c.get('excerpt'))]
    if not result.get('citations'):
        parts.append('没有匹配证据；不生成来源或引用。')
    parts += ['## 执行复盘', code(result.get('adaptive', {}).get('reflection')), '## 导出时人工验收与复核记录',
              text(ctx.get('review_notice')), code(ctx.get('assessment_at_export')), code(reviews),
              '## 模型调用回执', code(result.get('llm', {}).get('calls', [])),
              '## 执行事件', code(result.get('execution_events', []))]
    front=readable_front(result)
    if front:parts=front+['## 技术附录：完整冻结计算、来源和执行记录']+parts[1:]
    else:parts.insert(1,'此历史报告当时未记录问题级答案或原文件回执；不从当前数据回填，以下原冻结内容保留。')
    return '\n\n'.join(parts) + '\n'
