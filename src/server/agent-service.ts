import {
  type AcceptanceEvidenceMode,
  agentIdSchema,
  diagnosticAgentRequestSchema,
  type AgentExecutionResult,
  type AgentId,
  type CitationConfidence,
  type CompetitiveAcceptanceReport,
  type CompetitiveAcceptanceScenarioResult,
  type CompetitiveMetricId,
  type CompetitiveMetricResult,
  type DataGatheringOutput,
  type DataUnderstandingOutput,
  type DegradationEvent,
  type DiagnosticAgentRequest,
  type DiagnosticRole,
  type DualPortalDataChannel,
  type DualPortalPageMatrixEntry,
  type DualPortalPersonalizationAuditReport,
  type DualPortalPersonalizationDriver,
  type DiagnosticWorkflowResponse,
  type EvidenceReviewOutput,
  type ExpressionGenerationOutput,
  type FocusMode,
  type IndustryEvidence,
  type IndustryRetrievalOutput,
  type ModelConnectivityAcceptanceCase,
  type MinimumDeploymentAuditCheck,
  type MinimumDeploymentAuditReport,
  type MathAnalysisOutput,
  type MemoryManagementOutput,
  type RagDocumentType,
  type TaskPlanStep,
  type TaskComplexity,
  type QueryIntent,
  type WorkflowAcceptanceResult,
} from "../shared/agents.js";
import {
  getConfiguredProviders,
  getDeploymentReadiness,
  getRuntimeReadiness,
  type ServerEnv,
} from "../shared/config.js";
import { AppError } from "./errors.js";
import { ModelExecutionError, ModelRouter, createDefaultAdapters, type LlmCapability } from "./llm.js";
import { InMemoryMemoryStore } from "./memory.js";
import { analyzeGrossMarginPressure, analyzeOperatingQuality, calculateDQI, calculateGMPS } from "./models.js";
import { PlatformStore } from "./platform-store.js";
import { RealtimeIndustryRagService } from "./realtime-rag.js";
import type { RealtimeRagResponse } from "../shared/rag.js";
import { DataGatheringAgent } from "./data/data-fetcher.js";

type WorkflowDependencies = {
  modelRouter?: ModelRouter;
  memoryStore?: InMemoryMemoryStore;
  ragService?: RealtimeIndustryRagService;
  dataGatheringAgent?: DataGatheringAgent;
  platformStore?: PlatformStore;
};

type AcceptanceBenchmarkScenario = {
  scenarioId: string;
  label: string;
  payload: DiagnosticAgentRequest;
};

const workflowPlan: TaskPlanStep[] = [
  {
    agentId: "taskOrchestrator",
    goal: "拆解目标并规划执行路径",
    dependsOn: [],
    executionMode: "serial",
  },
  {
    agentId: "memoryManagement",
    goal: "召回历史记忆并维护上下文",
    dependsOn: [],
    executionMode: "parallel",
  },
  {
    agentId: "dataGathering",
    goal: "自动化采集外部财报与宏观数据",
    dependsOn: ["taskOrchestrator"],
    executionMode: "parallel",
  },
  {
    agentId: "dataUnderstanding",
    goal: "理解问题与数据完备性",
    dependsOn: ["taskOrchestrator", "memoryManagement"],
    executionMode: "parallel",
  },
  {
    agentId: "mathAnalysis",
    goal: "执行数学模型分析",
    dependsOn: ["taskOrchestrator", "dataGathering"],
    executionMode: "parallel",
  },
  {
    agentId: "industryRetrieval",
    goal: "整合行业检索证据",
    dependsOn: ["taskOrchestrator"],
    executionMode: "parallel",
  },
  {
    agentId: "evidenceReview",
    goal: "审校证据链与结论可信度",
    dependsOn: ["dataUnderstanding", "mathAnalysis", "industryRetrieval", "dataGathering"],
    executionMode: "serial",
  },
  {
    agentId: "expressionGeneration",
    goal: "输出结论与行动建议",
    dependsOn: ["evidenceReview", "memoryManagement"],
    executionMode: "serial",
  },
];

const acceptanceMetricBaselines = [
  { metricId: "timeliness", label: "时效性", threshold: 70 },
  { metricId: "credibility", label: "可信度", threshold: 75 },
  { metricId: "personalization", label: "个性化", threshold: 65 },
  { metricId: "collaborationEfficiency", label: "协同效率", threshold: 65 },
] as const satisfies ReadonlyArray<{
  metricId: CompetitiveMetricId;
  label: string;
  threshold: number;
}>;

const acceptanceBenchmarkScenarios: AcceptanceBenchmarkScenario[] = [
  {
    scenarioId: "enterprise-baseline",
    label: "企业经营诊断基线",
    payload: {
      role: "enterprise",
      userId: "acceptance-enterprise",
      enterpriseName: "宁德时代",
      query: "请判断当前毛利承压与经营质量变化，并给出优先动作",
      focusMode: "operationalDiagnosis",
      grossMarginInput: {
        currentGrossMargin: 18,
        baselineGrossMargin: 24,
        currentRevenue: 1350,
        baselineRevenue: 1200,
        currentCost: 1110,
        baselineCost: 900,
        currentSalesVolume: 98,
        baselineSalesVolume: 100,
        currentInventoryExpense: 88,
        baselineInventoryExpense: 72,
      },
      operatingQualityInput: {
        currentSalesVolume: 98,
        baselineSalesVolume: 95,
        currentProductionVolume: 104,
        baselineProductionVolume: 100,
        currentManufacturingExpense: 630,
        baselineManufacturingExpense: 600,
        currentOperatingCost: 990,
        baselineOperatingCost: 930,
        currentOperatingCashFlow: 110,
        baselineOperatingCashFlow: 145,
        currentRevenue: 1350,
        baselineRevenue: 1200,
        currentTotalLiabilities: 760,
        baselineTotalLiabilities: 700,
        currentTotalAssets: 1480,
        baselineTotalAssets: 1460,
        currentNetProfit: 180,
        baselineNetProfit: 150,
        currentBeginNetAssets: 700,
        currentEndNetAssets: 720,
        baselineBeginNetAssets: 680,
        baselineEndNetAssets: 700,
        currentRevenueForDQI: 1350,
        baselineRevenueForDQI: 1200,
        currentOCFNet: 110,
        baselineOCFNet: 145,
      },
      memoryNotes: ["关注库存周转", "重点看现金流质量"],
      industryContext: {
        marketDemandIndex: 96,
        materialCostTrend: "up",
        policySignals: ["储能项目招标放量"],
      },
    },
  },
  {
    scenarioId: "enterprise-followup",
    label: "企业追踪复盘基线",
    payload: {
      role: "enterprise",
      userId: "acceptance-enterprise",
      enterpriseName: "宁德时代",
      query: "延续上轮结论，判断风险是否缓和并更新行动建议",
      focusMode: "deepDive",
      grossMarginInput: {
        currentGrossMargin: 19.5,
        baselineGrossMargin: 24,
        currentRevenue: 1405,
        baselineRevenue: 1200,
        currentCost: 1132,
        baselineCost: 900,
        currentSalesVolume: 102,
        baselineSalesVolume: 100,
        currentInventoryExpense: 80,
        baselineInventoryExpense: 72,
      },
      operatingQualityInput: {
        currentSalesVolume: 102,
        baselineSalesVolume: 95,
        currentProductionVolume: 106,
        baselineProductionVolume: 100,
        currentManufacturingExpense: 635,
        baselineManufacturingExpense: 600,
        currentOperatingCost: 1002,
        baselineOperatingCost: 930,
        currentOperatingCashFlow: 126,
        baselineOperatingCashFlow: 145,
        currentRevenue: 1405,
        baselineRevenue: 1200,
        currentTotalLiabilities: 748,
        baselineTotalLiabilities: 700,
        currentTotalAssets: 1498,
        baselineTotalAssets: 1460,
        currentNetProfit: 200,
        baselineNetProfit: 160,
        currentBeginNetAssets: 720,
        currentEndNetAssets: 750,
        baselineBeginNetAssets: 700,
        baselineEndNetAssets: 720,
        currentRevenueForDQI: 1405,
        baselineRevenueForDQI: 1200,
        currentOCFNet: 126,
        baselineOCFNet: 145,
      },
      memoryNotes: ["继续跟踪订单兑现", "复核库存去化节奏"],
      industryContext: {
        marketDemandIndex: 101,
        materialCostTrend: "flat",
        policySignals: ["储能需求延续", "出口订单保持改善"],
      },
    },
  },
  {
    scenarioId: "investor-recommendation",
    label: "投资建议个性化基线",
    payload: {
      role: "investor",
      userId: "acceptance-investor",
      enterpriseName: "宁德时代",
      query: "面向偏好现金流稳健与政策弹性的投资者，给出当前建议",
      focusMode: "investmentRecommendation",
      grossMarginInput: {
        currentGrossMargin: 22,
        baselineGrossMargin: 20,
        currentRevenue: 1520,
        baselineRevenue: 1360,
        currentCost: 1185,
        baselineCost: 1100,
        currentSalesVolume: 112,
        baselineSalesVolume: 103,
        currentInventoryExpense: 66,
        baselineInventoryExpense: 72,
      },
      operatingQualityInput: {
        currentSalesVolume: 112,
        baselineSalesVolume: 103,
        currentProductionVolume: 116,
        baselineProductionVolume: 108,
        currentManufacturingExpense: 660,
        baselineManufacturingExpense: 640,
        currentOperatingCost: 1050,
        baselineOperatingCost: 1010,
        currentOperatingCashFlow: 168,
        baselineOperatingCashFlow: 142,
        currentRevenue: 1520,
        baselineRevenue: 1360,
        currentTotalLiabilities: 710,
        baselineTotalLiabilities: 700,
        currentTotalAssets: 1510,
        baselineTotalAssets: 1470,
        currentNetProfit: 220,
        baselineNetProfit: 180,
        currentBeginNetAssets: 750,
        currentEndNetAssets: 800,
        baselineBeginNetAssets: 720,
        baselineEndNetAssets: 750,
        currentRevenueForDQI: 1520,
        baselineRevenueForDQI: 1360,
        currentOCFNet: 168,
        baselineOCFNet: 142,
      },
      memoryNotes: ["偏好现金流稳健企业", "优先看政策弹性"],
      industryContext: {
        marketDemandIndex: 108,
        materialCostTrend: "down",
        policySignals: ["动力电池出口改善"],
      },
    },
  },
];

const modelConnectivityAcceptanceCases = [
  {
    caseId: "qwen-orchestrator-intent",
    label: "Qwen3.5-Plus 中枢编排验收",
    provider: "qwen35Plus",
    capability: "planning",
    prompt: "请将“判断锂电池企业毛利承压与经营质量变化”拆解为多智能体执行步骤。",
    context: {
      role: "enterprise",
      focusMode: "operationalDiagnosis",
      query: "拆解企业诊断任务",
      enterpriseName: "宁德时代",
    },
  },
  {
    caseId: "glm-financial-reading",
    label: "GLM-5 长文本阅读验收",
    provider: "glm5",
    capability: "retrieval",
    prompt: "请从一份长篇财报/研报中提取毛利率、现金流、库存和订单相关要点。",
    context: {
      role: "enterprise",
      focusMode: "deepDive",
      query: "提取财报与研报关键字段",
      enterpriseName: "宁德时代",
      longTextMode: true,
    },
  },
  {
    caseId: "deepseek-decision-reasoning",
    label: "DeepSeek 推理决策验收",
    provider: "deepseekReasoner",
    capability: "review",
    prompt: "请基于毛利承压、经营质量与外部证据，输出风险等级和投资/经营建议。",
    context: {
      role: "investor",
      focusMode: "investmentRecommendation",
      query: "基于证据完成决策推理",
      enterpriseName: "宁德时代",
    },
  },
] as const satisfies ReadonlyArray<{
  caseId: string;
  label: string;
  provider: "deepseekReasoner" | "glm5" | "qwen35Plus";
  capability: LlmCapability;
  prompt: string;
  context: Record<string, unknown>;
}>;

const dualPortalAuditDataChannels = [
  {
    channelId: "enterprise-collection-input",
    label: "企业端数据采集输入",
    audience: "enterprise",
    layer: "frontendInput",
    source: "企业端首页/采集面板",
    target: "/api/enterprise/collect",
    purpose: "录入企业经营指标、行业上下文与企业基础信息，驱动经营诊断会话初始化。",
    integrationStatus: "real",
    affectsPersonalization: true,
    personalizationDrivers: ["focusMode", "enterpriseBaseInfo", "memoryNotes"],
    notes: ["直接服务企业端经营目标。", "采集结果进入会话上下文与后续诊断工作流。"],
  },
  {
    channelId: "investor-profile-input",
    label: "投资端画像输入",
    audience: "investor",
    layer: "frontendInput",
    source: "投资端画像建档/设置面板",
    target: "/api/investor/profile",
    purpose: "沉淀风险偏好、投资周期、关注企业与兴趣主题，驱动投资分析个性化。",
    integrationStatus: "real",
    affectsPersonalization: true,
    personalizationDrivers: ["preferredRole", "investorBaseInfo", "interests", "constraints"],
    notes: ["画像字段会回写用户档案。", "后续模式切换、推荐摘要和服务提示复用这些字段。"],
  },
  {
    channelId: "user-preferences-route",
    label: "用户偏好更新链路",
    audience: "shared",
    layer: "serverRoute",
    source: "/api/users/:userId/preferences",
    target: "BusinessPortalService.updateUserPreferences()",
    purpose: "统一维护主题、角色偏好、关注点和约束条件，作为双端共享个性化底座。",
    integrationStatus: "real",
    affectsPersonalization: true,
    personalizationDrivers: ["preferredRole", "focusModes", "interests", "constraints"],
    notes: ["共享底座字段同时服务企业端和投资端。"],
  },
  {
    channelId: "enterprise-analysis-route",
    label: "企业端分析入口",
    audience: "enterprise",
    layer: "serverRoute",
    source: "/api/enterprise/analyze",
    target: "BusinessPortalService.analyzeEnterprise()",
    purpose: "将企业端采集结果、会话上下文和记忆拼装为经营诊断请求。",
    integrationStatus: "real",
    affectsPersonalization: true,
    personalizationDrivers: ["focusMode", "enterpriseBaseInfo", "sessionContext"],
    notes: ["企业端返回整改导向的高亮结论。"],
  },
  {
    channelId: "investor-analysis-route",
    label: "投资端分析入口",
    audience: "investor",
    layer: "serverRoute",
    source: "/api/investor/recommend|industry-status|deep-dive|stream",
    target: "BusinessPortalService.analyzeInvestor()/streamInvestorAnalysis()",
    purpose: "按研究判断、投资建议和深度解析等模式生成投资端专属内容。",
    integrationStatus: "real",
    affectsPersonalization: true,
    personalizationDrivers: ["focusMode", "investorBaseInfo", "constraints", "attachments"],
    notes: ["同一工作流底座根据模式输出不同模块与服务提示。"],
  },
  {
    channelId: "workflow-memory-store",
    label: "工作流记忆存储",
    audience: "shared",
    layer: "storage",
    source: "InMemoryMemoryStore / PlatformStore.memories",
    target: "诊断工作流与会话上下文",
    purpose: "保存历史摘要、手工私有记忆与自动记忆，支撑跨轮次个性化。",
    integrationStatus: "real",
    affectsPersonalization: true,
    personalizationDrivers: ["memoryNotes", "privateMemories", "historySummary"],
    notes: ["企业端与投资端共享存储，但读取范围按用户隔离。"],
  },
  {
    channelId: "session-context-store",
    label: "会话上下文存储",
    audience: "shared",
    layer: "storage",
    source: "InMemorySessionStore / PlatformStore.sessions",
    target: "企业分析会话、投资分析会话、流式分析上下文",
    purpose: "保存当前角色、活跃模式、附件、时间线、辩论和最近事件。",
    integrationStatus: "real",
    affectsPersonalization: true,
    personalizationDrivers: ["sessionContext", "latestProfileUpdate", "attachments"],
    notes: ["通过 `role` 与 `activeMode` 维持双端边界。"],
  },
  {
    channelId: "chart-payload-layer",
    label: "图表载荷整理层",
    audience: "shared",
    layer: "chart",
    source: "分析结果与画像摘要",
    target: "web/chart-data.ts 与图表系统",
    purpose: "把经营诊断、投资建议、证据和个性化摘要映射为双端可视化载荷。",
    integrationStatus: "real",
    affectsPersonalization: true,
    personalizationDrivers: ["focusMode", "role", "personalizedSummary"],
    notes: ["前端图表层消费统一协议，但应按角色选择不同图表族。"],
  },
  {
    channelId: "realtime-rag-source",
    label: "实时网页检索",
    audience: "shared",
    layer: "externalSource",
    source: "RealtimeIndustryRagService.retrieve()",
    target: "industryRetrieval agent / /api/rag/realtime",
    purpose: "提供行业证据、引用摘要和网页级来源追溯。",
    integrationStatus: "real",
    affectsPersonalization: false,
    personalizationDrivers: [],
    notes: ["为双端共享证据底座。", "存在过滤、缓存和无引用时的结构化退化逻辑。"],
  },
  {
    channelId: "eastmoney-stock-report-source",
    label: "东方财富研报抓取",
    audience: "shared",
    layer: "externalSource",
    source: "DataGatheringAgent.fetchEastmoneyStockReports()",
    target: "dataGathering agent",
    purpose: "为企业端与投资端补充公司研报与外部分析素材。",
    integrationStatus: "real",
    affectsPersonalization: false,
    personalizationDrivers: [],
    notes: ["已通过真实 HTTP 连接器抓取东方财富研报。", "工作流仍需在结果中展示真实/降级标签。"],
  },
  {
    channelId: "nbs-macro-source",
    label: "宏观数据增强源（NBS 可选）",
    audience: "shared",
    layer: "externalSource",
    source: "DataGatheringAgent.fetchNBSMacroData()",
    target: "dataGathering agent",
    purpose: "作为可选增强补充结构化宏观指标；默认宏观证据可由公开网页 RAG 提供。",
    integrationStatus: "real",
    affectsPersonalization: false,
    personalizationDrivers: [],
    notes: ["支持令牌、账号密码或 Cookie 方式接入。", "缺少凭证或认证失败时，默认回退到公开网页 RAG 宏观证据。"],
  },
  {
    channelId: "exchange-report-connectors",
    label: "交易所财报连接器",
    audience: "shared",
    layer: "externalSource",
    source: "fetchSSEReports()/fetchSZSEReports()/fetchBSEReports()",
    target: "dataGathering agent",
    purpose: "为企业/投资分析补充交易所公告与定期报告。",
    integrationStatus: "real",
    affectsPersonalization: false,
    personalizationDrivers: [],
    notes: ["根据证券代码解析结果路由到上交所、深交所或北交所。", "主工作流会把交易所公告与东方财富/NBS 结果一起纳入外部证据。"],
  },
] as const satisfies ReadonlyArray<DualPortalDataChannel>;

