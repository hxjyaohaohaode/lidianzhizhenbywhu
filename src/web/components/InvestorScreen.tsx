import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  createInvestorProfile,
  createInvestorSession,
  deleteCurrentInvestorSession,
  deleteInvestorSessions,
  fetchInvestorSessionContext,
  fetchInvestorSessions,
  streamInvestorAnalysis,
  switchInvestorMode,
  uploadInvestorAttachment,
  type InvestorAnalysisResponse,
} from "../api.js";
import type { InvestorAnalysisStreamEvent } from "../../shared/business.js";
import type { IndustryRetrievalOutput } from "../../shared/agents.js";
import {
  buildInvestorAnalysisVisualization,
  buildInvestorHomeVisualization,
} from "../chart-data.js";
import { VisualizationBoard, renderWidgetByKind, extractTableData, extractMetricCards, type MetricCardData } from "../chart-system.js";
import { UnitSelector } from "../UnitSelector.js";
import { DataFormatter, type UnitPreferences } from "../data-formatter.js";
import {
  DQIGMPSPanelsContainer,
  extractMathAnalysisFromResponse,
} from "../dqi-gmps-panels.js";
import { MessageWithCharts } from "../chart-renderer.js";
import { useAppContext } from "../context/AppContext.js";
import { IdentitySwitcher } from "./IdentitySwitcher.js";
import { ChartWithInsightPanel } from "./ChartWithInsightPanel.js";
import type {
  AnalysisTimelineEntry,
  EditableBusinessInfo,
  ProfileUpdateReceipt,
  SessionAttachment,
  SessionContext,
  SessionHistorySummary,
  UserProfileResponse,
} from "../../shared/business.js";
import {
  type AuditPanelState,
  type AppTab,
  type InvestorWorkbenchMode,
  type InvestorOnboardingDraft,
  type WorkbenchMessage,
  EMPTY_WORKBENCH_MESSAGE,
  DEFAULT_ENTERPRISE_NAME,
  classifyQueryIntent,
  createWorkbenchId,
  readFileContent,
  formatClockTime,
  formatSessionTime,
  formatAbsoluteTime,
  splitInputTags,
  INVESTOR_BASE_INFO_GROUPS,
  INVESTOR_MODE_OPTIONS,
  DEFAULT_UPLOAD_DRAFT,
  getModeOption,
  getSessionTitle,
  mergeTimelineEntries,
  buildHistoryFallback,
  toDebateWorkbenchMessage,
  buildDeepDiveContext,
} from "../utils/helpers.js";
import {
  buildInvestorProfilePayload,
} from "../utils/enterprise-payload.js";
import { usePortalAuditReport } from "./CompetitiveBaselinePanel.js";
import { EditableBaseInfoPanel } from "./EditableBaseInfoPanel.js";
import { AuditInlineBanner } from "./CompetitiveBaselinePanel.js";
import { Icon } from "./Icon.js";

type InvestorScreenProps = {
  tab: AppTab;
  setTab: (tab: AppTab) => void;
  openMem: () => void;
  isDark: boolean;
  setIsDark: (isDark: boolean) => void;
  themeIndex: number;
  setThemeIndex: (themeIndex: number) => void;
  currentUserId: string | null;
  userProfile: UserProfileResponse | null;
  refreshUserProfile: (userId?: string) => Promise<UserProfileResponse | null>;
  investorOnboarding: import("../utils/helpers.js").InvestorOnboardingDraft;
  saveInvestorBaseInfo: (baseInfo: EditableBusinessInfo) => Promise<void>;
  unitPrefs: import("../data-formatter.js").UnitPreferences;
  dataFormatter: import("../data-formatter.js").DataFormatter;
  onUnitPrefsChange: (prefs: import("../data-formatter.js").UnitPreferences) => void;
  isRefreshing: boolean;
  lastDataRefreshAt: string;
  onRefreshData: () => void;
  refreshInterval: number;
  onRefreshIntervalChange: (ms: number) => void;
  prefetchedSessionHistoryRef: React.MutableRefObject<SessionHistorySummary[] | null>;
  chartThemeKey: number;
};

