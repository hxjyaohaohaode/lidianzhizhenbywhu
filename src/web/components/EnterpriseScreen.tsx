import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  analyzeEnterprise,
  collectEnterpriseData,
  type EnterpriseAnalysisResponse,
} from "../api.js";
import {
  buildEnterpriseVisualization,
  type EnterpriseOnboardingDraft,
} from "../chart-data.js";
import { VisualizationBoard } from "../chart-system.js";
import { UnitSelector } from "../UnitSelector.js";
import { DataFormatter, type UnitPreferences } from "../data-formatter.js";
import {
  DQIGMPSPanelsContainer,
  extractMathAnalysisFromResponse,
} from "../dqi-gmps-panels.js";
import { MessageWithCharts } from "../chart-renderer.js";
import type {
  EditableBusinessInfo,
  EnterpriseAnalysisRequest,
  UserProfileResponse,
} from "../../shared/business.js";
import {
  type AuditPanelState,
  type AppTab,
  classifyQueryIntent,
  dedupeStrings,
  ENTERPRISE_BASE_INFO_GROUPS,
} from "../utils/helpers.js";
import { usePortalAuditReport } from "./CompetitiveBaselinePanel.js";
import { buildEnterpriseCollectionPayload } from "../utils/enterprise-payload.js";
import { EditableBaseInfoPanel } from "./EditableBaseInfoPanel.js";
import { AuditInlineBanner } from "./CompetitiveBaselinePanel.js";