const dualPortalAuditPageMatrix = [
  {
    pageId: "enterprise-home",
    audience: "enterprise",
    pageName: "企业端首页",
    primaryGoal: "围绕经营诊断闭环收集输入并启动分析。",
    keyModules: ["企业基础信息", "经营数据采集", "行业上下文", "经营关注点"],
    chartFamilies: ["经营指标概览", "毛利承压趋势", "经营质量雷达"],
    primaryActions: ["采集数据", "发起企业分析", "写入企业记忆"],
    copySignals: ["保密提醒", "整改导向", "经营复盘语气"],
    personalizationDrivers: ["enterpriseBaseInfo", "focusMode", "memoryNotes"],
    isolationExpectations: ["不展示投资立场按钮。", "不暴露投委会/仓位类提示。"],
  },
  {
    pageId: "enterprise-analysis",
    audience: "enterprise",
    pageName: "企业端分析页",
    primaryGoal: "输出经营风险、整改优先级和执行动作。",
    keyModules: ["诊断摘要", "风险高亮", "整改动作", "会话上下文"],
    chartFamilies: ["经营质量拆解", "风险分层", "季度对比图"],
    primaryActions: ["复盘上轮结论", "更新行动建议", "写入人工记忆"],
    copySignals: ["优先动作", "整改闭环", "经营质量变化"],
    personalizationDrivers: ["sessionContext", "enterpriseBaseInfo", "historySummary"],
    isolationExpectations: ["不输出仓位建议。", "不使用投资推荐措辞。"],
  },
  {
    pageId: "enterprise-settings",
    audience: "enterprise",
    pageName: "企业端设置/辅助面板",
    primaryGoal: "维护企业基础信息、偏好与企业端专属上下文。",
    keyModules: ["角色偏好", "企业基础信息", "关注目标", "反馈入口"],
    chartFamilies: ["无强制图表"],
    primaryActions: ["更新企业资料", "调整关注点", "查看历史分析"],
    copySignals: ["经营目标", "部门复盘", "保密配置"],
    personalizationDrivers: ["preferredRole", "enterpriseBaseInfo", "focusModes"],
    isolationExpectations: ["不混入投资人画像字段。"],
  },
  {
    pageId: "investor-home",
    audience: "investor",
    pageName: "投资端首页",
    primaryGoal: "围绕研究判断与投资决策建立画像和会话入口。",
    keyModules: ["投资画像", "关注企业", "推荐模式", "附件上传"],
    chartFamilies: ["行业景气图", "证据覆盖概览", "推荐信号卡片"],
    primaryActions: ["建立画像", "切换模式", "开始流式分析"],
    copySignals: ["研究判断", "投资建议", "证据链"],
    personalizationDrivers: ["investorBaseInfo", "interests", "constraints"],
    isolationExpectations: ["不显示企业整改入口。", "不把经营保密提醒作为主文案。"],
  },
  {
    pageId: "investor-analysis",
    audience: "investor",
    pageName: "投资端分析页",
    primaryGoal: "输出推荐立场、行业判断、深度解析和正式辩论结果。",
    keyModules: ["推荐结论", "深度解析", "行业报告", "正式辩论"],
    chartFamilies: ["证据强度图", "推荐分数卡", "行业驱动图"],
    primaryActions: ["切换模式", "追问行业问题", "上传补充材料"],
    copySignals: ["推荐关注", "谨慎跟踪", "暂缓配置"],
    personalizationDrivers: ["focusMode", "constraints", "attachments", "latestProfileUpdate"],
    isolationExpectations: ["不展示企业端整改动作优先级。", "不把经营诊断摘要当主结论。"],
  },
  {
    pageId: "investor-settings",
    audience: "investor",
    pageName: "投资端设置/辅助面板",
    primaryGoal: "维护风险偏好、投资周期、关注企业与决策约束。",
    keyModules: ["风险偏好", "投资周期", "关注企业", "决策方式"],
    chartFamilies: ["无强制图表"],
    primaryActions: ["更新偏好", "管理多会话", "清理历史上下文"],
    copySignals: ["回撤控制", "投委会约束", "分批建仓"],
    personalizationDrivers: ["riskAppetite", "investmentHorizon", "decisionStyleHints"],
    isolationExpectations: ["不暴露企业侧经营资料表单。"],
  },
] as const satisfies ReadonlyArray<DualPortalPageMatrixEntry>;

const dualPortalPersonalizationDrivers = [
  {
    driverId: "preferred-role",
    label: "角色偏好",
    audience: "shared",
    sourceFields: ["preferences.preferredRole"],
    upstreamChannels: ["user-preferences-route"],
    downstreamSurfaces: ["企业端/投资端入口分流", "首页默认角色状态"],
    effectSummary: "决定默认进入的双端工作台，避免角色错配。",
    status: "active",
  },
  {
    driverId: "focus-mode",
    label: "分析模式",
    audience: "shared",
    sourceFields: ["focusMode", "preferences.focusModes"],
    upstreamChannels: ["enterprise-analysis-route", "investor-analysis-route", "user-preferences-route"],
    downstreamSurfaces: ["工作流提示词", "投资端模式摘要", "企业端分析目标"],
    effectSummary: "同一底座根据模式切换为经营诊断、行业状况、投资建议或深度解析。",
    status: "active",
  },
  {
    driverId: "enterprise-base-info",
    label: "企业基础信息",
    audience: "enterprise",
    sourceFields: ["enterpriseBaseInfo"],
    upstreamChannels: ["enterprise-collection-input", "user-preferences-route"],
    downstreamSurfaces: ["企业采集摘要", "企业分析结论", "企业端图表说明"],
    effectSummary: "让企业端摘要和行动建议围绕企业经营目标组织。",
    status: "active",
  },
  {
    driverId: "investor-profile-info",
    label: "投资画像字段",
    audience: "investor",
    sourceFields: ["riskAppetite", "investmentHorizon", "interests", "investorBaseInfo"],
    upstreamChannels: ["investor-profile-input", "user-preferences-route"],
    downstreamSurfaces: ["推荐立场", "模式推荐", "服务提示", "辩论个性化摘要"],
    effectSummary: "把风险偏好和研究兴趣映射为投资端推荐语气与提示重点。",
    status: "active",
  },
  {
    driverId: "session-context",
    label: "会话上下文",
    audience: "shared",
    sourceFields: ["session.summary", "session.activeMode", "latestProfileUpdate", "attachments"],
    upstreamChannels: ["session-context-store", "investor-analysis-route", "enterprise-analysis-route"],
    downstreamSurfaces: ["连续追问", "深度解析", "企业复盘", "流式分析"],
    effectSummary: "让不同页面在多轮分析中延续当前角色、模式和附件上下文。",
    status: "active",
  },
  {
    driverId: "memory-history",
    label: "历史记忆与人工记忆",
    audience: "shared",
    sourceFields: ["memoryNotes", "private memories", "workflow summaries"],
    upstreamChannels: ["workflow-memory-store", "enterprise-collection-input", "investor-analysis-route"],
    downstreamSurfaces: ["建议动作", "服务提示", "历史复盘摘要"],
    effectSummary: "把显式偏好与历史结论注入工作流，避免每轮分析丢失上下文。",
    status: "active",
  },
  {
    driverId: "chart-personalization",
    label: "图表排序与载荷差异",
    audience: "shared",
    sourceFields: ["role", "focusMode", "personalizedSummary"],
    upstreamChannels: ["chart-payload-layer"],
    downstreamSurfaces: ["企业端图表区", "投资端图表区"],
    effectSummary: "统一图表协议已经具备角色信号，但前端是否完全按矩阵消费仍需持续回归。",
    status: "partial",
  },
] as const satisfies ReadonlyArray<DualPortalPersonalizationDriver>;

const dualPortalAuditFindings = [
  {
    findingId: "external-source-labeling",
    severity: "medium",
    title: "外部连接器已接入真实链路，但必须持续暴露运行状态",
    summary: "交易所、东方财富与公开网页 RAG 已进入主工作流；若启用 NBS 作为可选增强，仍可能因凭证缺失或认证失败触发降级结果，页面与导出物必须清晰标识。",
    relatedChannelIds: ["eastmoney-stock-report-source", "nbs-macro-source", "exchange-report-connectors"],
    relatedDriverIds: [],
    recommendedAction: "统一消费 `integrationStatus`，在前端和导出物中展示真实/模拟/降级标签。",
  },
  {
    findingId: "shared-bottom-layer-boundary",
    severity: "medium",
    title: "双端共享同一工作流底座，需要持续校验角色隔离",
    summary: "企业端和投资端都复用诊断工作流与共享存储，虽然通过 `role` 和 `focusMode` 分流，但需持续防止模块串用。",
    relatedChannelIds: ["enterprise-analysis-route", "investor-analysis-route", "session-context-store"],
    relatedDriverIds: ["preferred-role", "focus-mode", "session-context"],
    recommendedAction: "每次迭代都回归验证角色切换、页面矩阵和输出文案边界。",
  },
  {
    findingId: "chart-consumption-regression",
    severity: "medium",
    title: "图表协议已具备个性化信号，但前端消费策略需持续回归",
    summary: "后端能提供角色、模式和个性化摘要，但如果图表层未按页面矩阵消费，可能退化成同构页面。",
    relatedChannelIds: ["chart-payload-layer"],
    relatedDriverIds: ["chart-personalization"],
    recommendedAction: "把页面矩阵作为图表层验收基线，避免双端只换标题不换内容结构。",
  },
  {
    findingId: "memory-cross-round-value",
    severity: "low",
    title: "记忆链路已生效，适合作为个性化回归门禁",
    summary: "当前记忆和会话链路能够把历史摘要注入后续分析，是双端个性化最稳定的后端抓手之一。",
    relatedChannelIds: ["workflow-memory-store", "session-context-store"],
    relatedDriverIds: ["memory-history", "session-context"],
    recommendedAction: "保留针对多轮分析与角色切换的后端测试，防止记忆链路回退成仅存储不生效。",
  },
] as const;

function combineRiskLevels(levels: Array<"low" | "medium" | "high">) {
  if (levels.includes("high")) {
    return "high";
  }

  if (levels.includes("medium")) {
    return "medium";
  }

  return "low";
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function normalizeInlineWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function roundScore(value: number) {
  return Number(value.toFixed(2));
}

function average(values: number[], fallback = 0) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : fallback;
}

function scoreToConfidence(score: number): CitationConfidence {
  if (score >= 0.76) {
    return "high";
  }

  if (score >= 0.56) {
    return "medium";
  }

  return "low";
}

function createInvalidRequestError(details: unknown) {
  return new AppError({
    code: "INVALID_REQUEST",
    message: "请求参数校验失败。",
    statusCode: 400,
    details,
  });
}

