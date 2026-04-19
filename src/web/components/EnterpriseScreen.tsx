import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  analyzeEnterprise,
  collectEnterpriseData,
  createEnterpriseSession,
  deleteCurrentEnterpriseSession,
  deleteEnterpriseSessions,
  fetchEnterpriseSessionContext,
  fetchEnterpriseSessions,
  streamEnterpriseAnalysis,
  uploadEnterpriseAttachment,
  type EnterpriseAnalysisResponse,
} from "../api.js";
import {
  type EnterpriseOnboardingDraft,
} from "../../shared/types.js";
import type {
  EditableBusinessInfo,
  EnterpriseAnalysisRequest,
  EnterpriseAnalysisStreamEvent,
  AnalysisTimelineEntry,
  SessionAttachment,
  SessionContext,
  SessionHistorySummary,
  UserProfileResponse,
} from "../../shared/business.js";
import { UnitSelector } from "../UnitSelector.js";
import { DataFormatter, type UnitPreferences } from "../data-formatter.js";
import { buildEnterpriseVisualization } from "../chart-data.js";
import { renderWidgetByKind } from '../chart-system.js';
import type { VisualizationWidget } from "../../shared/business.js";
import { MessageWithCharts } from "../chart-renderer.js";
import { DQIGMPSPanelsContainer, extractMathAnalysisFromResponse } from "../dqi-gmps-panels.js";
import { useAppContext } from "../context/AppContext.js";
import { ChartWithInsightPanel } from "./ChartWithInsightPanel.js";
import {
  type AuditPanelState,
  type AppTab,
  type EnterpriseWorkbenchMode,
  type WorkbenchMessage,
  classifyQueryIntent,
  dedupeStrings,
  ENTERPRISE_BASE_INFO_GROUPS,
  ENTERPRISE_MODE_OPTIONS,
  getEnterpriseModeOption,
  createWorkbenchId,
  formatClockTime,
  formatSessionTime,
  formatAbsoluteTime,
  getSessionTitle,
  buildHistoryFallback,
  readFileContent,
  DEFAULT_UPLOAD_DRAFT,
  mergeTimelineEntries,
  EMPTY_WORKBENCH_MESSAGE,
  DEFAULT_ENTERPRISE_NAME,
} from "../utils/helpers.js";
import { usePortalAuditReport } from "./CompetitiveBaselinePanel.js";
import { buildEnterpriseCollectionPayload } from "../utils/enterprise-payload.js";
import { EditableBaseInfoPanel } from "./EditableBaseInfoPanel.js";
import { AuditInlineBanner } from "./CompetitiveBaselinePanel.js";
import { Icon } from "./Icon.js";

type EnterpriseScreenProps = {
  tab: AppTab;
  setTab: (tab: AppTab) => void;
  openMem: () => void;
  isDark: boolean;
  setIsDark: (isDark: boolean) => void;
  themeIndex: number;
  setThemeIndex: (themeIndex: number) => void;
  currentUserId: string | null;
  enterpriseOnboarding: EnterpriseOnboardingDraft;
  userProfile: UserProfileResponse | null;
  refreshUserProfile: (userId?: string) => Promise<UserProfileResponse | null>;
  saveEnterpriseBaseInfo: (baseInfo: EditableBusinessInfo) => Promise<void>;
  unitPrefs: UnitPreferences;
  dataFormatter: DataFormatter;
  onUnitPrefsChange: (prefs: UnitPreferences) => void;
  isRefreshing: boolean;
  lastDataRefreshAt: string;
  onRefreshData: () => void;
  refreshInterval: number;
  onRefreshIntervalChange: (ms: number) => void;
  chartThemeKey: number;
};

type EntSetProps = {
  isActive: boolean;
  openMem: () => void;
  isDark: boolean;
  setIsDark: (isDark: boolean) => void;
  themeIndex: number;
  setThemeIndex: (themeIndex: number) => void;
};

function ThemeColorButton({ index, themeIndex, setThemeIndex }: { index: number; themeIndex: number; setThemeIndex: (i: number) => void }) {
  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899"];
  const labels = ["蓝紫", "青绿", "暖金", "粉紫"];
  return (
    <button type="button" onClick={() => setThemeIndex(index)} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderRadius: "12px", border: themeIndex === index ? "2px solid var(--blue)" : "1px solid var(--line)", background: themeIndex === index ? "rgba(59,130,246,0.1)" : "var(--gl)", cursor: "pointer", color: "var(--t1)", fontSize: "13px" }}>
      <span style={{ width: "16px", height: "16px", borderRadius: "50%", background: colors[index] }}></span>
      {labels[index]}
    </button>
  );
}

function ThemeModeSwitch({ isDark, setIsDark }: { isDark: boolean; setIsDark: (isDark: boolean) => void }) {
  return (
    <div style={{ display: "flex", gap: "8px" }}>
      <button type="button" onClick={() => setIsDark(true)} style={{ padding: "8px 16px", borderRadius: "12px", border: isDark ? "2px solid var(--blue)" : "1px solid var(--line)", background: isDark ? "rgba(59,130,246,0.1)" : "var(--gl)", cursor: "pointer", color: "var(--t1)", fontSize: "13px" }}>🌙 深色</button>
      <button type="button" onClick={() => setIsDark(false)} style={{ padding: "8px 16px", borderRadius: "12px", border: !isDark ? "2px solid var(--blue)" : "1px solid var(--line)", background: !isDark ? "rgba(59,130,246,0.1)" : "var(--gl)", cursor: "pointer", color: "var(--t1)", fontSize: "13px" }}>☀️ 浅色</button>
    </div>
  );
}

export function AppEnterpriseScreen({
  tab,
  setTab,
  openMem,
  isDark,
  setIsDark,
  themeIndex,
  setThemeIndex,
  currentUserId,
  enterpriseOnboarding,
  userProfile,
  refreshUserProfile,
  saveEnterpriseBaseInfo,
  unitPrefs,
  dataFormatter,
  onUnitPrefsChange,
  isRefreshing,
  lastDataRefreshAt,
  onRefreshData,
  refreshInterval,
  onRefreshIntervalChange,
}: EnterpriseScreenProps) {
  const ctx = useAppContext();
  const titles = { home: '首页', ana: '分析', set: '设置' };
  const enterpriseVisualization = useMemo(
    () => buildEnterpriseVisualization(
      userProfile,
      enterpriseOnboarding,
      undefined,
      undefined,
      unitPrefs,
    ),
    [userProfile, enterpriseOnboarding, unitPrefs, ctx.industryDataVersion]
  );
  const auditPanelState = usePortalAuditReport("enterprise", tab === "home" || tab === "ana", currentUserId);

  return (
    <div className="al">
      <nav className="nv">
        <div className="nl">
          <img src="/images/logo.png" alt="锂智诊断" className="nav-logo-img" width="40" height="40" />
        </div>
        <div className={`ni ${tab === 'home' ? 'on' : ''}`} onClick={() => setTab('home')}><Icon name="home" size={20} hoverable active={tab === 'home'} /><span className="tp">首页</span></div>
        <div className={`ni ${tab === 'ana' ? 'on' : ''}`} onClick={() => setTab('ana')}><Icon name="analysis" size={20} hoverable active={tab === 'ana'} /><span className="tp">分析</span></div>
        <div className={`ni ${tab === 'set' ? 'on' : ''}`} onClick={() => setTab('set')}><Icon name="settings" size={20} hoverable active={tab === 'set'} /><span className="tp">设置</span></div>
        <div className="nsp"></div>
      </nav>
      <div className="am">
        <div className="at">
          <span className="system-title">锂电智诊——锂电池企业经营质量与毛利承压智能诊断系统设计</span>
          <div className="atr">
            <UnitSelector onChange={onUnitPrefsChange} />
            <button className="ab" onClick={onRefreshData} disabled={isRefreshing} title={isRefreshing ? "刷新中..." : lastDataRefreshAt ? `上次刷新: ${lastDataRefreshAt}` : "刷新数据"} style={isRefreshing ? { opacity: 0.5, cursor: 'wait' } : undefined}>
              <span style={{ display: 'inline-block', animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }}>🔄</span>
            </button>
            <button className="ab" onClick={() => window.print()} title="导出报告">📄</button>
          </div>
        </div>
        <div className="ac">
          <EntHome isActive={tab === 'home'} visualization={enterpriseVisualization} dataFormatter={dataFormatter} openWorkbench={() => setTab("ana")} openSettings={() => setTab("set")} onRefreshData={onRefreshData} />
          <EntAna isActive={tab === 'ana'} currentUserId={currentUserId} userProfile={userProfile} enterpriseOnboarding={enterpriseOnboarding} refreshUserProfile={refreshUserProfile} openHome={() => setTab("home")} openSettings={() => setTab("set")} auditPanelState={auditPanelState} />
          <EntSet isActive={tab === 'set'} openMem={openMem} isDark={isDark} setIsDark={setIsDark} themeIndex={themeIndex} setThemeIndex={setThemeIndex} userProfile={userProfile} saveEnterpriseBaseInfo={saveEnterpriseBaseInfo} unitPrefs={unitPrefs} onUnitPrefsChange={onUnitPrefsChange} refreshInterval={refreshInterval} onRefreshIntervalChange={onRefreshIntervalChange} />
        </div>
      </div>
    </div>
  );
}