type InvSetProps = {
  isActive: boolean;
  openMem: () => void;
  isDark: boolean;
  setIsDark: (isDark: boolean) => void;
  themeIndex: number;
  setThemeIndex: (themeIndex: number) => void;
  userProfile: UserProfileResponse | null;
  saveInvestorBaseInfo: (info: EditableBusinessInfo) => Promise<void>;
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

function buildSessionMessages(context: SessionContext): WorkbenchMessage[] {
  const modeOption = getModeOption(context.activeMode);
  const seeded: WorkbenchMessage[] = [
    {
      id: createWorkbenchId("msg"),
      variant: "assistant",
      time: formatClockTime(context.updatedAt),
      content: `已载${context.enterpriseName ?? "当前"} 会话。\n模式${modeOption.label}\n摘要${context.summary}`,
    },
  ];

  if (context.investorProfileSummary) {
    seeded.push({
      id: createWorkbenchId("msg"),
      variant: "system",
      time: formatClockTime(context.updatedAt),
      content: `投资画像${context.investorProfileSummary}`,
    });
  }

  if (context.latestEvidenceSummary.length > 0) {
    seeded.push({
      id: createWorkbenchId("msg"),
      variant: "assistant",
      time: formatClockTime(context.updatedAt),
      content: `已沉淀证据：\n${context.latestEvidenceSummary.map((item) => `${item}`).join("\n")}`,
    });
  }

  if (context.pendingClarificationQuestions.length > 0) {
    seeded.push({
      id: createWorkbenchId("msg"),
      variant: "system",
      time: formatClockTime(context.updatedAt),
      content: `待补充研究条件：\n${context.pendingClarificationQuestions.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
    });
  }

  return seeded.concat(context.latestDebate.map(toDebateWorkbenchMessage));
}

function WorkbenchShortcutPanel({
  badge,
  title,
  description,
  highlights,
  primaryLabel,
  secondaryLabel,
  onPrimaryClick,
  onSecondaryClick,
}: {
  badge: string;
  title: string;
  description: string;
  highlights: string[];
  primaryLabel: string;
  secondaryLabel: string;
  onPrimaryClick: () => void;
  onSecondaryClick: () => void;
}) {
  return (
    <div style={{
      background: "var(--gl)",
      border: "1px solid var(--line)",
      borderRadius: "12px",
      padding: "16px",
      display: "flex",
      flexDirection: "column",
      gap: "12px"
    }}>
      <div style={{ fontSize: "12px", color: "#8B5CF6", fontWeight: "500" }}>{badge}</div>
      <h3 style={{ margin: 0, fontSize: "16px", color: "var(--t1)" }}>{title}</h3>
      <p style={{ margin: 0, fontSize: "14px", color: "var(--t2)" }}>{description}</p>
      {highlights && highlights.length > 0 && (
        <ul style={{ margin: "8px 0", paddingLeft: "20px", fontSize: "14px", color: "var(--t2)" }}>
          {highlights.map((highlight, index) => (
            <li key={index}>{highlight}</li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
        <button
          onClick={onPrimaryClick}
          style={{
            flex: 1,
            padding: "8px 16px",
            borderRadius: "8px",
            border: "1px solid #8B5CF6",
            background: "#8B5CF6",
            color: "white",
            cursor: "pointer",
            fontSize: "14px"
          }}
        >
          {primaryLabel}
        </button>
        <button
          onClick={onSecondaryClick}
          style={{
            flex: 1,
            padding: "8px 16px",
            borderRadius: "8px",
            border: "1px solid var(--line)",
            background: "transparent",
            color: "var(--t1)",
            cursor: "pointer",
            fontSize: "14px"
          }}
        >
          {secondaryLabel}
        </button>
      </div>
    </div>
  );
}

export function AppInvestorScreen({
  tab,
  setTab,
  openMem,
  isDark,
  setIsDark,
  themeIndex,
  setThemeIndex,
  currentUserId,
  userProfile,
  refreshUserProfile,
  investorOnboarding,
  saveInvestorBaseInfo,
  unitPrefs,
  dataFormatter,
  onUnitPrefsChange,
  isRefreshing,
  lastDataRefreshAt,
  onRefreshData,
  refreshInterval,
  onRefreshIntervalChange,
  prefetchedSessionHistoryRef,
}: InvestorScreenProps) {
  const ctx = useAppContext();
  const titles = { home: '首页', ana: '分析', set: '设置' };
  const investorVisualization = useMemo(
    () => buildInvestorHomeVisualization(
      userProfile,
      investorOnboarding.investorName,
      splitInputTags(investorOnboarding.investedEnterprises),
      undefined,
      unitPrefs,
    ),
    [userProfile, investorOnboarding, unitPrefs, ctx.industryDataVersion]
  );
  const auditPanelState = usePortalAuditReport("investor", tab === "home" || tab === "ana", currentUserId);

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
        <div className="nav2">
          <IdentitySwitcher currentRole={ctx.role} onSwitch={ctx.handleRoleSelect} isDark={ctx.isDark} />
        </div>
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
          <InvHome isActive={tab === 'home'} visualization={investorVisualization} dataFormatter={dataFormatter} openWorkbench={() => setTab("ana")} openSettings={() => setTab("set")} onRefreshData={onRefreshData} />
          <InvAna isActive={tab === 'ana'} currentUserId={currentUserId} userProfile={userProfile} refreshUserProfile={refreshUserProfile} investorOnboarding={investorOnboarding} openHome={() => setTab("home")} openSettings={() => setTab("set")} auditPanelState={auditPanelState} prefetchedSessionHistoryRef={prefetchedSessionHistoryRef} unitPrefs={unitPrefs} />
          <InvSet isActive={tab === 'set'} openMem={openMem} isDark={isDark} setIsDark={setIsDark} themeIndex={themeIndex} setThemeIndex={setThemeIndex} userProfile={userProfile} saveInvestorBaseInfo={saveInvestorBaseInfo} unitPrefs={unitPrefs} onUnitPrefsChange={onUnitPrefsChange} refreshInterval={refreshInterval} onRefreshIntervalChange={onRefreshIntervalChange} />
        </div>
      </div>
    </div>
  );
}

function ChartDataPanel({ widget }: { widget: NonNullable<ReturnType<typeof buildInvestorHomeVisualization>['sections'][number]>['widgets'][number] }) {
  const tableData = extractTableData(widget);
  const metricCards = extractMetricCards(widget);
  const columns = tableData.length > 0 ? Object.keys(tableData[0] ?? {}).filter(k => k !== '_index') : [];
  const filteredMetricCards = metricCards.filter(card => card.label !== '样本数');

  return (
    <div className="chart-data-panel chart-data-panel-split">
      <div className="chart-data-left">
        {tableData.length > 0 && (
          <div>
            <div className="chart-data-section-title">数据明细</div>
            <div style={{ overflow: 'auto', maxHeight: '240px' }}>
              <table>
                <thead>
                  <tr>
                    {columns.map(col => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.slice(0, 20).map((row, i) => (
                    <tr key={i}>
                      {columns.map(col => (
                        <td key={col}>{String(row[col] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {filteredMetricCards.length > 0 && (
        <div className="chart-data-right">
          <div className="chart-data-section-title">关键指标</div>
          <div className="chart-metric-cards">
            {filteredMetricCards.map((card, i) => (
              <div key={i} className={`chart-metric-card-item status-${card.status}`}>
                <span className="metric-label">{card.label}</span>
                <span className="metric-value">{card.value}</span>
                <span className="metric-meta">
                  {card.yoy !== '—' && `同比 ${card.yoy} `}
                  {card.qoq !== '—' && `环比 ${card.qoq}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InvHome({
  isActive,
  visualization,
  dataFormatter,
  openWorkbench,
  openSettings,
  onRefreshData,
}: {
  isActive: boolean;
  visualization: ReturnType<typeof buildInvestorHomeVisualization>;
  dataFormatter: DataFormatter;
  openWorkbench: () => void;
  openSettings: () => void;
  onRefreshData?: () => void;
}) {
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [refreshSpinning, setRefreshSpinning] = useState(false);
  const [selectedInsight, setSelectedInsight] = useState<{ widgetId: string; insight: any } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      onRefreshData?.();
      setLastRefresh(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, [onRefreshData]);

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

  const homeSection = visualization.sections.find(s => s.page === 'home');
  const homeWidgets = homeSection?.widgets ?? [];

  const barWidget = homeWidgets.find(w => w.id === 'investor-bar');
  const warmthValue = barWidget && barWidget.kind === 'lineChart'
    ? barWidget.data[barWidget.data.length - 1]?.value ?? '--'
    : '--';
  const warmthStatus = typeof warmthValue === 'number'
    ? warmthValue >= 70 ? 'green' : warmthValue >= 50 ? 'yellow' : 'red'
    : 'yellow';

  const boxWidget = homeWidgets.find(w => w.id === 'investor-box-plot');
  const pressureProb = boxWidget && boxWidget.kind === 'boxPlotChart'
    ? (boxWidget.groups.reduce((sum, g) => sum + g.median, 0) / boxWidget.groups.length / 100).toFixed(2)
    : '--';
  const pressureNum = typeof pressureProb === 'string' && pressureProb !== '--' ? parseFloat(pressureProb) : NaN;
  const pressureStatus = !isNaN(pressureNum)
    ? pressureNum < 0.33 ? 'green' : pressureNum >= 0.66 ? 'red' : 'yellow'
    : 'yellow';

  const lithiumSource = visualization.sourceMeta.find(s => s.id === 'investor-industry-benchmark');
  const lithiumTrace = lithiumSource?.trace?.find(t => t.includes('碳酸锂'));
  const lithiumPrice = lithiumTrace
    ? lithiumTrace.replace(/[^0-9.]/g, '') || '--'
    : '--';
  const lithiumTrend = typeof warmthValue === 'number' && warmthValue >= 70 ? '↑' : '↓';

  const stanceSource = visualization.sourceMeta.find(s => s.id === 'investor-profile');
  const stanceTrace = stanceSource?.trace?.[0] ?? '';
  const stanceText = stanceTrace.includes('high') ? '积极' : stanceTrace.includes('low') ? '保守' : '均衡';
  const stanceSignal = stanceText === '积极' ? 'green' : stanceText === '保守' ? 'red' : 'yellow';

  const allChartIds = ['investor-radar', 'investor-box-plot', 'investor-scatter', 'investor-heatmap-viz', 'investor-bar', 'investor-bubble', 'investor-sankey'];

  const allChartWidgets = allChartIds
    .map(id => homeWidgets.find(w => w.id === id))
    .filter((w): w is NonNullable<typeof w> => w != null);

  return (
    <div className={`pg ${isActive ? 'on' : ''}`}>
      <div className="homepage-layout">
        <div className="homepage-refresh-bar">
          <span className="homepage-refresh-time">最近刷新 {formatRefreshTime(lastRefresh)}</span>
          <button className={`homepage-refresh-btn${refreshSpinning ? ' spinning' : ''}`} onClick={handleManualRefresh}>↻</button>
        </div>
        <div className="homepage-ai-search-box" onClick={openWorkbench}>
          <span className="ai-search-icon">✨</span>
          <span className="ai-search-placeholder">点击AI分析师，询问任何关于锂电池企业的经营质量与毛利承压问题...</span>
          <span className="ai-search-action">点击跳转 →</span>
        </div>
        <div className="homepage-metrics-row">
          <div className="homepage-metric-card">
            <span className="homepage-metric-label">行业景气</span>
            <span className="homepage-metric-value">
              {warmthValue}
              <span className={`homepage-metric-dot ${warmthStatus}`} />
            </span>
          </div>
          <div className="homepage-metric-card">
            <span className="homepage-metric-label">承压概率</span>
            <span className="homepage-metric-value">
              {pressureProb}
              <span className={`homepage-metric-dot ${pressureStatus}`} />
            </span>
          </div>
          <div className="homepage-metric-card">
            <span className="homepage-metric-label">锂价</span>
            <span className="homepage-metric-value">
              {lithiumPrice}万/吨
              <span className={`homepage-metric-dot ${lithiumTrend === '↑' ? 'good' : lithiumTrend === '↓' ? 'risk' : 'watch'}`} />
            </span>
          </div>
          <div className="homepage-metric-card">
            <span className="homepage-metric-label">配置立场</span>
            <span className="homepage-metric-value">
              {stanceText}
              <span className={`homepage-metric-dot ${stanceSignal}`} />
            </span>
          </div>
        </div>

        <div className="homepage-all-charts">
          {allChartWidgets.map(widget => {
            return (
              <div
                key={widget.id}
                className="homepage-chart-cell homepage-chart-with-insight"
              >
                <span className="homepage-chart-title">{widget.title}</span>
                <ChartWithInsightPanel
                  widget={widget}
                  selectedInsight={selectedInsight?.widgetId === widget.id ? selectedInsight.insight : null}
                  onInsightChange={(insight) => handleInsightChange(widget.id, insight)}
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

function InvAna({
  isActive,
  currentUserId,
  userProfile,
  refreshUserProfile,
  investorOnboarding,
  openHome,
  openSettings,
  auditPanelState,
  prefetchedSessionHistoryRef,
  unitPrefs,
}: {
  isActive: boolean;
  currentUserId: string | null;
  userProfile: UserProfileResponse | null;
  refreshUserProfile: (userId?: string) => Promise<UserProfileResponse | null>;
  investorOnboarding: InvestorOnboardingDraft;
  openHome: () => void;
  openSettings: () => void;
  auditPanelState: AuditPanelState;
  prefetchedSessionHistoryRef: React.MutableRefObject<SessionHistorySummary[] | null>;
  unitPrefs: UnitPreferences;
}) {
  const [mode, setMode] = useState<InvestorWorkbenchMode>("industryStatus");
  const [sessionContext, setSessionContext] = useState<SessionContext | null>(null);
  const [sessionHistory, setSessionHistory] = useState<SessionHistorySummary[]>([]);
  const [messages, setMessages] = useState<WorkbenchMessage[]>([
    {
      id: createWorkbenchId("msg"),
      variant: "assistant",
      time: formatClockTime(),
      content: "欢迎进入投资分析工作台，正在同步历史对话、画像与会话上下文",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<InvestorAnalysisResponse | null>(null);
  const [timeline, setTimeline] = useState<AnalysisTimelineEntry[]>([]);
  const [attachments, setAttachments] = useState<SessionAttachment[]>([]);
  const [profileUpdate, setProfileUpdate] = useState<ProfileUpdateReceipt | null>(null);
  const [progressState, setProgressState] = useState<{
    stage: AnalysisTimelineEntry["stage"];
    label: string;
    detail?: string;
    progressPercent: number;
  } | null>(null);
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
  const [complexity, setComplexity] = useState<string>("moderate");
  const msgEndRef = useRef<HTMLDivElement>(null);
  const hasInitializedRef = useRef(false);
  const initializedRef = useRef(false);
  const streamingMessageIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const industryRetrievalAgent = analysisResult?.diagnostic.agents.find((agent) => agent.agentId === "industryRetrieval");
  const industryRetrieval = industryRetrievalAgent?.output as IndustryRetrievalOutput | undefined;
  const ragEvidenceDegraded = industryRetrievalAgent?.status === "degraded" || industryRetrieval?.indexStats.fallbackUsed === true;

  const syncSession = useCallback((
    nextContext: SessionContext,
    options?: {
      resetConversation?: boolean;
      seedMessages?: boolean;
      preserveMode?: boolean;
    },
  ) => {
    setSessionContext(nextContext);
    if (!options?.preserveMode) {
      setMode(nextContext.activeMode as InvestorWorkbenchMode);
    }
    setTimeline(nextContext.latestTimeline);
    setAttachments(nextContext.attachments);
    setProfileUpdate(nextContext.latestProfileUpdate ?? null);
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
      setMessages(options.seedMessages === false ? [] : buildSessionMessages(nextContext));
    }
  }, []);

  const refreshHistory = useCallback(async (fallbackContext?: SessionContext) => {
    if (!currentUserId) {
      return [];
    }
    try {
      const response = await fetchInvestorSessions(currentUserId);
      setSessionHistory(response.items);
      return response.items;
    } catch {
      if (fallbackContext) {
        setSessionHistory([buildHistoryFallback(fallbackContext)]);
        return [buildHistoryFallback(fallbackContext)];
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

  const appendAssistantMessage = useCallback((content: string) => {
    appendMessage({
      id: createWorkbenchId("msg"),
      variant: "assistant",
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
    setProfileUpdate(null);
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
          ? {
              ...message,
              content: `${message.content}${chunk}`,
            }
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
          ? {
              ...message,
              content: finalContent.length > 0 ? finalContent : message.content,
            }
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
    const context = await fetchInvestorSessionContext(sessionId, currentUserId!);
    syncSession(context, options ?? { resetConversation: true, seedMessages: true });
    return context;
  }, [currentUserId, syncSession]);

  const handleStreamEvent = useCallback((event: InvestorAnalysisStreamEvent) => {
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
      setTimeline((previous) => mergeTimelineEntries(previous, event.timelineEntry));
      return;
    }

    if (event.type === "delta") {
      if (event.stage === "debate") {
        appendAssistantMessage(event.chunk);
        return;
      }
      appendStreamingChunk(event.chunk);
      return;
    }

    if (event.type === "debate_message") {
      appendMessage(toDebateWorkbenchMessage(event.message));
      return;
    }

    if (event.type === "profile_update") {
      setProfileUpdate(event.profileUpdate);
      appendSystemMessage(`画像更新${event.profileUpdate.summary}`);
      return;
    }

    if (event.type === "clarification_required") {
      if (event.sessionContext) {
        syncSession(event.sessionContext);
        void refreshHistory(event.sessionContext);
      }
      setLoading(false);
      streamingMessageIdRef.current = null;
      appendSystemMessage(
        `待补充研究条件：\n${event.questions.map((question: string, index: number) => `${index + 1}. ${question}`).join("\n")}`,
      );
      return;
    }

    if (event.type === "result") {
      const nextResult = event.result as unknown as InvestorAnalysisResponse;
      setAnalysisResult(nextResult);
      syncSession(nextResult.sessionContext);
      setTimeline(nextResult.timeline);
      setAttachments(nextResult.usedAttachments);
      setProfileUpdate(nextResult.profileUpdate ?? null);
      setProgressState({ stage: "completed", label: "分析完成", progressPercent: 100 });
      setLoading(false);
      if (mode === "investmentRecommendation") {
        streamingMessageIdRef.current = null;
      } else {
        finalizeStreamingMessage(
          nextResult.diagnostic.finalAnswer
            ?? nextResult.deepDive.thesis
            ?? nextResult.industryReport.overview
            ?? "",
        );
      }
      void refreshHistory(nextResult.sessionContext);
      void refreshUserProfile();
      return;
    }

    if (event.type === "error") {
      setLoading(false);
      streamingMessageIdRef.current = null;
      setError(event.message);
      appendSystemMessage(`分析失败${event.message}`);
    }
  }, [appendAssistantMessage, appendMessage, appendStreamingChunk, appendSystemMessage, finalizeStreamingMessage, mode, refreshHistory, refreshUserProfile, syncSession]);

  const send = useCallback(async (override?: string) => {
    const text = (override ?? input).trim();
    const pendingQuestions = sessionContext?.pendingClarificationQuestions ?? [];

    if (!text || !sessionContext || !currentUserId || loading || bootstrapping) {
      return;
    }

    setInput("");
    const detectedIntent = classifyQueryIntent(text);
    const detectedComplexity = (function() {
      if (detectedIntent === "chitchat" || detectedIntent === "meta") return "simple";
      const q = text.toLowerCase();
      if (mode === "investmentRecommendation" || mode === "deepDive") return "full";
      if (["建议","推荐","深度","拆解","投资","辩论","策略","详细分析","全面评估","深入","根因","复盘","规划","方案"].some(k => q.includes(k))) return "full";
      if (["分析","判断","趋势","行业","经营","毛利承压","景气","怎么样","如何","情况","变化","对比","比较","评估","状况","表现"].some(k => q.includes(k))) return "moderate";
      if (["计算","查询","是多少","当前","多少","比率","指数","得分","查一下","告诉我","看一下","看看"].some(k => q.includes(k))) return "simple";
      return "moderate";
    })();
    setComplexity(detectedComplexity);
    setLoading(true);
    setError(null);
    setAnalysisResult(null);
    setTimeline([]);
    setProfileUpdate(null);
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
      await streamInvestorAnalysis(
        {
          role: "investor",
          userId: currentUserId,
          sessionId: sessionContext.sessionId,
          enterpriseName: sessionContext.enterpriseName ?? DEFAULT_ENTERPRISE_NAME,
          focusMode: mode,
          query: text,
          memoryNotes: sessionContext.memoryPreview.map((item) => item.summary).slice(0, 3),
          deepDiveContext: mode === "deepDive"
            ? buildDeepDiveContext(text, pendingQuestions, attachments)
            : undefined,
          complexity: detectedComplexity,
        },
        handleStreamEvent,
        abortController.signal,
      );
    } catch (nextError) {
      if (abortController.signal.aborted) {
        setLoading(false);
        return;
      }
      const message = nextError instanceof Error ? nextError.message : "流式分析失败";
      setLoading(false);
      streamingMessageIdRef.current = null;
      setError(message);
      appendSystemMessage(`分析失败${message}`);
    }
  }, [appendMessage, appendSystemMessage, attachments, bootstrapping, currentUserId, handleStreamEvent, input, loading, mode, sessionContext]);

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
    const fallbackMode = (sessionContext?.activeMode as InvestorWorkbenchMode | undefined) ?? mode;
    const fallbackEnterprise = sessionContext?.enterpriseName ?? DEFAULT_ENTERPRISE_NAME;

    setDeletingHistory(true);
    setHistoryDeleteError(null);

    try {
      const response = await deleteInvestorSessions({
        role: "investor",
        userId: currentUserId,
        sessionIds,
      });
      const deleteMessage = deletingCurrent && sessionIds.length === 1
        ? "已删除 1 条历史对话。"
        : deletingCurrent && sessionIds.length > 1
          ? `已删除${response.deletedCount ?? response.deletedSessionIds.length} 条历史对话。`
          : `已删除${response.deletedCount ?? response.deletedSessionIds.length} 条历史对话。`;
      const nextHistory = await refreshHistory();

      if (deletingCurrent) {
        if (nextHistory.length > 0) {
          await loadSession(nextHistory[0]!.sessionId, {
            resetConversation: true,
            seedMessages: false,
          });
        } else {
          const created = await createInvestorSession({
            role: "investor",
            userId: currentUserId,
            focusMode: fallbackMode,
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

  const fileInputRef = useRef<HTMLInputElement>(null);

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
        const response = await uploadInvestorAttachment({
          role: "investor",
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
        appendSystemMessage(`附件上传失败${message}`);
      } finally {
        setUploading(false);
        resetInput();
      }
    })();
  }, [appendSystemMessage, currentUserId, refreshHistory, refreshUserProfile, sessionContext, syncSession, uploading]);

  const handleModeSwitch = useCallback(async (nextMode: InvestorWorkbenchMode) => {
    if (!sessionContext || !currentUserId || nextMode === mode || switchingMode) {
      return;
    }

    setSwitchingMode(true);
    setError(null);

    try {
      const response = await switchInvestorMode({
        role: "investor",
        userId: currentUserId,
        sessionId: sessionContext.sessionId,
        focusMode: nextMode,
        enterpriseName: sessionContext.enterpriseName ?? DEFAULT_ENTERPRISE_NAME,
        query: `切换${getModeOption(nextMode).label}`,
      });
      syncSession(response.sessionContext);
      setMode(response.activeMode as InvestorWorkbenchMode);
      clearVisibleConversation();
      void refreshHistory(response.sessionContext);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "模式切换失败。");
    } finally {
      setSwitchingMode(false);
    }
  }, [clearVisibleConversation, currentUserId, mode, refreshHistory, sessionContext, switchingMode, syncSession]);

  const handleCreateSession = useCallback(async () => {
    if (bootstrapping || !currentUserId) {
      return;
    }

    setBootstrapping(true);
    setError(null);

    try {
      const response = await createInvestorSession({
        role: "investor",
        userId: currentUserId,
        focusMode: mode,
        enterpriseName: sessionContext?.enterpriseName ?? DEFAULT_ENTERPRISE_NAME,
      });
      syncSession(response.sessionContext, {
        resetConversation: true,
        seedMessages: true,
      });
      void refreshHistory(response.sessionContext);
      appendSystemMessage("已新建投资会话，可立即发起新的分析。");
      void refreshUserProfile();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "新建会话失败。");
    } finally {
      setBootstrapping(false);
    }
  }, [appendSystemMessage, bootstrapping, currentUserId, mode, refreshHistory, refreshUserProfile, sessionContext?.enterpriseName, syncSession]);

  const handleDeleteCurrentSession = useCallback(async () => {
    if (!sessionContext || !currentUserId) {
      return;
    }

    setBootstrapping(true);
    setError(null);

    try {
      const response = await deleteCurrentInvestorSession({
        role: "investor",
        userId: currentUserId,
        sessionId: sessionContext.sessionId,
      });
      if (response.replacementSessionContext) {
        syncSession(response.replacementSessionContext, {
          resetConversation: true,
          seedMessages: false,
        });
        void refreshHistory(response.replacementSessionContext);
        setWorkspaceNotice(response.replacementSessionContext.summary || "已自动重建默认投资会");
      } else {
        setSessionContext(null);
        setTimeline([]);
        setAttachments([]);
        setWorkspaceNotice("已自动重建默认投资会");
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
      const response = await uploadInvestorAttachment({
        role: "investor",
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

  useEffect(() => {
    if (!isActive || initializedRef.current || !currentUserId) {
      return;
    }

    initializedRef.current = true;
    setBootstrapping(true);
    setError(null);

    void (async () => {
      try {
        let history: SessionHistorySummary[];

        if (prefetchedSessionHistoryRef.current && prefetchedSessionHistoryRef.current.length > 0) {
          history = prefetchedSessionHistoryRef.current;
          setSessionHistory(history);
          prefetchedSessionHistoryRef.current = null;
        } else {
          history = await refreshHistory();
        }

        if (history.length > 0) {
          await loadSession(history[0]!.sessionId);
        } else {
          const createdProfile = await createInvestorProfile(buildInvestorProfilePayload(currentUserId, userProfile, investorOnboarding));
          syncSession(createdProfile.sessionContext, {
            resetConversation: true,
            seedMessages: true,
          });
          setMessages((previous) => [
            ...previous,
            {
              id: createWorkbenchId("msg"),
              variant: "system",
              time: formatClockTime(createdProfile.sessionContext.updatedAt),
              content: `画像摘要${createdProfile.portraitSummary}`,
            },
          ]);
          await refreshHistory(createdProfile.sessionContext);
          await refreshUserProfile(currentUserId);
        }
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : "初始化投资工作台失败";
        setError(message);
        setMessages([
          {
            id: createWorkbenchId("msg"),
            variant: "assistant",
            time: formatClockTime(),
            content: `初始化失败：${message}`,
          },
        ]);
      } finally {
        setBootstrapping(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, investorOnboarding, isActive, loadSession, refreshHistory, refreshUserProfile, syncSession, userProfile]);

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
      target.scrollIntoView({ behavior: "smooth" });
    }
  }, [isActive, loading, messages, timeline]);

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

  const handleSelectCompareSession = useCallback(async (summary: SessionHistorySummary) => {
    if (summary.sessionId === sessionContext?.sessionId) {
      return;
    }
    setBootstrapping(true);
    try {
      const context = await fetchInvestorSessionContext(summary.sessionId, currentUserId!);
      setCompareSessionContext(context);
      setHistoryOpen(false);
    } catch (e) {
      setHistoryDeleteError(e instanceof Error ? e.message : "加载对比会话失败");
    } finally {
      setBootstrapping(false);
    }
  }, [currentUserId, sessionContext?.sessionId]);

  const [rawMaterialChange, setRawMaterialChange] = useState<number>(0);
  const [yieldRate, setYieldRate] = useState<number>(90);
  const [lithiumPrice] = useState<number>(9.8);
  const [capacityUtilization] = useState<number>(85);

  const baseMarginStr = userProfile?.profile?.enterpriseBaseInfo?.["毛利率"];
  const baseMarginValue = (Array.isArray(baseMarginStr) ? baseMarginStr[0] : baseMarginStr) ?? "18.5";
  const baseMargin = parseFloat(baseMarginValue) || 18.5;
  const inferredMargin = baseMargin - (rawMaterialChange * 0.3) + ((yieldRate - 90) * 0.4) + ((9.8 - lithiumPrice) * 1.5) + ((capacityUtilization - 85) * 0.2);

  const currentMode = getModeOption(mode);
  const progressPercent = progressState?.progressPercent ?? 0;
  const recentHistory = sessionHistory.slice(0, 6);
  const pendingClarificationQuestions = sessionContext?.pendingClarificationQuestions ?? [];
  const awaitingClarification = mode === "deepDive" && pendingClarificationQuestions.length > 0;
  const inputPlaceholder = awaitingClarification
    ? "请按顺序补充研究目标、时间窗口与风险边界，补充后将继续正式研究"
    : currentMode.placeholder;
  const showMainProgress = loading && Boolean(progressState);
  void showMainProgress;
  const showConversationEmpty = messages.length === 0 && !loading;
  const analysisVisualization = buildInvestorAnalysisVisualization(analysisResult, userProfile, undefined, unitPrefs);

  return (
    <div className={`pg iwb-page ${isActive ? 'on' : ''}`}>
      {analysisVisualization ? (
        <div className="page-viz-stack iwb-viz-stack">
          <VisualizationBoard payload={analysisVisualization} page="analysis" className="page-viz-board" />
        </div>
      ) : null}

      {analysisResult && (
        <DQIGMPSPanelsContainer
          mathAnalysisOutput={extractMathAnalysisFromResponse(analysisResult)}
          isLoading={loading}
          displayMode="grid"
        />
      )}
      <AuditInlineBanner state={auditPanelState} />
      <div className={`cly ${splitMode ? 'iwb-split' : ''}`}>
        <div className="cp" style={{ flex: 1, borderRight: splitMode ? '1px solid #E2E8F0' : 'none', borderTopRightRadius: splitMode ? 0 : '12px', borderBottomRightRadius: splitMode ? 0 : '12px' }}>
          <div className="iwb-top">
            <div className="iwb-headline">
              <div className="iwb-kicker">分析工作台</div>
              <h3>{sessionContext?.enterpriseName ?? DEFAULT_ENTERPRISE_NAME}</h3>
              <p>{sessionContext?.summary ?? "正在同步投资画像、历史对话与会话上下文…"}</p>
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
            <span>当前会话：{sessionContext?.sessionId ?? "初始化中"}</span>
            <span>附件数：{attachments.length}</span>
            <span>最近更新：{sessionContext ? formatSessionTime(sessionContext.updatedAt) : "--"}</span>
          </div>

          <div className="mts">
            {INVESTOR_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`mt2 ${mode === option.value ? 'on' : ''}`}
                onClick={() => void handleModeSwitch(option.value)}
                disabled={!sessionContext || switchingMode}
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

          <div className="cms">
            {showConversationEmpty && (
              <div className="iwb-chat-empty">
                <div className="iwb-chat-empty-badge">{currentMode.label}</div>
                <div className="iwb-chat-empty-title">{EMPTY_WORKBENCH_MESSAGE}</div>
                <div className="iwb-chat-empty-copy">{currentMode.placeholder}</div>
              </div>
            )}
            {messages.map((message) => {
              if (message.variant === "debate" && mode !== "investmentRecommendation") {
                return null;
              }
              return (
                <div
                  key={message.id}
                  className={`m ${message.variant === "user" ? 'u' : 'a'} ${message.variant === "system" ? 'sys' : ''} ${message.variant === "debate" ? 'db' : ''}`}
                >
                  {message.variant === "debate" ? (
                    <div className="mb">
                      <div className="iwb-debate-head">
                        <span className="iwb-debate-role">{message.speakerLabel}</span>
                        <span className="iwb-debate-badge">
                          {message.round} · {message.speakerRole === "judge" ? "裁判" : message.speakerRole === "system" ? "系统" : "辩手"}
                        </span>
                        <span className="iwb-debate-model">{message.speakerModel}</span>
                      </div>
                      <div className="iwb-debate-content">{message.content}</div>
                    </div>
                  ) : (
                    <div className="mb" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7 }}><MessageWithCharts content={message.content} /></div>
                  )}
                  <div className="mt">{message.time}</div>
                </div>
              );
            })}
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
                    {progressState?.label ?? "AI 正在处理"}
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
                  {progressState && (
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
                title="上传资料（真API）"
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
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button className="cse" onClick={() => void send()} disabled={!sessionContext || loading || bootstrapping}></button>
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
                {buildSessionMessages(compareSessionContext).map((message) => (
                  <div
                    key={message.id}
                    className={`m ${message.variant === "user" ? 'u' : 'a'} ${message.variant === "system" ? 'sys' : ''} ${message.variant === "debate" ? 'db' : ''}`}
                  >
                    {message.variant === "debate" ? (
                      <div className="mb">
                        <div className="iwb-debate-head">
                          <span className="iwb-debate-role">{message.speakerLabel}</span>
                          <span className="iwb-debate-badge">
                            {message.round} · {message.speakerRole === "judge" ? "裁判" : message.speakerRole === "system" ? "系统" : "辩手"}
                          </span>
                          <span className="iwb-debate-model">{message.speakerModel}</span>
                        </div>
                        <div className="iwb-debate-content">{message.content}</div>
                      </div>
                    ) : (
                      <div className="mb">{message.content}</div>
                    )}
                    <div className="mt">{message.time}</div>
                  </div>
                ))}
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
              <h5>What-If 沙盘推演</h5>
            </div>
            <div className="iwb-result-block" style={{ padding: '12px' }}>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                  <span>原材料价格波动</span>
                  <span>{rawMaterialChange > 0 ? '+' : ''}{rawMaterialChange}%</span>
                </div>
                <input
                  type="range"
                  min="-30" max="30" step="1"
                  value={rawMaterialChange}
                  onChange={(e) => setRawMaterialChange(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#3B82F6' }}
                />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                  <span>良品率</span>
                  <span>{yieldRate}%</span>
                </div>
                <input
                  type="range"
                  min="70" max="100" step="1"
                  value={yieldRate}
                  onChange={(e) => setYieldRate(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#3B82F6' }}
                />
              </div>
              <div style={{ padding: '8px', background: '#F8FAFC', borderRadius: '4px' }}>
                <div style={{ fontSize: '12px', color: '#94A3B8' }}>基准毛利率：{baseMargin.toFixed(2)}%</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: inferredMargin < baseMargin ? 'var(--red)' : '#10B981', marginTop: '4px' }}>
                  推演后毛利率：{inferredMargin.toFixed(2)}%
                </div>
              </div>
            </div>
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

          {analysisResult && (
            <div className="ss">
              <div className="iwb-section-title">
                <h5>分析摘要</h5>
                <span>{analysisResult.recommendation.stance}</span>
              </div>
              <div className="iwb-result-card">
                <div className="iwb-score">{analysisResult.recommendation.score}</div>
                <div className="iwb-score-copy">
                  <div className="iwb-score-label">推荐立场</div>
                  <div className="iwb-score-value">{analysisResult.recommendation.stance}</div>
                </div>
              </div>
              <div className="iwb-result-block">
                <div className="iwb-result-title">行业结论</div>
                <div className="iwb-result-text">{analysisResult.industryReport.overview}</div>
              </div>
              <div className="iwb-result-block">
                <div className="iwb-result-title">深度解析</div>
                <div className="iwb-result-text">{analysisResult.deepDive.thesis}</div>
              </div>
              {mode === "investmentRecommendation" && (
              <div className="iwb-result-block">
                <div className="iwb-result-title">正式辩论</div>
                <div className="iwb-result-text">{analysisResult.debate.summary}</div>
                {analysisResult.debate.rounds.map((round) => (
                  <div key={round.round} className="iwb-round-item">
                    <span>{round.round} </span>
                    <span>{round.verdict}</span>
                  </div>
                ))}
              </div>
              )}
              <div className="iwb-result-block">
                <div className="iwb-result-title">证据摘要</div>
                {analysisResult.evidenceSummary.map((item) => (
                  <div key={item} className="iwb-bullet">{item}</div>
                ))}
              </div>
              {industryRetrieval && (
                <div className="iwb-result-block">
                  <div className="iwb-result-title">服务端RAG证据来源</div>
                  <div className="iwb-result-text">{industryRetrieval.retrievalSummary}</div>
                  {industryRetrieval.citations.length > 0 ? industryRetrieval.citations.map((citation: { id: string; source: string; publishedAt?: string; retrievedAt: string }) => (
                    <div
                      key={citation.id}
                      className="iwb-insight-item"
                      style={{ alignItems: 'flex-start', gap: '8px' }}
                    >
                      <span>{`来源：${citation.source}`}</span>
                      <span>{`时间：${formatAbsoluteTime(citation.publishedAt ?? citation.retrievedAt)} · 是否降级：${ragEvidenceDegraded ? "是" : "否"}`}</span>
                    </div>
                  )) : (
                    <div className="iwb-empty">暂无服务端可展示的引用来源</div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="ss">
            <div className="iwb-section-title">
              <h5>上传资料</h5>
              <span>{attachments.length} </span>
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
                      <span>{getModeOption(summary.activeMode).label}</span>
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
              <div key={item.label} className="ii" onClick={() => void send(`请结合当前会话分析「${item.label}」，当前值为 ${item.value}。`)}>
                <span className="inn">{item.label}</span>
                <span className="iv">{item.value}</span>
                <div className="ia">+</div>
              </div>
            ))}
          </div>

          {profileUpdate && (
            <div className="ss">
              <div className="iwb-section-title">
                <h5>画像更新</h5>
                <span>{profileUpdate.updatedFields.length} 项</span>
              </div>
              <div className="iwb-result-text">{profileUpdate.summary}</div>
              {profileUpdate.extractedInsights.map((insight) => (
                <div key={`${insight.category}-${insight.value}`} className="iwb-insight-item">
                  <span>{insight.category}</span>
                  <span>{insight.value}</span>
                </div>
              ))}
            </div>
          )}
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
                      <span>{getModeOption(summary.activeMode).label}</span>
                      <span>{summary.attachmentCount} 个附件</span>
                      <span>{summary.investedEnterprises.slice(0, 2).join("、") || "未同步关注标的"}</span>
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
                <div className="iwb-empty">暂无历史对话，系统将在首次画像初始化后自动创建会话</div>
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
              <span>{getModeOption(historyPreview.activeMode).label}</span>
              <span>{formatAbsoluteTime(historyPreview.updatedAt)}</span>
              <span>{historyPreview.attachmentCount} 个附件</span>
              <span>{historyPreview.sessionId === sessionContext?.sessionId ? "当前会话" : "历史会话"}</span>
            </div>
            <div className="iwb-history-preview-summary">
              {historyPreview.summary || "暂无摘要信息"}
            </div>
            <div className="iwb-history-preview-meta">
              <div>
                <span>关注标的</span>
                <strong>{historyPreview.investedEnterprises.join("、") || "未同步"}</strong>
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

function InvSet({ isActive, openMem, isDark, setIsDark, themeIndex, setThemeIndex, userProfile, saveInvestorBaseInfo, onUnitPrefsChange, refreshInterval, onRefreshIntervalChange }: InvSetProps & { unitPrefs: UnitPreferences; onUnitPrefsChange: (prefs: UnitPreferences) => void; refreshInterval: number; onRefreshIntervalChange: (ms: number) => void }) {
  const profile = userProfile?.profile;

  return (
    <div className={`pg ${isActive ? 'on' : ''}`}>
      <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '12px', letterSpacing: '.6px' }}>偏好设置</div>
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
        <div className="sr"><span className="sl2">分析角色</span><span style={{ color: '#8B5CF6', fontSize: '12px' }}>投资人员</span></div>
        <div className="sr"><span className="sl2">当前用户</span><span style={{ color: '#475569', fontSize: '12px' }}>{profile?.displayName || profile?.userId || "初始化中"}</span></div>
        <div className="sr"><span className="sl2">关注企业</span><span style={{ color: '#94A3B8', fontSize: '12px' }}>{profile?.investedEnterprises.slice(0, 2).join("、") || "待同步"}</span></div>
        <EditableBaseInfoPanel title="投资基本信息" baseInfo={profile?.investorBaseInfo} emptyText="可补充可投资资产、关注企业、风险偏好等关键信息。" presetGroups={INVESTOR_BASE_INFO_GROUPS} onSave={saveInvestorBaseInfo} />
      </div>
      <div className="sts2"><h3>🤖 Agent 任务</h3>
        <div className="sr"><span className="sl2">自动推送频率</span><div className="sc"><select className="ssel"><option>每日一次</option><option>每周一次</option><option>有异动时</option></select></div></div>
        <div className="sr"><span className="sl2">重大事件推送</span><div className="sw on"></div></div>
      </div>
      <div className="sts2">
        <button className="mbtn" onClick={openMem}>
          <div className="mi2">🧠</div><span>记忆中的你</span>
        </button>
      </div>
    </div>
  );
}