type EnterpriseScreenProps = {
  tab: AppTab;
  setTab: (tab: AppTab) => void;
  openMem: () => void;
  isDark: boolean;
  setIsDark: (isDark: boolean) => void;
  themeIndex: number;
  setThemeIndex: (themeIndex: number) => void;
  currentUserId: string | null;
  enterpriseOnboarding: import("../chart-data.js").EnterpriseOnboardingDraft;
  userProfile: UserProfileResponse | null;
  refreshUserProfile: (userId?: string) => Promise<UserProfileResponse | null>;
  saveEnterpriseBaseInfo: (baseInfo: EditableBusinessInfo) => Promise<void>;
  unitPrefs: import("../data-formatter.js").UnitPreferences;
  dataFormatter: import("../data-formatter.js").DataFormatter;
  onUnitPrefsChange: (prefs: import("../data-formatter.js").UnitPreferences) => void;
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

function WorkbenchShortcutPanel({ 
  badge, 
  title, 
  description, 
  highlights, 
  primaryLabel, 
  secondaryLabel, 
  onPrimaryClick, 
  onSecondaryClick 
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
  const titles = { home: '首页', ana: '分析', set: '设置' };
  const enterpriseVisualization = useMemo(
    () => buildEnterpriseVisualization(userProfile, enterpriseOnboarding, undefined, undefined, unitPrefs),
    [userProfile, enterpriseOnboarding, unitPrefs]
  );
  const auditPanelState = usePortalAuditReport("enterprise", tab === "home" || tab === "ana", currentUserId);
  
  return (
    <div className="al">
      <nav className="nv">
        <div className="nl">
          <img src="/images/logo.png" alt="锂智诊断" className="nav-logo-img" width="40" height="40" />
        </div>
        <div className={`ni ${tab === 'home' ? 'on' : ''}`} onClick={() => setTab('home')}><span>🏠</span><span className="tp">首页</span></div>
        <div className={`ni ${tab === 'ana' ? 'on' : ''}`} onClick={() => setTab('ana')}><span>💬</span><span className="tp">分析</span></div>
        <div className={`ni ${tab === 'set' ? 'on' : ''}`} onClick={() => setTab('set')}><span>⚙️</span><span className="tp">设置</span></div>
        <div className="nsp"></div>
        <div className="nav2"></div>
      </nav>
      <div className="am">
        <div className="at">
          <span className="att">{titles[tab as keyof typeof titles]}</span>
          <div className="atr">
            <UnitSelector onChange={onUnitPrefsChange} />
            <button className="ab" onClick={onRefreshData} disabled={isRefreshing} title={isRefreshing ? "刷新中..." : lastDataRefreshAt ? `上次刷新: ${lastDataRefreshAt}` : "刷新数据"} style={isRefreshing ? { opacity: 0.5, cursor: 'wait' } : undefined}>
              <span style={{ display: 'inline-block', animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }}>🔄</span>
            </button>
            <button className="ab" onClick={() => window.print()} title="导出报告">📄</button>
          </div>
        </div>
        <div className="ac">
          <EntHome isActive={tab === 'home'} visualization={enterpriseVisualization} dataFormatter={dataFormatter} openWorkbench={() => setTab("ana")} openSettings={() => setTab("set")} />
          <EntAna isActive={tab === 'ana'} visualization={enterpriseVisualization} currentUserId={currentUserId} userProfile={userProfile} enterpriseOnboarding={enterpriseOnboarding} refreshUserProfile={refreshUserProfile} openHome={() => setTab("home")} openSettings={() => setTab("set")} auditPanelState={auditPanelState} />
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
  openSettings,
}: {
  isActive: boolean;
  visualization: ReturnType<typeof buildEnterpriseVisualization>;
  dataFormatter: DataFormatter;
  openWorkbench: () => void;
  openSettings: () => void;
}) {
  return (
    <div className={`pg ${isActive ? 'on' : ''}`}>
      <div className="page-viz-stack">
        <VisualizationBoard payload={visualization} page="home" className="page-viz-board" dataFormatter={dataFormatter} />
      </div>
      <div className="home-utility-grid">
        <WorkbenchShortcutPanel
          badge="企业端工作台"
          title="经营诊断入口已闭环"
          description="从首页进入经营工作台后，可继续回看总览、补充企业资料，并联动下方图表诊断"
          highlights={["首页总览", "经营分析", "基本信息维护"]}
          primaryLabel="进入经营工作台"
          secondaryLabel="维护基本信息"
          onPrimaryClick={openWorkbench}
          onSecondaryClick={openSettings}
        />
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
): EnterpriseAnalysisRequest {
  const collectionPayload = buildEnterpriseCollectionPayload(userId, draft, userProfile);
  return {
    role: "enterprise",
    userId,
    sessionId,
    enterpriseName: collectionPayload.enterpriseName,
    query,
    focusMode: /深度|拆解|根因|详细|复盘/.test(query) ? "deepDive" : "operationalDiagnosis",
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

function formatEnterpriseAssistantResponse(response: EnterpriseAnalysisResponse) {
  const personalization = (response as EnterpriseAnalysisResponse & {
    personalization?: {
      summary?: string;
      nextTasks?: string[];
    };
  }).personalization;
  const insightLines = response.highlights.combinedInsights.map((item) => `${item}`).join("\n");
  const taskLines = personalization?.nextTasks?.map((item) => `${item}`).join("\n");

  return [
    "📊 <b>真实接口分析已返回</b>",
    response.diagnostic.finalAnswer,
    insightLines ? `\n关键关注：\n${insightLines}` : "",
    personalization?.summary ? `\n画像提示${personalization.summary}` : "",
    taskLines ? `\n建议下一步：\n${taskLines}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function EntAna({
  isActive,
  visualization,
  currentUserId,
  userProfile,
  enterpriseOnboarding,
  refreshUserProfile,
  openHome,
  openSettings,
  auditPanelState,
}: {
  isActive: boolean;
  visualization: ReturnType<typeof buildEnterpriseVisualization>;
  currentUserId: string | null;
  userProfile?: UserProfileResponse | null;
  enterpriseOnboarding: EnterpriseOnboardingDraft;
  refreshUserProfile: (userId?: string) => Promise<UserProfileResponse | null>;
  openHome: () => void;
  openSettings: () => void;
  auditPanelState: AuditPanelState;
}) {
  const [messages, setMessages] = useState<{ role: 'u' | 'a', text: string, time: string }[]>([
    {
      role: 'a',
      time: '13:20',
      text: "👋 您好！我是锂电智诊智能分析助手。\n\n当前工作台已接入企业端真实分析接口。您可以直接提问，系统会结合已采集的经营数据、行业上下文和企业画像返回真实诊断结果"
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressState, setProgressState] = useState<{label: string; detail?: string} | null>(null);
  const msgEndRef = useRef<HTMLDivElement>(null);
  const hasInitializedRef = useRef(false);
  const [enterpriseSessionId, setEnterpriseSessionId] = useState<string | null>(null);
  const [collectionSummaryText, setCollectionSummaryText] = useState<string | null>(null);
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high" | null>(null);
  const collectionBootstrapRef = useRef<string | null>(null);

  const [rawMaterialChange, setRawMaterialChange] = useState<number>(0);
  const [yieldRate, setYieldRate] = useState<number>(90);
  const [lithiumPrice, setLithiumPrice] = useState<number>(9.8);
  const [capacityUtilization, setCapacityUtilization] = useState<number>(85);

  // DQI/GMPS 面板数据存储
  const [lastAnalysisResponse, setLastAnalysisResponse] = useState<EnterpriseAnalysisResponse | null>(null);
  const [complexity, setComplexity] = useState<string>("moderate");

  const baseMarginStr = userProfile?.profile?.enterpriseBaseInfo?.["毛利率"];
  const baseMarginValue = (Array.isArray(baseMarginStr) ? baseMarginStr[0] : baseMarginStr) ?? "18.5";
  const baseMargin = parseFloat(baseMarginValue) || 18.5;
  const inferredMargin = baseMargin - (rawMaterialChange * 0.3) + ((yieldRate - 90) * 0.4) + ((9.8 - lithiumPrice) * 1.5) + ((capacityUtilization - 85) * 0.2);

  const gt = () => { const d = new Date(); return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0') };

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
    setEnterpriseSessionId(collectionResponse.sessionContext.sessionId);
    setCollectionSummaryText(
      `${collectionResponse.collectionSummary.confidentialityNotice} 当前覆盖：${collectionResponse.collectionSummary.capturedModules.join("、") || "企业经营数据"}`,
    );
    return collectionResponse.sessionContext.sessionId;
  }, [currentUserId, enterpriseOnboarding, enterpriseSessionId, userProfile]);

  const send = useCallback(async (override?: string) => {
    const text = override || input.trim();
    if (!text || loading) {
      return;
    }

    if (!currentUserId) {
      setMessages((prev) => [
        ...prev,
        { role: 'a', text: "⚠️ 当前用户尚未完成初始化，暂时无法调用真实企业分析接口。", time: gt() },
      ]);
      return;
    }

    setInput('');
    setMessages((prev) => [...prev, { role: 'u', text, time: gt() }]);
    const detectedIntent = classifyQueryIntent(text);
    const detectedComplexity = (function() {
      if (detectedIntent === "chitchat" || detectedIntent === "meta") return "simple";
      const q = text.toLowerCase();
      const inferredFocusMode = /深度|拆解|根因|详细|复盘/.test(text) ? "deepDive" : "operationalDiagnosis";
      if (inferredFocusMode === "deepDive") return "full";
      if (["建议","推荐","深度","拆解","投资","辩论","策略","详细分析","全面评估","深入","根因","复盘","规划","方案"].some(k => q.includes(k))) return "full";
      if (["分析","判断","趋势","行业","经营","毛利承压","景气","怎么样","如何","情况","变化","对比","比较","评估","状况","表现"].some(k => q.includes(k))) return "moderate";
      if (["计算","查询","是多少","当前","多少","比率","指数","得分","查一下","告诉我","看一下","看看"].some(k => q.includes(k))) return "simple";
      return "moderate";
    })();
    setComplexity(detectedComplexity);
    setLoading(true);
    setProgressPercent(0);
    setProgressState({ label: detectedIntent === "chitchat" ? "对话处理中" : detectedIntent === "meta" ? "查询中" : "开始分析..." });

    try {
      const sessionId = await ensureEnterpriseSession();
      const analysisResponse = await analyzeEnterprise(
        buildEnterpriseAnalysisRequestPayload(
          currentUserId,
          sessionId,
          text,
          enterpriseOnboarding,
          userProfile,
          detectedComplexity,
        ),
      );
      setEnterpriseSessionId(analysisResponse.sessionContext.sessionId);
      const isConversation = detectedIntent === "chitchat" || detectedIntent === "meta";
      if (!isConversation) {
        setRiskLevel(analysisResponse.highlights.combinedRiskLevel);
        setLastAnalysisResponse(analysisResponse);
        setCollectionSummaryText(
          `${analysisResponse.collectionSummary.confidentialityNotice} 当前覆盖：${analysisResponse.collectionSummary.capturedModules.join("、") || "企业经营数据"}`,
        );
      }
      setMessages((prev) => [
        ...prev,
        { role: 'a', text: isConversation ? analysisResponse.diagnostic.finalAnswer : formatEnterpriseAssistantResponse(analysisResponse), time: gt() },
      ]);
      void refreshUserProfile(currentUserId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "企业端真实分析暂时失败，请稍后重试";
      setMessages((prev) => [
        ...prev,
        { role: 'a', text: `⚠️ <b>真实接口调用失败</b>\n\n${message}`, time: gt() },
      ]);
    } finally {
      setProgressPercent(100);
      setProgressState({ label: "分析完成" });
      setLoading(false);
    }
  }, [currentUserId, enterpriseOnboarding, ensureEnterpriseSession, input, loading, refreshUserProfile, userProfile]);

  const addInd = (n: string, v: string) => {
    void send(`请分析${n}」（当前值：${v}）`);
  };

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

  return (
    <div className={`pg ${isActive ? 'on' : ''}`}>
      <div className="page-viz-stack">
        <VisualizationBoard payload={visualization} page="analysis" className="page-viz-board" />
      </div>

      {/* DQI & GMPS 诊断结果面板 */}
      {lastAnalysisResponse && (
        <DQIGMPSPanelsContainer
          mathAnalysisOutput={extractMathAnalysisFromResponse(lastAnalysisResponse)}
          isLoading={loading}
          displayMode="grid"
        />
      )}
      {collectionSummaryText && (
        <div className="enterprise-sync-banner">
          <strong>企业数据已通过真实接口同步</strong>
          <span>{collectionSummaryText}</span>
        </div>
      )}
      <AuditInlineBanner state={auditPanelState} />
      <div className="cly enterprise-chat-shell">
        <div className="cp">
          <div className="cms">
            {messages.map((m, i) => (
              <div key={i} className={`m ${m.role}`}>
                <div className="mb" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7 }}><MessageWithCharts content={m.text} /></div>
                <div className="mt">{m.time}</div>
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
              </div>
            )}
            <div ref={msgEndRef} />
          </div>
          <div className="cia">
            <div className="ciw">
              <textarea 
                className="ci" 
                rows={1} 
                placeholder="请输入经营诊断问题，系统将调用真实企业分析接.." 
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              />
              <button className="cse" onClick={() => void send()}></button>
            </div>
          </div>
        </div>
        <div className="csb">
          <div className="ss">
            <div className="iwb-section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <h5>What-If 沙盘推演</h5>
            </div>
            <div className="iwb-result-block" style={{ padding: '12px' }}>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                  <span>原材料价格波</span>
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
                    <span>良品</span>
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
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                    <span>碳酸锂预期价</span>
                    <span>{lithiumPrice}</span>
                  </div>
                  <input
                    type="range"
                    min="5" max="20" step="0.1"
                    value={lithiumPrice}
                    onChange={(e) => setLithiumPrice(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#3B82F6' }}
                  />
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                    <span>产能利用</span>
                    <span>{capacityUtilization}%</span>
                  </div>
                  <input
                    type="range"
                    min="50" max="100" step="1"
                    value={capacityUtilization}
                    onChange={(e) => setCapacityUtilization(Number(e.target.value))}
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
        </div>
      </div>
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

// --- APP INVESTOR ---