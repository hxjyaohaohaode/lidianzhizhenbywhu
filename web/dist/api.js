let csrf = '';
let authGeneration = 0;
export function invalidateContext() { authGeneration++; }
export function setCsrf(value) { if (value !== csrf)
    authGeneration++; csrf = value; }
export class ApiError extends Error {
    status;
    code;
    requestId;
    constructor(message, status, code, requestId) {
        super(message);
        this.status = status;
        this.code = code;
        this.requestId = requestId;
    }
}
export async function api(path, method = 'GET', body, extra = {}) {
    const generation = authGeneration;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const headers = { 'Accept': 'application/json', ...extra };
    if (csrf && method !== 'GET')
        headers['X-CSRF-Token'] = csrf;
    if (body !== undefined && !(body instanceof FormData))
        headers['Content-Type'] = 'application/json';
    try {
        const res = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const type = res.headers.get('content-type') ?? '';
        if (!type.includes('application/json'))
            throw new ApiError('服务返回格式异常，请检查后端地址。', res.status, 'NON_JSON', '');
        const data = await res.json();
        if (generation !== authGeneration)
            throw new ApiError('账户或服务身份已变化，已丢弃旧上下文的迟到响应。', 409, 'STALE_SESSION', '');
        if (!res.ok) {
            const e = data.error ?? {};
            throw new ApiError((e.message ?? '请求失败') + (e.details?.length ? '\n' + e.details.map((x) => x.path + ': ' + x.message).join('\n') : ''), res.status, e.code ?? 'ERROR', data.request_id ?? '');
        }
        return data;
    }
    catch (e) {
        if (e instanceof ApiError)
            throw e;
        if (e instanceof Error && e.name === 'AbortError')
            throw new Error('请求超时。写入可能已被服务端接收，请刷新状态后确认；不会自动重复提交。');
        throw new Error('无法连接服务。当前输入仍在页面，请检查网络后重试。');
    }
    finally {
        clearTimeout(timeout);
    }
}
export const workspace = (path, method = 'GET', body) => api('/workspace' + path, method, body);