function parseRequest(payload: unknown) {
  const parsed = diagnosticAgentRequestSchema.safeParse(payload);

  if (!parsed.success) {
    throw createInvalidRequestError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  return parsed.data;
}

function buildDataUnderstandingOutput(input: DiagnosticAgentRequest): DataUnderstandingOutput {
  const missingInputs: string[] = [];

  if (!input.grossMarginInput) {
    missingInputs.push("毛利承压指标");
  }

  if (!input.operatingQualityInput) {
    missingInputs.push("经营质量指标");
  }

  if (!input.industryContext?.marketDemandIndex) {
    missingInputs.push("行业需求指数");
  }

  if (!input.industryContext?.materialCostTrend) {
    missingInputs.push("原材料成本趋势");
  }

  const extractedFocus = uniqueStrings([
    input.focusMode,
    input.role === "enterprise" ? "经营诊断" : "投资判断",
    input.grossMarginInput ? "毛利承压" : "",
    input.operatingQualityInput ? "经营质量" : "",
    input.industryContext ? "行业联动" : "",
  ]);

  const datasetCompleteness =
    missingInputs.length === 0 ? "high" : missingInputs.length <= 2 ? "medium" : "low";

  return {
    objective: `${input.enterpriseName ?? "目标企业"}需要围绕“${input.query}”形成可执行诊断结论。`,
    extractedFocus,
    datasetCompleteness,
    missingInputs,
  };
}

// ==================== DQI/GMPS 模型集成辅助函数 ====================

/**
 * 判断是否需要计算DQI模型
 */
function shouldCalculateDQI(focusMode: FocusMode, role: DiagnosticRole): boolean {
  if (focusMode === "operationalDiagnosis") return true;
  if (focusMode === "deepDive") return true;
  if (focusMode === "investmentRecommendation") return true;
  return false;
}

/**
 * 判断是否需要计算GMPS模型
 */
function shouldCalculateGMPS(focusMode: FocusMode, role: DiagnosticRole): boolean {
  if (focusMode === "operationalDiagnosis") return true;
  if (focusMode === "industryStatus") return true;
  if (focusMode === "investmentRecommendation") return true;
  if (focusMode === "deepDive") return true;
  return false;
}

/**
 * 升级风险等级
 */
function upgradeRiskLevel(
  currentLevel: "low" | "medium" | "high",
  requiredLevel: "medium" | "high",
): "low" | "medium" | "high" {
  if (currentLevel === "high") return "high";
  if (requiredLevel === "high") return "high";
  if (currentLevel === "low" || requiredLevel === "medium") return "medium";
  return currentLevel;
}

/**
 * 从上下文中提取DQI所需的输入数据
 */
function extractDQIInputFromContext(input: DiagnosticAgentRequest): unknown {
  // 尝试从 operatingQualityInput 中提取DQI所需的数据
  // DQI需要：净利润、期初/期末净资产、营业收入、经营现金流（当期和基期）
  const oqInput = input.operatingQualityInput;

  if (!oqInput) {
    return null; // 数据不足，无法计算DQI
  }

  return {
    currentNetProfit: oqInput.currentRevenue * 0.08,
    currentBeginningEquity: oqInput.baselineTotalAssets * 0.45,
    currentEndingEquity: oqInput.currentTotalAssets * 0.44,
    currentRevenue: oqInput.currentRevenue,
    currentOperatingCashFlow: oqInput.currentOperatingCashFlow,
    currentTotalAssets: oqInput.currentTotalAssets,
    currentInventoryExpense: oqInput.currentRevenue * 0.18,
    currentOperatingCost: oqInput.currentRevenue * 0.78,
    baselineNetProfit: oqInput.baselineRevenue * 0.09,
    baselineBeginningEquity: oqInput.baselineTotalAssets * 0.46,
    baselineEndingEquity: oqInput.baselineTotalAssets * 0.45,
    baselineRevenue: oqInput.baselineRevenue,
    baselineOperatingCashFlow: oqInput.baselineOperatingCashFlow,
    baselineTotalAssets: oqInput.baselineTotalAssets,
    baselineInventoryExpense: oqInput.baselineRevenue * 0.17,
    baselineOperatingCost: oqInput.baselineRevenue * 0.76,
    dataProvenance: {
      estimatedFields: ["currentNetProfit", "currentBeginningEquity", "currentEndingEquity", "baselineNetProfit", "baselineBeginningEquity", "baselineEndingEquity", "currentInventoryExpense", "currentOperatingCost", "baselineInventoryExpense", "baselineOperatingCost"],
      estimationMethod: "净利润率假设8%/9%，净资产占资产比例假设44%-46%，库存费用占营收17%-18%，营业成本占营收76%-78%，研发投入强度按营收4.5%估算",
    },
  };
}

/**
 * 从上下文中提取GMPS所需的输入数据
 */
function extractGMPSInputFromContext(
  input: DiagnosticAgentRequest,
  dataGatheringOutput?: DataGatheringOutput,
  platformStore?: PlatformStore,
): unknown | null {
  const gmInput = input.grossMarginInput;
  const oqInput = input.operatingQualityInput;

  if (!gmInput || !oqInput) {
    return null;
  }

  let currentLithiumPrice = 10;
  let baselineLithiumPrice = 12;
  let industryVolatility = 0.2;
  let usedPlatformStoreData = false;

  if (platformStore) {
    const latestIndustry = platformStore.getLatestIndustryData();
    if (latestIndustry) {
      if (latestIndustry.lithiumPrice?.price && latestIndustry.lithiumPrice.price > 0) {
        currentLithiumPrice = latestIndustry.lithiumPrice.price / 10000;
        baselineLithiumPrice = currentLithiumPrice * 1.1;
        usedPlatformStoreData = true;
      }
      if (latestIndustry.industryIndex?.volatility && latestIndustry.industryIndex.volatility > 0) {
        industryVolatility = latestIndustry.industryIndex.volatility;
        usedPlatformStoreData = true;
      }
    }
  }

  if (dataGatheringOutput?.gatheredData && typeof dataGatheringOutput.gatheredData === "object") {
    const gathered = dataGatheringOutput.gatheredData as Record<string, unknown>;
    if (typeof gathered.lithiumPrice === "number") {
      currentLithiumPrice = gathered.lithiumPrice;
    }
    if (typeof gathered.baselineLithiumPrice === "number") {
      baselineLithiumPrice = gathered.baselineLithiumPrice;
    }
    if (typeof gathered.industryVolatility === "number") {
      industryVolatility = gathered.industryVolatility;
    }
  }

  const isUsingDefaultLithiumPrice = currentLithiumPrice === 10 && baselineLithiumPrice === 12;
  const isUsingDefaultVolatility = industryVolatility === 0.2;

  return {
    currentGrossMargin: gmInput.currentGrossMargin,
    currentRevenue: gmInput.currentRevenue,
    currentCost: gmInput.currentCost,
    currentSalesVolume: gmInput.currentSalesVolume,
    currentProductionVolume: oqInput.currentProductionVolume,
    currentInventory: gmInput.currentInventoryExpense * 1.15,
    currentManufacturingExpense: oqInput.currentManufacturingExpense,
    currentTotalLiabilities: oqInput.currentTotalLiabilities,
    currentTotalAssets: oqInput.currentTotalAssets,
    currentOperatingCashFlow: oqInput.currentOperatingCashFlow,

    baselineGrossMargin: gmInput.baselineGrossMargin,
    baselineRevenue: gmInput.baselineRevenue,
    baselineCost: gmInput.baselineCost,
    baselineSalesVolume: gmInput.baselineSalesVolume,
    baselineProductionVolume: oqInput.baselineProductionVolume,
    baselineInventory: gmInput.baselineInventoryExpense * 1.15,
    baselineManufacturingExpense: oqInput.baselineManufacturingExpense,
    baselineTotalLiabilities: oqInput.baselineTotalLiabilities,
    baselineTotalAssets: oqInput.baselineTotalAssets,
    baselineOperatingCashFlow: oqInput.baselineOperatingCashFlow,

    currentLithiumPrice,
    baselineLithiumPrice,
    industryVolatility,
    industrySegment: "powerBattery" as const,
    dataProvenance: {
      estimatedFields: [
        "currentInventory",
        "baselineInventory",
        ...(isUsingDefaultLithiumPrice ? ["currentLithiumPrice", "baselineLithiumPrice"] : []),
        ...(isUsingDefaultVolatility ? ["industryVolatility"] : []),
      ],
      estimationMethod: usedPlatformStoreData
        ? "库存=库存费用×1.2/1.1；碳酸锂价格和行业波动率来自PlatformStore行业数据"
        : "库存=库存费用×1.2/1.1；碳酸锂价格默认10/12万/吨；行业波动率默认0.2",
    },
  };
}

/**
 * 计算降级后的经营质量结果（当DQI失败时使用）
 */
function calculateOperatingQualityFallback(input: DiagnosticAgentRequest) {
  return input.operatingQualityInput ? analyzeOperatingQuality(input.operatingQualityInput) : undefined;
}

/**
 * 计算降级后的毛利承压结果（当GMPS失败时使用）
 */
function calculateGrossMarginPressureFallback(input: DiagnosticAgentRequest) {
  return input.grossMarginInput ? analyzeGrossMarginPressure(input.grossMarginInput) : undefined;
}

function buildMathAnalysisOutput(input: DiagnosticAgentRequest, dataGatheringOutput?: DataGatheringOutput, platformStore?: PlatformStore): { output: MathAnalysisOutput; degradationTrace: DegradationEvent[] } {
  const degradationTrace: DegradationEvent[] = [];
  const grossMargin = input.grossMarginInput
    ? analyzeGrossMarginPressure(input.grossMarginInput)
    : undefined;
  const operatingQuality = input.operatingQualityInput
    ? analyzeOperatingQuality(input.operatingQualityInput)
    : undefined;

  const output: MathAnalysisOutput = {
    grossMargin,
    operatingQuality,
    combinedRiskLevel: "low",
    combinedInsights: [],
  };

  // 收集基础风险等级
  const riskLevels = [grossMargin?.riskLevel, operatingQuality?.riskLevel].filter(
    (value): value is "low" | "medium" | "high" => Boolean(value),
  );
  output.combinedRiskLevel = riskLevels.length > 0 ? combineRiskLevels(riskLevels) : "medium";

  // ========== 集成 DQI 模型 ==========
  const needsDQI = shouldCalculateDQI(input.focusMode, input.role);
  if (needsDQI) {
    try {
      const dqiInput = extractDQIInputFromContext(input);
      if (dqiInput) {
        const dqiResult = calculateDQI(dqiInput);
        output.dqiModel = dqiResult;

        // 根据DQI结果调整风险等级
        if (dqiResult.dqi < 0.95) {
          output.combinedRiskLevel = upgradeRiskLevel(output.combinedRiskLevel, "medium");
        }
        if (dqiResult.dqi < 0.85) {
          output.combinedRiskLevel = upgradeRiskLevel(output.combinedRiskLevel, "high");
        }

        // 添加DQI洞察
        output.combinedInsights.push(
          `DQI经营质量指数为${dqiResult.dqi.toFixed(2)}，状态为"${dqiResult.status}"，主要驱动因素：${dqiResult.driver}。${dqiResult.trend}`
        );
      } else {
        console.warn("DQI模型：输入数据不足，降级到简化经营质量模型");
        output.combinedInsights.push("DQI数据不足，已降级到基础经营质量分析");
        degradationTrace.push(createHeuristicEvent("mathAnalysis", "DQI模型计算降级：输入数据不足"));
      }
    } catch (error) {
      console.warn("DQI模型计算失败，降级到简化模型:", error);
      output.combinedInsights.push("DQI模型计算异常，已降级到基础经营质量分析");
      degradationTrace.push(createHeuristicEvent("mathAnalysis", "DQI模型计算降级：" + (error instanceof Error ? error.message : "输入数据不足")));
    }
  }

  // ========== 集成 GMPS 模型 ==========
  const needsGMPS = shouldCalculateGMPS(input.focusMode, input.role);
  if (needsGMPS) {
    try {
      const gmpsInput = extractGMPSInputFromContext(input, dataGatheringOutput, platformStore);
      if (gmpsInput) {
        const gmpsResult = calculateGMPS(gmpsInput);
        output.gmpsModel = {
          gmps: gmpsResult.gmps,
          level: gmpsResult.level,
          probabilityNextQuarter: gmpsResult.probabilityNextQuarter,
          riskLevel: gmpsResult.riskLevel,
          dimensionScores: gmpsResult.dimensionScores,
          featureScores: gmpsResult.featureScores,
          keyFindings: gmpsResult.keyFindings,
          industrySegment: gmpsResult.industrySegment,
          industryWeights: gmpsResult.industryWeights,
        };

        if (gmpsInput && typeof gmpsInput === "object" && "dataProvenance" in gmpsInput) {
          output.dataProvenance = (gmpsInput as Record<string, unknown>).dataProvenance as { estimatedFields: string[]; estimationMethod: string };
        }

        // 根据GMPS结果调整风险等级
        if (gmpsResult.gmps >= 40) {
          output.combinedRiskLevel = upgradeRiskLevel(
            output.combinedRiskLevel,
            gmpsResult.gmps >= 70 ? "high" : "medium",
          );
        }

        // 添加GMPS洞察
        output.combinedInsights.push(
          `GMPS毛利承压指数为${gmpsResult.gmps.toFixed(2)}，等级为"${gmpsResult.level}"，下季度风险概率：${(gmpsResult.probabilityNextQuarter * 100).toFixed(2)}%（${gmpsResult.riskLevel}）`
        );

        // 添加关键发现
        if (gmpsResult.keyFindings.length > 0) {
          output.combinedInsights.push(...gmpsResult.keyFindings.slice(0, 3));
        }
      } else {
        console.warn("GMPS模型：输入数据不足，降级到简化毛利承压模型");
        output.combinedInsights.push("GMPS数据不足，已降级到基础毛利承压分析");
        degradationTrace.push(createHeuristicEvent("mathAnalysis", "GMPS模型计算降级：输入数据不足"));
      }
    } catch (error) {
      console.warn("GMPS模型计算失败，降级到简化模型:", error);
      output.combinedInsights.push("GMPS模型计算异常，已降级到基础毛利承压分析");
      degradationTrace.push(createHeuristicEvent("mathAnalysis", "GMPS模型计算降级：" + (error instanceof Error ? error.message : "输入数据不足")));
    }
  }

  // ========== 整合所有洞察 ==========
  const gatheringInsights = [];
  if (dataGatheringOutput?.status === "success") {
    gatheringInsights.push(`外部数据引入：${dataGatheringOutput.source} 的抓取数据已纳入综合参考。`);
  }

  // 合并所有洞察并去重，限制数量
  output.combinedInsights = uniqueStrings([
    ...(grossMargin?.keyFindings ?? []),
    ...(operatingQuality?.keyFindings ?? []),
    ...output.combinedInsights, // 包含DQI和GMPS的洞察
    ...gatheringInsights,
  ]).slice(0, 8); // 增加到8条以容纳新模型的洞察

  return { output, degradationTrace };
}

function buildIndustryEvidence(
  input: DiagnosticAgentRequest,
  realtimeRetrieval: RealtimeRagResponse,
): IndustryEvidence[] {
  const demandIndex = input.industryContext?.marketDemandIndex;
  const materialCostTrend = input.industryContext?.materialCostTrend;
  const policySignals = input.industryContext?.policySignals ?? [];

  const demandFinding =
    demandIndex === undefined
      ? "未提供行业需求指数，需要补充终端装机与订单节奏。"
      : demandIndex >= 110
        ? `需求指数为 ${demandIndex}，行业需求保持扩张。`
        : demandIndex >= 95
          ? `需求指数为 ${demandIndex}，行业需求整体平稳。`
          : `需求指数为 ${demandIndex}，需求端存在放缓压力。`;

  const materialFinding =
    materialCostTrend === "up"
      ? "原材料成本处于上行阶段，毛利率容易继续承压。"
      : materialCostTrend === "down"
        ? "原材料成本回落，有助于缓解制造端利润压力。"
        : materialCostTrend === "flat"
          ? "原材料成本相对平稳，重点关注需求与库存变量。"
          : "未提供原材料成本趋势，行业成本侧结论可信度受限。";

  const policyFinding =
    policySignals.length > 0
      ? `政策信号包括：${policySignals.join("、")}。`
      : "未提供政策信号，建议补充补贴、产能约束或出口政策变化。";

  const structuredEvidence = [
    {
      source: "行业需求跟踪",
      finding: demandFinding,
      confidence: demandIndex === undefined ? "medium" : "high",
      confidenceScore: demandIndex === undefined ? 0.62 : 0.82,
    },
    {
      source: "材料成本监测",
      finding: materialFinding,
      confidence: materialCostTrend ? "high" : "medium",
      confidenceScore: materialCostTrend ? 0.8 : 0.6,
    },
    {
      source: "政策与竞争格局",
      finding: policyFinding,
      confidence: policySignals.length > 0 ? "high" : "medium",
      confidenceScore: policySignals.length > 0 ? 0.8 : 0.6,
    },
  ] satisfies IndustryEvidence[];

  const citationEvidence = realtimeRetrieval.citations.map((citation) => ({
    source: citation.source,
    finding: citation.summary,
    confidence: citation.confidence,
    confidenceScore: citation.confidenceScore,
    citationId: citation.id,
    citationUrl: citation.url,
    summary: citation.excerpt,
  })) satisfies IndustryEvidence[];

  return [...citationEvidence, ...structuredEvidence];
}

function buildIndustryRetrievalOutput(
  input: DiagnosticAgentRequest,
  synthesis: string,
  realtimeRetrieval: RealtimeRagResponse,
) {
  return {
    query: realtimeRetrieval.query,
    synthesis,
    retrievalSummary: realtimeRetrieval.retrievalSummary,
    referenceAbstract: realtimeRetrieval.referenceAbstract,
    evidence: buildIndustryEvidence(input, realtimeRetrieval),
    citations: realtimeRetrieval.citations,
    indexStats: realtimeRetrieval.indexStats,
  } satisfies IndustryRetrievalOutput;
}

function buildEvidenceReviewOutput(
  input: DiagnosticAgentRequest,
  dataUnderstanding: DataUnderstandingOutput,
  mathAnalysis: MathAnalysisOutput,
  industryRetrieval: IndustryRetrievalOutput,
  reviewSummary: string,
  dataGathering: DataGatheringOutput,
) {
  const citationAbstracts = industryRetrieval.citations.map(
    (item) => `${item.source}：${item.summary}`,
  );

  // 增强交叉验证：检查数据采集中是否有错误或特殊发现
  const gatheringValid = dataGathering.status === "success";

  // ========== DQI/GMPS 结果合理性验证 ==========
  const modelValidationClaims: { verified: string[]; challenged: string[] } = {
    verified: [],
    challenged: [],
  };

  // 验证DQI结果
  if (mathAnalysis.dqiModel) {
    const { dqi, confidence } = mathAnalysis.dqiModel;

    // 范围检查：DQI通常在0.5-2.0之间
    if (dqi < 0.3 || dqi > 2.5) {
      modelValidationClaims.challenged.push(`DQI值${dqi.toFixed(2)}超出合理范围(0.3-2.5)，需人工复核`);
    } else {
      modelValidationClaims.verified.push(`DQI指数${dqi.toFixed(2)}处于合理范围`);
    }

    // 置信度检查
    if (confidence < 0.6) {
      modelValidationClaims.challenged.push(`DQI置信度偏低(${confidence})，建议补充数据源验证`);
    } else if (confidence >= 0.85) {
      modelValidationClaims.verified.push(`DQI模型置信度良好(${confidence})`);
    }
  }

  // 验证GMPS结果
  if (mathAnalysis.gmpsModel) {
    const { gmps, probabilityNextQuarter } = mathAnalysis.gmpsModel;

    // GMPS范围检查：0-100
    if (gmps < 0 || gmps > 100) {
      modelValidationClaims.challenged.push(`GMPS值${gmps}超出有效范围(0-100)，计算可能有误`);
    } else {
      modelValidationClaims.verified.push(`GMPS得分${gmps.toFixed(2)}符合规范`);
    }

    // 概率范围检查：0-1
    if (probabilityNextQuarter < 0 || probabilityNextQuarter > 1) {
      modelValidationClaims.challenged.push(`风险概率${probabilityNextQuarter}超出[0,1]范围`);
    } else {
      modelValidationClaims.verified.push(`预测概率${(probabilityNextQuarter * 100).toFixed(2)}%有效`);
    }

    // 维度得分一致性检查
    const dimScores = mathAnalysis.gmpsModel.dimensionScores;
    if (dimScores) {
      const allValid = Object.values(dimScores).every((score) => score >= 0 && score <= 100);
      if (!allValid) {
        modelValidationClaims.challenged.push("GMPS维度得分存在异常值，需复核计算逻辑");
      }
    }

    // 关键发现数量检查
    if (mathAnalysis.gmpsModel.keyFindings.length === 0) {
      modelValidationClaims.challenged.push("GMPS未生成关键发现，可能遗漏重要风险信号");
    }
  }

  const verifiedClaims = uniqueStrings([
    ...mathAnalysis.combinedInsights.slice(0, 3),
    ...industryRetrieval.evidence
      .filter((item) => item.confidence !== "low")
      .map((item) => item.finding),
    gatheringValid ? `[${dataGathering.source}] 外部数据验证通过` : "",
    ...modelValidationClaims.verified,
  ]).slice(0, 8);

  const challengedClaims = [
    dataUnderstanding.datasetCompleteness === "high"
      ? ""
      : `当前数据完备性为 ${dataUnderstanding.datasetCompleteness}，需补充 ${dataUnderstanding.missingInputs.join("、")}。`,
    industryRetrieval.citations.length > 0 ? "" : "未命中可引用的实时网页证据，外部证据强度偏弱。",
    input.industryContext ? "" : "行业侧缺少结构化输入，外部证据闭环仍不完整。",
    gatheringValid ? "" : "自动采集外部财报/宏观数据失败，部分结论可能缺少最新数据支撑。",
    ...modelValidationClaims.challenged,
  ].filter(Boolean);

  const averageCitationScore =
    industryRetrieval.citations.length > 0
      ? industryRetrieval.citations.reduce((sum, item) => sum + item.confidenceScore, 0) /
        industryRetrieval.citations.length
      : 0.45;
  const structuredEvidenceScores = industryRetrieval.evidence
    .filter((item) => !item.citationId)
    .map(getEvidenceStrength);
  const averageStructuredEvidenceScore = average(structuredEvidenceScores, 0.55);
  const maxCitationScore = industryRetrieval.citations.reduce(
    (maxScore, item) => Math.max(maxScore, item.confidenceScore),
    0.45,
  );
  const sourceDiversity = uniqueStrings(industryRetrieval.evidence.map((item) => item.source)).length;
  const completenessBonus =
    dataUnderstanding.datasetCompleteness === "high"
      ? 0.12
      : dataUnderstanding.datasetCompleteness === "medium"
        ? 0.06
        : 0;
  const gatheringBonus = gatheringValid ? 0.05 : 0;
  const verificationBonus = Math.min(0.12, verifiedClaims.length * 0.02);
  const sourceDiversityBonus = Math.min(0.08, sourceDiversity * 0.015);
  const corroborationBonus =
    Math.min(
      0.08,
      [
        gatheringValid,
        industryRetrieval.citations.length >= 2,
        sourceDiversity >= 4,
        dataUnderstanding.datasetCompleteness === "high",
      ].filter(Boolean).length * 0.02,
    );
  const fallbackPenalty = industryRetrieval.indexStats.fallbackUsed ? 0.03 : 0;
  const challengePenalty = challengedClaims.length * 0.08;
  const confidenceScore = Math.max(
    0.2,
    Math.min(
      0.98,
      averageCitationScore * 0.55 +
        averageStructuredEvidenceScore * 0.25 +
        maxCitationScore * 0.1 +
        completenessBonus +
        gatheringBonus +
        verificationBonus +
        sourceDiversityBonus +
        corroborationBonus -
        fallbackPenalty -
        challengePenalty,
    ),
  );

  const confidence = scoreToConfidence(confidenceScore);

  return {
    confidence,
    confidenceScore: roundScore(confidenceScore),
    verifiedClaims,
    challengedClaims,
    citations: industryRetrieval.citations.map((item) => `${item.source}｜${item.title}`),
    citationAbstracts,
    reviewSummary,
  } satisfies EvidenceReviewOutput;
}

function buildExpressionGenerationOutput(
  input: DiagnosticAgentRequest,
  mathAnalysis: MathAnalysisOutput,
  evidenceReview: EvidenceReviewOutput,
  memoryOutput: MemoryManagementOutput,
  expressionText: string,
) {
  const entityName = input.enterpriseName ?? "该企业";
  const recommendedActions = uniqueStrings([
    mathAnalysis.combinedRiskLevel === "high" ? "优先收敛高成本与高库存环节" : "",
    input.focusMode === "investmentRecommendation" ? "持续跟踪需求指数与政策变化" : "",
    input.role === "investor" ? "对照现金流质量与订单兑现率更新投资假设" : "",
    evidenceReview.challengedClaims.length > 0 ? "补充缺失指标并复核行业证据" : "建立周度跟踪看板观察趋势变化",
    memoryOutput.recalledMemories.length > 0 ? "结合历史记忆校验建议是否与既往结论一致" : "",
  ]).slice(0, 4);

  const citationAbstract =
    evidenceReview.citationAbstracts.slice(0, 2).join("；") ||
    "当前未形成稳定的实时引用摘要，建议继续补充外部网页证据。";
  const executiveSummary = `${entityName}当前综合风险等级为 ${mathAnalysis.combinedRiskLevel}，证据可信度为 ${evidenceReview.confidence}（${evidenceReview.confidenceScore}）。`;
  const finalAnswer = [
    executiveSummary,
    `核心结论：${expressionText}`,
    `关键证据：${evidenceReview.verifiedClaims.slice(0, 3).join("；") || "当前以结构化输入为主，建议继续补充外部证据。"}。`,
    `引用摘要：${citationAbstract}。`,
    `建议动作：${recommendedActions.join("；")}。`,
  ].join("\n");

  const chartBlocks: string[] = [];
  if (mathAnalysis?.dqiModel) {
    const dqi = mathAnalysis.dqiModel;
    chartBlocks.push(`\`\`\`chart\n${JSON.stringify({
      type: "radar",
      title: "DQI经营质量分解",
      data: [
        { subject: "盈利能力", value: Math.abs(dqi.decomposition.profitabilityContribution) },
        { subject: "成长能力", value: Math.abs(dqi.decomposition.growthContribution) },
        { subject: "现金流质量", value: Math.abs(dqi.decomposition.cashflowContribution) },
      ],
      xKey: "subject",
      yKeys: ["value"],
    })}\n\`\`\``);
  }
  if (mathAnalysis?.gmpsModel) {
    const gmps = mathAnalysis.gmpsModel;
    chartBlocks.push(`\`\`\`chart\n${JSON.stringify({
      type: "bar",
      title: "GMPS毛利承压五维评分",
      data: [
        { name: "毛利率", score: gmps.dimensionScores.A_毛利率结果 },
        { name: "材料成本", score: gmps.dimensionScores.B_材料成本冲击 },
        { name: "产销负荷", score: gmps.dimensionScores.C_产销负荷 },
        { name: "外部风险", score: gmps.dimensionScores.D_外部风险 },
        { name: "现金流安全", score: gmps.dimensionScores.E_现金流安全 },
      ],
      xKey: "name",
      yKeys: ["score"],
    })}\n\`\`\``);
  }

  return {
    executiveSummary,
    recommendedActions,
    citationAbstract,
    finalAnswer: finalAnswer + (chartBlocks.length > 0 ? "\n\n" + chartBlocks.join("\n\n") : ""),
  } satisfies ExpressionGenerationOutput;
}

function createHeuristicEvent(agentId: AgentId, message: string): DegradationEvent {
  return {
    agentId,
    reason: "heuristic_fallback",
    message,
    occurredAt: new Date().toISOString(),
  };
}

function getPreferredProviders(capability: "planning" | "understanding" | "retrieval" | "review" | "expression" | "memory") {
  if (capability === "planning" || capability === "understanding") {
    return ["qwen35Plus", "glm5", "deepseekReasoner"] as const;
  }

  if (capability === "retrieval" || capability === "memory") {
    return ["glm5", "qwen35Plus", "deepseekReasoner"] as const;
  }

  if (capability === "review" || capability === "expression") {
    return ["deepseekReasoner", "glm5", "qwen35Plus"] as const;
  }

  return ["deepseekReasoner", "qwen35Plus", "glm5"] as const;
}

export type ProgressCallback = (stage: "session" | "clarification" | "understanding" | "retrieval" | "feasibility" | "debate" | "evidence" | "writing" | "profile_update" | "completed", label: string, progressPercent: number, detail?: string) => void;

function classifyQueryIntent(query: string): QueryIntent {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return "chitchat";

  const chitchatPatterns = [
    /^(你好|hi|hello|hey|嗨|您好|早上好|下午好|晚上好|早安|晚安)[\s!！.。]*$/i,
    /^(谢谢|感谢|多谢|thanks|thank you|thx)[\s!！.。]*$/i,
    /^(再见|拜拜|bye|goodbye|see you)[\s!！.。]*$/i,
    /^(好的|ok|okay|嗯|哦|了解|明白|收到)[\s!！.。]*$/i,
    /^(你是谁|你叫什么|你是什么|who are you|你叫啥)[\?？]*/i,
    /^(今天天气|天气怎么样|现在几点|几点了|what time)[\?？]*/i,
    /^(哈哈|嘻嘻|呵呵|lol|😄|😊|👍|🎉)/i,
  ];

  const metaPatterns = [
    /^(你能做什么|你能帮我什么|你有什么功能|系统功能|使用说明|帮助|help|怎么用|如何使用|功能介绍|使用指南)[\?？]*/i,
    /^(什么是dqi|什么是gmps|dqi是什么|gmps是什么|毛利承压是什么|经营质量指数|诊断流程是什么)/i,
    /^(怎么采集数据|如何输入数据|数据从哪来|数据来源)/i,
  ];

  const diagnosticPatterns = [
    /分析|诊断|评估|测算|计算|查询|指标|比率|指数|得分|分数|毛利|承压|经营|现金流|营收|利润|成本|库存|负债|资产|roe|gmps|dqi|景气|趋势|建议|推荐|深度|拆解|投资|辩论|策略|行动|风险|画像|行业|锂|电池|碳酸锂|产能|产销/,
  ];

  for (const pattern of chitchatPatterns) {
    if (pattern.test(normalized)) return "chitchat";
  }

  for (const pattern of metaPatterns) {
    if (pattern.test(normalized)) return "meta";
  }

  for (const pattern of diagnosticPatterns) {
    if (pattern.test(normalized)) return "diagnostic";
  }

  if (normalized.length <= 4) return "chitchat";

  return "diagnostic";
}

function classifyQueryComplexity(input: DiagnosticAgentRequest): TaskComplexity {
  const query = input.query.toLowerCase();
  const simpleKeywords = ["计算", "查询", "是多少", "当前", "多少", "比率", "指数", "得分", "分数", "指标", "多少", "查一下", "告诉我", "看一下", "看看"];
  const moderateKeywords = ["分析", "判断", "趋势", "行业", "经营", "毛利承压", "经营质量", "景气", "怎么样", "如何", "情况", "变化", "对比", "比较", "评估", "状况", "表现"];
  const fullKeywords = ["建议", "推荐", "深度", "拆解", "投资", "辩论", "策略", "行动方案", "详细分析", "全面评估", "深入", "根因", "复盘", "规划", "方案"];

  if (input.focusMode === "investmentRecommendation" || input.focusMode === "deepDive" || input.focusMode === "industryStatus") {
    return "full";
  }

  if (fullKeywords.some((keyword) => query.includes(keyword))) {
    return "full";
  }

  if (moderateKeywords.some((keyword) => query.includes(keyword))) {
    return "moderate";
  }

  if (simpleKeywords.some((keyword) => query.includes(keyword))) {
    const hasCompleteData = Boolean(input.grossMarginInput) && Boolean(input.operatingQualityInput);
    if (hasCompleteData) {
      return "simple";
    }
    return "moderate";
  }

  return "moderate";
}

function nowIso() {
  return new Date().toISOString();
}

function getDurationMs(startedAt: string, completedAt: string) {
  return Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
}

function estimateBudgetUsedTokens(...values: Array<string | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .reduce((sum, value) => sum + Math.max(16, Math.ceil(value.length / 4)), 0);
}

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, roundScore(value)));
}

