/* eslint-disable react-refresh/only-export-components */
import React, { useState, useEffect, useCallback } from "react";
import { fetchPortalAuditReport, type PortalAuditReport } from "../api.js";
import {
  type AuditPanelState,
  getAuditStatusLabel,
  getAuditStatusClassName,
  getAuditDriverStatusLabel,
  getAuditDriverStatusClassName,
  getAuditFindingSeverityLabel,
  getAuditFindingSeverityClassName,
  formatCompetitiveTimestamp,
} from "../utils/helpers.js";

export function usePortalAuditReport(role: "enterprise" | "investor", isEnabled: boolean, userId: string | null): AuditPanelState {
  const [report, setReport] = useState<PortalAuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const nextReport = await fetchPortalAuditReport(role, userId);
      setReport(nextReport);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "双端审计报告加载失败。");
    } finally {
      setLoading(false);
    }
  }, [role, userId]);

  useEffect(() => {
    if (!isEnabled || !userId || report || loading || error) return;
    void loadReport();
  }, [error, isEnabled, loadReport, loading, report, userId]);

  return { report, loading, error, reload: loadReport };
}

export function AuditInlineBanner({ state }: { state: AuditPanelState }) {
  const { report, loading, error } = state;
  if (loading && !report) return <div className="audit-inline-banner">正在同步双端审计状态</div>;
  if (error && !report) return <div className="audit-inline-banner warning">双端审计同步失败：{error}</div>;
  if (!report) return null;

  const highlightedChannels = report.channels.filter((channel) => channel.affectsPersonalization && channel.status !== "real");
  const bannerChannels = (highlightedChannels.length > 0 ? highlightedChannels : report.channels.filter((channel) => channel.status !== "real")).slice(0, 3);

  return (
    <div className="audit-inline-banner">
      <div className="audit-inline-kicker">{report.roleLabel}审计提示</div>
      <div className="audit-inline-summary">{report.summary}</div>
      <div className="audit-inline-chips">
        {bannerChannels.map((channel) => (
          <span key={channel.id} className={`audit-pill ${getAuditStatusClassName(channel.status)}`}>
            {channel.label} · {getAuditStatusLabel(channel.status)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CompetitiveBaselinePanel({
  state,
  compactTitle,
}: {
  state: AuditPanelState;
  compactTitle: string;
}) {
  const { report, loading, error, reload } = state;
  const highlightedFindings = report?.findings.slice(0, 3) ?? [];
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <section className="home-utility-card competitive-panel-card competitive-panel-compact">
      <div className="home-utility-head">
        <div>
          <div className="home-utility-badge">双端审计</div>
          <h4>{compactTitle}</h4>
        </div>
        <button type="button" className="home-inline-action" onClick={reload} disabled={loading}>
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>
      <p className="competitive-panel-copy">
        {report ? report.summary : "直接展示双端个性化审计的四态链路状态，避免把模拟、降级或占位能力误读为真实接入。"}
      </p>
      {loading && !report && <div className="competitive-panel-empty">正在加载双端审计报告…</div>}
      {error && !report && (
        <div className="competitive-panel-error">
          <span>{error}</span>
          <button type="button" className="bt bgh" onClick={reload}>重试加载</button>
        </div>
      )}
      {report && (
        <>
          <div className="competitive-summary-grid compact">
            <div className="competitive-summary-card"><span>真实接入</span><strong className="status-good">{report.statusBreakdown.real}</strong></div>
            <div className="competitive-summary-card"><span>模拟演示</span><strong>{report.statusBreakdown.simulated}</strong></div>
            <div className="competitive-summary-card"><span>降级可用</span><strong>{report.statusBreakdown.degraded}</strong></div>
            <div className="competitive-summary-card"><span>预留占位</span><strong>{report.statusBreakdown.placeholder}</strong></div>
          </div>
          {report.pages.length > 0 && (
            <div className="audit-focus-list compact">
              {report.pages.map((page) => (<span key={page.pageId} className="audit-focus-tag">{page.pageName}</span>))}
            </div>
          )}
          <div className="audit-accordion">
            {report.drivers.length > 0 && (
              <div className={`audit-accordion-item ${expandedSection === "drivers" ? "expanded" : ""}`}>
                <button type="button" className="audit-accordion-header" onClick={() => toggleSection("drivers")}>
                  <span className="audit-accordion-title"><strong>个性化驱动</strong><em>{report.drivers.length}</em></span>
                  <span className="audit-accordion-icon">{expandedSection === "drivers" ? "收起" : "展开"}</span>
                </button>
                {expandedSection === "drivers" && (
                  <div className="audit-accordion-content">
                    <div className="audit-driver-list compact">
                      {report.drivers.map((driver) => (
                        <div key={driver.driverId} className="audit-driver-item">
                          <div className="audit-driver-top"><strong>{driver.label}</strong><span className={`audit-pill mini ${getAuditDriverStatusClassName(driver.status)}`}>{getAuditDriverStatusLabel(driver.status)}</span></div>
                          <p>{driver.effectSummary}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {report.channels.length > 0 && (
              <div className={`audit-accordion-item ${expandedSection === "channels" ? "expanded" : ""}`}>
                <button type="button" className="audit-accordion-header" onClick={() => toggleSection("channels")}>
                  <span className="audit-accordion-title"><strong>链路接入</strong><em>{report.channels.length}</em></span>
                  <span className="audit-accordion-icon">{expandedSection === "channels" ? "收起" : "展开"}</span>
                </button>
                {expandedSection === "channels" && (
                  <div className="audit-accordion-content">
                    <div className="audit-channel-list compact">
                      {report.channels.map((channel) => (
                        <div key={channel.id} className="audit-channel-item">
                          <div className="audit-channel-top"><strong>{channel.label}</strong><span className={`audit-pill mini ${getAuditStatusClassName(channel.status)}`}>{getAuditStatusLabel(channel.status)}</span></div>
                          <p>{channel.purpose}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {highlightedFindings.length > 0 && (
              <div className={`audit-accordion-item ${expandedSection === "findings" ? "expanded" : ""}`}>
                <button type="button" className="audit-accordion-header" onClick={() => toggleSection("findings")}>
                  <span className="audit-accordion-title"><strong>审计发现</strong><em>{report.findings.length}</em></span>
                  <span className="audit-accordion-icon">{expandedSection === "findings" ? "收起" : "展开"}</span>
                </button>
                {expandedSection === "findings" && (
                  <div className="audit-accordion-content">
                    <div className="competitive-scenario-list compact">
                      {highlightedFindings.map((finding) => (
                        <div key={finding.findingId} className="competitive-scenario-item">
                          <div className="competitive-scenario-top"><strong>{finding.title}</strong><span className={`audit-pill mini ${getAuditFindingSeverityClassName(finding.severity)}`}>{getAuditFindingSeverityLabel(finding.severity)}</span></div>
                          <p>{finding.summary}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {report.releaseGates.length > 0 && (
              <div className={`audit-accordion-item ${expandedSection === "gates" ? "expanded" : ""}`}>
                <button type="button" className="audit-accordion-header" onClick={() => toggleSection("gates")}>
                  <span className="audit-accordion-title"><strong>发布门槛</strong><em>{report.releaseGates.length}</em></span>
                  <span className="audit-accordion-icon">{expandedSection === "gates" ? "收起" : "展开"}</span>
                </button>
                {expandedSection === "gates" && (
                  <div className="audit-accordion-content">
                    <div className="audit-gates-list">
                      {report.releaseGates.map((gate: string, idx: number) => (<div key={idx} className="audit-gate-item"><span className="audit-gate-check">✓</span><span>{gate}</span></div>))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="audit-footer"><span>更新时间：{formatCompetitiveTimestamp(report.generatedAt)}</span></div>
        </>
      )}
    </section>
  );
}
