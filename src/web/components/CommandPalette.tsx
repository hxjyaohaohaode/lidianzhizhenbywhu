import React, { useState, useEffect, useRef } from "react";
import type { UserProfileResponse } from "../../shared/business.js";

export function CommandPalette({ isOpen, onClose, userProfile }: { isOpen: boolean; onClose: () => void; userProfile: UserProfileResponse | null }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setQuery("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const sessions = userProfile?.recentSessions || [];
  const memories = userProfile?.recentMemories || [];
  const filteredSessions = sessions.filter(s => s.summary?.toLowerCase().includes(query.toLowerCase()) || s.enterpriseName?.toLowerCase().includes(query.toLowerCase()));
  const filteredMemories = memories.filter(m => m.summary.toLowerCase().includes(query.toLowerCase()) || (m.details && m.details.toLowerCase().includes(query.toLowerCase())));

  return (
    <div className="cmd-palette-overlay" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh' }}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()} style={{ background: 'var(--bg2)', width: '600px', borderRadius: '12px', border: '1px solid var(--border)', boxShadow: '0 20px 40px rgba(0,0,0,0.4)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '60vh' }}>
        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索节点或会话 (Cmd+K / Ctrl+K)..." style={{ width: '100%', padding: '16px 24px', fontSize: '18px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--t1)', outline: 'none' }} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          {query && filteredSessions.length === 0 && filteredMemories.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--t3)' }}>没有找到匹配的结果</div>
          )}
          {filteredSessions.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--t3)', padding: '8px 12px', textTransform: 'uppercase', fontWeight: 600 }}>会话 (Sessions)</div>
              {filteredSessions.map(s => (
                <div key={s.sessionId} className="cmd-item" onClick={onClose} style={{ padding: '12px', borderRadius: '8px', cursor: 'pointer', transition: 'background 0.2s', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontWeight: 500, color: 'var(--t1)' }}>{s.enterpriseName || s.sessionId}</div>
                  <div style={{ fontSize: '13px', color: 'var(--t3)', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.summary}</div>
                </div>
              ))}
            </div>
          )}
          {filteredMemories.length > 0 && (
            <div>
              <div style={{ fontSize: '12px', color: 'var(--t3)', padding: '8px 12px', textTransform: 'uppercase', fontWeight: 600 }}>记忆节点 (Nodes)</div>
              {filteredMemories.map(m => (
                <div key={m.id} className="cmd-item" onClick={onClose} style={{ padding: '12px', borderRadius: '8px', cursor: 'pointer', transition: 'background 0.2s', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontWeight: 500, color: 'var(--t1)' }}>{m.summary}</div>
                  <div style={{ fontSize: '13px', color: 'var(--t3)', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.details || m.tags?.join(' ')}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