function normalizeFreshnessScore(ageInDays: number) {
  if (!Number.isFinite(ageInDays)) {
    return 0.25;
  }

  if (ageInDays <= 7) {
    return 1;
  }

  if (ageInDays <= 30) {
    return 0.85;
  }

  if (ageInDays <= 60) {
    return 0.6;
  }

  return 0.25;
}

function parseTimestamp(value?: string) {
  if (!value) {
    return Number.NaN;
  }

  const directTimestamp = new Date(value).getTime();
  if (!Number.isNaN(directTimestamp)) {
    return directTimestamp;
  }

  const normalizedValue = value
    .replace(/星期[一二三四五六日天]|周[一二三四五六日天]/g, "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const localizedDateMatch = normalizedValue.match(
    /^(\d{1,2})\s+(\d{1,2})月\s+(\d{4})(?:\s+(\d{2}:\d{2}:\d{2}))?\s*(GMT|UTC)?$/i,
  );

  if (localizedDateMatch) {
    const [, day, month, year, timeText = "00:00:00"] = localizedDateMatch;
    const [hours, minutes, seconds] = timeText.split(":").map((item) => Number(item));

    return Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number.isFinite(hours) ? hours : 0,
      Number.isFinite(minutes) ? minutes : 0,
      Number.isFinite(seconds) ? seconds : 0,
    );
  }

  return Number.NaN;
}

function calculateAgeInDays(primaryValue?: string, fallbackValue?: string) {
  const timestamp = parseTimestamp(primaryValue);
  if (Number.isNaN(timestamp) && !fallbackValue) {
    return Number.POSITIVE_INFINITY;
  }

  const fallbackTimestamp = Number.isNaN(timestamp) ? parseTimestamp(fallbackValue) : timestamp;
  if (Number.isNaN(fallbackTimestamp)) {
    return Number.POSITIVE_INFINITY;
  }

  const nowTimestamp = Date.now();
  if (Number.isNaN(nowTimestamp)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, (nowTimestamp - fallbackTimestamp) / (1000 * 60 * 60 * 24));
}

function getEvidenceStrength(evidence: IndustryEvidence) {
  if (typeof evidence.confidenceScore === "number") {
    return evidence.confidenceScore;
  }

  if (evidence.confidence === "high") {
    return 0.82;
  }

  if (evidence.confidence === "medium") {
    return 0.62;
  }

  return 0.38;
}

function getGatheredRecordCount(gatheredData?: Record<string, unknown>) {
  if (!gatheredData) {
    return 0;
  }

  const listCandidates = [
    gatheredData.data,
    gatheredData.records,
    gatheredData.reports,
  ];

  const matchedList = listCandidates.find((value) => Array.isArray(value));
  if (Array.isArray(matchedList)) {
    return matchedList.length;
  }

  return Object.keys(gatheredData).length > 0 ? 1 : 0;
}

function getAgentTimestampValue(value?: string) {
  const timestamp = parseTimestamp(value);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  return timestamp;
}

function getAgentOutput<TOutput>(response: DiagnosticWorkflowResponse, agentId: AgentId) {
  return response.agents.find((item) => item.agentId === agentId)?.output as TOutput | undefined;
}

function buildDualPortalIntegrationStatusBreakdown(channels: ReadonlyArray<DualPortalDataChannel>) {
  return channels.reduce<DualPortalPersonalizationAuditReport["summary"]["integrationStatusBreakdown"]>(
    (accumulator, channel) => {
      accumulator[channel.integrationStatus] += 1;
      return accumulator;
    },
    {
      real: 0,
      simulated: 0,
      degraded: 0,
      placeholder: 0,
    },
  );
}

function buildMetricResult(metricId: CompetitiveMetricId, score: number, evidence: string[]): CompetitiveMetricResult {
  const baseline = acceptanceMetricBaselines.find((item) => item.metricId === metricId);
  if (!baseline) {
    throw new Error(`Unknown acceptance metric: ${metricId}`);
  }

  const normalizedScore = clampPercentage(score);
  return {
    metricId,
    label: baseline.label,
    score: normalizedScore,
    threshold: baseline.threshold,
    passed: normalizedScore >= baseline.threshold,
    evidence: uniqueStrings(evidence).slice(0, 4),
  };
}

function evaluateWorkflowAcceptance(
  input: DiagnosticAgentRequest,
  response: DiagnosticWorkflowResponse,
): WorkflowAcceptanceResult {
  const dataUnderstanding = getAgentOutput<DataUnderstandingOutput>(response, "dataUnderstanding");
  const dataGathering = getAgentOutput<DataGatheringOutput>(response, "dataGathering");
  const industryRetrieval = getAgentOutput<IndustryRetrievalOutput>(response, "industryRetrieval");
  const evidenceReview = getAgentOutput<EvidenceReviewOutput>(response, "evidenceReview");
  const memoryManagement = getAgentOutput<MemoryManagementOutput>(response, "memoryManagement");
  const expressionGeneration = getAgentOutput<ExpressionGenerationOutput>(response, "expressionGeneration");

  const citations = industryRetrieval?.citations ?? [];
  const publicationAgeSamples = citations.map((item) => calculateAgeInDays(item.publishedAt, item.retrievedAt));
  const retrievalAgeSamples = citations.map((item) => calculateAgeInDays(item.retrievedAt));
  const averagePublicationFreshness = average(publicationAgeSamples.map(normalizeFreshnessScore), 0.45);
  const averageRetrievalFreshness = average(retrievalAgeSamples.map(normalizeFreshnessScore), 0.45);
  const gatheredRecordCount = getGatheredRecordCount(dataGathering?.gatheredData);
  const retrievalActivityScore = Math.min(
    12,
    (industryRetrieval?.indexStats.searchHits ?? 0) * 2 + (industryRetrieval?.indexStats.fetchedPages ?? 0),
  );
  const retrievalCoverageScore = Math.min(10, citations.length * 3 + Math.min(4, gatheredRecordCount));
  const stalePenalty = Math.min(8, (industryRetrieval?.indexStats.staleFiltered ?? 0) * 2);
  const timelinessScore =
    averagePublicationFreshness * 35 +
    averageRetrievalFreshness * 10 +
    (dataGathering?.status === "success" ? 18 : dataGathering?.status === "degraded" ? 10 : 0) +
    retrievalCoverageScore +
    retrievalActivityScore -
    stalePenalty;

  const evidenceSourceCount = uniqueStrings((industryRetrieval?.evidence ?? []).map((item) => item.source)).length;
  const averageEvidenceStrength = average((industryRetrieval?.evidence ?? []).map(getEvidenceStrength), 0.45);

  const credibilityScore =
    (evidenceReview?.confidenceScore ?? 0.45) * 58 +
    averageEvidenceStrength * 18 +
    Math.min(14, (evidenceReview?.verifiedClaims.length ?? 0) * 2.5) +
    Math.min(10, evidenceSourceCount * 1.8) +
    (dataGathering?.status === "success" ? 6 : dataGathering?.status === "degraded" ? 2 : 0) -
    Math.min(20, (evidenceReview?.challengedClaims.length ?? 0) * 5) -
    ((industryRetrieval?.indexStats.fallbackUsed ?? false) ? 3 : 0);

  const personalizationSignalCount = [
    true,
    input.memoryNotes.length > 0,
    Boolean(memoryManagement?.recalledMemories.length),
    dataUnderstanding?.extractedFocus.includes(input.focusMode) ?? false,
    dataUnderstanding?.extractedFocus.includes(input.role === "enterprise" ? "经营诊断" : "投资判断") ?? false,
  ].filter(Boolean).length;
  const personalizationScore =
    personalizationSignalCount * 14 +
    Math.min(28, (expressionGeneration?.recommendedActions.length ?? 0) * 8) +
    (response.summary.includes("证据可信度") ? 16 : 8);

  const collaborationAgents = ["dataGathering", "dataUnderstanding", "industryRetrieval"] as const;
  const collaborationTimestamps = collaborationAgents
    .map((agentId) => response.agents.find((item) => item.agentId === agentId))
    .filter((item): item is AgentExecutionResult => Boolean(item))
    .map((item) => getAgentTimestampValue(item.startedAt))
    .filter((value): value is number => value !== undefined);
  const parallelStartDelta =
    collaborationTimestamps.length > 1
      ? Math.max(...collaborationTimestamps) - Math.min(...collaborationTimestamps)
      : 999;
  const startedTimestamps = response.agents
    .map((item) => getAgentTimestampValue(item.startedAt))
    .filter((value): value is number => value !== undefined);
  const completedTimestamps = response.agents
    .map((item) => getAgentTimestampValue(item.completedAt))
    .filter((value): value is number => value !== undefined);
  const firstStartedAt = startedTimestamps.length > 0 ? Math.min(...startedTimestamps) : Number.NaN;
  const lastCompletedAt = completedTimestamps.length > 0 ? Math.max(...completedTimestamps) : Number.NaN;
  const wallClockDurationMs =
    Number.isFinite(firstStartedAt) && Number.isFinite(lastCompletedAt)
      ? Math.max(1, lastCompletedAt - firstStartedAt)
      : response.governance?.totalDurationMs ?? 1;
  const totalAgentDuration = response.agents.reduce(
    (sum, item) => sum + (item.governance?.durationMs ?? getDurationMs(item.startedAt, item.completedAt)),
    0,
  );
  const parallelPlannedCount = workflowPlan.filter((item) => item.executionMode === "parallel").length;
  const serialPlannedCount = workflowPlan.length - parallelPlannedCount;
  const parallelExecutedCount = response.agents.filter((item) =>
    workflowPlan.find((step) => step.agentId === item.agentId)?.executionMode === "parallel",
  ).length;
  const serialExecutedCount = response.agents.filter((item) =>
    workflowPlan.find((step) => step.agentId === item.agentId)?.executionMode === "serial",
  ).length;
  const degradedCount = response.agents.filter((item) => item.status === "degraded").length;
  const manualInterventionCount = response.agents.filter(
    (item) => item.governance?.manualInterventionAvailable,
  ).length;
  const retryCount = response.agents.reduce((sum, item) => sum + (item.governance?.retryCount ?? 0), 0);
  const durationGainRatio = totalAgentDuration / Math.max(1, wallClockDurationMs);
  const launchCoordinationScore =
    parallelStartDelta <= 40 ? 22 : parallelStartDelta <= 90 ? 19 : parallelStartDelta <= 160 ? 13 : 6;
  const parallelCoverageScore = (parallelExecutedCount / Math.max(1, parallelPlannedCount)) * 24;
  const handoffScore = (serialExecutedCount / Math.max(1, serialPlannedCount)) * 18;
  const concurrencyEfficiencyScore =
    durationGainRatio >= 1
      ? Math.min(12, Math.max(6, (durationGainRatio - 1) * 16 + 6))
      : Math.max(0, durationGainRatio * 4);
  const governanceStabilityScore = Math.max(
    0,
    24 -
      degradedCount * 4 -
      manualInterventionCount -
      retryCount -
      (response.governance?.budget.withinBudget === false ? 8 : 0),
  );
  const collaborationScore =
    launchCoordinationScore +
    parallelCoverageScore +
    handoffScore +
    concurrencyEfficiencyScore +
    governanceStabilityScore;

  const metrics = [
    buildMetricResult("timeliness", timelinessScore, [
      `外部数据状态：${dataGathering?.status ?? "unknown"}，来源：${dataGathering?.source ?? "unknown"}`,
      `发布时间新鲜度：${roundScore(averagePublicationFreshness)}，检索刷新度：${roundScore(averageRetrievalFreshness)}`,
      `引用数量：${citations.length}，外部记录数：${gatheredRecordCount}，检索命中：${industryRetrieval?.indexStats.searchHits ?? 0}`,
      citations[0]?.publishedAt
        ? `最新引用发布时间：${citations[0].publishedAt}`
        : citations[0]?.retrievedAt
          ? `最新引用检索时间：${citations[0].retrievedAt}`
          : "当前暂无可用引用时间戳",
    ]),
    buildMetricResult("credibility", credibilityScore, [
      `证据审校分：${roundScore((evidenceReview?.confidenceScore ?? 0) * 100)}`,
      `证据源数：${evidenceSourceCount}，平均证据强度：${roundScore(averageEvidenceStrength * 100)}`,
      `已验证结论：${evidenceReview?.verifiedClaims.length ?? 0} 条，待挑战：${evidenceReview?.challengedClaims.length ?? 0} 条`,
      citations.length > 0 ? `已形成 ${citations.length} 条可引用证据` : "当前缺少可引用网页证据",
    ]),
    buildMetricResult("personalization", personalizationScore, [
      `显式偏好/记忆输入：${input.memoryNotes.length} 条`,
      `召回历史记忆：${memoryManagement?.recalledMemories.length ?? 0} 条`,
      `聚焦主题：${dataUnderstanding?.extractedFocus.join("、") ?? "无"}`,
      `定制动作：${expressionGeneration?.recommendedActions.length ?? 0} 条`,
    ]),
    buildMetricResult("collaborationEfficiency", collaborationScore, [
      `并行起跑偏差：${parallelStartDelta} ms`,
      `并行节点覆盖：${parallelExecutedCount}/${parallelPlannedCount}，串行节点覆盖：${serialExecutedCount}/${serialPlannedCount}`,
      `总智能体耗时：${totalAgentDuration} ms，墙钟耗时：${wallClockDurationMs} ms，协同时比：${roundScore(durationGainRatio)}`,
      `降级节点：${degradedCount} 个，人工介入信号：${manualInterventionCount} 个，重试次数：${retryCount}`,
    ]),
  ];

  const overallScore = clampPercentage(
    metrics.reduce((sum, item) => sum + item.score, 0) / Math.max(1, metrics.length),
  );

  return {
    overallScore,
    overallPassed: metrics.every((item) => item.passed),
    metrics,
  };
}