function EntHome({
  isActive,
  visualization,
  dataFormatter,
  openWorkbench,
  onRefreshData,
}: {
  isActive: boolean;
  visualization: ReturnType<typeof buildEnterpriseVisualization>;
  dataFormatter: DataFormatter;
  openWorkbench: () => void;
  openSettings: () => void;
  onRefreshData?: () => void;
}) {
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [refreshSpinning, setRefreshSpinning] = useState(false);
  const [selectedInsight, setSelectedInsight] = useState<{ widgetId: string; insight: any } | null>(null);

  useEffect(() => {
    setLastRefresh(new Date());
  }, [visualization]);

  const formatRefreshTime = (d: Date) => {
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const handleManualRefresh = () => {
    setRefreshSpinning(true);
    onRefreshData?.();
    setLastRefresh(new Date());
    setTimeout(() => setRefreshSpinning(false), 600);
  };

  const handleInsightChange = useCallback((widgetId: string, insight: any) => {
    setSelectedInsight(insight ? { widgetId, insight } : null);
  }, []);

  const homeWidgets = visualization.sections.find(s => s.page === 'home')?.widgets ?? [];

  const radarWidget = homeWidgets.find(w => w.id === 'enterprise-radar' && w.kind === 'radarChart') as
    | Extract<VisualizationWidget, { kind: 'radarChart' }>
    | undefined;
  const lineWidget = homeWidgets.find(w => w.id === 'enterprise-line' && w.kind === 'lineChart') as
    | Extract<VisualizationWidget, { kind: 'lineChart' }>
    | undefined;

  const gmpsDims = radarWidget?.dimensions.filter(d =>
    ['材料成本冲击', '产销负荷', '外部风险', '现金流安全'].includes(d.dimension),
  ) ?? [];
  const dqiDims = radarWidget?.dimensions.filter(d =>
    ['盈利能力', '成长能力', '现金流质量', '毛利率结果'].includes(d.dimension),
  ) ?? [];

  const gmpsValue = gmpsDims.length > 0
    ? (gmpsDims.reduce((s, d) => s + d.current, 0) / gmpsDims.length).toFixed(1)
    : '--';
  const gmpsStatus: 'good' | 'watch' | 'risk' =
    Number(gmpsValue) >= 75 ? 'good' : Number(gmpsValue) >= 55 ? 'watch' : 'risk';

  const dqiValue = dqiDims.length > 0
    ? (dqiDims.reduce((s, d) => s + d.current, 0) / dqiDims.length).toFixed(1)
    : '--';
  const dqiStatus: 'good' | 'watch' | 'risk' =
    Number(dqiValue) >= 80 ? 'good' : Number(dqiValue) >= 60 ? 'watch' : 'risk';

  const lastLineDatum = lineWidget?.data[lineWidget.data.length - 1];
  const prevLineDatum = lineWidget?.data[lineWidget.data.length - 2];
  const grossMarginDisplay = lastLineDatum?.displayValue ?? '--%';
  const grossMarginDelta = lastLineDatum && prevLineDatum
    ? lastLineDatum.value - prevLineDatum.value
    : 0;
  const grossMarginDeltaClass: 'up' | 'down' | 'flat' =
    grossMarginDelta > 0.5 ? 'up' : grossMarginDelta < -0.5 ? 'down' : 'flat';

  const cashFlowDim = radarWidget?.dimensions.find(d => d.dimension === '现金流安全');
  const cashFlowDisplay = cashFlowDim?.displayCurrent ?? '--';
  const cashFlowValue = cashFlowDim?.current ?? 0;
  const cashFlowStatus: 'good' | 'watch' | 'risk' =
    cashFlowValue >= 80 ? 'good' : cashFlowValue >= 60 ? 'watch' : 'risk';

  const allChartDefs: { id: string; title: string }[] = [
    { id: 'enterprise-radar', title: '经营质量画像' },
    { id: 'enterprise-waterfall', title: '毛利承压分解' },
    { id: 'enterprise-box-plot', title: '毛利率分布' },
    { id: 'enterprise-heatmap-viz', title: '经营质量热力图' },
    { id: 'enterprise-line', title: '毛利率趋势' },
    { id: 'enterprise-scatter', title: '毛利率营收关系' },
    { id: 'enterprise-sankey', title: '成本流向' },
  ];

  const seenIds = new Set<string>();
  const uniqueChartDefs = allChartDefs.filter(d => {
    if (seenIds.has(d.id)) return false;
    seenIds.add(d.id);
    return true;
  });

  return (
    <div className={`pg ${isActive ? 'on' : ''}`}>
      <div className="homepage-layout">
        <div className="homepage-refresh-bar">
          <span className="homepage-refresh-time">最近刷新 {formatRefreshTime(lastRefresh)}</span>
          <button className={`homepage-refresh-btn${refreshSpinning ? ' spinning' : ''}`} onClick={handleManualRefresh}>↻</button>
        </div>
        <div className="homepage-ai-search-box" onClick={openWorkbench}>
          <span className="ai-search-icon">✨</span>
          <span className="ai-search-placeholder">点击AI分析师，询问任何关于企业经营质量与毛利承压问题...</span>
          <span className="ai-search-action">点击跳转 →</span>
        </div>
        <div className="homepage-metrics-row">
          <div className="homepage-metric-card">
            <span className="homepage-metric-label">承压指数</span>
            <span className="homepage-metric-value">
              {gmpsValue}
              <span className={`homepage-metric-dot ${gmpsStatus}`} />
            </span>
          </div>
          <div className="homepage-metric-card">
            <span className="homepage-metric-label">经营质量</span>
            <span className="homepage-metric-value">
              {dqiValue}
              <span className={`homepage-metric-dot ${dqiStatus}`} />
            </span>
          </div>
          <div className="homepage-metric-card">
            <span className="homepage-metric-label">毛利率</span>
            <span className="homepage-metric-value">
              {grossMarginDisplay}
              <span className={`homepage-metric-dot ${grossMarginDelta > 0.5 ? 'good' : grossMarginDelta < -0.5 ? 'risk' : 'watch'}`} />
            </span>
          </div>
          <div className="homepage-metric-card">
            <span className="homepage-metric-label">现金流</span>
            <span className="homepage-metric-value">
              {cashFlowDisplay}
              <span className={`homepage-metric-dot ${cashFlowStatus}`} />
            </span>
          </div>
        </div>

        <div className="homepage-all-charts">
          {uniqueChartDefs.map(def => {
            const widget = homeWidgets.find(w => w.id === def.id);
            if (!widget) return null;
            return (
              <div key={def.id} className="homepage-chart-cell homepage-chart-with-insight">
                <span className="homepage-chart-title">{def.title}</span>
                <ChartWithInsightPanel
                  widget={widget}
                  selectedInsight={selectedInsight?.widgetId === def.id ? selectedInsight.insight : null}
                  onInsightChange={(insight) => handleInsightChange(def.id, insight)}
                >
                  {renderWidgetByKind(widget)}
                </ChartWithInsightPanel>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function buildEnterpriseAnalysisRequestPayload(
  userId: string,
  sessionId: string,
  query: string,
  draft: EnterpriseOnboardingDraft,
  userProfile?: UserProfileResponse | null,
  complexity?: string,
  focusMode?: string,
): EnterpriseAnalysisRequest {
  const collectionPayload = buildEnterpriseCollectionPayload(userId, draft, userProfile);
  return {
    role: "enterprise",
    userId,
    sessionId,
    enterpriseName: collectionPayload.enterpriseName,
    query,
    focusMode: (focusMode as "operationalDiagnosis" | "deepDive") ?? (/深度|拆解|根因|详细|复盘/.test(query) ? "deepDive" : "operationalDiagnosis"),
    grossMarginInput: collectionPayload.grossMarginInput,
    operatingQualityInput: collectionPayload.operatingQualityInput,
    industryContext: collectionPayload.industryContext,
    memoryNotes: dedupeStrings([
      ...(collectionPayload.notes ?? []),
      ...(userProfile?.profile.preferences.attentionTags ?? []),
    ]).slice(0, 8),
    complexity: (complexity as "simple" | "moderate" | "full") ?? "moderate",
  };
}

const GMPS_FEATURE_META: Record<string, { name: string; weight: number; dim: string; dimWeight: number }> = {
  gpmYoy: { name: "毛利率同比", weight: 0.14, dim: "A.毛利率结果", dimWeight: 0.14 },
  unitCostYoy: { name: "单位成本同比", weight: 0.12, dim: "B.材料成本冲击", dimWeight: 0.12 },
  mfgCostRatio: { name: "制造费用占比", weight: 0.12, dim: "C.产销负荷分摊", dimWeight: 0.10 },
  revCostGap: { name: "营收成本增速差", weight: 0.11, dim: "A.毛利率结果", dimWeight: 0.14 },
  saleProdRatio: { name: "产销率", weight: 0.10, dim: "C.产销负荷分摊", dimWeight: 0.10 },
  liPriceYoy: { name: "碳酸锂价格同比", weight: 0.10, dim: "B.材料成本冲击", dimWeight: 0.12 },
  invYoy: { name: "库存同比", weight: 0.09, dim: "C.产销负荷分摊", dimWeight: 0.10 },
  cfoRatio: { name: "现金流比率", weight: 0.08, dim: "E.现金流安全垫", dimWeight: 0.08 },
  lev: { name: "资产负债率", weight: 0.07, dim: "D.外部风险传导", dimWeight: 0.07 },
  indVol: { name: "行业指数波动率", weight: 0.07, dim: "D.外部风险传导", dimWeight: 0.07 },
};

function classifyPressureLevel(score: number): { label: string; emoji: string } {
  if (score >= 75) return { label: "低压", emoji: "🟢" };
  if (score >= 55) return { label: "中压", emoji: "🟡" };
  return { label: "高压", emoji: "🔴" };
}

function classifyDQIDimension(ratio: number): { label: string; emoji: string } {
  if (ratio > 1.05) return { label: "改善", emoji: "🟢" };
  if (ratio >= 0.95) return { label: "稳定", emoji: "🔵" };
  return { label: "恶化", emoji: "🔴" };
}

function formatEnterpriseAssistantResponse(
  response: EnterpriseAnalysisResponse,
  userProfile?: UserProfileResponse | null,
  enterpriseOnboarding?: EnterpriseOnboardingDraft,
) {
  const mathAnalysis = extractMathAnalysisFromResponse(response);
  const gmpsModel = mathAnalysis?.gmpsModel;
  const dqiModel = mathAnalysis?.dqiModel;
  const grossMargin = mathAnalysis?.grossMargin;
  const operatingQuality = mathAnalysis?.operatingQuality;

  const personalization = (response as EnterpriseAnalysisResponse & {
    personalization?: { summary?: string; nextTasks?: string[] };
  }).personalization;

  const sections: string[] = [];

  const enterpriseName = enterpriseOnboarding?.enterpriseName || "贵企业";
  const attentionTags = userProfile?.profile?.preferences?.attentionTags ?? [];
  const memoryNotes = response.diagnostic?.memorySnapshot?.map((m: { summary: string }) => m.summary).filter(Boolean) ?? [];

  if (attentionTags.length > 0 || personalization?.summary) {
    sections.push("📋 个性化摘要");
    if (personalization?.summary) sections.push(personalization.summary);
    if (attentionTags.length > 0) sections.push(`关注标签：${attentionTags.join("、")}`);
    sections.push("");
  }

  if (gmpsModel) {
    const dims = gmpsModel.dimensionScores;
    const gmpsQuality = Math.round(100 - gmpsModel.gmps);
    const gmpsPressure = classifyPressureLevel(gmpsQuality);

    const dimEntries: Array<{ label: string; score: number; weight: number }> = [
      { label: "A.毛利率结果", score: Math.round(100 - dims.A_毛利率结果), weight: 0.14 },
      { label: "B.材料成本冲击", score: Math.round(100 - dims.B_材料成本冲击), weight: 0.12 },
      { label: "C.产销负荷分摊", score: Math.round(100 - dims.C_产销负荷), weight: 0.10 },
      { label: "D.外部风险传导", score: Math.round(100 - dims.D_外部风险), weight: 0.07 },
      { label: "E.现金流安全垫", score: Math.round(100 - dims.E_现金流安全), weight: 0.08 },
    ];

    sections.push("📊 GMPS 毛利承压评估");
    for (const dim of dimEntries) {
      const p = classifyPressureLevel(dim.score);
      sections.push(`${dim.label}: ${dim.score}分 (权重${dim.weight.toFixed(2)}) — ${p.emoji} ${p.label}`);
    }
    sections.push(`综合承压指数: ${gmpsQuality} — ${gmpsPressure.emoji} ${gmpsPressure.label}`);
    sections.push("");
  } else if (grossMargin) {
    const gmScore = grossMargin.score;
    const gmPressure = classifyPressureLevel(gmScore);
    sections.push("📊 毛利承压评估（基础模型）");
    sections.push(`综合评分: ${gmScore}分 — ${gmPressure.emoji} ${gmPressure.label}`);
    if (grossMargin.keyFindings?.length) {
      sections.push(grossMargin.keyFindings.join("\n"));
    }
    sections.push("");
  }

  if (dqiModel) {
    const roeRatio = dqiModel.metrics.roeRatio;
    const growthRatio = dqiModel.metrics.growthRatio;
    const ocfRatioChange = dqiModel.metrics.ocfRatioChange;

    const profitScore = Math.round(Math.min(Math.max(roeRatio * 50, 0), 100));
    const growthScore = Math.round(Math.min(Math.max(growthRatio * 50, 0), 100));
    const cashflowScore = Math.round(Math.min(Math.max(ocfRatioChange * 50, 0), 100));
    const dqiOverallScore = Math.round(Math.min(Math.max(dqiModel.dqi * 50, 0), 100));

    sections.push("📈 DQI 经营质量评估");
    sections.push(`盈利能力(w=0.4): ${profitScore}分 — ${classifyDQIDimension(roeRatio).emoji} ${classifyDQIDimension(roeRatio).label}`);
    sections.push(`成长能力(w=0.3): ${growthScore}分 — ${classifyDQIDimension(growthRatio).emoji} ${classifyDQIDimension(growthRatio).label}`);
    sections.push(`现金流质量(w=0.3): ${cashflowScore}分 — ${classifyDQIDimension(ocfRatioChange).emoji} ${classifyDQIDimension(ocfRatioChange).label}`);
    sections.push(`综合经营质量: ${dqiOverallScore} — ${classifyDQIDimension(dqiModel.dqi).emoji} ${classifyDQIDimension(dqiModel.dqi).label}`);
    sections.push("");
  } else if (operatingQuality) {
    const oqScore = operatingQuality.score;
    const oqStatus = oqScore >= 75 ? "🟢 改善" : oqScore >= 55 ? "🔵 稳定" : "🔴 恶化";
    sections.push("📈 经营质量评估（基础模型）");
    sections.push(`综合评分: ${oqScore}分 — ${oqStatus}`);
    if (operatingQuality.keyFindings?.length) {
      sections.push(operatingQuality.keyFindings.join("\n"));
    }
    sections.push("");
  }

  if (gmpsModel?.featureScores) {
    const totalScore = Object.values(gmpsModel.featureScores).reduce((s, v) => s + v, 0);
    const ranked = Object.entries(gmpsModel.featureScores)
      .map(([key, score]) => ({
        key,
        meta: GMPS_FEATURE_META[key] ?? { name: key, weight: 0 },
        contribution: totalScore > 0 ? (score / totalScore) * 100 : 0,
      }))
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 5);

    sections.push("🔑 关键特征贡献度排名");
    ranked.forEach((item, idx) => {
      sections.push(`${idx + 1}. ${item.key} (${item.meta.name}, w=${item.meta.weight.toFixed(2)}): 贡献度 ${item.contribution.toFixed(1)}%`);
    });
    sections.push("");
  }

  sections.push(response.diagnostic.finalAnswer);

  const insightLines = response.highlights.combinedInsights.map((item) => `${item}`).join("\n");
  if (insightLines) {
    sections.push(`\n关键关注：\n${insightLines}`);
  }

  sections.push("");
  sections.push("📐 模型参数说明");
  sections.push("GMPS 10特征变量：");
  const featureList = Object.entries(GMPS_FEATURE_META);
  for (let i = 0; i < featureList.length; i += 2) {
    const [k1, m1] = featureList[i]!;
    const line = `  ${k1} (${m1.name}, w=${m1.weight.toFixed(2)})`;
    if (i + 1 < featureList.length) {
      const [k2, m2] = featureList[i + 1]!;
      sections.push(`${line} | ${k2} (${m2.name}, w=${m2.weight.toFixed(2)})`);
    } else {
      sections.push(line);
    }
  }
  sections.push("压力等级：🟢 低压 ≥75 | 🟡 中压 55-74 | 🔴 高压 <55");
  sections.push("DQI等级：🟢 改善 >1.05 | 🔵 稳定 0.95-1.05 | 🔴 恶化 <0.95");

  if (personalization?.nextTasks?.length) {
    sections.push("");
    sections.push("💡 建议下一步");
    personalization.nextTasks.forEach((task, idx) => {
      sections.push(`${idx + 1}. ${task}`);
    });
  } else {
    sections.push("");
    sections.push("💡 建议下一步");
    if (gmpsModel) {
      const gmpsQ = 100 - gmpsModel.gmps;
      if (gmpsQ < 55) {
        sections.push("1. 深入拆解毛利承压根因，重点关注材料成本与产销匹配");
        sections.push("2. 制定现金流改善方案，评估短期融资需求");
      } else if (gmpsQ < 75) {
        sections.push("1. 跟踪碳酸锂价格走势，评估成本传导能力");
        sections.push("2. 优化产销匹配度，降低库存积压风险");
      } else {
        sections.push("1. 持续监控毛利率变化趋势，保持竞争优势");
        sections.push("2. 关注行业景气度变化，提前布局应对策略");
      }
    } else {
      sections.push("1. 补充企业经营数据以获取更精准的GMPS/DQI诊断");
      sections.push("2. 尝试WHAT-IF推演沙盘，模拟不同经营情景");
    }
  }

  if (memoryNotes.length > 0) {
    sections.push("");
    sections.push("🧠 记忆关联");
    sections.push(`基于您的历史记忆：${memoryNotes.slice(0, 3).join("、")}`);
  }

  return sections.filter((s) => s !== undefined).join("\n");
}

function EntAna({
  isActive,
  currentUserId,
  userProfile,
  enterpriseOnboarding,
  refreshUserProfile,
  openHome,
  openSettings,
  auditPanelState,
}: {
  isActive: boolean;
  currentUserId: string | null;
  userProfile?: UserProfileResponse | null;
  enterpriseOnboarding: EnterpriseOnboardingDraft;
  refreshUserProfile: (userId?: string) => Promise<UserProfileResponse | null>;
  openHome: () => void;
  openSettings: () => void;
  auditPanelState: AuditPanelState;
}) {
  const [mode, setMode] = useState<EnterpriseWorkbenchMode>("operationalDiagnosis");
  const [sessionContext, setSessionContext] = useState<SessionContext | null>(null);
  const [sessionHistory, setSessionHistory] = useState<SessionHistorySummary[]>([]);
  const [messages, setMessages] = useState<WorkbenchMessage[]>([
    {
      id: createWorkbenchId("msg"),
      variant: "assistant",
      time: formatClockTime(),
      content: "👋 您好！我是锂电智诊智能分析助手。\n\n当前工作台已接入企业端真实分析接口。您可以直接提问，系统会结合已采集的经营数据、行业上下文和企业画像返回真实诊断结果",
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressState, setProgressState] = useState<{
    stage: AnalysisTimelineEntry["stage"];
    label: string;
    detail?: string;
    progressPercent: number;
  } | null>(null);
  const [timeline, setTimeline] = useState<AnalysisTimelineEntry[]>([]);
  const [analysisResult, setAnalysisResult] = useState<EnterpriseAnalysisResponse | null>(null);
  const [attachments, setAttachments] = useState<SessionAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDraft, setUploadDraft] = useState(DEFAULT_UPLOAD_DRAFT);
  const [uploading, setUploading] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySelection, setHistorySelection] = useState<string[]>([]);
  const [historyDeleteError, setHistoryDeleteError] = useState<string | null>(null);
  const [deletingHistory, setDeletingHistory] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<SessionHistorySummary | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [compareSessionContext, setCompareSessionContext] = useState<SessionContext | null>(null);
  const [enterpriseSessionId, setEnterpriseSessionId] = useState<string | null>(null);
  const [collectionSummaryText, setCollectionSummaryText] = useState<string | null>(null);
  const collectionBootstrapRef = useRef<string | null>(null);
  const [complexity, setComplexity] = useState<string>("moderate");
  const [liPriceYoy, setLiPriceYoy] = useState<number>(0);
  const [saleProdRatio, setSaleProdRatio] = useState<number>(85);
  const [invYoy, setInvYoy] = useState<number>(0);
  const [cfoRatio, setCfoRatio] = useState<number>(50);
  const msgEndRef = useRef<HTMLDivElement>(null);
  const hasInitializedRef = useRef(false);
  const initializedRef = useRef(false);
  const streamingMessageIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const baseMarginStr = userProfile?.profile?.enterpriseBaseInfo?.["毛利率"];
  const baseMarginValue = (Array.isArray(baseMarginStr) ? baseMarginStr[0] : baseMarginStr) ?? "18.5";
  const baseMargin = parseFloat(baseMarginValue) || 18.5;
  const deltaMargin = (liPriceYoy * 0.10 * 0.3) + ((saleProdRatio - 85) * 0.10 * 0.2) + (invYoy * 0.09 * 0.25) + ((cfoRatio - 50) * 0.08 * 0.15);
  const inferredMargin = baseMargin + deltaMargin;
  const pressureLevel: "低压" | "中压" | "高压" =
    inferredMargin >= baseMargin ? "低压" :
    inferredMargin >= baseMargin * 0.85 ? "中压" : "高压";
  const pressureColor = pressureLevel === "低压" ? "#10B981" : pressureLevel === "中压" ? "#F59E0B" : "#EF4444";

  const mathAnalysisForPanel = useMemo(
    () => extractMathAnalysisFromResponse(analysisResult),
    [analysisResult],
  );

  const syncSession = useCallback((
    nextContext: SessionContext,
    options?: {
      resetConversation?: boolean;
      seedMessages?: boolean;
      preserveMode?: boolean;
    },
  ) => {
    setSessionContext(nextContext);
    setEnterpriseSessionId(nextContext.sessionId);
    if (!options?.preserveMode) {
      setMode(nextContext.activeMode as EnterpriseWorkbenchMode);
    }
    setTimeline(nextContext.latestTimeline);
    setAttachments(nextContext.attachments);
    setProgressState(
      nextContext.latestTimeline.length > 0
        ? {
            stage: nextContext.latestTimeline[nextContext.latestTimeline.length - 1]!.stage,
            label: nextContext.latestTimeline[nextContext.latestTimeline.length - 1]!.label,
            detail: nextContext.latestTimeline[nextContext.latestTimeline.length - 1]!.detail,
            progressPercent: nextContext.latestTimeline[nextContext.latestTimeline.length - 1]!.progressPercent,
          }
        : null,
    );

    if (options?.resetConversation) {
      setAnalysisResult(null);
      if (options.seedMessages === false) {
        setMessages([]);
      } else {
        setMessages([
          {
            id: createWorkbenchId("msg"),
            variant: "assistant",
            time: formatClockTime(nextContext.updatedAt),
            content: `已载入${nextContext.enterpriseName ?? "当前"} 企业会话。\n模式：${getEnterpriseModeOption(nextContext.activeMode).label}\n摘要：${nextContext.summary}`,
          },
        ]);
      }
    }
  }, []);

  const refreshHistory = useCallback(async (fallbackContext?: SessionContext) => {
    if (!currentUserId) {
      return [];
    }
    try {
      const response = await fetchEnterpriseSessions(currentUserId);
      setSessionHistory(response.items);
      return response.items;
    } catch {
      if (fallbackContext) {
        const fallback = [buildHistoryFallback(fallbackContext)];
        setSessionHistory(fallback);
        return fallback;
      }
      return [];
    }
  }, [currentUserId]);

  const appendMessage = useCallback((message: WorkbenchMessage) => {
    setMessages((previous) => [...previous, message]);
  }, []);

  const appendSystemMessage = useCallback((content: string) => {
    appendMessage({
      id: createWorkbenchId("msg"),
      variant: "system",
      time: formatClockTime(),
      content,
    });
  }, [appendMessage]);

  const clearVisibleConversation = useCallback(() => {
    streamingMessageIdRef.current = null;
    setMessages([]);
    setAnalysisResult(null);
    setTimeline([]);
    setProgressState(null);
  }, []);

  const ensureStreamingMessage = useCallback(() => {
    if (streamingMessageIdRef.current) {
      return streamingMessageIdRef.current;
    }
    const id = createWorkbenchId("msg");
    streamingMessageIdRef.current = id;
    appendMessage({
      id,
      variant: "assistant",
      time: formatClockTime(),
      content: "",
    });
    return id;
  }, [appendMessage]);

  const appendStreamingChunk = useCallback((chunk: string) => {
    const id = ensureStreamingMessage();
    setMessages((previous) =>
      previous.map((message) =>
        message.id === id
          ? { ...message, content: `${message.content}${chunk}` }
          : message,
      ),
    );
  }, [ensureStreamingMessage]);

  const finalizeStreamingMessage = useCallback((content: string) => {
    const finalContent = content.trim();
    const currentId = streamingMessageIdRef.current;

    if (!currentId) {
      if (finalContent.length > 0) {
        appendMessage({
          id: createWorkbenchId("msg"),
          variant: "assistant",
          time: formatClockTime(),
          content: finalContent,
        });
      }
      return;
    }

    setMessages((previous) =>
      previous.map((message) =>
        message.id === currentId
          ? { ...message, content: finalContent.length > 0 ? finalContent : message.content }
          : message,
      ),
    );
    streamingMessageIdRef.current = null;
  }, [appendMessage]);

  const loadSession = useCallback(async (
    sessionId: string,
    options?: {
      resetConversation?: boolean;
      seedMessages?: boolean;
    },
  ) => {
    const context = await fetchEnterpriseSessionContext(sessionId, currentUserId!);
    syncSession(context, options ?? { resetConversation: true, seedMessages: true });
    return context;
  }, [currentUserId, syncSession]);

  const ensureEnterpriseSession = useCallback(async () => {
    if (!currentUserId) {
      throw new Error("当前用户尚未初始化，请稍后重试");
    }
    if (enterpriseSessionId) {
      return enterpriseSessionId;
    }

    const collectionResponse = await collectEnterpriseData(
      buildEnterpriseCollectionPayload(currentUserId, enterpriseOnboarding, userProfile),
    );
    syncSession(collectionResponse.sessionContext, { resetConversation: false });
    setCollectionSummaryText(
      `${collectionResponse.collectionSummary.confidentialityNotice} 当前覆盖：${collectionResponse.collectionSummary.capturedModules.join("、") || "企业经营数据"}`,
    );
    return collectionResponse.sessionContext.sessionId;
  }, [currentUserId, enterpriseOnboarding, enterpriseSessionId, userProfile, syncSession]);

  const handleModeSwitch = useCallback((nextMode: EnterpriseWorkbenchMode) => {
    if (nextMode === mode) {
      return;
    }
    setMode(nextMode);
    clearVisibleConversation();
  }, [mode, clearVisibleConversation]);

  const handleStreamEvent = useCallback((event: EnterpriseAnalysisStreamEvent) => {
    if (event.type === "session") {
      void refreshHistory(event.sessionContext);
      return;
    }

    if (event.type === "progress") {
      setProgressState({
        stage: event.stage,
        label: event.label,
        detail: event.detail,
        progressPercent: event.progressPercent,
      });
      setProgressPercent(event.progressPercent);
      setTimeline((prev) => mergeTimelineEntries(prev, event.timelineEntry));
      return;
    }

    if (event.type === "delta") {
      appendStreamingChunk(event.chunk);
      return;
    }

    if (event.type === "result") {
      const nextResult = event.result as unknown as EnterpriseAnalysisResponse;
      setAnalysisResult(nextResult);
      if (nextResult.sessionContext) {
        syncSession(nextResult.sessionContext);
      }
      setProgressState({ stage: "completed", label: "分析完成", progressPercent: 100 });
      setProgressPercent(100);
      setLoading(false);
      finalizeStreamingMessage(
        formatEnterpriseAssistantResponse(nextResult, userProfile, enterpriseOnboarding),
      );
      void refreshHistory(nextResult.sessionContext);
      void refreshUserProfile();
      return;
    }

    if (event.type === "error") {
      setLoading(false);
      streamingMessageIdRef.current = null;
      setError(event.message);
      appendSystemMessage(`分析失败：${event.message}`);
    }
  }, [appendStreamingChunk, appendSystemMessage, finalizeStreamingMessage, refreshHistory, refreshUserProfile, syncSession, userProfile, enterpriseOnboarding]);

  const send = useCallback(async (override?: string) => {
    const text = override || input.trim();
    if (!text || loading || bootstrapping) {
      return;
    }

    if (!currentUserId) {
      appendSystemMessage("⚠️ 当前用户尚未完成初始化，暂时无法调用真实企业分析接口。");
      return;
    }

    setInput('');
    const detectedIntent = classifyQueryIntent(text);
    const detectedComplexity = (function() {
      if (detectedIntent === "chitchat" || detectedIntent === "meta") return "simple";
      const q = text.toLowerCase();
      if (mode === "deepDive") return "full";
      if (["建议","推荐","深度","拆解","投资","辩论","策略","详细分析","全面评估","深入","根因","复盘","规划","方案"].some(k => q.includes(k))) return "full";
      if (["分析","判断","趋势","行业","经营","毛利承压","景气","怎么样","如何","情况","变化","对比","比较","评估","状况","表现"].some(k => q.includes(k))) return "moderate";
      if (["计算","查询","是多少","当前","多少","比率","指数","得分","查一下","告诉我","看一下","看看"].some(k => q.includes(k))) return "simple";
      return "moderate";
    })();
    setComplexity(detectedComplexity);
    setLoading(true);
    setError(null);
    setProgressPercent(0);
    setTimeline([]);
    setAnalysisResult(null);
    setProgressState({
      stage: "session",
      label: detectedIntent === "chitchat" ? "对话处理中" : detectedIntent === "meta" ? "查询中" : "准备会话上下文",
      progressPercent: 0,
    });
    streamingMessageIdRef.current = null;
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    appendMessage({
      id: createWorkbenchId("msg"),
      variant: "user",
      time: formatClockTime(),
      content: text,
    });

    try {
      const sessionId = await ensureEnterpriseSession();
      const effectiveFocusMode = mode === "debate" ? "deepDive" : mode;
      const requestPayload = buildEnterpriseAnalysisRequestPayload(
        currentUserId,
        sessionId,
        text,
        enterpriseOnboarding,
        userProfile,
        detectedComplexity,
        effectiveFocusMode,
      );

      await streamEnterpriseAnalysis(
        requestPayload,
        handleStreamEvent,
        abortController.signal,
      );
    } catch (error) {
      if (abortController.signal.aborted) {
        setLoading(false);
        return;
      }
      const message = error instanceof Error ? error.message : "企业端真实分析暂时失败，请稍后重试";
      setLoading(false);
      streamingMessageIdRef.current = null;
      setError(message);
      appendSystemMessage(`⚠️ 真实接口调用失败：${message}`);
    }
  }, [appendMessage, appendSystemMessage, bootstrapping, currentUserId, enterpriseOnboarding, ensureEnterpriseSession, handleStreamEvent, input, loading, mode, refreshUserProfile, userProfile]);

  const addInd = (n: string, v: string) => {
    void send(`请分析「${n}」（当前值：${v}）`);
  };

  const openHistoryDialog = useCallback(() => {
    setHistoryDeleteError(null);
    setHistorySelection([]);
    setHistoryOpen(true);
  }, []);

  const toggleHistorySelection = useCallback((sessionId: string) => {
    setHistorySelection((previous) =>
      previous.includes(sessionId)
        ? previous.filter((item) => item !== sessionId)
        : [...previous, sessionId],
    );
  }, []);

  const performHistoryDeletion = useCallback(async (
    sessionIds: string[],
    options?: {
      closeHistoryDialog?: boolean;
      closeHistoryPreview?: boolean;
    },
  ) => {
    if (sessionIds.length === 0 || deletingHistory || !currentUserId) {
      return;
    }

    const deletingCurrent = sessionIds.includes(sessionContext?.sessionId ?? "");
    const fallbackMode = (sessionContext?.activeMode as EnterpriseWorkbenchMode | undefined) ?? mode;
    const fallbackEnterprise = sessionContext?.enterpriseName ?? DEFAULT_ENTERPRISE_NAME;

    setDeletingHistory(true);
    setHistoryDeleteError(null);

    try {
      const response = await deleteEnterpriseSessions({
        role: "enterprise",
        userId: currentUserId,
        sessionIds,
      });
      const deleteMessage = `已删除${response.deletedCount ?? response.deletedSessionIds.length} 条历史对话。`;
      const nextHistory = await refreshHistory();

      if (deletingCurrent) {
        if (nextHistory.length > 0) {
          await loadSession(nextHistory[0]!.sessionId, {
            resetConversation: true,
            seedMessages: false,
          });
        } else {
          const created = await createEnterpriseSession({
            role: "enterprise",
            userId: currentUserId,
            focusMode: (fallbackMode === "debate" ? "deepDive" : fallbackMode) as "operationalDiagnosis" | "deepDive",
            enterpriseName: fallbackEnterprise,
          });
          syncSession(created.sessionContext, {
            resetConversation: true,
            seedMessages: false,
          });
          await refreshHistory(created.sessionContext);
        }
      }

      setHistorySelection([]);
      if (options?.closeHistoryDialog ?? true) {
        setHistoryOpen(false);
      }
      if (options?.closeHistoryPreview ?? true) {
        setHistoryPreview(null);
      }
      setWorkspaceNotice(deleteMessage);
      void refreshUserProfile();
    } catch (nextError) {
      setHistoryDeleteError(nextError instanceof Error ? nextError.message : "删除历史对话失败。");
    } finally {
      setDeletingHistory(false);
    }
  }, [currentUserId, deletingHistory, loadSession, mode, refreshHistory, refreshUserProfile, sessionContext, syncSession]);

  const handleDeleteSelectedHistory = useCallback(async () => {
    await performHistoryDeletion(historySelection);
  }, [historySelection, performHistoryDeletion]);

  const handleSelectHistory = useCallback(async (summary: SessionHistorySummary) => {
    if (summary.sessionId === sessionContext?.sessionId || bootstrapping) {
      return;
    }
    setBootstrapping(true);
    setError(null);

    try {
      await loadSession(summary.sessionId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载历史会话失败。");
    } finally {
      setBootstrapping(false);
    }
  }, [bootstrapping, loadSession, sessionContext?.sessionId]);

  const handleOpenHistorySession = useCallback(async (summary: SessionHistorySummary) => {
    await handleSelectHistory(summary);
    setHistoryOpen(false);
  }, [handleSelectHistory]);

  const openHistoryPreview = useCallback((summary: SessionHistorySummary) => {
    setHistoryDeleteError(null);
    setHistoryPreview(summary);
  }, []);

  const handleDeletePreviewHistory = useCallback(async () => {
    if (!historyPreview) {
      return;
    }
    await performHistoryDeletion([historyPreview.sessionId], {
      closeHistoryDialog: false,
      closeHistoryPreview: true,
    });
  }, [historyPreview, performHistoryDeletion]);

  const handleCreateSession = useCallback(async () => {
    if (bootstrapping || !currentUserId) {
      return;
    }

    setBootstrapping(true);
    setError(null);

    try {
      const response = await createEnterpriseSession({
        role: "enterprise",
        userId: currentUserId,
        focusMode: (mode === "debate" ? "deepDive" : mode) as "operationalDiagnosis" | "deepDive",
        enterpriseName: sessionContext?.enterpriseName ?? enterpriseOnboarding.enterpriseName ?? DEFAULT_ENTERPRISE_NAME,
      });
      syncSession(response.sessionContext, {
        resetConversation: true,
        seedMessages: true,
      });
      void refreshHistory(response.sessionContext);
      appendSystemMessage("已新建企业会话，可立即发起新的分析。");
      void refreshUserProfile();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "新建会话失败。");
    } finally {
      setBootstrapping(false);
    }
  }, [appendSystemMessage, bootstrapping, currentUserId, enterpriseOnboarding.enterpriseName, mode, refreshHistory, refreshUserProfile, sessionContext?.enterpriseName, syncSession]);

  const handleDeleteCurrentSession = useCallback(async () => {
    if (!sessionContext || !currentUserId) {
      return;
    }

    setBootstrapping(true);
    setError(null);

    try {
      const response = await deleteCurrentEnterpriseSession({
        role: "enterprise",
        userId: currentUserId,
        sessionId: sessionContext.sessionId,
      });
      if (response.replacementSessionContext) {
        syncSession(response.replacementSessionContext, {
          resetConversation: true,
          seedMessages: false,
        });
        void refreshHistory(response.replacementSessionContext);
        setWorkspaceNotice(response.replacementSessionContext.summary || "已自动重建默认企业会话");
      } else {
        setSessionContext(null);
        setEnterpriseSessionId(null);
        setTimeline([]);
        setAttachments([]);
        setWorkspaceNotice("已自动重建默认企业会话");
        setMessages([]);
        setSessionHistory([]);
      }
      void refreshUserProfile();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除当前会话失败。");
    } finally {
      setBootstrapping(false);
    }
  }, [currentUserId, refreshHistory, refreshUserProfile, sessionContext, syncSession]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    const resetInput = () => {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };

    if (!sessionContext || !currentUserId || uploading) {
      resetInput();
      return;
    }

    void (async () => {
      setUploading(true);
      setUploadWarnings([]);
      setUploadError(null);

      try {
        const content = await readFileContent(file);
        const response = await uploadEnterpriseAttachment({
          role: "enterprise",
          userId: currentUserId,
          sessionId: sessionContext.sessionId,
          fileName: file.name,
          mimeType: file.type || "text/plain",
          content,
        });
        setAttachments(response.sessionContext.attachments);
        syncSession(response.sessionContext);
        setUploadWarnings(response.warnings);
        void refreshHistory(response.sessionContext);
        appendSystemMessage(`附件《${response.attachment.fileName}》已接入当前会话，可结合材料继续追问。`);
        void refreshUserProfile();
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : "上传附件失败";
        setUploadError(message);
        appendSystemMessage(`附件上传失败：${message}`);
      } finally {
        setUploading(false);
        resetInput();
      }
    })();
  }, [appendSystemMessage, currentUserId, refreshHistory, refreshUserProfile, sessionContext, syncSession, uploading]);

  const handleUploadSubmit = useCallback(async () => {
    if (!sessionContext || !currentUserId || uploading) {
      return;
    }

    const fileName = uploadDraft.fileName.trim();
    const content = uploadDraft.content.trim();

    if (!fileName || !content) {
      setUploadError("请填写文件名与资料内容。");
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadWarnings([]);

    try {
      const response = await uploadEnterpriseAttachment({
        role: "enterprise",
        userId: currentUserId,
        sessionId: sessionContext.sessionId,
        fileName,
        mimeType: uploadDraft.mimeType.trim() || "text/plain",
        content,
      });
      setAttachments(response.sessionContext.attachments);
      syncSession(response.sessionContext);
      setUploadWarnings(response.warnings);
      void refreshHistory(response.sessionContext);
      appendSystemMessage(`附件《${response.attachment.fileName}》已接入当前会话，可结合材料继续追问。`);
      setUploadOpen(false);
      void refreshUserProfile();
    } catch (nextError) {
      setUploadError(nextError instanceof Error ? nextError.message : "上传附件失败。");
    } finally {
      setUploading(false);
    }
  }, [appendSystemMessage, currentUserId, refreshHistory, refreshUserProfile, sessionContext, syncSession, uploadDraft, uploading]);

  const handleSelectCompareSession = useCallback(async (summary: SessionHistorySummary) => {
    if (summary.sessionId === sessionContext?.sessionId) {
      return;
    }
    setBootstrapping(true);
    try {
      const context = await fetchEnterpriseSessionContext(summary.sessionId, currentUserId!);
      setCompareSessionContext(context);
      setHistoryOpen(false);
    } catch (e) {
      setHistoryDeleteError(e instanceof Error ? e.message : "加载对比会话失败");
    } finally {
      setBootstrapping(false);
    }
  }, [currentUserId, sessionContext?.sessionId]);

  useEffect(() => {
    if (!isActive || !currentUserId || enterpriseSessionId) {
      return;
    }

    const bootstrapKey = `${currentUserId}:${enterpriseOnboarding.enterpriseName}:${enterpriseOnboarding.currentQuarterLabel}:${enterpriseOnboarding.baselineQuarterLabel}`;
    if (collectionBootstrapRef.current === bootstrapKey) {
      return;
    }
    collectionBootstrapRef.current = bootstrapKey;

    void ensureEnterpriseSession()
      .then(() => {
        void refreshUserProfile(currentUserId);
      })
      .catch(() => {
        collectionBootstrapRef.current = null;
      });
  }, [
    currentUserId,
    ensureEnterpriseSession,
    enterpriseOnboarding.baselineQuarterLabel,
    enterpriseOnboarding.currentQuarterLabel,
    enterpriseOnboarding.enterpriseName,
    enterpriseSessionId,
    isActive,
    refreshUserProfile,
  ]);

  useEffect(() => {
    if (!isActive || initializedRef.current || !currentUserId) {
      return;
    }

    initializedRef.current = true;
    setBootstrapping(true);
    setError(null);

    void (async () => {
      try {
        const history = await refreshHistory();
        if (history.length > 0) {
          await loadSession(history[0]!.sessionId);
        }
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : "初始化企业工作台失败";
        setError(message);
      } finally {
        setBootstrapping(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, isActive]);

  useEffect(() => {
    if (!isActive) {
      hasInitializedRef.current = false;
      return;
    }
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      return;
    }
    const target = msgEndRef.current;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading, isActive]);

  useEffect(() => {
    setHistorySelection((previous) => previous.filter((sessionId) => sessionHistory.some((item) => item.sessionId === sessionId)));
  }, [sessionHistory]);

  useEffect(() => {
    if (!historyPreview) {
      return;
    }
    const nextPreview = sessionHistory.find((item) => item.sessionId === historyPreview.sessionId) ?? null;
    setHistoryPreview(nextPreview);
  }, [historyPreview, sessionHistory]);

  const currentMode = getEnterpriseModeOption(mode);
  const inputPlaceholder = currentMode.placeholder;
  const recentHistory = sessionHistory.slice(0, 6);

  return (
    <div className={`pg iwb-page ${isActive ? 'on' : ''}`}>
      <div className={`cly ${splitMode ? 'iwb-split' : ''}`}>
        <div className="cp" style={{ flex: 1, borderRight: splitMode ? '1px solid #E2E8F0' : 'none', borderTopRightRadius: splitMode ? 0 : '12px', borderBottomRightRadius: splitMode ? 0 : '12px' }}>
          <div className="iwb-top">
            <div className="iwb-headline">
              <div className="iwb-kicker">分析工作台</div>
              <h3>{(sessionContext?.enterpriseName ?? enterpriseOnboarding.enterpriseName) || DEFAULT_ENTERPRISE_NAME}</h3>
              <p>{sessionContext?.summary ?? "企业经营质量与毛利承压智能诊断"}</p>
            </div>
            <div className="iwb-actions">
              <button className="iwb-action-btn" onClick={openHome} disabled={bootstrapping}>返回首页</button>
              <button className="iwb-action-btn" onClick={openSettings} disabled={bootstrapping}>偏好设置</button>
              <button className={`iwb-action-btn ${splitMode ? 'on' : ''}`} onClick={() => setSplitMode(!splitMode)} disabled={bootstrapping}>分屏对比</button>
              <button className="iwb-action-btn" onClick={() => window.print()} disabled={bootstrapping}>📄 导出报告</button>
              <button className="iwb-action-btn" onClick={openHistoryDialog} disabled={bootstrapping}>🕘 历史对话</button>
              <button className="iwb-action-btn" onClick={() => void handleCreateSession()} disabled={bootstrapping}>新建会话</button>
              <button className="iwb-action-btn danger" onClick={() => void handleDeleteCurrentSession()} disabled={!sessionContext}>删除当前</button>
            </div>
          </div>

          <div className="iwb-meta">
            <span>当前模式：{currentMode.label}</span>
            <span>当前会话：{sessionContext?.sessionId ?? enterpriseSessionId ?? "初始化中"}</span>
            <span>附件数：{attachments.length}</span>
            <span>最近更新：{sessionContext ? formatSessionTime(sessionContext.updatedAt) : formatClockTime()}</span>
          </div>

          <div className="mts">
            {ENTERPRISE_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`mt2 ${mode === option.value ? 'on' : ''}`}
                onClick={() => handleModeSwitch(option.value)}
                disabled={loading}
              >
                {option.icon} {option.label}
              </button>
            ))}
          </div>

          {(error || bootstrapping) && (
            <div className="iwb-alert">
              {bootstrapping ? "正在同步会话与历史对话…" : error}
            </div>
          )}
          {workspaceNotice && <div className="iwb-alert">{workspaceNotice}</div>}

          {(mathAnalysisForPanel || loading) && (
            <div style={{ padding: "0 12px", marginBottom: 8 }}>
              <DQIGMPSPanelsContainer
                mathAnalysisOutput={mathAnalysisForPanel}
                isLoading={loading && !mathAnalysisForPanel}
                displayMode="grid"
              />
            </div>
          )}

          <div className="cms">
            {messages.length === 0 && !loading && (
              <div className="iwb-chat-empty">
                <div className="iwb-chat-empty-badge">{currentMode.label}</div>
                <div className="iwb-chat-empty-title">{EMPTY_WORKBENCH_MESSAGE}</div>
                <div className="iwb-chat-empty-copy">{currentMode.placeholder}</div>
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`m ${message.variant === "user" ? 'u' : 'a'} ${message.variant === "system" ? 'sys' : ''}`}
              >
                <div className="mb" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7 }}><MessageWithCharts content={message.content} /></div>
                <div className="mt">{message.time}</div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '0 12px' }}>
                <span style={{ fontSize: 12, color: '#94A3B8' }}>任务分级</span>
                <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: '4px', background: '#F1F5F9', color: complexity === 'simple' ? '#22c55e' : complexity === 'moderate' ? '#eab308' : '#ef4444' }}>
                  {complexity === 'simple' ? '简单' : complexity === 'moderate' ? '中等' : '复杂'}
                </span>
              </div>
            )}
            {loading && (
              <div className="m a iwb-chain-wrap">
                <div className="iwb-chain-header">
                  <div className={`iwb-chain-header-icon${progressPercent >= 100 ? ' done' : ''}`}></div>
                  <span className={`iwb-chain-header-text${progressPercent >= 100 ? ' done' : ''}`}>
                    {progressState?.label ?? "AI 正在分析"}
                  </span>
                </div>
                <div className="iwb-live-progress-bar">
                  <div className={`iwb-live-progress-fill${progressPercent <= 0 ? ' indeterminate' : ''}`} style={{ width: `${progressPercent}%` }}></div>
                </div>
                <div className="iwb-chain-steps">
                  {timeline.filter(s => s.status === "completed").map((step, idx) => (
                    <div key={step.id || idx} className="iwb-chain-step done">
                      <div className="iwb-chain-step-dot"></div>
                      <div className="iwb-chain-step-content">
                        <span className="iwb-chain-step-label">{step.label}</span>
                      </div>
                    </div>
                  ))}
                  {progressState && progressState.stage !== "completed" && (
                    <div className="iwb-chain-step active">
                      <div className="iwb-chain-step-dot"></div>
                      <div className="iwb-chain-step-content">
                        <span className="iwb-chain-step-label">{progressState.label}</span>
                        {progressState.detail && <span className="iwb-chain-step-detail">{progressState.detail}</span>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div ref={msgEndRef} />
          </div>

          <div className="cia">
            <div className="ciw">
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: "none" }}
                onChange={handleFileSelect}
                accept=".pdf,.txt,.doc,.docx"
              />
              <button
                className="iwb-upload-entry"
                onClick={handleUploadClick}
                disabled={!sessionContext || loading || bootstrapping || uploading}
                title="上传资料"
                aria-label="上传资料"
              >
              </button>
              <textarea
                className="ci"
                rows={1}
                placeholder={inputPlaceholder}
                value={input}
                disabled={!sessionContext || loading || bootstrapping}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              />
              <button className="cse" onClick={() => void send()} disabled={!sessionContext || loading || bootstrapping}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {splitMode && (
          <div className="cp" style={{ flex: 1, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}>
            <div className="iwb-top">
              <div className="iwb-headline">
                <div className="iwb-kicker">对比会话</div>
                <h3>{compareSessionContext ? compareSessionContext.enterpriseName ?? DEFAULT_ENTERPRISE_NAME : "等待选择"}</h3>
                <p>{compareSessionContext?.summary ?? "请从历史对话中选择一个会话加入对比。"}</p>
              </div>
            </div>
            {compareSessionContext ? (
              <div className="cms" style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
                <div className="iwb-chat-empty" style={{ marginBottom: '24px' }}>
                  <div className="iwb-chat-empty-badge">对比视图</div>
                  <div className="iwb-chat-empty-title">正在对比：{compareSessionContext.sessionId}</div>
                  <div className="iwb-chat-empty-copy">此视图为历史快照（只读模式）</div>
                </div>
                <div className="m a">
                  <div className="mb" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7 }}>
                    {`已载入${compareSessionContext.enterpriseName ?? "当前"} 企业会话。\n模式：${getEnterpriseModeOption(compareSessionContext.activeMode).label}\n摘要：${compareSessionContext.summary}`}
                  </div>
                  <div className="mt">{formatClockTime(compareSessionContext.updatedAt)}</div>
                </div>
              </div>
            ) : (
              <div className="cms" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="iwb-empty" style={{ textAlign: 'center' }}>点击左侧「历史对话」并选择「加入对比」</div>
              </div>
            )}
          </div>
        )}

        <div className="csb" style={{ display: splitMode ? 'none' : 'block' }}>
          <div className="ss">
            <div className="iwb-section-title">
              <h5>WHAT-IF 推演沙盘</h5>
            </div>
            <div className="iwb-result-block" style={{ padding: '12px' }}>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                  <span>碳酸锂价格波动</span>
                  <span>{liPriceYoy > 0 ? '+' : ''}{liPriceYoy}%</span>
                </div>
                <input
                  type="range"
                  min="-30" max="30" step="1"
                  value={liPriceYoy}
                  onChange={(e) => setLiPriceYoy(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#3B82F6' }}
                />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                  <span>产销比率</span>
                  <span>{saleProdRatio}%</span>
                </div>
                <input
                  type="range"
                  min="50" max="120" step="1"
                  value={saleProdRatio}
                  onChange={(e) => setSaleProdRatio(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#3B82F6' }}
                />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                  <span>库存费用变动</span>
                  <span>{invYoy > 0 ? '+' : ''}{invYoy}%</span>
                </div>
                <input
                  type="range"
                  min="-30" max="30" step="1"
                  value={invYoy}
                  onChange={(e) => setInvYoy(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#3B82F6' }}
                />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                  <span>经营现金流比率</span>
                  <span>{cfoRatio}%</span>
                </div>
                <input
                  type="range"
                  min="0" max="100" step="1"
                  value={cfoRatio}
                  onChange={(e) => setCfoRatio(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#3B82F6' }}
                />
              </div>
              <div style={{ padding: '8px', background: '#F8FAFC', borderRadius: '4px' }}>
                <div style={{ fontSize: '12px', color: '#94A3B8' }}>基准毛利率：{baseMargin.toFixed(2)}%</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: inferredMargin < baseMargin ? 'var(--red)' : '#10B981', marginTop: '4px' }}>
                  推演后毛利率：{inferredMargin.toFixed(2)}%
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                  <span style={{ fontSize: '12px', color: '#475569' }}>压力等级：</span>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: pressureColor, padding: '2px 8px', borderRadius: '4px', background: pressureColor + '1A' }}>
                    {pressureLevel}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="ss"><h5>行业参考指标</h5>
            <div className="ii" onClick={() => addInd('行业平均毛利率','21.3%')}><span className="inn">行业平均毛利率</span><span className="iv">21.3%</span><div className="ia">+</div></div>
            <div className="ii" onClick={() => addInd('头部企业毛利率','28.5%')}><span className="inn">头部企业毛利率</span><span className="iv">28.5%</span><div className="ia">+</div></div>
            <div className="ii" onClick={() => addInd('碳酸锂均价','9.8')}><span className="inn">碳酸锂均价</span><span className="iv">9.8</span><div className="ia">+</div></div>
            <div className="ii" onClick={() => addInd('行业产能利用率','72%')}><span className="inn">行业产能利用率</span><span className="iv">72%</span><div className="ia">+</div></div>
            <div className="ii" onClick={() => addInd('正极材料价格指数','86.2')}><span className="inn">正极材料价格指数</span><span className="iv">86.2</span><div className="ia">+</div></div>
          </div>
          <div className="ss"><h5>风险预警</h5>
            <div className="ii" onClick={() => addInd('原材料价格波动','高')}><span className="inn">原材料价格波动</span><span className="iv" style={{ color: 'var(--red)' }}>高</span><div className="ia">+</div></div>
            <div className="ii" onClick={() => addInd('库存积压风险','中高')}><span className="inn">库存积压风险</span><span className="iv" style={{ color: 'var(--orange)' }}>中高</span><div className="ia">+</div></div>
            <div className="ii" onClick={() => addInd('价格战压力','中等')}><span className="inn">价格战压力</span><span className="iv" style={{ color: 'var(--orange)' }}>中等</span><div className="ia">+</div></div>
          </div>
          <div className="ss">
            <div className="iwb-section-title">
              <h5>任务时间线</h5>
              <span>{timeline.length > 0 ? `${timeline.length} 步` : "待开始"}</span>
            </div>
            {timeline.length > 0 ? timeline.filter(entry => !(complexity === 'simple' && ['session', 'understanding', 'retrieval', 'evidence'].includes(entry.stage))).map((entry) => (
              <div key={entry.id} className={`iwb-timeline-item ${entry.status}`}>
                <div className="iwb-timeline-dot"></div>
                <div className="iwb-timeline-body">
                  <div className="iwb-timeline-top">
                    <span>{entry.label}</span>
                    <span>{entry.progressPercent}%</span>
                  </div>
                  <div className="iwb-timeline-detail">
                    {entry.detail ?? "已进入当前阶段"}
                  </div>
                </div>
              </div>
            )) : (
              <div className="iwb-empty">暂无任务时间线，发送问题后开始编排。</div>
            )}
          </div>
          <div className="ss">
            <div className="iwb-section-title">
              <h5>上传资料</h5>
              <span>{attachments.length}</span>
            </div>
            {attachments.length > 0 ? attachments.map((attachment) => (
              <div key={attachment.attachmentId} className="iwb-attachment-item">
                <div className="iwb-attachment-top">
                  <span>{attachment.fileName}</span>
                  <span>{attachment.status}</span>
                </div>
                <div className="iwb-attachment-summary">{attachment.summary}</div>
              </div>
            )) : (
              <div className="iwb-empty">当前还没有上传资料，可补充纪要、公告或访谈摘要</div>
            )}
            {uploadWarnings.length > 0 && (
              <div className="iwb-warning-box">
                {uploadWarnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            )}
          </div>
          <div className="ss">
            <div className="iwb-section-title">
              <h5>对话历史</h5>
              <span>{recentHistory.length > 0 ? `最近${recentHistory.length}条` : "等待沉淀"}</span>
            </div>
            {recentHistory.length > 0 ? recentHistory.map((summary) => {
              const isCurrent = summary.sessionId === sessionContext?.sessionId;
              return (
                <div key={summary.sessionId} className={`iwb-history-item ${isCurrent ? 'on' : ''}`}>
                  <button
                    type="button"
                    className="iwb-history-entry-main"
                    onClick={() => void handleSelectHistory(summary)}
                    disabled={bootstrapping || isCurrent}
                  >
                    <div className="iwb-history-top">
                      <span>{getSessionTitle(summary)}</span>
                      <span>{formatSessionTime(summary.updatedAt)}</span>
                    </div>
                    <div className="iwb-history-summary">{summary.summary || "暂无摘要"}</div>
                    <div className="iwb-history-meta">
                      <span>{getEnterpriseModeOption(summary.activeMode).label}</span>
                      <span>{summary.attachmentCount} 个附件</span>
                      <span>{isCurrent ? "当前会话" : "点击切换"}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="iwb-history-entry-action"
                    aria-label={`打开${getSessionTitle(summary)}摘要`}
                    onClick={() => openHistoryPreview(summary)}
                    disabled={deletingHistory}
                  >
                    摘要
                  </button>
                </div>
              );
            }) : (
              <div className="iwb-empty">暂无历史对话，创建新会话或完成分析后会在这里显示</div>
            )}
          </div>
          <div className="ss">
            <div className="iwb-section-title">
              <h5>快速追问</h5>
              <span>{currentMode.label}</span>
            </div>
            {currentMode.quickPrompts.map((item) => (
              <div key={item.label} className="ii" onClick={() => void send(`请分析「${item.label}」，当前值为 ${item.value}。`)}>
                <span className="inn">{item.label}</span>
                <span className="iv">{item.value}</span>
                <div className="ia">+</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {uploadOpen && createPortal(
        <div className="iwb-modal-overlay" onClick={() => !uploading && setUploadOpen(false)}>
          <div className="iwb-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="iwb-modal-header">
              <div>
                <h3>上传资料到当前会话</h3>
                <p>支持公告摘要、调研纪要、订单跟踪与行业笔记</p>
              </div>
              <button className="iwb-modal-close" onClick={() => !uploading && setUploadOpen(false)}></button>
            </div>
            <div className="fr">
              <div className="fg">
                <label>文件名</label>
                <input
                  value={uploadDraft.fileName}
                  onChange={(event) => setUploadDraft((previous) => ({ ...previous, fileName: event.target.value }))}
                />
              </div>
              <div className="fg">
                <label>MIME 类型</label>
                <input
                  value={uploadDraft.mimeType}
                  onChange={(event) => setUploadDraft((previous) => ({ ...previous, mimeType: event.target.value }))}
                />
              </div>
            </div>
            <div className="fr">
              <div className="fg">
                <label>资料内容</label>
                <textarea
                  value={uploadDraft.content}
                  onChange={(event) => setUploadDraft((previous) => ({ ...previous, content: event.target.value }))}
                  style={{ height: '80px' }}
                />
              </div>
            </div>
            {uploadError && <div className="iwb-warning-box">{uploadError}</div>}
            <div className="br">
              <button className="bt bgh" onClick={() => setUploadOpen(false)} disabled={uploading}>取消</button>
              <button className="bt bp" onClick={() => void handleUploadSubmit()} disabled={uploading}>
                {uploading ? "解析中" : "开始解析"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {historyOpen && createPortal(
        <div className="iwb-modal-overlay" onClick={() => !deletingHistory && setHistoryOpen(false)}>
          <div className="iwb-modal iwb-history-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="iwb-modal-header">
              <div>
                <h3>历史对话</h3>
                <p>可切换会话，也可勾选后批量删除无效历史记录</p>
              </div>
              <button className="iwb-modal-close" onClick={() => !deletingHistory && setHistoryOpen(false)}></button>
            </div>
            <div className="iwb-history-toolbar">
              <span>共 {sessionHistory.length} 条，已选择 {historySelection.length} 条</span>
              <button
                className="bt bgh"
                onClick={() => void handleDeleteSelectedHistory()}
                disabled={historySelection.length === 0 || deletingHistory}
              >
                {deletingHistory ? "删除中" : "删除勾选"}
              </button>
            </div>
            {historyDeleteError && <div className="iwb-warning-box">{historyDeleteError}</div>}
            <div className="iwb-history-dialog-list">
              {sessionHistory.length > 0 ? sessionHistory.map((summary) => (
                <div
                  key={summary.sessionId}
                  className={`iwb-history-row ${summary.sessionId === sessionContext?.sessionId ? 'on' : ''}`}
                >
                  <label className="iwb-history-check">
                    <input
                      type="checkbox"
                      checked={historySelection.includes(summary.sessionId)}
                      readOnly
                      onClick={() => toggleHistorySelection(summary.sessionId)}
                      disabled={deletingHistory}
                    />
                    <span className="iwb-history-check-mark"></span>
                  </label>
                  <div className="iwb-history-row-body">
                    <div className="iwb-history-top">
                      <span>{getSessionTitle(summary)}</span>
                      <span>{formatSessionTime(summary.updatedAt)}</span>
                    </div>
                    <div className="iwb-history-summary">{summary.summary}</div>
                    <div className="iwb-history-meta">
                      <span>{getEnterpriseModeOption(summary.activeMode).label}</span>
                      <span>{summary.attachmentCount} 个附件</span>
                      <span>{summary.enterpriseName ?? "未同步企业"}</span>
                    </div>
                  </div>
                  <div className="iwb-history-actions" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button
                      className="iwb-action-btn"
                      onClick={() => void handleOpenHistorySession(summary)}
                      disabled={deletingHistory}
                    >
                      {summary.sessionId === sessionContext?.sessionId ? "当前会话" : "进入会话"}
                    </button>
                    {splitMode && summary.sessionId !== sessionContext?.sessionId && (
                      <button
                        className="iwb-action-btn"
                        onClick={() => void handleSelectCompareSession(summary)}
                        disabled={deletingHistory}
                      >
                        加入对比
                      </button>
                    )}
                  </div>
                </div>
              )) : (
                <div className="iwb-empty">暂无历史对话，系统将在首次数据采集后自动创建会话</div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      {historyPreview && createPortal(
        <div className="iwb-modal-overlay" onClick={() => !deletingHistory && setHistoryPreview(null)}>
          <div className="iwb-modal iwb-history-preview-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="iwb-modal-header">
              <div>
                <h3>会话摘要</h3>
                <p>{getSessionTitle(historyPreview)}</p>
              </div>
              <button className="iwb-modal-close" onClick={() => !deletingHistory && setHistoryPreview(null)}></button>
            </div>
            <div className="iwb-history-preview-badges">
              <span>{getEnterpriseModeOption(historyPreview.activeMode).label}</span>
              <span>{formatAbsoluteTime(historyPreview.updatedAt)}</span>
              <span>{historyPreview.attachmentCount} 个附件</span>
              <span>{historyPreview.sessionId === sessionContext?.sessionId ? "当前会话" : "历史会话"}</span>
            </div>
            <div className="iwb-history-preview-summary">
              {historyPreview.summary || "暂无摘要信息"}
            </div>
            <div className="iwb-history-preview-meta">
              <div>
                <span>企业名称</span>
                <strong>{historyPreview.enterpriseName ?? "未同步"}</strong>
              </div>
              <div>
                <span>会话编号</span>
                <strong>{historyPreview.sessionId}</strong>
              </div>
            </div>
            {historyDeleteError && <div className="iwb-warning-box">{historyDeleteError}</div>}
            <div className="br">
              <button className="bt bgh" onClick={() => setHistoryPreview(null)} disabled={deletingHistory}>关闭</button>
              <button className="bt danger" onClick={() => void handleDeletePreviewHistory()} disabled={deletingHistory}>
                {deletingHistory ? "删除中" : "删除会话"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function EntSet({ isActive, openMem, isDark, setIsDark, themeIndex, setThemeIndex, userProfile, saveEnterpriseBaseInfo, onUnitPrefsChange, refreshInterval, onRefreshIntervalChange }: EntSetProps & { userProfile: UserProfileResponse | null; saveEnterpriseBaseInfo: (baseInfo: EditableBusinessInfo) => Promise<void>; unitPrefs: UnitPreferences; onUnitPrefsChange: (prefs: UnitPreferences) => void; refreshInterval: number; onRefreshIntervalChange: (ms: number) => void }) {
  const profile = userProfile?.profile;

  return (
    <div className={`pg ${isActive ? 'on' : ''}`}>
      <div className="sts2"><h3>🎨 界面配色</h3>
        <div className="sr"><span className="sl2">主题</span><div className="sc">
          <ThemeColorButton index={0} themeIndex={themeIndex} setThemeIndex={setThemeIndex} />
          <ThemeColorButton index={1} themeIndex={themeIndex} setThemeIndex={setThemeIndex} />
          <ThemeColorButton index={2} themeIndex={themeIndex} setThemeIndex={setThemeIndex} />
          <ThemeColorButton index={3} themeIndex={themeIndex} setThemeIndex={setThemeIndex} />
        </div></div>
        <div className="sr"><span className="sl2">深色模式</span><ThemeModeSwitch isDark={isDark} setIsDark={setIsDark} /></div>
      </div>
      <div className="sts2"><h3>📐 数据单位</h3>
        <UnitSelector onChange={onUnitPrefsChange} />
      </div>
      <div className="sts2"><h3>🔄 数据刷新</h3>
        <div className="sr"><span className="sl2">自动刷新间隔</span><div className="sc"><select className="ssel" value={refreshInterval} onChange={(e) => onRefreshIntervalChange(Number(e.target.value))}><option value={30000}>30 秒</option><option value={60000}>60 秒（默认）</option><option value={120000}>120 秒</option><option value={0}>关闭</option></select></div></div>
      </div>
      <div className="sts2"><h3>📋 基本信息</h3>
        <div className="sr"><span className="sl2">分析角色</span><span style={{ color: '#3B82F6', fontSize: '12px' }}>企业运营分析</span></div>
        <div className="sr"><span className="sl2">当前用户</span><span style={{ color: '#475569', fontSize: '12px' }}>{profile?.displayName || profile?.userId || "初始化中"}</span></div>
        <div className="sr"><span className="sl2">数据季度</span><span style={{ color: '#94A3B8', fontSize: '12px' }}>Q4 2024</span></div>
        <EditableBaseInfoPanel title="企业基本信息" baseInfo={profile?.enterpriseBaseInfo} emptyText="可补充营业收入、毛利率、订单、库存等关键信息。" presetGroups={ENTERPRISE_BASE_INFO_GROUPS} onSave={saveEnterpriseBaseInfo} />
      </div>
      <div className="sts2"><h3>🤖 Agent 任务</h3>
        <div className="sr"><span className="sl2">自动分析频率</span><div className="sc"><select className="ssel"><option>每周一次</option><option>每两周一次</option><option>每月一次</option></select></div></div>
        <div className="sr"><span className="sl2">异常预警推送</span><div className="sw on"></div></div>
        <div className="sr"><span className="sl2">毛利预警阈值</span><div className="sc"><select className="ssel"><option>15%</option><option>18%</option><option>20%</option></select></div></div>
      </div>
      <div className="sts2">
        <button className="mbtn" onClick={openMem}>
          <div className="mi2">🧠</div><span>记忆中的你</span>
        </button>
      </div>
    </div>
  );
}
