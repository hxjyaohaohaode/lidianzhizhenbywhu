/** Native SSE first. Polling is explicitly labelled, bounded, and never retries writes. */
import { api, workspace, ApiError, contextGuard } from './api.js';
export class RunLive {
    id;
    receive;
    done;
    label;
    stream = null;
    timer = null;
    disposed = false;
    started = false;
    busy = false;
    cursor = 0;
    failures = 0;
    pending = false;
    pendingFinal = false;
    currentContext = contextGuard();
    visible = () => { if (!document.hidden)
        void this.refresh(); };
    constructor(id, receive, done, label) {
        this.id = id;
        this.receive = receive;
        this.done = done;
        this.label = label;
    }
    start() {
        if (!this.active() || this.started)
            return;
        this.started = true;
        document.addEventListener('visibilitychange', this.visible);
        try {
            const stream = this.stream = new EventSource('/api/runs/' + encodeURIComponent(this.id) + '/events?after=' + this.cursor, { withCredentials: true });
            const current = () => this.stream === stream && this.active();
            stream.onopen = () => { if (current())
                this.label('实时事件连接已建立'); };
            stream.addEventListener('trace', (event) => { if (!current())
                return; try {
                const value = JSON.parse(event.data);
                if (!Number.isSafeInteger(value?.seq) || value.seq < 1)
                    throw Error('invalid event cursor');
                if (value.seq > this.cursor) {
                    this.cursor = value.seq;
                    void this.refresh();
                }
            }
            catch {
                this.poll('事件格式异常，改为状态轮询');
            } });
            stream.addEventListener('end', () => { if (current())
                void this.refresh(true); });
            stream.addEventListener('auth_expired', () => { if (!current())
                return; this.dispose(); this.label('登录已过期；不会继续读取记录'); });
            stream.onerror = () => { if (current())
                this.poll('实时连接暂不可用，正在状态轮询'); };
            // Initial snapshot closes the gap between rendering and subscribing.
            void this.refresh();
        }
        catch {
            this.poll('当前环境不支持实时连接，正在状态轮询');
        }
    }
    active() { if (this.disposed)
        return false; if (!this.currentContext()) {
        this.dispose();
        return false;
    } return true; }
    poll(message) { if (!this.active())
        return; this.stream?.close(); this.stream = null; this.label(message); if (this.timer)
        clearTimeout(this.timer); this.timer = setTimeout(() => void this.refresh(), Math.min(12000, 1500 * 2 ** this.failures)); }
    async refresh(final = false) {
        if (!this.active())
            return;
        if (this.busy) {
            this.pending = true;
            this.pendingFinal = this.pendingFinal || final;
            return;
        }
        if (document.hidden && !final) {
            if (!this.stream)
                this.poll('页面在后台，降低状态轮询频率');
            return;
        }
        this.busy = true;
        try {
            const [runtime, events] = await Promise.all([workspace('/runs/' + this.id + '/runtime'), api('/runs/' + this.id + '/trace')]);
            if (!this.active())
                return;
            if (!Array.isArray(events.items) || events.items.some((e) => !Number.isSafeInteger(e?.seq) || e.seq < 1))
                throw Error('invalid trace cursor');
            this.failures = 0;
            for (const event of events.items)
                this.cursor = Math.max(this.cursor, event.seq);
            this.receive(runtime, events.items);
            if (['succeeded', 'degraded', 'failed', 'cancelled', 'paused', 'interrupted'].includes(runtime.state)) {
                this.dispose();
                this.done();
                return;
            }
        }
        catch (e) {
            if (!this.active())
                return;
            if (e instanceof ApiError && (e.status === 401 || e.code === 'STALE_SESSION')) {
                this.dispose();
                this.label('登录上下文已失效，已停止读取；不会显示旧账户的迟到结果');
                return;
            }
            if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
                this.dispose();
                this.label('此执行记录已删除或不再可访问，已停止读取');
                return;
            }
            this.failures++;
            this.stream?.close();
            this.stream = null;
            this.label('读取暂未完成；保留已有状态，未当作成功');
        }
        finally {
            this.busy = false;
            if (!this.disposed && this.pending) {
                const last = this.pendingFinal;
                this.pending = false;
                this.pendingFinal = false;
                void this.refresh(last);
            }
            else if (!this.disposed && !this.stream)
                this.poll(this.failures ? '连接异常，已延长状态重试间隔' : '状态轮询 · 不会重复提交任务');
        }
    }
    dispose() { this.disposed = true; document.removeEventListener('visibilitychange', this.visible); this.pending = false; this.pendingFinal = false; this.stream?.close(); this.stream = null; if (this.timer)
        clearTimeout(this.timer); this.timer = null; }
}
