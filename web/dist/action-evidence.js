import { esc, input, safeLink, badge } from './components.js';
/** Read and choose from one catalog response; expanding details never reloads or selects it. */
export function actionEvidenceChoice(e) {
    const p = e.payload, r = e.review;
    const stances = { context: '背景资料', supports: '支持某项判断', contradicts: '反向 / 反驳证据' };
    const statuses = { unreviewed: '尚未审阅', accepted: '人工接受', rejected: '已排除' };
    const origins = { search_snippet: '搜索摘要（非网页全文）', uploaded_document: '上传文档提取内容', public_document: '公开来源获取内容', user_provided: '用户提供文本' };
    const checks = { search_snippet_unverified: '搜索摘要，未经独立核验', fetched_not_fact_checked: '已获取内容，未经事实核验', unverified: '未经独立核验' };
    const source = (url) => typeof url === 'string' && url ? safeLink(url, url) : '未记录';
    const originalSource = Object.hasOwn(p, 'original_source_url') ? source(p.original_source_url) : `未单独记录；当前记录地址：${source(p.source_url)}`;
    return `<article class="action-evidence-choice" data-action-evidence="${esc(e.id)}">
 <label class="action-evidence-select">${input('evidence_ids', e.id, 'type="checkbox"')}<span><strong>${esc(p.title)}</strong> ${badge(statuses[r.status] ?? '审阅状态未记录', r.status === 'accepted' ? 'neutral' : 'warm')}</span></label>
 <p>适用范围：${esc(r.company || (r.global_scope ? '通用资料 / 所有企业' : '范围未指定'))}</p>
 <p>证据立场：${esc(stances[r.stance] ?? '未记录')} · 有效截至：${esc(r.expires_at || '未设置')}</p>
 <p class="micro">资料版本 ${esc(e.version ?? '未记录')} · 审阅版本 ${esc(e.review_version ?? '未记录')}</p>
 <div><h4>审阅依据与适用边界</h4>${r.note ? `<div class="action-evidence-note preserve-lines" role="region" tabindex="0" aria-label="${esc(p.title)}的完整审阅依据">${esc(r.note)}</div>` : `<p class="muted">${r.status === 'unreviewed' ? '尚未填写审阅依据，请先核对原文与适用范围。' : '未记录审阅依据，请先核对资料。'}</p>`}</div>
 <details class="action-evidence-source"><summary>查看来源与完整已保存文本</summary>
 <p>来源地址：${source(p.source_url)}</p><p>原始采集地址：${originalSource}</p>
 <p class="micro">发布日期：${esc(p.published_at || '未记录')} · 采集时间：${esc(p.retrieved_at || p.fetched_at || '未记录')}</p>
 <p class="micro">来源类型：${esc(origins[p.source_kind] ?? p.source_kind ?? '未记录')} · 核验状态：${esc(checks[p.verification] ?? p.verification ?? '未记录')}</p>
 ${p.source_kind === 'search_snippet' ? '<p class="muted">下方是完整保存的搜索摘要，不是来源网页全文。</p>' : ''}
 ${p.source_kind === 'uploaded_document' ? '<p class="muted">下方是已保存的文档提取文本，可能不等于原文件全文；请同时核对原文件。</p>' : ''}
 ${p.text ? `<div class="action-evidence-text preserve-lines" role="region" tabindex="0" aria-label="${esc(p.title)}的完整已保存文本">${esc(p.text)}</div>` : '<p class="muted">文本未提供，请先在证据资料中核对。</p>'}
 <p class="micro">已保存文本指纹：${esc(e.content_hash || '未记录')}</p><p class="micro">审阅指纹：${esc(e.review_hash || '未记录')}</p>
 </details></article>`;
}
