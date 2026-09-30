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


def report_payload(run, events, reviews, assessment=None):
    snapshot = run.get('snapshot') or {}
    return {**run['result'], 'execution_events': events,
        'export_context': {'run_id': run['id'], 'execution_state': run['state'],
            'identity': snapshot.get('identity'), 'research_goal': snapshot.get('profile', {}).get('objective', ''),
            'success_criteria': snapshot.get('studio', {}).get('success_criteria', ''),
            'human_reviews_at_export': reviews, 'assessment_at_export': assessment,
            'review_notice': '人工审阅为导出时保存的意见；不改写原始报告与输入快照。'}}


def math_markdown(kind, output):
    names = {'forecast': '时间序列预测与回测', 'sensitivity': '情景与敏感性',
             'counterevidence': '支持与反向证据对照', 'gaps': '数据缺口与补充计划'}
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
    elif kind == 'counterevidence':
        parts += [text(output.get('limitation', '标签对照不是语义矛盾认证')),
                  table(['立场', '原始引用 ID'], [[label, '、'.join(output.get('groups', {}).get(key, [])) or '未提供']
                    for key, label in [('supports', '支持'), ('contradicts', '反向'), ('context', '背景')]])]
    elif kind == 'gaps':
        parts += [table(['缺失字段', '待补充工作'], [[i.get('field'), i.get('action')] for i in output.get('items', [])])
                  if output.get('items') else '本节点没有列出缺失字段，不代表全部业务事实已核验。']
    parts += ['#### 方法边界', *[text(x) for x in output.get('limitations', [])],
              '#### 完整已保存产物（包含输入、逐折与网格，未重新计算）', code(output)]
    return '\n\n'.join(parts)


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
    parts += ['## 模型解释与人工复核', '结构门禁与引用关联不等于事实核验。']
    reviews = ctx.get('human_reviews_at_export', [])
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
    return '\n\n'.join(parts) + '\n'