export class DiagnosticWorkflowService {
  private readonly env: ServerEnv;

  private readonly modelRouter: ModelRouter;

  private readonly memoryStore: InMemoryMemoryStore;

  private readonly ragService: RealtimeIndustryRagService;

  private readonly providerStatus: ReturnType<typeof getConfiguredProviders>;

  private readonly dataGatheringAgent: DataGatheringAgent;

  private readonly platformStore?: PlatformStore;

  private readonly retryLimit: number;

  private readonly budgetTotalTokens: number;

  constructor(env: ServerEnv, dependencies: WorkflowDependencies = {}) {
    this.env = env;
    this.modelRouter = dependencies.modelRouter ?? new ModelRouter(createDefaultAdapters(env));
    this.memoryStore = dependencies.memoryStore ?? new InMemoryMemoryStore(dependencies.platformStore);
    this.ragService =
      dependencies.ragService ??
      new RealtimeIndustryRagService({
        cacheTtlMs: env.CACHE_TTL_SECONDS * 1000,
        sourceWhitelist: env.RAG_SOURCE_WHITELIST,
        maxSourceAgeDays: env.RAG_MAX_SOURCE_AGE_DAYS,
        modelRouter: this.modelRouter,
        platformStore: dependencies.platformStore,
      });
    this.providerStatus = getConfiguredProviders(env);
    this.dataGatheringAgent = dependencies.dataGatheringAgent ?? new DataGatheringAgent({ env });
    this.platformStore = dependencies.platformStore;
    this.retryLimit = env.AGENT_RETRY_LIMIT;
    this.budgetTotalTokens = env.AGENT_BUDGET_TOTAL_TOKENS;
  }

  getDataGatheringAgent() {
    return this.dataGatheringAgent;
  }

  async collectIndustryData() {
    const currentYear = String(new Date().getFullYear());
    const currentPeriod = `${currentYear}-Q${Math.ceil((new Date().getMonth() + 1) / 3)}`;

    const macroContext = await this.collectMacroContext(
      { role: "enterprise", query: "碳酸锂价格 行业指数 锂电池行业" } as DiagnosticAgentRequest,
      currentPeriod,
      currentYear,
    );

    const result: Record<string, unknown> = {
      macroContext,
      success: !macroContext.degraded,
    };

    if (this.platformStore && !macroContext.degraded) {
      const macroRec = macroContext as Record<string, unknown>;
      const hasPlaceholder = Array.isArray(macroRec.records) && macroRec.records.some((r: Record<string, unknown>) => r.isPlaceholder);
      if (!hasPlaceholder) {
        const hasActualLithiumPrice = typeof macroRec.lithiumPrice === "number" && macroRec.lithiumPrice > 0;
        const hasActualIndustryVolatility = typeof macroRec.industryVolatility === "number" && macroRec.industryVolatility > 0;
        if (hasActualLithiumPrice || hasActualIndustryVolatility) {
          await this.platformStore.saveIndustryData({
            recordId: `industry_${Date.now()}`,
            dataDate: new Date().toISOString().slice(0, 10),
            lithiumPrice: {
              priceDate: new Date().toISOString().slice(0, 10),
              price: hasActualLithiumPrice ? (macroRec.lithiumPrice as number) * 10000 : 0,
              source: hasActualLithiumPrice
                ? (typeof macroRec.source === "string" ? macroRec.source : "data-gathering-agent")
                : "default-estimate",
            },
            industryIndex: hasActualIndustryVolatility ? {
              indexDate: new Date().toISOString().slice(0, 10),
              indexType: "CSI_POWER_BATTERY",
              indexValue: typeof macroRec.industryIndexValue === "number" ? macroRec.industryIndexValue : 0,
              volatility: macroRec.industryVolatility as number,
            } : undefined,
          });
          result.persisted = true;
        }
      }
    }

    return result;
  }

  private getAcceptanceEvidenceMode(): AcceptanceEvidenceMode {
    return this.env.NODE_ENV === "test" ? "automated_mock" : "configured_runtime";
  }

  private async generateModelConnectivityAcceptanceReport() {
    const cases: ModelConnectivityAcceptanceCase[] = [];

    for (const acceptanceCase of modelConnectivityAcceptanceCases) {
      const result = await this.modelRouter.probeProvider(acceptanceCase.provider, {
        agentId: "taskOrchestrator",
        capability: acceptanceCase.capability,
        prompt: acceptanceCase.prompt,
        context: acceptanceCase.context,
        preferredProviders: [acceptanceCase.provider],
      });

      cases.push({
        caseId: acceptanceCase.caseId,
        label: acceptanceCase.label,
        provider: acceptanceCase.provider,
        model: result.model,
        capability: acceptanceCase.capability,
        available: result.available,
        status:
          result.status === "success"
            ? "passed"
            : result.status === "unavailable"
              ? "unavailable"
              : "failed",
        latencyMs: result.latencyMs,
        responsePreview: result.response?.text.slice(0, 120),
        usage: result.response?.usage,
        error: result.error,
      });
    }

    const passedCaseCount = cases.filter((item) => item.status === "passed").length;

    return {
      overallPassed: passedCaseCount === cases.length,
      passedCaseCount,
      totalCaseCount: cases.length,
      cases,
      notes: [
        "每个模型均使用其主职责能力单独探测，不依赖路由回退。",
        "未配置 API 密钥时记为 unavailable，调用失败时记为 failed。",
        "自动化测试中的 mock 通过仅表示验收逻辑生效，只有在 acceptance-report 使用真实密钥运行时才计为真实连通通过。",
        "该结果可与 acceptance-report 脚本一起复现，作为连通性门禁。",
      ],
    };
  }

  private buildRagTraceabilityReport(
    scenarioResults: CompetitiveAcceptanceScenarioResult[],
    diagnostics: DiagnosticWorkflowResponse[],
  ) {
    const traceabilityScenarios = scenarioResults.map((scenarioResult, index) => {
      const diagnostic = diagnostics[index];
      if (!diagnostic) {
        return {
          scenarioId: scenarioResult.scenarioId,
          label: scenarioResult.label,
          query: "",
          citationCount: 0,
          traceCoverage: 0,
          documentTypes: [] as RagDocumentType[],
          searchProvider: "unknown",
          fallbackUsed: false,
          passed: false,
          evidence: ["缺少对应的诊断结果，无法生成 RAG 可追溯性验收记录。"],
        };
      }

      const industryRetrieval = getAgentOutput<IndustryRetrievalOutput>(diagnostic, "industryRetrieval");
      const citations = industryRetrieval?.citations ?? [];
      const traceableCitations = citations.filter((item) => Boolean(item.trace?.chunkId)).length;
      const traceCoverage =
        citations.length > 0 ? clampPercentage((traceableCitations / citations.length) * 100) : 0;
      const documentTypes = Array.from(
        new Set(citations.map((item) => item.trace.documentType)),
      ) as RagDocumentType[];
      const passed =
        citations.length > 0 &&
        traceCoverage === 100 &&
        documentTypes.some((item) => item === "financialReport" || item === "industryReport");

      return {
        scenarioId: scenarioResult.scenarioId,
        label: scenarioResult.label,
        query: industryRetrieval?.query ?? "",
        citationCount: citations.length,
        traceCoverage,
        documentTypes,
        searchProvider: industryRetrieval?.indexStats.searchProvider ?? "unknown",
        fallbackUsed: industryRetrieval?.indexStats.fallbackUsed ?? false,
        passed,
        evidence: uniqueStrings([
          `引用数：${citations.length}，追溯覆盖率：${traceCoverage}%`,
          `文档类型：${documentTypes.join("、") || "无"}`,
          `检索通道：${industryRetrieval?.indexStats.searchProvider ?? "unknown"}${industryRetrieval?.indexStats.fallbackUsed ? "（含回退）" : ""}`,
          citations[0]?.trace
            ? `Top1 追溯：${citations[0].trace.documentId}/${citations[0].trace.chunkId}`
            : "当前无可追溯引用",
        ]),
      };
    });

    return {
      totalScenarioCount: traceabilityScenarios.length,
      passedScenarioCount: traceabilityScenarios.filter((item) => item.passed).length,
      scenarios: traceabilityScenarios,
    };
  }

  private buildPerformanceBaseline(diagnostics: DiagnosticWorkflowResponse[]) {
    const workflowDurations = diagnostics.map((item) => item.governance?.totalDurationMs ?? 0);
    const allAgentDurations = diagnostics.flatMap((item) =>
      item.agents.map((agent) => agent.governance?.durationMs ?? getDurationMs(agent.startedAt, agent.completedAt)),
    );
    const budgetSamples = diagnostics.map((item) => item.governance?.budget.usedTokens ?? 0);
    const industryOutputs = diagnostics.map((item) =>
      getAgentOutput<IndustryRetrievalOutput>(item, "industryRetrieval"),
    );
    const dataGatheringOutputs = diagnostics.map((item) =>
      getAgentOutput<DataGatheringOutput>(item, "dataGathering"),
    );

    return {
      scenarioCount: diagnostics.length,
      averageWorkflowDurationMs: roundScore(average(workflowDurations)),
      maxWorkflowDurationMs: roundScore(Math.max(...workflowDurations, 0)),
      averageAgentDurationMs: roundScore(average(allAgentDurations)),
      averageBudgetUsedTokens: roundScore(average(budgetSamples)),
      averageCitationCount: roundScore(average(industryOutputs.map((item) => item?.citations.length ?? 0))),
      averageExternalRecordCount: roundScore(
        average(dataGatheringOutputs.map((item) => getGatheredRecordCount(item?.gatheredData))),
      ),
      averageSearchHits: roundScore(average(industryOutputs.map((item) => item?.indexStats.searchHits ?? 0))),
      averageChunkCount: roundScore(average(industryOutputs.map((item) => item?.indexStats.chunkCount ?? 0))),
      reproducibilityKey: `task7-baseline:${diagnostics.length}:${workflowDurations.join("-")}`,
      evidenceMode: this.getAcceptanceEvidenceMode(),
    };
  }

  private buildBusinessQualityBaseline(
    aggregateMetrics: WorkflowAcceptanceResult["metrics"],
    scenarioResults: CompetitiveAcceptanceScenarioResult[],
    modelConnectivity: Awaited<ReturnType<DiagnosticWorkflowService["generateModelConnectivityAcceptanceReport"]>>,
    ragTraceability: ReturnType<DiagnosticWorkflowService["buildRagTraceabilityReport"]>,
  ) {
    const scenarioScores = scenarioResults.map((item) => ({
      scenarioId: item.scenarioId,
      score: item.acceptance.overallScore,
      passed: item.acceptance.overallPassed,
    }));
    const minimumScenarioScore =
      scenarioScores.length > 0 ? Math.min(...scenarioScores.map((item) => item.score)) : 0;
    const overallScore = clampPercentage(
      average([
        ...aggregateMetrics.map((item) => item.score),
        modelConnectivity.overallPassed ? 100 : (modelConnectivity.passedCaseCount / Math.max(1, modelConnectivity.totalCaseCount)) * 100,
        ragTraceability.totalScenarioCount > 0
          ? (ragTraceability.passedScenarioCount / ragTraceability.totalScenarioCount) * 100
          : 0,
      ]),
    );

    return {
      overallScore,
      overallPassed:
        aggregateMetrics.every((item) => item.passed) &&
        scenarioScores.every((item) => item.passed) &&
        modelConnectivity.overallPassed &&
        ragTraceability.passedScenarioCount === ragTraceability.totalScenarioCount,
      minimumScenarioScore: roundScore(minimumScenarioScore),
      scenarioScores,
      metrics: aggregateMetrics,
      evidenceMode: this.getAcceptanceEvidenceMode(),
    };
  }

  async generateCompetitiveAcceptanceReport(): Promise<CompetitiveAcceptanceReport> {
    const scenarios: CompetitiveAcceptanceScenarioResult[] = [];
    const diagnostics: DiagnosticWorkflowResponse[] = [];

    for (const scenario of acceptanceBenchmarkScenarios) {
      const diagnostic = await this.diagnose(scenario.payload);
      diagnostics.push(diagnostic);
      scenarios.push({
        scenarioId: scenario.scenarioId,
        label: scenario.label,
        role: diagnostic.role,
        focusMode: scenario.payload.focusMode,
        workflowId: diagnostic.workflowId,
        summary: diagnostic.summary,
        acceptance: diagnostic.acceptance,
      });
    }

    const aggregateMetrics = acceptanceMetricBaselines.map((baseline) => {
      const scenarioScores = scenarios.map((item) => {
        return item.acceptance.metrics.find((metric) => metric.metricId === baseline.metricId)?.score ?? 0;
      });
      const averageScore = clampPercentage(
        scenarioScores.reduce((sum, item) => sum + item, 0) / Math.max(1, scenarioScores.length),
      );

      return buildMetricResult(baseline.metricId, averageScore, [
        `基线阈值：${baseline.threshold}`,
        `通过场景数：${scenarios.filter((item) => item.acceptance.metrics.find((metric) => metric.metricId === baseline.metricId)?.passed).length}/${scenarios.length}`,
        `平均分：${averageScore}`,
      ]);
    });

    const passedScenarioCount = scenarios.filter((item) => item.acceptance.overallPassed).length;
    const overallScore = clampPercentage(
      aggregateMetrics.reduce((sum, item) => sum + item.score, 0) / Math.max(1, aggregateMetrics.length),
    );
    const ragTraceability = this.buildRagTraceabilityReport(scenarios, diagnostics);
    const modelConnectivity = await this.generateModelConnectivityAcceptanceReport();
    const performanceBaseline = this.buildPerformanceBaseline(diagnostics);
    const businessQualityBaseline = this.buildBusinessQualityBaseline(
      aggregateMetrics,
      scenarios,
      modelConnectivity,
      ragTraceability,
    );

    const evidenceMode = this.getAcceptanceEvidenceMode();

    return {
      generatedAt: nowIso(),
      evidenceMode,
      baselines: acceptanceMetricBaselines.map((item) => ({
        metricId: item.metricId,
        label: item.label,
        threshold: item.threshold,
      })),
      aggregate: {
        overallScore,
        overallPassed:
          aggregateMetrics.every((item) => item.passed) && passedScenarioCount === scenarios.length,
        passedScenarioCount,
        totalScenarioCount: scenarios.length,
        metrics: aggregateMetrics,
      },
      scenarios,
      ragTraceability,
      modelConnectivity,
      performanceBaseline,
      businessQualityBaseline,
      reproduction: {
        command: "npx tsx src/server/acceptance-report.ts",
        evaluationVersion: "task8-financial-connectivity-and-doc-alignment-v1",
        scenarioIds: acceptanceBenchmarkScenarios.map((item) => item.scenarioId),
        environmentMode: evidenceMode,
      },
    };
  }

