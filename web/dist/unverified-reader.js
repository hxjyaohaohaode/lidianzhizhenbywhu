import { esc, notice } from './components.js';
import { state } from './state.js';
// Transport the original string as a JSON *string*, never decode its contents.
// Literal CR/LF would be normalized by the HTML parser even in an attribute.
const scope = () => JSON.stringify([state.user?.id ?? '', state.identity, state.active]);
const readers = new WeakMap();
const radius = 240;
const textHtml = (text) => esc(text).replace(/\r/g, '&#13;').replace(/\n/g, '&#10;');
const high = (n) => n >= 0xd800 && n <= 0xdbff, low = (n) => n >= 0xdc00 && n <= 0xdfff;
function contextStart(raw, start) { const n = Math.max(0, start); return low(raw.charCodeAt(n)) && high(raw.charCodeAt(n - 1)) ? n - 1 : n; }
function contextEnd(raw, end) { const n = Math.min(raw.length, end); return high(raw.charCodeAt(n - 1)) && low(raw.charCodeAt(n)) ? n + 1 : n; }
export function rawTextBytes(raw) {
    if (typeof raw !== 'string')
        return null;
    // TextEncoder replaces unpaired surrogates. Refuse an exact-byte claim then.
    for (let i = 0; i < raw.length; i++) {
        const n = raw.charCodeAt(i);
        if (n >= 0xd800 && n <= 0xdbff) {
            const next = raw.charCodeAt(++i);
            if (!(next >= 0xdc00 && next <= 0xdfff))
                return null;
        }
        else if (n >= 0xdc00 && n <= 0xdfff)
            return null;
    }
    return new TextEncoder().encode(raw);
}
export function rawMatches(raw, query) {
    if (!query || rawTextBytes(query) === null)
        return [];
    const hits = [];
    let from = 0, at;
    while ((at = raw.indexOf(query, from)) !== -1) {
        hits.push(at);
        from = at + query.length;
    }
    return hits;
}
export function rawExcerpt(raw, start, end, hit, query) {
    const left = contextStart(raw, start), right = contextEnd(raw, end);
    return (left ? '…\n' : '') + `<span>${textHtml(raw.slice(left, hit))}</span><mark>${textHtml(query)}</mark><span>${textHtml(raw.slice(hit + query.length, right))}</span>` + (right < raw.length ? '\n…' : '');
}
export function unverifiedReader(raw, runId) {
    const exact = rawTextBytes(raw);
    if (exact === null)
        return `<details data-unverified-report-raw><summary>未核验的已保存报告原文（仅供排查）</summary>${notice('原文不是可保真的文本类型，无法提供原字节阅读或下载。没有将对象重新序列化冒充原文；请核对可信原始记录。', 'danger')}</details>`;
    const text = raw;
    return `<details class="unverified-reader" data-unverified-report-raw data-raw-text="${esc(JSON.stringify(text))}" data-reader-scope="${esc(scope())}" data-reader-run="${esc(runId)}"><summary>未核验的已保存报告原文（仅供排查）</summary>
 <div class="notice danger" data-unverified-warning><span><strong>未核验原文，不是可用结论。</strong> 内容可能损坏，金额和比例不能作为正常结果使用；阅读和下载不会修复或改写原记录。</span></div>
 <p class="micro">只读阅读排版：原字符自动换行，不解析或修复 JSON，不换算数字。可查找字段、原始值或上下文；按原文字面匹配。</p>
 <div class="unverified-search" role="search" aria-label="查找未核验原文"><label>查找原文字段或值<input type="search" data-raw-query placeholder="例如：毛利率" maxlength="200" autocomplete="off"></label><div class="inline-actions"><button type="button" class="secondary" data-raw-action="find">查找</button><button type="button" class="secondary" data-raw-action="previous" disabled>上一处</button><button type="button" class="secondary" data-raw-action="next" disabled>下一处</button></div></div>
 <p data-raw-status role="status" aria-live="polite">输入关键词后查找；全文共 ${text.length} 个字符位置，${exact.length} 个 UTF-8 字节。</p>
 <section data-raw-match hidden aria-label="未核验原文命中与前后文"><strong>未核验 · 命中与前后文</strong><pre data-raw-excerpt tabindex="0" aria-label="命中原文及前后文"></pre><div class="inline-actions"><button type="button" class="secondary" data-raw-action="earlier">更多前文</button><button type="button" class="secondary" data-raw-action="later">更多后文</button></div></section>
 <details data-raw-full><summary>完整原文 · 自动换行（未核验）</summary><pre data-raw-content tabindex="0" aria-label="完整未核验原文"><span>${textHtml(text)}</span></pre></details>
 <button type="button" class="secondary" data-raw-action="download">下载未核验原始文本（.txt）</button><p class="micro">下载保留已保存文本的完整 UTF-8 字节（包括原有换行）；不是正常报告的 Markdown 或 JSON 导出。</p></details>`;
}
export function keepUnverifiedReaders(host) {
    return { roots: [...host.querySelectorAll('[data-unverified-report-raw][data-raw-text]')], focused: document.activeElement };
}
export function restoreUnverifiedReaders(host, saved) {
    // A current thread refresh can finish while the person types. Reuse only an
    // unchanged run/text/scope reader, capturing the newest input at paint time.
    for (const next of host.querySelectorAll('[data-unverified-report-raw][data-raw-text]')) {
        const prior = saved.roots.find(old => old.dataset.readerRun === next.dataset.readerRun && old.dataset.rawText === next.dataset.rawText && old.dataset.readerScope === next.dataset.readerScope && old.dataset.readerScope === scope());
        if (!prior)
            continue;
        next.replaceWith(prior);
        if (saved.focused && prior.contains(saved.focused))
            saved.focused.focus({ preventScroll: true });
    }
}
function original(root) {
    if (!root.isConnected || root.dataset.readerScope !== scope())
        return null;
    try {
        const raw = JSON.parse(root.dataset.rawText ?? 'null');
        return typeof raw === 'string' ? raw : null;
    }
    catch {
        return null;
    }
}
function act(root, action) {
    const raw = original(root);
    if (raw === null)
        return;
    const status = root.querySelector('[data-raw-status]'), input = root.querySelector('[data-raw-query]');
    if (action === 'download') {
        const bytes = rawTextBytes(raw);
        if (bytes === null) {
            status.textContent = '无法保证原文本字节，下载未执行。';
            return;
        }
        const url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=utf-8' })), link = document.createElement('a');
        link.href = url;
        link.download = 'unverified-saved-report-' + (root.dataset.readerRun ?? 'record').replace(/[^a-zA-Z0-9_-]/g, '_') + '.txt';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
    }
    const query = input.value;
    let current = readers.get(root);
    if (!current || current.query !== query || action === 'find') {
        current = { query, hits: rawMatches(raw, query), index: 0, start: 0, end: 0 };
        readers.set(root, current);
        action = 'find';
    }
    const match = root.querySelector('[data-raw-match]');
    for (const name of ['previous', 'next'])
        root.querySelector(`[data-raw-action="${name}"]`).disabled = current.hits.length < 2;
    match.hidden = !current.hits.length;
    if (!current.hits.length) {
        status.textContent = query ? '未找到“' + query + '”。原文可能使用不同字段名；可查看完整原文或更换关键词。' : '请输入要查找的字段或原始值。';
        return;
    }
    if (action === 'next')
        current.index = (current.index + 1) % current.hits.length;
    if (action === 'previous')
        current.index = (current.index - 1 + current.hits.length) % current.hits.length;
    const hit = current.hits[current.index];
    if (action === 'earlier')
        current.start = Math.max(0, current.start - radius);
    else if (action === 'later')
        current.end = Math.min(raw.length, current.end + radius);
    else {
        current.start = Math.max(0, hit - radius);
        current.end = Math.min(raw.length, hit + query.length + radius);
    }
    current.start = contextStart(raw, current.start);
    current.end = contextEnd(raw, current.end);
    status.textContent = `第 ${current.index + 1} / ${current.hits.length} 处 · 原文位置 ${hit + 1} · 前后文位置 ${current.start + 1}–${current.end}（未核验）`;
    root.querySelector('[data-raw-excerpt]').innerHTML = rawExcerpt(raw, current.start, current.end, hit, query);
    root.querySelector('[data-raw-action="earlier"]').disabled = current.start === 0;
    root.querySelector('[data-raw-action="later"]').disabled = current.end === raw.length;
    // Search is synchronous and updates this reader only. No draft, cache, API,
    // business action, or delayed repaint is involved.
    const excerpt = root.querySelector('[data-raw-excerpt]');
    excerpt.querySelector('mark')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
if (typeof document !== 'undefined') {
    document.addEventListener('click', event => { const button = event.target.closest('[data-raw-action]'); if (!button?.dataset.rawAction || button.hasAttribute('disabled'))
        return; const root = button.closest('[data-unverified-report-raw]'); if (root) {
        event.preventDefault();
        act(root, button.dataset.rawAction);
    } });
    document.addEventListener('keydown', event => { const input = event.target; if (event.key !== 'Enter' || input.dataset?.rawQuery === undefined)
        return; const root = input.closest('[data-unverified-report-raw]'); if (root) {
        event.preventDefault();
        act(root, 'find');
    } });
    document.addEventListener('input', event => { const input = event.target; if (input.dataset?.rawQuery === undefined)
        return; const root = input.closest('[data-unverified-report-raw]'); if (!root || original(root) === null)
        return; root.querySelector('[data-raw-match]').hidden = true; root.querySelector('[data-raw-status]').textContent = '关键词已更改，按查找查看新结果。'; for (const name of ['previous', 'next'])
        root.querySelector(`[data-raw-action="${name}"]`).disabled = true; });
}
