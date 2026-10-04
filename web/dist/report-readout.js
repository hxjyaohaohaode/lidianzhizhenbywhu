import { esc, num, pct, amount, unitName, notice, table } from './components.js';
import { financialFields } from './views-data.js';
const labels = Object.fromEntries(financialFields);
export function readoutValue(value, kind, unit) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return kind === 'CNY' ? '未提供' : '不可计算';
    return kind === 'CNY' ? amount(value, unit) + ' ' + unitName(unit) : kind === 'ratio' ? pct(value) : kind === 'ratio_points' ? num(value * 100) + ' 个百分点' : kind === 'times' ? num(value) + ' 倍' : num(value) + '（单位未记录）';
}
export function reportReadout(report) {
    const r = report.readout;
    if (!r)
        return notice('此历史报告当时未记录问题级答案或原文件回执；不从当前数据补写旧依据。原冻结报告与技术记录保留。');
    const unit = r.amount_unit, source = r.input_source;
    const facts = r.facts.length ? table(['目标季度', '所问指标', '已保存结果', '原输入与公式'], r.facts.map((f) => [
        esc(f.period), esc(f.label), `<strong>${esc(readoutValue(f.value, f.unit, unit))}</strong>${f.reason ? `<p class="micro">${esc(f.reason)}</p>` : ''}`,
        `${f.inputs.map((v) => `<p>${esc(labels[v.field ?? v.path?.split('/').at(-1)] ?? v.field ?? '原始输入')}：${esc(readoutValue(v.value, v.unit ?? 'CNY', unit))}</p>`).join('')}<p class="micro">${esc(f.formula)}</p>`
    ])) : notice(r.scope_recorded ? '本次问题未映射到已支持的确定性指标；一般计算不能冒充原问题的直接答案。' : '旧计划未记录问题级指标范围；不重新解析历史问题。');
    return `<section class="panel report-readout" data-report-readout aria-label="本次问题的回答"><h2>本次问题的回答</h2><p class="preserve-lines">${esc(report.query)}</p><p class="micro">${esc(r.notice)} 本页金额展示单位：${esc(unitName(unit))}。</p>${facts}<h3>输入来源与保存范围</h3>${table(['项目', '本报告保存值'], [
        ['目标季度 / 数据修订', esc(r.period) + ' / ' + esc(report.dataset_version)],
        ['确认使用的文件', esc(source.file?.name ?? (source.source_kind === 'structured_input' ? '结构化编辑，没有本次文件' : '当时未记录或目标季度未绑定文件'))],
        ['原文件 SHA256', esc(source.file?.sha256 ?? '当时未记录')],
        [source.status === 'recorded' ? '原文件金额单位' : '输入金额单位（冻结声明）', esc({ yuan: '元', wan: '万元', yi: '亿元' }[source.input_amount_unit] ?? '当时未记录')],
        [source.status === 'recorded' ? '原文件期间口径' : '输入期间口径（冻结声明）', esc({ standalone_quarter: '单季度', year_to_date: '年初累计转单季度' }[source.input_basis] ?? '当时未记录')],
        ['导入确认时间', esc(source.confirmed_at ?? '当时未记录')],
        ['系统保存口径', '金额归一为元；独立单季度']
    ])}<p class="micro">${esc(source.notice)}</p><h3>下一步需要补充什么</h3><ul class="compact-list">${r.next_steps.map((step) => `<li>${step.conditional ? '进一步核查时：' : ''}${esc(step.action)}</li>`).join('')}</ul><details><summary>冻结数据与回执指纹</summary>${table(['数据 SHA256', '回执 SHA256'], [[esc(report.dataset_hash), esc(source.receipt_hash ?? '当时未记录')]])}</details></section>`;
}