  async generateMinimumDeploymentAuditReport(): Promise<MinimumDeploymentAuditReport> {
    const deploymentReadiness = getDeploymentReadiness(this.env);
    const runtimeReadiness = getRuntimeReadiness(this.env);
    const evidenceMode = this.getAcceptanceEvidenceMode();
    const smokeUserId = "minimum-deployment-audit-user";

    const firstWorkflow = await this.diagnose({
      role: "investor",
      userId: smokeUserId,
      query: "请结合行业景气、现金流和风险信号给出一段简短的投资侧诊断摘要。",
      focusMode: "investmentRecommendation",
      memoryNotes: ["重点关注现金流质量", "保留个性化历史偏好"],
    });
    const secondWorkflow = await this.diagnose({
      role: "investor",
      userId: smokeUserId,
      query: "延续上一轮结论，给出后续跟踪建议，并保持同样的关注重点。",
      focusMode: "deepDive",
    });

    const secondMemory = getAgentOutput<MemoryManagementOutput>(secondWorkflow, "memoryManagement");
    const secondDataGathering = getAgentOutput<DataGatheringOutput>(secondWorkflow, "dataGathering");
    const smokeWorkflowPassed =
      Boolean(firstWorkflow.finalAnswer) &&
      Boolean(secondWorkflow.finalAnswer) &&
      (secondMemory?.savedMemory ? 1 : 0) >= 1;

    const checks: MinimumDeploymentAuditCheck[] = [
      {
        checkId: "server_only_config",
        label: "供应商级 API 与凭证仅在服务端配置",
        passed: deploymentReadiness.privateConfigMode === "server_only",
        evidence: [
          `配置模式：${deploymentReadiness.privateConfigMode}`,
          "普通用户仅访问业务接口，不暴露第三方模型或数据源凭证输入。",
        ],
      },
      {
        checkId: "minimum_api_inputs",
        label: "至少一个模型 API Key 即满足最小部署条件",
        passed: deploymentReadiness.canRunWithApiOnly,
        evidence: [
          `必填项：${deploymentReadiness.requiredInputs.join("；")}`,
          `可选项：${deploymentReadiness.optionalInputs.join("；")}`,
          deploymentReadiness.summary,
        ],
      },
      {
        checkId: "persistence_ready",
        label: "个性化存储与跨会话持久化已启用",
        passed: runtimeReadiness.subsystems.persistence.status === "ready",
        evidence: [
          `持久化模式：${runtimeReadiness.subsystems.persistence.mode}`,
          runtimeReadiness.subsystems.persistence.summary,
        ],
      },
      {
        checkId: "workflow_smoke_test",
        label: "最小部署主工作流可输出结果且可接受可选数据源降级",
        passed: smokeWorkflowPassed,
        evidence: [
          `首轮工作流：${firstWorkflow.workflowId}`,
          `二轮工作流：${secondWorkflow.workflowId}`,
          `二轮数据采集状态：${secondDataGathering?.status ?? "unknown"}`,
          secondWorkflow.finalAnswer ? "主工作流已生成最终回答。" : "主工作流未生成最终回答。",
        ],
      },
      {
        checkId: "personalization_memory_recall",
        label: "个性化记忆能够写入并在后续工作流中召回",
        passed: (secondMemory?.recalledMemories.length ?? 0) > 0,
        evidence: [
          `召回记忆数：${secondMemory?.recalledMemories.length ?? 0}`,
          `本轮是否写入新记忆：${secondMemory?.savedMemory ? "是" : "否"}`,
          "同一 userId 的二次诊断已验证记忆链路参与个性化上下文。",
        ],
      },
    ];

    return {
      generatedAt: nowIso(),
      evidenceMode,
      overallPassed: checks.every((item) => item.passed),
      deploymentReadiness,
      runtimeReadiness,
      checks,
      smokeWorkflow: {
        firstWorkflowId: firstWorkflow.workflowId,
        secondWorkflowId: secondWorkflow.workflowId,
        finalAnswerReady: Boolean(firstWorkflow.finalAnswer && secondWorkflow.finalAnswer),
        degradedDataSource: Boolean(secondDataGathering?.status === "degraded"),
        recalledMemoryCount: secondMemory?.recalledMemories.length ?? 0,
        savedMemoryCount: secondMemory?.savedMemory ? 1 : 0,
        passed: smokeWorkflowPassed && (secondMemory?.recalledMemories.length ?? 0) > 0,
      },
      recommendations: [
        deploymentReadiness.canRunWithApiOnly
          ? "已满足最小模型 API 条件，建议在真实密钥环境运行 minimum-deployment-report 复核。"
          : "请先在服务端配置至少一个模型 API Key，再执行最小部署验收。",
        runtimeReadiness.subsystems.persistence.status === "ready"
          ? "文件持久化已启用，可继续验证跨重启恢复能力。"
          : "请切换到文件持久化模式，否则个性化数据在服务重启后无法保留。",
        secondDataGathering?.status === "degraded"
          ? "当前最小部署验证允许可选数据源降级；系统会继续使用公开网页 RAG 提供宏观证据，NBS 仅作为结构化增强源。"
          : "数据采集链路已处于可用状态，可继续验证真实外部源的新鲜度。",
      ],
    };
  }

  generateDualPortalPersonalizationAuditReport(): DualPortalPersonalizationAuditReport {
    const dataChannels = dualPortalAuditDataChannels.map((item) => ({
      ...item,
      personalizationDrivers: [...item.personalizationDrivers],
      notes: [...item.notes],
    }));
    const pageMatrix = dualPortalAuditPageMatrix.map((item) => ({
      ...item,
      keyModules: [...item.keyModules],
      chartFamilies: [...item.chartFamilies],
      primaryActions: [...item.primaryActions],
      copySignals: [...item.copySignals],
      personalizationDrivers: [...item.personalizationDrivers],
      isolationExpectations: [...item.isolationExpectations],
    }));
    const personalizationDrivers = dualPortalPersonalizationDrivers.map((item) => ({
      ...item,
      sourceFields: [...item.sourceFields],
      upstreamChannels: [...item.upstreamChannels],
      downstreamSurfaces: [...item.downstreamSurfaces],
    }));
    const findings = dualPortalAuditFindings.map((item) => ({
      ...item,
      relatedChannelIds: [...item.relatedChannelIds],
      relatedDriverIds: [...item.relatedDriverIds],
    }));

    return {
      generatedAt: nowIso(),
      summary: {
        channelCount: dataChannels.length,
        pageCount: pageMatrix.length,
        driverCount: personalizationDrivers.length,
        integrationStatusBreakdown: buildDualPortalIntegrationStatusBreakdown(dataChannels),
      },
      dataChannels,
      pageMatrix,
      personalizationDrivers,
      findings,
      releaseGates: [
        "企业端与投资端页面必须通过页面矩阵逐项核对，禁止仅更换角色文案。",
        "所有外部数据链路必须展示真实、模拟、降级或待接入状态。",
        "preferredRole、focusMode、企业基础信息、投资画像、会话上下文和记忆链路必须真实参与结果生成。",
        "角色切换后不得暴露另一端专属模块、按钮或服务提示。",
      ],
    };
  }

  async diagnose(payload: unknown, onProgress?: ProgressCallback): Promise<DiagnosticWorkflowResponse> {
    const input = parseRequest(payload);
    const intent = classifyQueryIntent(input.query);
    const complexity = input.complexity ?? classifyQueryComplexity(input);
    const workflowId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${input.userId}`;
    const degradationTrace: DegradationEvent[] = [];

    if (intent === "chitchat" || intent === "meta") {
      return this.handleConversation(input, intent, workflowId, onProgress);
    }

    if (complexity === "simple") {
      onProgress?.("understanding", "计算数学模型", 30, "数学分析+LLM表达");
      const mathAnalysis = await this.runMathAnalysisAgent(input);
      degradationTrace.push(...mathAnalysis.degradationTrace);

      onProgress?.("writing", "生成结论", 70, "LLM基于数学模型生成表达");
      const expressionGeneration = await this.runModelBackedAgent({
        agentId: "expressionGeneration",
        input,
        prompt: `请基于以下数学模型计算结果，简洁回答用户的问题：${input.query}\n\n模型计算结果：\n- 综合风险等级：${mathAnalysis.output.combinedRiskLevel}\n- 核心指标：${mathAnalysis.output.combinedInsights.slice(0, 4).join("；")}${mathAnalysis.output.dqiModel ? `\n- DQI指数：${mathAnalysis.output.dqiModel.dqi.toFixed(2)}（${mathAnalysis.output.dqiModel.status}）${mathAnalysis.output.dqiModel.trend ? `\n- DQI趋势：${mathAnalysis.output.dqiModel.trend}` : ""}` : ""}${mathAnalysis.output.gmpsModel ? `\n- GMPS得分：${mathAnalysis.output.gmpsModel.gmps.toFixed(2)}（${mathAnalysis.output.gmpsModel.level}）\n- 下季度风险概率：${(mathAnalysis.output.gmpsModel.probabilityNextQuarter * 100).toFixed(2)}%（${mathAnalysis.output.gmpsModel.riskLevel}）` : ""}`,
        capability: "expression",
        buildOutput: (text) => buildExpressionGenerationOutput(
          input,
          mathAnalysis.output,
          { confidence: "medium", confidenceScore: 0.6, verifiedClaims: mathAnalysis.output.combinedInsights.slice(0, 3), challengedClaims: [], citations: [], citationAbstracts: [], reviewSummary: "简单路径：基于DQI/GMPS模型计算结果生成结论。" },
          { workingMemoryDigest: input.memoryNotes.length > 0 ? input.memoryNotes.join("；") : "无历史记忆", recalledMemories: [] },
          text,
        ),
        buildSummary: (output) => output.executiveSummary,
        fallbackOutput: () => buildExpressionGenerationOutput(
          input,
          mathAnalysis.output,
          { confidence: "medium", confidenceScore: 0.6, verifiedClaims: mathAnalysis.output.combinedInsights.slice(0, 3), challengedClaims: [], citations: [], citationAbstracts: [], reviewSummary: "简单路径：基于数学模型结果生成结论。" },
          { workingMemoryDigest: input.memoryNotes.length > 0 ? input.memoryNotes.join("；") : "无历史记忆", recalledMemories: [] },
          `根据模型计算，综合风险等级为${mathAnalysis.output.combinedRiskLevel}。${mathAnalysis.output.combinedInsights.join("；")}`,
        ),
        fallbackMessage: "表达生成已切换到本地模板。",
      });
      degradationTrace.push(...expressionGeneration.degradationTrace);

      await this.memoryStore.appendWithFilter({
        userId: input.userId,
        summary: `${input.query}｜${expressionGeneration.output.executiveSummary}`,
        tags: uniqueStrings([input.role, input.focusMode, mathAnalysis.output.combinedRiskLevel]).slice(0, 6),
        role: input.role,
        source: "workflow",
      });

      const agents: AgentExecutionResult[] = [
        { agentId: agentIdSchema.enum.taskOrchestrator, status: "skipped" as const, provider: "local" as const, summary: "简单任务跳过编排", attempts: [], startedAt: nowIso(), completedAt: nowIso(), output: { mission: input.query, planNarrative: "简化路径：数学计算+LLM表达", parallelBranches: [] } },
        { agentId: agentIdSchema.enum.memoryManagement, status: "skipped" as const, provider: "local" as const, summary: "简单任务跳过记忆召回", attempts: [], startedAt: nowIso(), completedAt: nowIso(), output: { workingMemoryDigest: "", recalledMemories: [] } },
        { agentId: agentIdSchema.enum.dataGathering, status: "skipped" as const, provider: "local" as const, summary: "简单任务跳过数据采集", attempts: [], startedAt: nowIso(), completedAt: nowIso(), output: { gatheredData: {}, status: "skipped", source: "none" } },
        { agentId: agentIdSchema.enum.dataUnderstanding, status: "skipped" as const, provider: "local" as const, summary: "简单任务跳过数据理解", attempts: [], startedAt: nowIso(), completedAt: nowIso(), output: { objective: input.query, extractedFocus: [input.focusMode], datasetCompleteness: "medium" as const, missingInputs: [] } },
        mathAnalysis.result,
        { agentId: agentIdSchema.enum.industryRetrieval, status: "skipped" as const, provider: "local" as const, summary: "简单任务跳过行业检索", attempts: [], startedAt: nowIso(), completedAt: nowIso(), output: { query: "", synthesis: "", retrievalSummary: "", referenceAbstract: "", evidence: [], citations: [], indexStats: { searchHits: 0, fetchedPages: 0, chunkCount: 0, rankedChunks: 0, searchProvider: "none", fallbackUsed: false } } },
        { agentId: agentIdSchema.enum.evidenceReview, status: "skipped" as const, provider: "local" as const, summary: "简单任务跳过证据审校", attempts: [], startedAt: nowIso(), completedAt: nowIso(), output: { confidence: "medium" as const, confidenceScore: 0.6, verifiedClaims: [], challengedClaims: [], citations: [], citationAbstracts: [], reviewSummary: "简单路径：基于模型结果直接表达" } },
        expressionGeneration.result,
      ];

      const totalDurationMs = agents.reduce((sum, agent) => sum + (agent.governance?.durationMs ?? getDurationMs(agent.startedAt, agent.completedAt)), 0);
      const usedTokens = agents.reduce((sum, agent) => sum + (agent.governance?.budgetUsedTokens ?? 0), 0);

      return {
        workflowId,
        role: input.role,
        providerStatus: this.providerStatus,
        plan: workflowPlan,
        agents,
        degradationTrace,
        finalAnswer: expressionGeneration.output.finalAnswer,
        summary: expressionGeneration.output.executiveSummary,
        memorySnapshot: this.memoryStore.list(input.userId, 5),
        acceptance: { overallScore: 0, overallPassed: false, metrics: [] },
        governance: {
          workflowState: "completed" as const,
          totalDurationMs,
          retryLimit: this.retryLimit,
          manualTakeoverAvailable: false,
          budget: { maxTokens: this.budgetTotalTokens, usedTokens, withinBudget: true },
        },
        complexity,
      };
    }

    if (complexity === "moderate") {
      onProgress?.("understanding", "理解分析任务", 10, "任务编排");
      const orchestration = await this.runModelBackedAgent({
        agentId: "taskOrchestrator",
        input,
        prompt: input.query,
        capability: "planning",
        buildOutput: (text) => ({ mission: input.query, planNarrative: text, parallelBranches: workflowPlan.filter((step) => step.executionMode === "parallel").map((step) => step.agentId) }),
        buildSummary: (output) => String(output.planNarrative),
        fallbackOutput: () => ({ mission: input.query, planNarrative: "中等复杂度路径：数学分析与表达生成。", parallelBranches: [] }),
        fallbackMessage: "任务编排已切换到本地规则模板。",
      });
      degradationTrace.push(...orchestration.degradationTrace);

      onProgress?.("retrieval", "计算数学模型", 30, "数学分析");
      const mathAnalysis = await this.runMathAnalysisAgent(input);
      degradationTrace.push(...mathAnalysis.degradationTrace);

      onProgress?.("writing", "生成分析报告", 80, "LLM基于模型结果生成表达");
      const expressionGeneration = await this.runModelBackedAgent({
        agentId: "expressionGeneration",
        input,
        prompt: `请基于以下数学模型计算结果，生成完整的经营诊断报告。\n用户问题：${input.query}\n\n模型计算结果：\n- 综合风险等级：${mathAnalysis.output.combinedRiskLevel}\n- 核心指标：${mathAnalysis.output.combinedInsights.join("；")}${mathAnalysis.output.dqiModel ? `\n\nDQI经营质量指数：${mathAnalysis.output.dqiModel.dqi.toFixed(2)}（${mathAnalysis.output.dqiModel.status}）\n- 主要驱动因素：${mathAnalysis.output.dqiModel.driver}\n- ${mathAnalysis.output.dqiModel.trend}` : ""}${mathAnalysis.output.gmpsModel ? `\n\nGMPS毛利承压指数：${mathAnalysis.output.gmpsModel.gmps.toFixed(2)}（${mathAnalysis.output.gmpsModel.level}）\n- 下季度风险概率：${(mathAnalysis.output.gmpsModel.probabilityNextQuarter * 100).toFixed(2)}%（${mathAnalysis.output.gmpsModel.riskLevel}）\n- 关键发现：${mathAnalysis.output.gmpsModel.keyFindings.slice(0, 2).join("；")}` : ""}`,
        capability: "expression",
        contextExtras: {
          workingMemoryDigest: input.memoryNotes.length > 0 ? input.memoryNotes.join("；") : "无历史记忆",
        },
        buildOutput: (text) => buildExpressionGenerationOutput(
          input,
          mathAnalysis.output,
          { confidence: "medium", confidenceScore: 0.6, verifiedClaims: mathAnalysis.output.combinedInsights.slice(0, 3), challengedClaims: [], citations: [], citationAbstracts: [], reviewSummary: "中等路径：基于DQI/GMPS模型计算结果生成诊断报告。" },
          { workingMemoryDigest: input.memoryNotes.length > 0 ? input.memoryNotes.join("；") : "无历史记忆", recalledMemories: this.memoryStore.list(input.userId, 3, input.role) },
          text,
        ),
        buildSummary: (output) => output.executiveSummary,
        fallbackOutput: () => buildExpressionGenerationOutput(
          input,
          mathAnalysis.output,
          { confidence: "medium", confidenceScore: 0.6, verifiedClaims: mathAnalysis.output.combinedInsights.slice(0, 3), challengedClaims: [], citations: [], citationAbstracts: [], reviewSummary: "中等路径：基于数学模型结果生成诊断报告。" },
          { workingMemoryDigest: input.memoryNotes.length > 0 ? input.memoryNotes.join("；") : "无历史记忆", recalledMemories: this.memoryStore.list(input.userId, 3, input.role) },
          `根据DQI/GMPS模型计算，综合风险等级为${mathAnalysis.output.combinedRiskLevel}。${mathAnalysis.output.combinedInsights.join("；")}`,
        ),
        fallbackMessage: "表达生成已切换到本地模板。",
      });
      degradationTrace.push(...expressionGeneration.degradationTrace);

      const savedMemory = await this.memoryStore.appendWithFilter({
        userId: input.userId,
        summary: `${input.query}｜${expressionGeneration.output.executiveSummary}`,
        tags: uniqueStrings([input.role, input.focusMode, mathAnalysis.output.combinedRiskLevel]).slice(0, 6),
        role: input.role,
        source: "workflow",
      });

      const memoryResult: AgentExecutionResult = {
        agentId: agentIdSchema.enum.memoryManagement,
        status: "degraded" as const,
        provider: "local" as const,
        summary: "中等复杂度跳过LLM记忆召回",
        attempts: [],
        startedAt: nowIso(),
        completedAt: nowIso(),
        governance: { durationMs: 0, retryCount: 0, budgetUsedTokens: 0, manualInterventionAvailable: false },
        output: { workingMemoryDigest: input.memoryNotes.length > 0 ? input.memoryNotes.join("；") : "无历史记忆", recalledMemories: this.memoryStore.list(input.userId, 3, input.role), savedMemory: savedMemory.entry ?? undefined },
      };

      const agents: AgentExecutionResult[] = [
        orchestration.result,
        memoryResult,
        { agentId: agentIdSchema.enum.dataGathering, status: "skipped" as const, provider: "local" as const, summary: "中等任务跳过数据采集", attempts: [], startedAt: nowIso(), completedAt: nowIso(), output: { gatheredData: {}, status: "skipped", source: "none" } },
        { agentId: agentIdSchema.enum.dataUnderstanding, status: "skipped" as const, provider: "local" as const, summary: "中等任务跳过数据理解", attempts: [], startedAt: nowIso(), completedAt: nowIso(), output: { objective: input.query, extractedFocus: [input.focusMode], datasetCompleteness: "medium" as const, missingInputs: [] } },
        mathAnalysis.result,
        { agentId: agentIdSchema.enum.industryRetrieval, status: "skipped" as const, provider: "local" as const, summary: "中等任务跳过行业检索", attempts: [], startedAt: nowIso(), completedAt: nowIso(), output: { query: "", synthesis: "", retrievalSummary: "", referenceAbstract: "", evidence: [], citations: [], indexStats: { searchHits: 0, fetchedPages: 0, chunkCount: 0, rankedChunks: 0, searchProvider: "none", fallbackUsed: false } } },
        { agentId: agentIdSchema.enum.evidenceReview, status: "skipped" as const, provider: "local" as const, summary: "中等任务跳过证据审校", attempts: [], startedAt: nowIso(), completedAt: nowIso(), output: { confidence: "medium" as const, confidenceScore: 0.6, verifiedClaims: mathAnalysis.output.combinedInsights.slice(0, 3), challengedClaims: [], citations: [], citationAbstracts: [], reviewSummary: "中等路径：基于模型结果审校" } },
        expressionGeneration.result,
      ];
      const totalDurationMs = agents.reduce((sum, agent) => sum + (agent.governance?.durationMs ?? getDurationMs(agent.startedAt, agent.completedAt)), 0);
      const usedTokens = agents.reduce((sum, agent) => sum + (agent.governance?.budgetUsedTokens ?? 0), 0);
      const withinBudget = usedTokens <= this.budgetTotalTokens;
      const workflowState = degradationTrace.length > 0 || !withinBudget ? "degraded" : "completed";

      const response: DiagnosticWorkflowResponse = {
        workflowId, role: input.role, providerStatus: this.providerStatus, plan: workflowPlan, agents, degradationTrace,
        finalAnswer: expressionGeneration.output.finalAnswer, summary: expressionGeneration.output.executiveSummary,
        memorySnapshot: this.memoryStore.list(input.userId, 5),
        acceptance: { overallScore: 0, overallPassed: false, metrics: [] },
        governance: { workflowState, totalDurationMs, retryLimit: this.retryLimit, manualTakeoverAvailable: workflowState === "degraded", budget: { maxTokens: this.budgetTotalTokens, usedTokens, withinBudget } },
        complexity,
      };
      response.acceptance = evaluateWorkflowAcceptance(input, response);
      this.platformStore?.saveWorkflowSnapshot({ workflowId, userId: input.userId, role: input.role, createdAt: nowIso(), summary: response.summary, finalAnswer: response.finalAnswer, agents, budget: response.governance?.budget, manualTakeoverAvailable: response.governance?.manualTakeoverAvailable ?? false });
      return response;
    }

    onProgress?.("understanding", "理解分析任务与召回记忆", 12, "任务编排与记忆召回并行");
    const [orchestration, memoryBase] = await Promise.all([
      this.runModelBackedAgent({
        agentId: "taskOrchestrator",
        input,
        prompt: input.query,
        capability: "planning",
        buildOutput: (text) => ({
          mission: input.query,
          planNarrative: text,
          parallelBranches: workflowPlan
            .filter((step) => step.executionMode === "parallel")
            .map((step) => step.agentId),
        }),
        buildSummary: (output) => String(output.planNarrative),
        fallbackOutput: () => ({
          mission: input.query,
          planNarrative:
            "按既定链路先召回记忆，再并行执行数据理解、数学分析与行业检索，随后进行证据审校和表达生成。",
          parallelBranches: workflowPlan
            .filter((step) => step.executionMode === "parallel")
            .map((step) => step.agentId),
        }),
        fallbackMessage: "任务编排已切换到本地规则模板。",
      }),
      this.runModelBackedAgent({
        agentId: "memoryManagement",
        input,
        prompt: input.query,
        capability: "memory",
        buildOutput: (text) => ({
          workingMemoryDigest: text,
          recalledMemories: this.memoryStore.list(input.userId, 3, input.role),
        }),
        buildSummary: (output) =>
          `召回 ${output.recalledMemories.length} 条记忆，并生成当前会话记忆摘要。`,
        fallbackOutput: () => ({
          workingMemoryDigest:
            input.memoryNotes.length > 0
              ? `用户显式记忆偏好：${input.memoryNotes.join("；")}。`
              : "暂无历史显式记忆，本轮以当前问题为中心建立工作记忆。",
          recalledMemories: this.memoryStore.list(input.userId, 3, input.role),
        }),
        fallbackMessage: "记忆管理已切换到本地摘要模式。",
      }),
    ]);
    degradationTrace.push(...orchestration.degradationTrace);
    degradationTrace.push(...memoryBase.degradationTrace);

    onProgress?.("retrieval", "采集外部数据与检索行业信息", 30, "数据采集与行业检索并行");
    const [dataGathering, industryRetrieval] = await Promise.all([
      this.runDataGatheringAgent(input, { skipNBS: true }),
      this.runIndustryRetrievalAgent(input),
    ]);
    degradationTrace.push(...dataGathering.degradationTrace);
    degradationTrace.push(...industryRetrieval.degradationTrace);

    onProgress?.("understanding", "理解数据与计算数学模型", 48, "数据理解与数学分析并行");
    const [dataUnderstanding, mathAnalysis] = await Promise.all([
      Promise.resolve({
        output: buildDataUnderstandingOutput(input),
        degradationTrace: [createHeuristicEvent("dataUnderstanding", "数据理解使用本地规则模板，跳过LLM调用")] as DegradationEvent[],
        result: {
          agentId: agentIdSchema.enum.dataUnderstanding,
          status: "degraded" as const,
          provider: "local" as const,
          summary: `聚焦于${buildDataUnderstandingOutput(input).extractedFocus.join("、")}，数据完备性为${buildDataUnderstandingOutput(input).datasetCompleteness}。`,
          attempts: [],
          startedAt: nowIso(),
          completedAt: nowIso(),
          governance: { durationMs: 0, retryCount: 0, budgetUsedTokens: 0, manualInterventionAvailable: false },
          output: buildDataUnderstandingOutput(input),
        } as AgentExecutionResult,
      }),
      this.runMathAnalysisAgent(input, dataGathering.output),
    ]);

    degradationTrace.push(...dataUnderstanding.degradationTrace);
    degradationTrace.push(...mathAnalysis.degradationTrace);

    onProgress?.("evidence", "审校证据与交叉验证", 68, "证据审校");
    const evidenceReview = await this.runModelBackedAgent({
      agentId: "evidenceReview",
      input,
      prompt: `${input.query}\n请结合抓取到的财报/宏观数据：${JSON.stringify(dataGathering.output.gatheredData).slice(0, 3000)}，进行交叉对比。`,
      capability: "review",
      contextExtras: {
        recalledMemories: memoryBase.output.recalledMemories.map((m) => m.summary),
        workingMemoryDigest: memoryBase.output.workingMemoryDigest,
      },
      buildOutput: (text) =>
        buildEvidenceReviewOutput(
          input,
          dataUnderstanding.output,
          mathAnalysis.output,
          industryRetrieval.output,
          text,
          dataGathering.output,
        ),
      buildSummary: (output) => `证据可信度为 ${output.confidence}。`,
      fallbackOutput: () =>
        buildEvidenceReviewOutput(
          input,
          dataUnderstanding.output,
          mathAnalysis.output,
          industryRetrieval.output,
          "证据审校已退化为本地规则校验，当前优先依赖数学模型与结构化行业线索。",
          dataGathering.output,
        ),
      fallbackMessage: "证据审校已切换到本地规则校验。",
    });
    degradationTrace.push(...evidenceReview.degradationTrace);

    onProgress?.("writing", "生成分析报告", 82, "表达生成");
    const expressionGeneration = await this.runModelBackedAgent({
      agentId: "expressionGeneration",
      input,
      prompt: input.query,
      capability: "expression",
      contextExtras: {
        recalledMemories: memoryBase.output.recalledMemories.map((m) => m.summary),
        workingMemoryDigest: memoryBase.output.workingMemoryDigest,
      },
      buildOutput: (text) =>
        buildExpressionGenerationOutput(
          input,
          mathAnalysis.output,
          evidenceReview.output,
          memoryBase.output,
          text,
        ),
      buildSummary: (output) => output.executiveSummary,
      fallbackOutput: () =>
        buildExpressionGenerationOutput(
          input,
          mathAnalysis.output,
          evidenceReview.output,
          memoryBase.output,
          "表达生成已切换到模板输出，建议后续由可用模型进一步润色。",
        ),
      fallbackMessage: "表达生成已切换到本地模板。",
    });
    degradationTrace.push(...expressionGeneration.degradationTrace);

    const savedMemory = await this.memoryStore.appendWithFilter({
      userId: input.userId,
      summary: `${input.query}｜${expressionGeneration.output.executiveSummary}`,
      tags: uniqueStrings([
        input.role,
        input.focusMode,
        mathAnalysis.output.combinedRiskLevel,
        ...(dataUnderstanding.output.extractedFocus ?? []),
      ]).slice(0, 6),
      role: input.role,
      source: "workflow",
    });
    const memoryOutput: MemoryManagementOutput = {
      ...memoryBase.output,
      savedMemory: savedMemory.entry ?? undefined,
    };
    const memoryResult: AgentExecutionResult = {
      ...memoryBase.result,
      summary: `${memoryBase.result.summary} 已写入新记忆。`,
      output: memoryOutput,
    };

    const agents: AgentExecutionResult[] = [
      orchestration.result,
      memoryResult,
      dataGathering.result,
      dataUnderstanding.result,
      mathAnalysis.result,
      industryRetrieval.result,
      evidenceReview.result,
      expressionGeneration.result,
    ];

    const totalDurationMs = agents.reduce((sum, agent) => {
      return sum + (agent.governance?.durationMs ?? getDurationMs(agent.startedAt, agent.completedAt));
    }, 0);
    const usedTokens = agents.reduce((sum, agent) => sum + (agent.governance?.budgetUsedTokens ?? 0), 0);
    const withinBudget = usedTokens <= this.budgetTotalTokens;
    const workflowState = degradationTrace.length > 0 || !withinBudget ? "degraded" : "completed";

    const response: DiagnosticWorkflowResponse = {
      workflowId,
      role: input.role,
      providerStatus: this.providerStatus,
      plan: workflowPlan,
      agents,
      degradationTrace,
      finalAnswer: expressionGeneration.output.finalAnswer,
      summary: expressionGeneration.output.executiveSummary,
      memorySnapshot: this.memoryStore.list(input.userId, 5),
      acceptance: {
        overallScore: 0,
        overallPassed: false,
        metrics: [],
      },
      governance: {
        workflowState,
        totalDurationMs,
        retryLimit: this.retryLimit,
        manualTakeoverAvailable: workflowState === "degraded",
        budget: {
          maxTokens: this.budgetTotalTokens,
          usedTokens,
          withinBudget,
        },
      },
      complexity,
    };
    response.acceptance = evaluateWorkflowAcceptance(input, response);
    const workflowGovernance = response.governance;

    this.platformStore?.saveWorkflowSnapshot({
      workflowId,
      userId: input.userId,
      role: input.role,
      createdAt: nowIso(),
      summary: response.summary,
      finalAnswer: response.finalAnswer,
      agents,
      budget: workflowGovernance?.budget,
      manualTakeoverAvailable: workflowGovernance?.manualTakeoverAvailable ?? false,
    });

    return response;
  }

  private async handleConversation(
    input: DiagnosticAgentRequest,
    intent: QueryIntent,
    workflowId: string,
    onProgress?: ProgressCallback,
  ): Promise<DiagnosticWorkflowResponse> {
    onProgress?.("understanding", "理解对话", 20, intent === "meta" ? "系统功能问答" : "日常对话");

    const metaAnswers: Record<string, string> = {
      "你能做什么": "我可以帮你进行锂电池企业的经营诊断和投资分析。企业端支持数据采集、DQI经营质量指数计算、GMPS毛利承压评分；投资端支持行业景气分析、投资推荐和深度研究。你也可以直接问我关于锂电池行业的基础知识。",
      "你有什么功能": "我的核心功能包括：1) DQI经营质量诊断——评估企业盈利、成长和现金流质量；2) GMPS毛利承压评分——量化毛利率压力来源和风险等级；3) 行业实时检索——获取锂电池行业最新动态；4) 投资分析——提供行业景气度和投资建议。试试输入'分析宁德时代经营质量'来体验！",
      "怎么用": "使用很简单：企业端用户先采集财务数据，然后输入分析问题即可获得诊断报告；投资端用户先建立投资画像，然后选择分析模式即可获得投资建议。你也可以直接输入任何关于锂电池企业的问题。",
      "帮助": "我是锂电池企业智能诊断系统助手。你可以：1) 输入企业财务数据获取DQI/GMPS诊断；2) 询问行业趋势和投资建议；3) 直接和我聊天。需要什么帮助？",
      "什么是dqi": "DQI（Diagnostic Quality Index，诊断质量指数）是衡量企业经营质量变化的综合指标，由盈利能力（ROE）、成长能力（营收增速）和现金流质量（OCF比率）三个维度加权构成，权重分别为0.4、0.3、0.3。DQI>1.05表示经营改善，0.95-1.05为稳定，<0.95为恶化。",
      "什么是gmps": "GMPS（Gross Margin Pressure Score，毛利承压评分）是量化企业毛利率压力的综合评分模型，从A毛利率结果、B材料成本冲击、C产销负荷、D外部风险、E现金流安全五个维度、十个特征变量进行评估。评分<40为低压，40-70为中压，≥70为高压。",
    };

    let conversationText: string;
    const matchedMetaKey = Object.keys(metaAnswers).find((key) => input.query.toLowerCase().includes(key));

    if (intent === "meta" && matchedMetaKey && metaAnswers[matchedMetaKey]) {
      conversationText = metaAnswers[matchedMetaKey];
    } else if (this.modelRouter) {
      try {
        onProgress?.("writing", "生成回复", 50, "对话生成");
        const llmResponse = await this.modelRouter.complete({
          agentId: "expressionGeneration",
          capability: "conversation",
          prompt: input.query,
          context: { query: input.query, role: input.role, intent },
          preferredProviders: ["qwen35Plus", "deepseekReasoner", "glm5"],
        });
        conversationText = llmResponse.result.text;
      } catch {
        conversationText = intent === "meta"
          ? "我是锂电池企业智能诊断系统，可以帮你分析企业经营质量、毛利承压状况和行业趋势。请输入具体的企业名称或分析问题来开始诊断。"
          : "你好！我是锂电池企业智能诊断系统助手。有什么我可以帮你的吗？你可以输入企业分析相关的问题，也可以直接和我聊天。";
      }
    } else {
      conversationText = intent === "meta"
        ? "我是锂电池企业智能诊断系统，可以帮你分析企业经营质量、毛利承压状况和行业趋势。请输入具体的企业名称或分析问题来开始诊断。"
        : "你好！我是锂电池企业智能诊断系统助手。有什么我可以帮你的吗？你可以输入企业分析相关的问题，也可以直接和我聊天。";
    }

    const startedAt = nowIso();
    const completedAt = nowIso();

    return {
      workflowId,
      role: input.role,
      providerStatus: this.providerStatus,
      plan: [],
      agents: [{
        agentId: agentIdSchema.enum.expressionGeneration,
        status: "completed",
        provider: "local",
        summary: intent === "meta" ? "系统功能问答" : "日常对话",
        attempts: [],
        startedAt,
        completedAt,
        governance: { durationMs: 0, retryCount: 0, budgetUsedTokens: 0, manualInterventionAvailable: false },
        output: { executiveSummary: conversationText, recommendedActions: [], citationAbstract: "", finalAnswer: conversationText },
      }],
      degradationTrace: [],
      finalAnswer: conversationText,
      summary: conversationText,
      memorySnapshot: this.memoryStore.list(input.userId, 5, input.role),
      acceptance: { overallScore: 0, overallPassed: false, metrics: [] },
      governance: {
        workflowState: "completed",
        totalDurationMs: 0,
        retryLimit: this.retryLimit,
        manualTakeoverAvailable: false,
        budget: { maxTokens: this.budgetTotalTokens, usedTokens: 0, withinBudget: true },
      },
      complexity: "simple",
    };
  }

  private async runModelBackedAgent<TOutput extends Record<string, unknown>>(options: {
    agentId: AgentId;
    input: DiagnosticAgentRequest;
    prompt: string;
    capability: "planning" | "understanding" | "retrieval" | "review" | "expression" | "memory";
    startedAtOverride?: string;
    contextExtras?: Record<string, unknown>;
    buildOutput: (text: string) => TOutput;
    buildSummary: (output: TOutput) => string;
    fallbackOutput: () => TOutput;
    fallbackMessage: string;
  }) {
    const startedAt = options.startedAtOverride ?? nowIso();
    try {
      const execution = await this.modelRouter.complete({
        agentId: options.agentId,
        capability: options.capability,
        prompt: options.prompt,
        context: {
          query: options.input.query,
          role: options.input.role,
          focusMode: options.input.focusMode,
          enterpriseName: options.input.enterpriseName,
          hasGrossMarginInput: Boolean(options.input.grossMarginInput),
          hasOperatingQualityInput: Boolean(options.input.operatingQualityInput),
          industryContext: options.input.industryContext,
          memoryNotes: options.input.memoryNotes,
          ...options.contextExtras,
        },
        preferredProviders: [...getPreferredProviders(options.capability)],
      });
      const output = options.buildOutput(execution.result.text);
      const completedAt = nowIso();
      return {
        output,
        degradationTrace: execution.degradationTrace,
        result: {
          agentId: options.agentId,
          status: execution.degradationTrace.length > 0 ? "degraded" : "completed",
          provider: execution.result.provider,
          summary: options.buildSummary(output),
          attempts: execution.attempts,
          startedAt,
          completedAt,
          governance: {
            durationMs: getDurationMs(startedAt, completedAt),
            retryCount: Math.max(0, execution.attempts.length - 1),
            budgetUsedTokens: estimateBudgetUsedTokens(options.prompt, execution.result.text),
            manualInterventionAvailable: execution.degradationTrace.length > 0,
          },
          output,
        } satisfies AgentExecutionResult,
      };
    } catch (error) {
      const completedAt = nowIso();
      if (!(error instanceof ModelExecutionError)) {
        throw error;
      }

      const output = options.fallbackOutput();
      const degradationTrace = [
        ...error.degradationTrace,
        createHeuristicEvent(options.agentId, options.fallbackMessage),
      ];

      return {
        output,
        degradationTrace,
        result: {
          agentId: options.agentId,
          status: "degraded",
          provider: "local",
          summary: options.buildSummary(output),
          attempts: error.attempts,
          startedAt,
          completedAt,
          governance: {
            durationMs: getDurationMs(startedAt, completedAt),
            retryCount: Math.max(0, error.attempts.length - 1),
            budgetUsedTokens: estimateBudgetUsedTokens(options.prompt, JSON.stringify(output)),
            manualInterventionAvailable: true,
          },
          output,
        } satisfies AgentExecutionResult,
      };
    }
  }

  private async runIndustryRetrievalAgent(input: DiagnosticAgentRequest) {
    const startedAt = nowIso();
    const realtimeRetrieval = await this.ragService.retrieve({
      role: input.role,
      enterpriseName: input.enterpriseName,
      query: input.query,
      focusMode: input.focusMode,
      limit: 3,
    });

    const result = await this.runModelBackedAgent({
      agentId: "industryRetrieval",
      input,
      prompt: `${input.query}\n实时引用摘要：${realtimeRetrieval.referenceAbstract || realtimeRetrieval.retrievalSummary}`,
      capability: "retrieval",
      startedAtOverride: startedAt,
      contextExtras: {
        realtimeRagQuery: realtimeRetrieval.query,
        realtimeRagReferenceAbstract: realtimeRetrieval.referenceAbstract,
        realtimeRagCitations: realtimeRetrieval.citations.map((item) => ({
          title: item.title,
          source: item.source,
          confidence: item.confidenceScore,
        })),
      },
      buildOutput: (text) => buildIndustryRetrievalOutput(input, text, realtimeRetrieval),
      buildSummary: (output) =>
        `整合 ${output.evidence.length} 条行业证据、${output.citations.length} 条引用，检索分片 ${output.indexStats.chunkCount} 个。`,
      fallbackOutput: () =>
        buildIndustryRetrievalOutput(
          input,
          realtimeRetrieval.retrievalSummary,
          realtimeRetrieval,
        ),
      fallbackMessage: "行业检索已切换到本地 RAG 摘要模式。",
    });

    if (realtimeRetrieval.citations.length > 0) {
      return result;
    }

    const degradationTrace = [
      ...result.degradationTrace,
      createHeuristicEvent("industryRetrieval", "未检索到可引用网页证据，已退回结构化行业输入。"),
    ];

    return {
      output: result.output,
      degradationTrace,
      result: {
        ...result.result,
        status: "degraded",
      } satisfies AgentExecutionResult,
    };
  }

  private async collectMacroContext(
    input: DiagnosticAgentRequest,
    currentPeriod: string,
    currentYear: string,
  ) {
    const publicMacroRetrieval = await this.ragService.retrieve({
      role: input.role,
      query: normalizeInlineWhitespace(
        [
          input.query,
          "中国宏观经济 CPI PPI PMI 社会消费品零售 固定资产投资 工业增加值",
          "官方 公告 报告 数据",
          currentYear,
        ]
          .filter(Boolean)
          .join(" "),
      ),
      focusMode: input.focusMode,
      limit: 3,
    });

    const ragMacro = {
      success: publicMacroRetrieval.citations.length > 0,
      degraded: publicMacroRetrieval.citations.length === 0,
      source: "public-rag",
      query: publicMacroRetrieval.query,
      retrievalSummary: publicMacroRetrieval.retrievalSummary,
      referenceAbstract: publicMacroRetrieval.referenceAbstract,
      records: publicMacroRetrieval.citations.map((citation, index) => ({
        time: citation.publishedAt?.slice(0, 7) ?? `${currentPeriod}#${index + 1}`,
        value: citation.summary,
        source: citation.source,
        title: citation.title,
        url: citation.url,
      })),
      citations: publicMacroRetrieval.citations.map((citation) => ({
        title: citation.title,
        source: citation.source,
        url: citation.url,
        confidence: citation.confidence,
      })),
      indexStats: publicMacroRetrieval.indexStats,
    };

    const hasNbsCredential = Boolean(
      this.env.NBS_COOKIE || this.env.NBS_TOKEN || (this.env.NBS_ACCOUNT && this.env.NBS_PASSWORD),
    );

    if (!hasNbsCredential && this.env.NODE_ENV === "test") {
      return {
        success: false,
        degraded: true,
        source: "public-rag",
        query: publicMacroRetrieval.query,
        retrievalSummary: "测试环境未配置 NBS 凭证，宏观数据使用公开网页 RAG 预留模式。",
        referenceAbstract: "",
        records: [] as Array<Record<string, string>>,
        citations: [] as Array<Record<string, string>>,
        indexStats: publicMacroRetrieval.indexStats,
      };
    }

    if (!hasNbsCredential) {
      return ragMacro;
    }

    const nbsMacro = await this.dataGatheringAgent.fetchNBSMacroData("A0201", currentPeriod);
    if (!nbsMacro.degraded) {
      return {
        ...nbsMacro,
        source: "nbs",
      };
    }

    return {
      ...ragMacro,
      source: ragMacro.degraded ? "nbs+public-rag" : "public-rag",
      degraded: ragMacro.degraded,
      fallbackFrom: "nbs",
    };
  }

  private async runDataGatheringAgent(input: DiagnosticAgentRequest, options?: { skipNBS?: boolean }) {
    const startedAt = nowIso();
    let gatheredData: Record<string, unknown> = {};
    let status = "success";
    let source = "none";
    let degradationEvent: DegradationEvent | null = null;
    const currentDate = new Date();
    const currentYear = String(currentDate.getFullYear());
    const currentPeriod = `${currentYear}01-${currentYear}${String(currentDate.getMonth() + 1).padStart(2, "0")}`;

    try {
      if (input.enterpriseName) {
        const macroPromise = options?.skipNBS
          ? Promise.resolve({ success: true, data: {}, degraded: true, source: "skipped-nbs" })
          : this.collectMacroContext(input, currentPeriod, currentYear);
        const [enterpriseFinancials, macroResult] = await Promise.allSettled([
          this.dataGatheringAgent.collectEnterpriseFinancialData(input.enterpriseName, currentYear),
          macroPromise,
        ]);

        const macroSource =
          macroResult.status === "fulfilled" && typeof macroResult.value.source === "string"
            ? macroResult.value.source
            : "macro-unknown";
        source = `exchange+eastmoney+${macroSource}`;
        gatheredData = {
          enterpriseFinancials:
            enterpriseFinancials.status === "fulfilled"
              ? enterpriseFinancials.value
              : { success: false, degraded: true, error: String(enterpriseFinancials.reason) },
          macroData:
            macroResult.status === "fulfilled"
              ? macroResult.value
              : { success: false, degraded: true, error: String(macroResult.reason) },
          connectedAt: nowIso(),
        };

        if (this.platformStore) {
          const fetchedFinancials = enterpriseFinancials.status === "fulfilled" ? enterpriseFinancials.value : null;
          if (fetchedFinancials && !fetchedFinancials.degraded) {
            const reports = [
              ...(Array.isArray(fetchedFinancials.exchangeReports) ? fetchedFinancials.exchangeReports : []),
              ...(Array.isArray(fetchedFinancials.eastmoneyReports) ? fetchedFinancials.eastmoneyReports : []),
            ];
            if (reports.length > 0) {
              this.platformStore.saveIndustryData({
                recordId: `enterprise_reports_${Date.now()}`,
                dataDate: new Date().toISOString().slice(0, 10),
                lithiumPrice: {
                  priceDate: new Date().toISOString().slice(0, 10),
                  price: 0,
                  source: `exchange-reports:${fetchedFinancials.securityProfile?.exchange ?? "unknown"}`,
                },
              }).catch((e: unknown) => console.warn("持久化企业报告元数据失败:", e));
            }
          }
          if (input.grossMarginInput && input.operatingQualityInput) {
            const gmI = input.grossMarginInput;
            const oqI = input.operatingQualityInput;
            this.platformStore.saveFinancialData({
              enterpriseId: input.enterpriseName,
              periodDate: currentYear,
              revenue: gmI.currentRevenue,
              operatingCost: gmI.currentCost,
              grossProfit: gmI.currentRevenue - gmI.currentCost,
              grossMargin: gmI.currentGrossMargin,
              netProfit: gmI.currentRevenue - gmI.currentCost - (oqI.currentManufacturingExpense || 0),
              totalAssets: oqI.currentTotalAssets,
              totalLiabilities: oqI.currentTotalLiabilities,
              beginningEquity: oqI.currentTotalAssets - oqI.currentTotalLiabilities,
              endingEquity: oqI.currentTotalAssets - oqI.currentTotalLiabilities,
              inventory: gmI.currentInventoryExpense * 1.15,
              operatingCashFlow: oqI.currentOperatingCashFlow,
              salesVolume: gmI.currentSalesVolume,
              productionVolume: oqI.currentProductionVolume,
              manufacturingExpense: oqI.currentManufacturingExpense,
              dataSource: "manual",
            }).catch((e: unknown) => console.warn("持久化企业财务数据失败:", e));
          }
          if (macroResult.status === "fulfilled" && !macroResult.value.degraded) {
            const macroVal = macroResult.value as Record<string, unknown>;
            const hasPlaceholder = Array.isArray(macroVal.records) && macroVal.records.some((r: Record<string, unknown>) => r.isPlaceholder);
            if (!hasPlaceholder) {
              const hasActualLP = typeof macroVal.lithiumPrice === "number" && macroVal.lithiumPrice > 0;
              const hasActualIV = typeof macroVal.industryVolatility === "number" && macroVal.industryVolatility > 0;
              if (hasActualLP || hasActualIV) {
                this.platformStore.saveIndustryData({
                  recordId: `industry_${Date.now()}`,
                  dataDate: new Date().toISOString().slice(0, 10),
                  lithiumPrice: {
                    priceDate: new Date().toISOString().slice(0, 10),
                    price: hasActualLP ? (macroVal.lithiumPrice as number) * 10000 : 0,
                    source: hasActualLP
                      ? (typeof macroVal.source === "string" ? macroVal.source : "data-gathering-agent")
                      : "default-estimate",
                  },
                  industryIndex: hasActualIV ? {
                    indexDate: new Date().toISOString().slice(0, 10),
                    indexType: "CSI_POWER_BATTERY",
                    indexValue: typeof macroVal.industryIndexValue === "number" ? macroVal.industryIndexValue : 0,
                    volatility: macroVal.industryVolatility as number,
                  } : undefined,
                }).catch((e: unknown) => console.warn("持久化行业数据失败:", e));
              }
            }
          }
        }

        const hasConnectorFailure =
          enterpriseFinancials.status === "rejected" || macroResult.status === "rejected";
        const hasConnectorDegrade =
          enterpriseFinancials.status === "fulfilled" && enterpriseFinancials.value.degraded ||
          macroResult.status === "fulfilled" && macroResult.value.degraded;

        if (hasConnectorFailure || hasConnectorDegrade) {
          status = "degraded";
          degradationEvent = createHeuristicEvent(
            "dataGathering",
            "交易所/东方财富/宏观网页证据部分降级，已自动回退到可用结果。",
          );
        }
      } else {
        if (options?.skipNBS) {
          gatheredData = { success: true, data: {}, degraded: true, source: "skipped-nbs" };
          source = "skipped-nbs";
          status = "degraded";
          degradationEvent = createHeuristicEvent("dataGathering", "中等复杂度跳过NBS宏观数据获取");
        } else {
          const macro = await this.collectMacroContext(input, currentPeriod, currentYear);
          gatheredData = macro;
          source = typeof macro.source === "string" ? macro.source : "public-rag";
          if (macro.degraded) {
            status = "degraded";
            degradationEvent = createHeuristicEvent("dataGathering", "宏观公开网页证据不足，已降级使用有限宏观数据");
          }
          if (this.platformStore && !macro.degraded) {
            const macroRec = macro as Record<string, unknown>;
            const hasPlaceholder = Array.isArray(macroRec.records) && macroRec.records.some((r: Record<string, unknown>) => r.isPlaceholder);
            if (!hasPlaceholder) {
              const hasActualLP = typeof macroRec.lithiumPrice === "number" && macroRec.lithiumPrice > 0;
              const hasActualIV = typeof macroRec.industryVolatility === "number" && macroRec.industryVolatility > 0;
              if (hasActualLP || hasActualIV) {
                this.platformStore.saveIndustryData({
                  recordId: `industry_${Date.now()}`,
                  dataDate: new Date().toISOString().slice(0, 10),
                  lithiumPrice: {
                    priceDate: new Date().toISOString().slice(0, 10),
                    price: hasActualLP ? (macroRec.lithiumPrice as number) * 10000 : 0,
                    source: hasActualLP
                      ? (typeof macroRec.source === "string" ? macroRec.source : "data-gathering-agent")
                      : "default-estimate",
                  },
                  industryIndex: hasActualIV ? {
                    indexDate: new Date().toISOString().slice(0, 10),
                    indexType: "CSI_POWER_BATTERY",
                    indexValue: typeof macroRec.industryIndexValue === "number" ? macroRec.industryIndexValue : 0,
                    volatility: macroRec.industryVolatility as number,
                  } : undefined,
                }).catch((e: unknown) => console.warn("持久化行业数据失败:", e));
              }
            }
          }
        }
      }
    } catch (error) {
      status = "degraded";
      gatheredData = { error: String(error), fallback: true };
      source = source || "none";
      degradationEvent = createHeuristicEvent("dataGathering", "外部数据抓取异常，已降级为无外部数据模式");
    }

    const output: DataGatheringOutput = {
      gatheredData,
      status,
      source,
    };

    const completedAt = nowIso();

    return {
      output,
      degradationTrace: degradationEvent ? [degradationEvent] : ([] as DegradationEvent[]),
      result: {
        agentId: agentIdSchema.enum.dataGathering,
        status: status === "degraded" ? "degraded" : "completed",
        provider: "local",
        summary:
          status === "success"
            ? `成功抓取外部数据 (${source})。`
            : `降级抓取外部数据 (${source})。`,
        attempts: [],
        startedAt,
        completedAt,
        governance: {
          durationMs: getDurationMs(startedAt, completedAt),
          retryCount: 0,
          budgetUsedTokens: estimateBudgetUsedTokens(JSON.stringify(gatheredData)),
          manualInterventionAvailable: status !== "success",
        },
        output,
      } satisfies AgentExecutionResult,
    };
  }

  private runMathAnalysisAgent(input: DiagnosticAgentRequest, dataGatheringOutput?: DataGatheringOutput) {
    const startedAt = nowIso();
    const { output, degradationTrace } = buildMathAnalysisOutput(input, dataGatheringOutput, this.platformStore);
    const completedAt = nowIso();
    const hasDegradation = degradationTrace.length > 0;

    return Promise.resolve({
      output,
      degradationTrace,
      result: {
        agentId: agentIdSchema.enum.mathAnalysis,
        status: hasDegradation ? "degraded" : "completed",
        provider: "local",
        summary:
          output.combinedInsights.length > 0
            ? `完成 ${output.combinedInsights.length} 条数学分析结论，综合风险为 ${output.combinedRiskLevel}。`
            : "当前未提供可计算的数学模型输入。",
        attempts: [],
        startedAt,
        completedAt,
        governance: {
          durationMs: getDurationMs(startedAt, completedAt),
          retryCount: 0,
          budgetUsedTokens: estimateBudgetUsedTokens(
            JSON.stringify(input.grossMarginInput),
            JSON.stringify(input.operatingQualityInput),
            JSON.stringify(output),
          ),
          manualInterventionAvailable: hasDegradation,
        },
        output,
      } satisfies AgentExecutionResult,
    });
  }
}
