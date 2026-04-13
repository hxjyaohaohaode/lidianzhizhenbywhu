import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import {
  MEMORY_VISUAL_PROFILES,
  createMemoryVisualObjectCounts,
  expandMemoryVisualObjectCounts,
  resolveMemoryVisualProfile,
} from "./memory-performance.js";
import type {
  EnterpriseAnalysisResponse,
  EnterpriseCollectionResponse,
  InvestorAnalysisResponse,
  InvestorModeResponse,
  InvestorProfileResponse,
} from "./api.js";
import type { DiagnosticWorkflowResponse, DualPortalPersonalizationAuditReport } from "../shared/agents.js";
import type { MemoryEntry } from "../shared/agents.js";
import type {
  AnalysisTimelineEntry,
  DebateMessage,
  SessionContext,
  UserProfileResponse as BusinessUserProfileResponse,
} from "../shared/business.js";
import type { HealthResponse, MetaResponse } from "../shared/types.js";

const healthResponse: HealthResponse = {
  status: "ok",
  service: "battery-diagnostic-platform",
  version: "0.1.0",
  environment: "test",
  uptimeInSeconds: 128,
  configuredProviders: {
    deepseekReasoner: true,
    glm5: false,
    qwen35Plus: true,
  },
  storage: {
    mode: "file",
    persistenceReady: true,
    stats: {
      users: 2,
      sessions: 2,
      memories: 1,
      tasks: 1,
      analyses: 2,
      workflows: 2,
    },
  },
  governance: {
    cacheTtlSeconds: 300,
    rateLimitMaxRequests: 120,
    asyncTaskConcurrency: 2,
    agentBudgetTotalTokens: 16000,
    ragMaxSourceAgeDays: 60,
    backgroundTasksEnabled: true,
  },
  configProfile: {
    layer: "testing",
    healthcheckIncludesDetails: true,
  },
  dependencyChecks: {
    llm: "ready",
    rag: "ready",
    dataSources: "degraded",
    persistence: "ready",
    agent: "ready",
  },
  deploymentReadiness: {
    privateConfigMode: "server_only",
    canRunWithApiOnly: true,
    requiredInputs: ["至少一个模型 API Key（DeepSeek / GLM / Qwen）"],
    optionalInputs: ["国家统计局凭证（NBS_TOKEN 或 NBS_ACCOUNT + NBS_PASSWORD）"],
    summary: "平台已具备最小部署条件，仅需服务端填写模型 API 即可运行，缺失的可选数据源凭证将自动降级。",
  },
  timestamp: "2026-03-31T08:00:00.000Z",
};

const metaResponse: MetaResponse = {
  title: "锂电池企业智能诊断系统",
  subtitle: "面向企业运营分析与投资人员的统一智能诊断底座",
  roles: [
    {
      role: "企业运营分析",
      description: "聚焦经营诊断、毛利承压与行动编排。",
      focus: ["经营指标采集", "模型分析", "智能体诊断"],
    },
    {
      role: "投资人员",
      description: "聚焦行业切换、推荐评分与证据穿透。",
      focus: ["画像初始化", "模式切换", "建议与深潜"],
    },
  ],
};

const portalAuditResponse: DualPortalPersonalizationAuditReport = {
  generatedAt: "2026-03-31T08:20:00.000Z",
  summary: {
    channelCount: 10,
    pageCount: 6,
    driverCount: 7,
    integrationStatusBreakdown: {
      real: 6,
      simulated: 1,
      degraded: 2,
      placeholder: 1,
    },
  },
  dataChannels: [
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
      personalizationDrivers: ["focus-mode", "enterprise-base-info"],
      notes: ["直接服务企业端经营目标。"],
    },
    {
      channelId: "enterprise-analysis-route",
      label: "企业端分析入口",
      audience: "enterprise",
      layer: "serverRoute",
      source: "/api/enterprise/analyze",
      target: "BusinessPortalService.analyzeEnterprise()",
      purpose: "将企业端采集结果与会话上下文拼装为经营诊断请求。",
      integrationStatus: "real",
      affectsPersonalization: true,
      personalizationDrivers: ["focus-mode", "session-context"],
      notes: ["企业端返回整改导向的高亮结论。"],
    },
    {
      channelId: "investor-profile-input",
      label: "投资端画像输入",
      audience: "investor",
      layer: "frontendInput",
      source: "投资端画像建档/设置面板",
      target: "/api/investor/profile",
      purpose: "沉淀风险偏好、投资周期、关注企业与兴趣主题。",
      integrationStatus: "real",
      affectsPersonalization: true,
      personalizationDrivers: ["investor-profile-info", "preferred-role"],
      notes: ["后续推荐与模式切换会复用该画像。"],
    },
    {
      channelId: "investor-analysis-route",
      label: "投资端分析入口",
      audience: "investor",
      layer: "serverRoute",
      source: "/api/investor/recommend|industry-status|deep-dive|stream",
      target: "BusinessPortalService.analyzeInvestor()/streamInvestorAnalysis()",
      purpose: "生成投资推荐、行业判断、深度解析和流式结论。",
      integrationStatus: "real",
      affectsPersonalization: true,
      personalizationDrivers: ["focus-mode", "investor-profile-info", "session-context"],
      notes: ["同一底座根据模式输出不同研究模块。"],
    },
    {
      channelId: "user-preferences-route",
      label: "用户偏好更新链路",
      audience: "shared",
      layer: "serverRoute",
      source: "/api/users/:userId/preferences",
      target: "BusinessPortalService.updateUserPreferences()",
      purpose: "统一维护主题、角色偏好、关注点和约束条件。",
      integrationStatus: "real",
      affectsPersonalization: true,
      personalizationDrivers: ["preferred-role", "focus-mode"],
      notes: ["共享底座字段同时服务企业端和投资端。"],
    },
    {
      channelId: "session-context-store",
      label: "会话上下文存储",
      audience: "shared",
      layer: "storage",
      source: "InMemorySessionStore / PlatformStore.sessions",
      target: "企业分析会话、投资分析会话、流式分析上下文",
      purpose: "保存当前角色、活跃模式、附件、时间线与最近事件。",
      integrationStatus: "real",
      affectsPersonalization: true,
      personalizationDrivers: ["session-context"],
      notes: ["通过 role 与 activeMode 维持双端边界。"],
    },
    {
      channelId: "chart-payload-layer",
      label: "图表载荷整理层",
      audience: "shared",
      layer: "chart",
      source: "分析结果与画像摘要",
      target: "web/chart-data.ts 与图表系统",
      purpose: "把经营诊断、投资建议、证据和个性化摘要映射为双端可视化载荷。",
      integrationStatus: "degraded",
      affectsPersonalization: true,
      personalizationDrivers: ["chart-personalization", "focus-mode"],
      notes: ["前端消费策略仍需持续回归。"],
    },
    {
      channelId: "eastmoney-stock-report-source",
      label: "东方财富研报抓取",
      audience: "shared",
      layer: "externalSource",
      source: "DataGatheringAgent.fetchEastmoneyStockReports()",
      target: "dataGathering agent",
      purpose: "为企业端与投资端补充公司研报与外部分析素材。",
      integrationStatus: "simulated",
      affectsPersonalization: false,
      personalizationDrivers: [],
      notes: ["当前实现为测试桩返回。"],
    },
    {
      channelId: "nbs-macro-source",
      label: "国家统计局宏观数据",
      audience: "shared",
      layer: "externalSource",
      source: "DataGatheringAgent.fetchNBSMacroData()",
      target: "industryRetrieval agent",
      purpose: "补充宏观指标，支持行业和投资分析。",
      integrationStatus: "degraded",
      affectsPersonalization: false,
      personalizationDrivers: [],
      notes: ["缺少凭证时回退到公开降级数据。"],
    },
    {
      channelId: "exchange-report-connectors",
      label: "交易所财报连接器",
      audience: "shared",
      layer: "externalSource",
      source: "fetchSSEReports()/fetchSZSEReports()/fetchBSEReports()",
      target: "未来企业/投资端财报接入",
      purpose: "预留交易所公告链路，用于更权威的财报拉取。",
      integrationStatus: "placeholder",
      affectsPersonalization: false,
      personalizationDrivers: [],
      notes: ["当前未进入主工作流。"],
    },
  ],
  pageMatrix: [
    {
      pageId: "enterprise-home",
      audience: "enterprise",
      pageName: "企业端首页",
      primaryGoal: "围绕经营诊断闭环收集输入并启动分析。",
      keyModules: ["企业基础信息", "经营数据采集"],
      chartFamilies: ["经营指标概览"],
      primaryActions: ["采集数据", "发起企业分析"],
      copySignals: ["整改导向", "经营复盘语气"],
      personalizationDrivers: ["enterprise-base-info", "focus-mode"],
      isolationExpectations: ["不展示投资立场按钮。", "不暴露投委会/仓位类提示。"],
    },
    {
      pageId: "enterprise-analysis",
      audience: "enterprise",
      pageName: "企业端分析页",
      primaryGoal: "输出经营风险、整改优先级和执行动作。",
      keyModules: ["诊断摘要", "整改动作"],
      chartFamilies: ["经营质量雷达"],
      primaryActions: ["复盘上轮结论", "更新行动建议"],
      copySignals: ["优先动作", "经营质量变化"],
      personalizationDrivers: ["session-context", "enterprise-base-info"],
      isolationExpectations: ["不输出仓位建议。", "不使用投资推荐措辞。"],
    },
    {
      pageId: "enterprise-settings",
      audience: "enterprise",
      pageName: "企业端设置页",
      primaryGoal: "维护企业资料与偏好。",
      keyModules: ["企业基础信息", "反馈入口"],
      chartFamilies: ["无强制图表"],
      primaryActions: ["更新企业资料"],
      copySignals: ["经营目标", "保密配置"],
      personalizationDrivers: ["preferred-role", "enterprise-base-info"],
      isolationExpectations: ["不混入投资人画像字段。"],
    },
    {
      pageId: "investor-home",
      audience: "investor",
      pageName: "投资端首页",
      primaryGoal: "围绕研究判断与投资决策建立画像和会话入口。",
      keyModules: ["投资画像", "关注企业"],
      chartFamilies: ["行业景气总览"],
      primaryActions: ["建立画像", "开始流式分析"],
      copySignals: ["研究判断", "投资建议"],
      personalizationDrivers: ["investor-profile-info", "constraints"],
      isolationExpectations: ["不显示企业整改入口。", "不把经营保密提醒作为主文案。"],
    },
    {
      pageId: "investor-analysis",
      audience: "investor",
      pageName: "投资端分析页",
      primaryGoal: "输出推荐立场、行业判断和深度解析。",
      keyModules: ["推荐结论", "正式辩论"],
      chartFamilies: ["证据链视图"],
      primaryActions: ["切换模式", "上传补充材料"],
      copySignals: ["推荐关注", "谨慎跟踪", "暂缓配置"],
      personalizationDrivers: ["focus-mode", "session-context"],
      isolationExpectations: ["不展示企业端整改动作优先级。", "不把经营诊断摘要当主结论。"],
    },
    {
      pageId: "investor-settings",
      audience: "investor",
      pageName: "投资端设置页",
      primaryGoal: "维护风险偏好、投资周期与关注企业。",
      keyModules: ["风险偏好", "关注企业"],
      chartFamilies: ["无强制图表"],
      primaryActions: ["更新偏好", "管理多会话"],
      copySignals: ["回撤控制", "投委会约束"],
      personalizationDrivers: ["preferred-role", "investor-profile-info"],
      isolationExpectations: ["不暴露企业侧经营资料表单。"],
    },
  ],
  personalizationDrivers: [
    {
      driverId: "preferred-role",
      label: "角色偏好",
      audience: "shared",
      sourceFields: ["preferences.preferredRole"],
      upstreamChannels: ["user-preferences-route"],
      downstreamSurfaces: ["企业端/投资端入口分流"],
      effectSummary: "决定默认进入的双端工作台，避免角色错配。",
      status: "active",
    },
    {
      driverId: "focus-mode",
      label: "分析模式",
      audience: "shared",
      sourceFields: ["focusMode", "preferences.focusModes"],
      upstreamChannels: ["enterprise-analysis-route", "investor-analysis-route"],
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
      downstreamSurfaces: ["企业采集摘要", "企业分析结论"],
      effectSummary: "让企业端摘要和行动建议围绕企业经营目标组织。",
      status: "active",
    },
    {
      driverId: "investor-profile-info",
      label: "投资画像字段",
      audience: "investor",
      sourceFields: ["riskAppetite", "investmentHorizon", "interests"],
      upstreamChannels: ["investor-profile-input", "user-preferences-route"],
      downstreamSurfaces: ["推荐立场", "模式推荐", "服务提示"],
      effectSummary: "把风险偏好和研究兴趣映射为投资端推荐语气与提示重点。",
      status: "active",
    },
    {
      driverId: "session-context",
      label: "会话上下文",
      audience: "shared",
      sourceFields: ["session.summary", "session.activeMode", "attachments"],
      upstreamChannels: ["session-context-store", "enterprise-analysis-route", "investor-analysis-route"],
      downstreamSurfaces: ["连续追问", "深度解析", "企业复盘"],
      effectSummary: "让不同页面在多轮分析中延续当前角色、模式和附件上下文。",
      status: "active",
    },
    {
      driverId: "memory-history",
      label: "历史记忆与人工记忆",
      audience: "shared",
      sourceFields: ["memoryNotes", "private memories"],
      upstreamChannels: ["session-context-store"],
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
      effectSummary: "统一图表协议已具备角色信号，但前端消费策略仍需持续回归。",
      status: "partial",
    },
  ],
  findings: [
    {
      findingId: "chart-consumption-regression",
      severity: "medium",
      title: "图表协议已具备个性化信号，但前端消费策略需持续回归",
      summary: "如果图表层未按页面矩阵消费，可能退化成双端同构页面。",
      relatedChannelIds: ["chart-payload-layer"],
      relatedDriverIds: ["chart-personalization"],
      recommendedAction: "持续回归企业端/投资端首页和分析页的角色隔离展示。",
    },
    {
      findingId: "external-source-labeling",
      severity: "high",
      title: "外部连接器尚未全部真实接入",
      summary: "模拟、降级和占位链路必须在页面标签上明确标识，避免误读为真实接入。",
      relatedChannelIds: ["eastmoney-stock-report-source", "nbs-macro-source", "exchange-report-connectors"],
      relatedDriverIds: [],
      recommendedAction: "统一消费 integrationStatus 四态并在前端显式展示。",
    },
  ],
  releaseGates: [
    "企业端页面不展示投资推荐、仓位和投委会措辞。",
    "投资端页面不展示企业整改动作、经营保密提醒等企业侧主文案。",
  ],
};

function createSessionContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "session-001",
    userId: "user-001",
    role: "enterprise",
    activeMode: "operationalDiagnosis",
    enterpriseName: "星海电池",
    summary: "会话摘要",
    investedEnterprises: [],
    recentEvents: [],
    memoryPreview: [],
    attachments: [],
    latestTimeline: [],
    latestDebate: [],
    latestEvidenceSummary: [],
    pendingClarificationQuestions: [],
    updatedAt: "2026-03-31T08:00:00.000Z",
    ...overrides,
  };
}

function dedupeRoles(roles: Array<string | undefined>) {
  return Array.from(new Set(roles.filter((role): role is "enterprise" | "investor" => role === "enterprise" || role === "investor")));
}

function createDiagnostic(overrides: Partial<DiagnosticWorkflowResponse> = {}): DiagnosticWorkflowResponse {
  return {
    workflowId: "workflow-001",
    role: "enterprise",
    providerStatus: healthResponse.configuredProviders,
    plan: [],
    agents: [],
    degradationTrace: [],
    finalAnswer: "系统已生成诊断结果。",
    summary: "诊断已完成",
    memorySnapshot: [],
    acceptance: {
      overallScore: 82,
      overallPassed: true,
      metrics: [
        {
          metricId: "timeliness",
          label: "时效性",
          score: 84,
          threshold: 70,
          passed: true,
          evidence: ["引用数量：2"],
        },
        {
          metricId: "credibility",
          label: "可信度",
          score: 83,
          threshold: 75,
          passed: true,
          evidence: ["证据审校分：83"],
        },
        {
          metricId: "personalization",
          label: "个性化",
          score: 79,
          threshold: 65,
          passed: true,
          evidence: ["召回历史记忆：1 条"],
        },
        {
          metricId: "collaborationEfficiency",
          label: "协同效率",
          score: 82,
          threshold: 70,
          passed: true,
          evidence: ["并行起跑偏差：20 ms"],
        },
      ],
    },
    ...overrides,
  };
}

function createJsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function findClickable(container: HTMLElement, label: string) {
  const match = Array.from(container.querySelectorAll("button, .rc, .ni, .tn, .ii")).find((el) =>
    el.textContent?.includes(label),
  ) as HTMLElement;

  if (!match) {
    throw new Error(`未找到可点击元素：${label}`);
  }

  return match;
}

async function clickButton(container: HTMLElement, label: string) {
  const button = findClickable(container, label);
  await act(async () => {
    button.click();
  });
}

async function clickElement(element: HTMLElement | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    element?.click();
  });
}

function findElementByText(container: ParentNode, selector: string, label: string) {
  return Array.from(container.querySelectorAll(selector)).find((element) =>
    element.textContent?.includes(label),
  ) as HTMLElement | undefined;
}

async function setFieldValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    valueSetter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function waitFor(assertion: () => void, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === attempts - 1) {
        throw error;
      }

      await act(async () => {
        await Promise.resolve();
      });
    }
  }
}

function getCurrentInvestorSessionId(container: HTMLElement) {
  const matched = container.querySelector(".iwb-meta")?.textContent?.match(/当前会话：(.+?)附件数：/);
  return matched?.[1] ?? null;
}

async function settleBootstrap() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1499);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

function installFetchMock(options: { streamResponseDelayMs?: number; preferencesResponseDelayMs?: number } = {}) {
  const { streamResponseDelayMs = 0, preferencesResponseDelayMs = 0 } = options;
  const DEFAULT_USER_ID = "mock-user-001";
  const enterpriseCollectionResponse: EnterpriseCollectionResponse = {
    sessionContext: createSessionContext({
      sessionId: "enterprise-session-001",
      userId: "enterprise-user",
      role: "enterprise",
      activeMode: "operationalDiagnosis",
      enterpriseName: "星海电池",
      summary: "企业分析会话已创建",
      recentEvents: [
        {
          id: "evt-collect",
          type: "enterprise_collection",
          summary: "已完成企业数据采集",
          occurredAt: "2026-03-31T08:05:00.000Z",
        },
      ],
    }),
    collectionSummary: {
      confidentialityNotice: "我们承诺对贵企业的信息进行保密，数据只用于数据分析。",
      historyCoverage: "baselineComparison",
      capturedModules: ["毛利承压", "经营质量", "行业上下文"],
      quarterScope: {
        currentQuarter: "2026Q1",
        baselineQuarter: "2025Q1",
        recentQuarterLabels: ["2025Q2", "2025Q3", "2025Q4", "2026Q1"],
      },
      confidenceLabel: "high",
      limitations: ["历史季度为示例数据"],
    },
  };

  const enterpriseAnalysisResponse: EnterpriseAnalysisResponse = {
    sessionContext: createSessionContext({
      sessionId: "enterprise-session-001",
      userId: "enterprise-user",
      role: "enterprise",
      activeMode: "operationalDiagnosis",
      enterpriseName: "星海电池",
      summary: "企业端完成诊断",
      recentEvents: [
        {
          id: "evt-analyze",
          type: "enterprise_analysis",
          summary: "企业诊断已生成",
          occurredAt: "2026-03-31T08:08:00.000Z",
        },
      ],
    }),
    collectionSummary: enterpriseCollectionResponse.collectionSummary,
    diagnostic: createDiagnostic({
      role: "enterprise",
      finalAnswer: "企业端诊断：库存去化慢于订单恢复，建议优先改善现金流与排产节奏。",
      summary: "企业诊断已生成",
    }),
    highlights: {
      combinedRiskLevel: "medium",
      combinedInsights: ["库存费用偏高", "现金流修复滞后"],
    },
  };

  let investorSessionSeed = 0;
  const investorSessions = new Map<string, SessionContext>();
  const userProfiles = new Map<string, BusinessUserProfileResponse["profile"]>();
  const userMemories = new Map<string, MemoryEntry[]>();
  const userAnalyses = new Map<string, BusinessUserProfileResponse["recentAnalyses"]>();

  function nextInvestorSessionId() {
    investorSessionSeed += 1;
    return `investor-session-${investorSessionSeed.toString().padStart(3, "0")}`;
  }

  function parseBody(init?: RequestInit) {
    if (!init?.body || typeof init.body !== "string") {
      return {};
    }
    return JSON.parse(init.body) as Record<string, unknown>;
  }

  function isEditableBusinessInfoRecord(value: unknown): value is NonNullable<BusinessUserProfileResponse["profile"]["enterpriseBaseInfo"]> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function upsertInvestorSession(context: SessionContext) {
    investorSessions.set(context.sessionId, context);
    return context;
  }

  function ensureUserProfile(userId = DEFAULT_USER_ID) {
    if (!userProfiles.has(userId)) {
      userProfiles.set(userId, {
        userId,
        displayName: "测试用户",
        identitySource: "generated",
        createdAt: "2026-03-31T07:58:00.000Z",
        lastActiveAt: "2026-03-31T08:00:00.000Z",
        roles: [],
        enterpriseNames: [],
        investedEnterprises: [],
        enterpriseBaseInfo: {},
        investorBaseInfo: {},
        preferences: {
          themeMode: "dark",
          themeColor: "blue-violet",
          focusModes: [],
          interests: [],
          attentionTags: [],
          goals: [],
          constraints: [],
          decisionStyleHints: [],
        },
        feedback: {
          ratingCount: 0,
          learnedSignals: [],
        },
      });
    }

    return userProfiles.get(userId)!;
  }

  function upsertUserProfile(
    userId: string,
    updater: (
      current: BusinessUserProfileResponse["profile"],
    ) => BusinessUserProfileResponse["profile"],
  ) {
    const nextProfile = updater(ensureUserProfile(userId));
    userProfiles.set(userId, nextProfile);
    return nextProfile;
  }

  function buildUserProfileResponse(userId: string): BusinessUserProfileResponse {
    const profile = ensureUserProfile(userId);
    const sessions = Array.from(investorSessions.values())
      .filter((context) => context.userId === userId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const recentMemories = userMemories.get(userId) ?? [];
    const recentAnalyses = userAnalyses.get(userId) ?? [];

    return {
      profile: {
        ...profile,
        lastActiveAt: sessions[0]?.updatedAt ?? profile.lastActiveAt,
      },
      stats: {
        sessionCount: sessions.length,
        memoryCount: recentMemories.length,
        analysisCount: recentAnalyses.length,
        taskCount: 0,
        workflowCount: recentAnalyses.length,
      },
      recentSessions: sessions.map(toSummary).slice(0, 8),
      recentMemories: recentMemories.slice(0, 8),
      recentAnalyses: recentAnalyses.slice(0, 8),
      latestSessionContext: sessions[0],
    };
  }

  function buildInvestorContext(overrides: Partial<SessionContext> = {}) {
    return createSessionContext({
      sessionId: nextInvestorSessionId(),
      userId: DEFAULT_USER_ID,
      role: "investor",
      activeMode: "deepDive",
      enterpriseName: "星海电池",
      summary: "投资画像已初始化",
      investedEnterprises: ["星海电池", "蓝峰材料"],
      investorProfileSummary: "偏好现金流稳健、关注海外储能订单兑现。",
      recentEvents: [
        {
          id: "evt-profile",
          type: "investor_profile",
          summary: "投资画像已初始化",
          occurredAt: "2026-03-31T08:10:00.000Z",
        },
      ],
      ...overrides,
    });
  }

  function toSummary(context: SessionContext) {
    return {
      sessionId: context.sessionId,
      userId: context.userId,
      role: context.role,
      activeMode: context.activeMode,
      enterpriseName: context.enterpriseName,
      summary: context.summary,
      investedEnterprises: context.investedEnterprises,
      updatedAt: context.updatedAt,
      attachmentCount: context.attachments.length,
      hasAttachments: context.attachments.length > 0,
      lastEventType: context.recentEvents[0]?.type,
    };
  }

  function createRecommendationTimeline(): AnalysisTimelineEntry[] {
    return [
      {
        id: "timeline-session",
        stage: "session",
        label: "加载会话上下文",
        status: "completed",
        detail: "已注入历史画像与附件摘要",
        progressPercent: 8,
        occurredAt: "2026-03-31T08:13:00.000Z",
      },
      {
        id: "timeline-debate-1",
        stage: "debate",
        label: "进行第一轮辩论",
        status: "completed",
        detail: "GLM 与 DeepSeek 对决，Qwen 裁决",
        progressPercent: 30,
        occurredAt: "2026-03-31T08:13:20.000Z",
      },
      {
        id: "timeline-debate-2",
        stage: "debate",
        label: "进行第二轮辩论",
        status: "completed",
        detail: "DeepSeek 与 Qwen 对决，GLM 裁决",
        progressPercent: 56,
        occurredAt: "2026-03-31T08:13:35.000Z",
      },
      {
        id: "timeline-debate-3",
        stage: "debate",
        label: "进行第三轮辩论",
        status: "completed",
        detail: "GLM 与 Qwen 对决，DeepSeek 裁决",
        progressPercent: 82,
        occurredAt: "2026-03-31T08:13:45.000Z",
      },
      {
        id: "timeline-writing",
        stage: "writing",
        label: "总结最终方案",
        status: "completed",
        detail: "综合三轮辩论与外部证据",
        progressPercent: 93,
        occurredAt: "2026-03-31T08:13:50.000Z",
      },
      {
        id: "timeline-completed",
        stage: "completed",
        label: "完成投资建议辩论",
        status: "completed",
        detail: "已输出最终建议",
        progressPercent: 100,
        occurredAt: "2026-03-31T08:14:00.000Z",
      },
    ];
  }

  function createDeepDiveTimeline(): AnalysisTimelineEntry[] {
    return [
      {
        id: "timeline-clarification",
        stage: "clarification",
        label: "确认研究边界",
        status: "completed",
        detail: "已补齐研究目标、时间窗口与风险边界",
        progressPercent: 18,
        occurredAt: "2026-03-31T08:13:00.000Z",
      },
      {
        id: "timeline-retrieval",
        stage: "retrieval",
        label: "检索研究资料",
        status: "completed",
        detail: "整合证据与会话历史",
        progressPercent: 46,
        occurredAt: "2026-03-31T08:13:20.000Z",
      },
      {
        id: "timeline-evidence",
        stage: "evidence",
        label: "整理证据链",
        status: "completed",
        detail: "补全核心反证与结论依据",
        progressPercent: 74,
        occurredAt: "2026-03-31T08:13:40.000Z",
      },
      {
        id: "timeline-writing",
        stage: "writing",
        label: "撰写研究报告",
        status: "completed",
        detail: "形成问题、假设、发现与建议",
        progressPercent: 92,
        occurredAt: "2026-03-31T08:13:50.000Z",
      },
      {
        id: "timeline-completed",
        stage: "completed",
        label: "完成深度解析",
        status: "completed",
        detail: "已输出研究结论",
        progressPercent: 100,
        occurredAt: "2026-03-31T08:14:00.000Z",
      },
    ];
  }

  function createDebateMessages(): DebateMessage[] {
    return [
      {
        id: "debate-1",
        round: 1,
        speakerRole: "debater",
        speakerModel: "glm5",
        speakerLabel: "正方一辩",
        sequence: 1,
        content: "正方观点：订单兑现与现金流修复形成共振，当前更适合继续推荐关注。",
        occurredAt: "2026-03-31T08:13:20.000Z",
      },
      {
        id: "debate-2",
        round: 1,
        speakerRole: "judge",
        speakerModel: "qwen35Plus",
        speakerLabel: "Qwen 裁判",
        sequence: 2,
        content: "裁决意见：证据链完整，维持推荐关注，但需保留订单兑现验证条款。",
        occurredAt: "2026-03-31T08:13:30.000Z",
      },
    ];
  }

  function createInvestorAnalysisResponse(
    context: SessionContext,
    focusMode: SessionContext["activeMode"] = "investmentRecommendation",
  ): InvestorAnalysisResponse {
    const timeline = focusMode === "deepDive" ? createDeepDiveTimeline() : createRecommendationTimeline();
    const debateMessages = createDebateMessages();
    const updatedContext = upsertInvestorSession({
      ...context,
      activeMode: focusMode,
      summary: focusMode === "deepDive" ? "深度解析已输出" : "投资推荐已输出",
      pendingClarificationQuestions: [],
      recentEvents: [
        {
          id: focusMode === "deepDive" ? "evt-deep-dive" : "evt-recommend",
          type: focusMode === "deepDive" ? "investor_deep_dive" : "investor_recommendation",
          summary: focusMode === "deepDive" ? "深度解析已输出" : "投资推荐已输出",
          occurredAt: "2026-03-31T08:14:00.000Z",
        },
        ...context.recentEvents,
      ],
      latestTimeline: timeline,
      latestDebate: focusMode === "deepDive" ? [] : debateMessages,
      latestEvidenceSummary: focusMode === "deepDive"
        ? ["深度研究纪要：盈利修复主要由成本回落与回款改善驱动"]
        : ["行业快报：需求恢复与现金流修复同步推进"],
      latestProfileUpdate: {
        summary: "本轮识别到用户更关注现金流与海外储能订单兑现。",
        updatedFields: ["notes", "interests"],
        extractedInsights: [
          {
            category: "interest",
            value: "现金流质量",
            confidence: "high",
            source: "query",
          },
        ],
      },
      updatedAt: "2026-03-31T08:14:00.000Z",
    });

    const recentAnalysis = {
      analysisId: `analysis-${focusMode}-${Date.now()}`,
      createdAt: updatedContext.updatedAt,
      summary: updatedContext.summary,
      focusMode,
      combinedRiskLevel: "medium" as const,
      evidenceConfidence: "high" as const,
    };
    userAnalyses.set(
      context.userId,
      [recentAnalysis, ...(userAnalyses.get(context.userId) ?? [])].slice(0, 8),
    );
    userMemories.set(
      context.userId,
      [
        {
          id: `memory-${focusMode}-${Date.now()}`,
          userId: context.userId,
          summary: focusMode === "deepDive" ? "记录了深度研究边界与结论摘要" : "记录了投资推荐立场与证据摘要",
          tags: [focusMode, "analysis"],
          details: focusMode === "deepDive" ? "盈利修复主要由成本回落与回款改善驱动。" : "景气改善已出现，但仍需验证现金流与订单兑现。",
          role: "investor",
          conversationId: updatedContext.sessionId,
          source: "workflow",
          createdAt: updatedContext.updatedAt,
        } satisfies MemoryEntry,
        ...(userMemories.get(context.userId) ?? []),
      ].slice(0, 8),
    );

    return {
      sessionContext: updatedContext,
      diagnostic: createDiagnostic({
        role: "investor",
        finalAnswer: focusMode === "deepDive"
          ? "深度解析结论：盈利修复主要由成本回落与回款改善驱动。"
          : "投资端结论：景气改善已出现，但仍需验证现金流与订单兑现。",
        summary: focusMode === "deepDive" ? "深度解析已完成" : "投资推荐已完成",
        agents: [
          {
            agentId: "industryRetrieval",
            status: "degraded",
            provider: "qwen35Plus",
            summary: "服务端RAG已返回行业证据，并标记为降级可用。",
            attempts: [
              {
                provider: "qwen35Plus",
                model: "qwen-plus",
                status: "success",
                latencyMs: 820,
              },
            ],
            startedAt: "2026-03-31T08:13:18.000Z",
            completedAt: "2026-03-31T08:13:21.000Z",
            output: {
              query: "锂电池行业景气与现金流验证",
              synthesis: "行业景气改善与现金流修复同步推进，但仍需关注订单兑现。",
              retrievalSummary: "服务端RAG：命中 2 条行业来源，当前以降级模式聚合公开网页证据。",
              referenceAbstract: "公开网页与宏观摘要交叉验证后形成统一结论。",
              evidence: [
                {
                  source: "上海有色网",
                  finding: "碳酸锂价格延续低位震荡，有利于电芯成本改善。",
                  confidence: "high",
                  confidenceScore: 0.84,
                  citationId: "citation-smm",
                  citationUrl: "https://example.com/smm",
                },
              ],
              citations: [
                {
                  id: "citation-smm",
                  title: "碳酸锂现货价格周报",
                  url: "https://example.com/smm",
                  source: "上海有色网",
                  summary: "碳酸锂价格维持低位震荡。",
                  excerpt: "价格端回落带来成本支撑。",
                  confidence: "high",
                  confidenceScore: 0.84,
                  relevanceScore: 0.9,
                  publishedAt: "2026-03-30T09:00:00.000Z",
                  retrievedAt: "2026-03-31T08:13:20.000Z",
                  trace: {
                    query: "锂电池行业景气与现金流验证",
                    matchedChunkId: "chunk-smm-001",
                    matchedText: "碳酸锂价格延续低位震荡",
                    searchRank: 1,
                    rerankScore: 0.91,
                    relevanceScore: 0.9,
                    confidenceScore: 0.84,
                  },
                },
                {
                  id: "citation-nbs",
                  title: "工业增加值公开摘要",
                  url: "https://example.com/nbs",
                  source: "国家统计局公开摘要",
                  summary: "制造业景气仍处恢复阶段。",
                  excerpt: "需求修复延续，但节奏仍需观察。",
                  confidence: "medium",
                  confidenceScore: 0.72,
                  relevanceScore: 0.78,
                  retrievedAt: "2026-03-31T08:13:20.000Z",
                  trace: {
                    query: "锂电池行业景气与现金流验证",
                    matchedChunkId: "chunk-nbs-001",
                    matchedText: "制造业景气仍处恢复阶段",
                    searchRank: 2,
                    rerankScore: 0.8,
                    relevanceScore: 0.78,
                    confidenceScore: 0.72,
                  },
                },
              ],
              indexStats: {
                searchHits: 2,
                fetchedPages: 2,
                chunkCount: 6,
                rankedChunks: 2,
                searchProvider: "web",
                fallbackUsed: true,
              },
            },
          },
        ],
      }),
      recommendation: {
        stance: "推荐关注",
        score: 84,
        fitSignals: ["现金流韧性改善", "海外储能订单兑现"],
        rationale: "景气改善与现金流修复形成共振。",
      },
      deepDive: {
        thesis: "深度解析结论：盈利修复主要由成本回落与回款改善驱动。",
        modules: [
          {
            name: "盈利质量",
            summary: "成本传导改善推动毛利率修复。",
          },
        ],
        challengedClaims: ["短期库存去化仍需继续验证"],
      },
      industryReport: {
        overview: "行业景气温和修复，储能需求继续高增长。",
        keyDrivers: ["储能装机扩张", "原材料价格回落"],
        risks: ["订单兑现仍需验证"],
        opportunities: ["海外需求改善"],
        evidenceSources: ["行业快报"],
      },
      debate: {
        rounds: focusMode === "deepDive"
          ? []
          : [
              {
                round: 1,
                debaters: ["glm5", "deepseekReasoner"],
                judge: "qwen35Plus",
                verdict: "本轮裁决：维持推荐关注。",
                messages: debateMessages,
              },
            ],
        finalDecision: focusMode === "deepDive" ? "" : "总结结果确定方案：推荐关注。",
        summary: focusMode === "deepDive" ? "深度解析已完成。" : "三轮正式辩论完成。",
      },
      timeline,
      evidenceSummary: focusMode === "deepDive"
        ? ["深度研究纪要：盈利修复主要由成本回落与回款改善驱动"]
        : ["行业快报：需求恢复与现金流修复同步推进"],
      usedAttachments: updatedContext.attachments,
      profileUpdate: updatedContext.latestProfileUpdate,
      personalization: {
        summary: "画像驱动下优先强调景气与现金流。",
        serviceHints: ["保留关键证据链供下次追问复用"],
      },
    };
  }

  function createSseResponse(events: unknown[]) {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      },
    });

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    });
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const pathname = new URL(url, "http://localhost").pathname;
    const body = parseBody(init);

    if (pathname === "/api/health") {
      return createJsonResponse(healthResponse);
    }

    if (pathname === "/api/meta") {
      return createJsonResponse(metaResponse);
    }

    if (pathname === "/api/acceptance/dual-portal-personalization-audit") {
      return createJsonResponse(portalAuditResponse);
    }

    if (pathname === "/api/users/bootstrap") {
      const userId = body.userId ? String(body.userId) : DEFAULT_USER_ID;
      upsertUserProfile(userId, (current) => ({
        ...current,
        identitySource: body.userId ? "provided" : "generated",
        displayName: typeof body.displayName === "string" ? body.displayName : current.displayName,
        roles: dedupeRoles([
          ...current.roles,
          typeof body.role === "string" ? body.role : undefined,
          typeof body.preferredRole === "string" ? body.preferredRole : undefined,
        ]),
        enterpriseNames: typeof body.enterpriseName === "string"
          ? [body.enterpriseName]
          : current.enterpriseNames,
        investedEnterprises: Array.isArray(body.investedEnterprises)
          ? body.investedEnterprises.map(String)
          : current.investedEnterprises,
        enterpriseBaseInfo: isEditableBusinessInfoRecord(body.enterpriseBaseInfo)
          ? body.enterpriseBaseInfo
          : current.enterpriseBaseInfo,
        investorBaseInfo: isEditableBusinessInfoRecord(body.investorBaseInfo)
          ? body.investorBaseInfo
          : current.investorBaseInfo,
        preferences: {
          ...current.preferences,
          themeMode: body.themeMode === "light" || body.themeMode === "dark" ? body.themeMode : current.preferences.themeMode,
          themeColor: typeof body.themeColor === "string" ? body.themeColor : current.preferences.themeColor,
          preferredRole: body.preferredRole === "enterprise" || body.preferredRole === "investor"
            ? body.preferredRole
            : current.preferences.preferredRole,
          riskAppetite: body.riskAppetite === "low" || body.riskAppetite === "medium" || body.riskAppetite === "high"
            ? body.riskAppetite
            : current.preferences.riskAppetite,
          investmentHorizon: body.investmentHorizon === "short" || body.investmentHorizon === "medium" || body.investmentHorizon === "long"
            ? body.investmentHorizon
            : current.preferences.investmentHorizon,
          interests: Array.isArray(body.interests) ? body.interests.map(String) : current.preferences.interests,
          attentionTags: Array.isArray(body.attentionTags) ? body.attentionTags.map(String) : current.preferences.attentionTags,
          goals: Array.isArray(body.goals) ? body.goals.map(String) : current.preferences.goals,
          constraints: Array.isArray(body.constraints) ? body.constraints.map(String) : current.preferences.constraints,
          decisionStyleHints: Array.isArray(body.decisionStyleHints) ? body.decisionStyleHints.map(String) : current.preferences.decisionStyleHints,
          focusModes: current.preferences.focusModes,
        },
      }));
      return createJsonResponse(buildUserProfileResponse(userId));
    }

    if (pathname.startsWith("/api/users/") && pathname.endsWith("/preferences")) {
      const userId = decodeURIComponent(pathname.replace("/api/users/", "").replace("/preferences", ""));
      if (preferencesResponseDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, preferencesResponseDelayMs));
      }
      upsertUserProfile(userId, (current) => ({
        ...current,
        displayName: typeof body.displayName === "string" ? body.displayName : current.displayName,
        roles: dedupeRoles([
          ...current.roles,
          typeof body.role === "string" ? body.role : undefined,
          typeof body.preferredRole === "string" ? body.preferredRole : undefined,
        ]),
        enterpriseNames: typeof body.enterpriseName === "string"
          ? [body.enterpriseName]
          : current.enterpriseNames,
        investedEnterprises: Array.isArray(body.investedEnterprises)
          ? body.investedEnterprises.map(String)
          : current.investedEnterprises,
        enterpriseBaseInfo: isEditableBusinessInfoRecord(body.enterpriseBaseInfo)
          ? body.enterpriseBaseInfo
          : current.enterpriseBaseInfo,
        investorBaseInfo: isEditableBusinessInfoRecord(body.investorBaseInfo)
          ? body.investorBaseInfo
          : current.investorBaseInfo,
        profileSummary: typeof body.profileSummary === "string" ? body.profileSummary : current.profileSummary,
        behaviorSummary: typeof body.behaviorSummary === "string" ? body.behaviorSummary : current.behaviorSummary,
        preferences: {
          ...current.preferences,
          themeMode: body.themeMode === "light" || body.themeMode === "dark" ? body.themeMode : current.preferences.themeMode,
          themeColor: typeof body.themeColor === "string" ? body.themeColor : current.preferences.themeColor,
          preferredRole: body.preferredRole === "enterprise" || body.preferredRole === "investor"
            ? body.preferredRole
            : current.preferences.preferredRole,
          riskAppetite: body.riskAppetite === "low" || body.riskAppetite === "medium" || body.riskAppetite === "high"
            ? body.riskAppetite
            : current.preferences.riskAppetite,
          investmentHorizon: body.investmentHorizon === "short" || body.investmentHorizon === "medium" || body.investmentHorizon === "long"
            ? body.investmentHorizon
            : current.preferences.investmentHorizon,
          interests: Array.isArray(body.interests) ? body.interests.map(String) : current.preferences.interests,
          attentionTags: Array.isArray(body.attentionTags) ? body.attentionTags.map(String) : current.preferences.attentionTags,
          goals: Array.isArray(body.goals) ? body.goals.map(String) : current.preferences.goals,
          constraints: Array.isArray(body.constraints) ? body.constraints.map(String) : current.preferences.constraints,
          decisionStyleHints: Array.isArray(body.decisionStyleHints) ? body.decisionStyleHints.map(String) : current.preferences.decisionStyleHints,
          focusModes: current.preferences.focusModes,
        },
      }));
      return createJsonResponse(buildUserProfileResponse(userId));
    }

    if (pathname.startsWith("/api/users/")) {
      const userId = decodeURIComponent(pathname.replace("/api/users/", ""));
      return createJsonResponse(buildUserProfileResponse(userId));
    }

    if (pathname === "/api/enterprise/collect") {
      return createJsonResponse(enterpriseCollectionResponse);
    }

    if (pathname === "/api/enterprise/analyze") {
      return createJsonResponse(enterpriseAnalysisResponse);
    }

    if (pathname === "/api/investor/profile") {
      const userId = String(body.userId ?? DEFAULT_USER_ID);
      const investedEnterprises = Array.isArray(body.investedEnterprises) ? body.investedEnterprises.map(String) : ["星海电池", "蓝峰材料"];
      upsertUserProfile(userId, (current) => ({
        ...current,
        displayName: typeof body.investorName === "string" ? body.investorName : current.displayName,
        roles: dedupeRoles([...current.roles, "investor"]),
        investedEnterprises,
        investorBaseInfo: isEditableBusinessInfoRecord(body.investorBaseInfo)
          ? body.investorBaseInfo
          : current.investorBaseInfo,
        profileSummary: "偏好现金流稳健、关注海外储能订单兑现。",
        behaviorSummary: "关注景气、现金流与海外储能订单兑现。",
        preferences: {
          ...current.preferences,
          preferredRole: "investor",
          riskAppetite: body.riskAppetite === "low" || body.riskAppetite === "medium" || body.riskAppetite === "high" ? body.riskAppetite : "medium",
          investmentHorizon: body.investmentHorizon === "short" || body.investmentHorizon === "medium" || body.investmentHorizon === "long" ? body.investmentHorizon : "long",
          interests: Array.isArray(body.interests) ? body.interests.map(String) : current.preferences.interests,
          attentionTags: Array.isArray(body.notes) ? body.notes.map(String) : current.preferences.attentionTags,
          focusModes: ["deepDive"],
        },
      }));
      const context = upsertInvestorSession(buildInvestorContext({
        userId,
        investedEnterprises,
        investorProfileSummary: "偏好现金流稳健、关注海外储能订单兑现。",
      }));
      const investorProfileResponse: InvestorProfileResponse = {
        profileId: "investor-profile-001",
        portraitSummary: "偏好现金流稳健、关注海外储能订单兑现。",
        recommendedMode: "deepDive",
        sessionContext: context,
      };
      userMemories.set(userId, [
        {
          id: "memory-profile-001",
          userId,
          summary: "初始化投资画像：偏好现金流稳健与海外储能订单兑现",
          tags: ["profile", "investor"],
          details: "投资者完成首次画像初始化，后续分析将复用该偏好。",
          role: "investor",
          source: "workflow",
          createdAt: context.updatedAt,
        },
      ]);
      return createJsonResponse(investorProfileResponse);
    }

    if (pathname === "/api/investor/sessions/delete-current") {
      investorSessions.delete(String(body.sessionId));
      const replacement = upsertInvestorSession(
        buildInvestorContext({
          userId: String(body.userId ?? DEFAULT_USER_ID),
          summary: "已自动重建默认投资会话",
          recentEvents: [
            {
              id: "evt-replacement",
              type: "session_created",
              summary: "已自动重建默认投资会话",
              occurredAt: "2026-03-31T08:15:00.000Z",
            },
          ],
          updatedAt: "2026-03-31T08:15:00.000Z",
        }),
      );
      return createJsonResponse({
        deletedSessionIds: [String(body.sessionId)],
        replacementSessionContext: replacement,
      });
    }

    if (pathname === "/api/investor/sessions/delete-batch") {
      const sessionIds = Array.isArray(body.sessionIds) ? body.sessionIds.map(String) : [];
      sessionIds.forEach((sessionId) => {
        investorSessions.delete(sessionId);
      });
      return createJsonResponse({
        deletedSessionIds: sessionIds,
        deletedCount: sessionIds.length,
      });
    }

    if (pathname.startsWith("/api/investor/sessions/")) {
      const userId = decodeURIComponent(pathname.replace("/api/investor/sessions/", ""));
      return createJsonResponse({
        items: Array.from(investorSessions.values())
          .filter((context) => context.userId === userId)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .map(toSummary),
      });
    }

    if (pathname.startsWith("/api/context/")) {
      const sessionId = decodeURIComponent(pathname.replace("/api/context/", ""));
      const context = investorSessions.get(sessionId);
      if (!context) {
        throw new Error(`未找到会话：${sessionId}`);
      }
      return createJsonResponse(context);
    }

    if (pathname === "/api/investor/sessions") {
      const context = upsertInvestorSession(
        buildInvestorContext({
          userId: String(body.userId ?? DEFAULT_USER_ID),
          activeMode: (body.focusMode as SessionContext["activeMode"]) ?? "industryStatus",
          summary: "已新建投资会话",
          recentEvents: [
            {
              id: "evt-create",
              type: "session_created",
              summary: "已新建投资会话",
              occurredAt: "2026-03-31T08:11:00.000Z",
            },
          ],
          updatedAt: "2026-03-31T08:11:00.000Z",
        }),
      );
      return createJsonResponse({
        sessionContext: context,
      });
    }

    if (pathname === "/api/investor/mode") {
      const session = investorSessions.get(String(body.sessionId));
      if (!session) {
        throw new Error("未找到当前投资会话。");
      }
      const nextMode = (body.focusMode as SessionContext["activeMode"]) ?? "investmentRecommendation";
      const nextSummary = nextMode === "deepDive"
        ? "已切换到深度解析模式"
        : nextMode === "industryStatus"
          ? "已切换到行业状况分析模式"
          : "已切换到投资推荐模式";
      const modeSummary = nextMode === "deepDive"
        ? "已切换到深度解析模式，优先确认研究边界后再展开正式研究。"
        : nextMode === "industryStatus"
          ? "已切换到行业状况分析模式，聚焦景气、供需与政策信号。"
          : "已切换到投资推荐模式，聚焦评分、立场与验证动作。";
      const nextContext = upsertInvestorSession({
        ...session,
        activeMode: nextMode,
        summary: nextSummary,
        recentEvents: [
          {
            id: `evt-switch-${nextMode}-${session.recentEvents.length}`,
            type: "mode_switch",
            summary: nextSummary,
            occurredAt: "2026-03-31T08:12:00.000Z",
          },
          ...session.recentEvents,
        ],
        updatedAt: "2026-03-31T08:12:00.000Z",
      });
      const investorModeResponse: InvestorModeResponse = {
        activeMode: nextMode,
        modeSummary,
        sessionContext: nextContext,
      };
      return createJsonResponse(investorModeResponse);
    }

    if (pathname === "/api/investor/attachments") {
      const session = investorSessions.get(String(body.sessionId));
      if (!session) {
        throw new Error("未找到当前投资会话。");
      }
      const attachment = {
        attachmentId: "attachment-001",
        sessionId: session.sessionId,
        userId: session.userId,
        fileName: String(body.fileName),
        mimeType: String(body.mimeType),
        sizeBytes: String(body.content).length,
        status: "ready" as const,
        summary: "海外储能订单继续改善，回款节奏快于预期。",
        tags: ["订单", "回款"],
        warnings: [],
        uploadedAt: "2026-03-31T08:12:30.000Z",
      };
      const nextContext = upsertInvestorSession({
        ...session,
        attachments: [attachment],
        recentEvents: [
          {
            id: "evt-attachment",
            type: "attachment_uploaded",
            summary: `已上传并解析附件：${attachment.fileName}`,
            occurredAt: "2026-03-31T08:12:30.000Z",
          },
          ...session.recentEvents,
        ],
        updatedAt: "2026-03-31T08:12:30.000Z",
      });
      return createJsonResponse({
        attachment,
        warnings: [],
        sessionContext: nextContext,
      });
    }

    if (pathname === "/api/investor/stream") {
      const session = investorSessions.get(String(body.sessionId));
      if (!session) {
        throw new Error("未找到当前投资会话。");
      }
      if (streamResponseDelayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, streamResponseDelayMs);
        });
      }
      if (body.focusMode === "deepDive") {
        const deepDiveContext = body.deepDiveContext as
          | {
              objective?: string;
              timeWindow?: string;
              riskBoundary?: string;
            }
          | undefined;

        if (!deepDiveContext?.objective || !deepDiveContext.timeWindow || !deepDiveContext.riskBoundary) {
          const clarificationQuestions = [
            "请确认本次深度解析最核心的研究目标，例如估值判断、竞争格局还是现金流验证。",
            "请补充研究时间窗口，例如未来一个季度、一年或三年。",
            "请说明可接受的风险边界或最关注的下行情景。",
          ];
          const clarificationContext = upsertInvestorSession({
            ...session,
            activeMode: "deepDive",
            summary: "深度解析待补充关键研究条件。",
            pendingClarificationQuestions: clarificationQuestions,
            updatedAt: "2026-03-31T08:12:45.000Z",
          });
          return createSseResponse([
            {
              type: "session",
              sessionContext: session,
            },
            {
              type: "clarification_required",
              questions: clarificationQuestions,
              sessionContext: clarificationContext,
            },
          ]);
        }

        const result = createInvestorAnalysisResponse(session, "deepDive");
        return createSseResponse([
          {
            type: "session",
            sessionContext: session,
          },
          {
            type: "progress",
            stage: "clarification",
            label: "确认研究边界",
            progressPercent: 18,
            detail: "已补齐研究目标、时间窗口与风险边界",
            timelineEntry: result.timeline[0],
          },
          {
            type: "progress",
            stage: "retrieval",
            label: "检索研究资料",
            progressPercent: 46,
            detail: "整合证据与会话历史",
            timelineEntry: result.timeline[1],
          },
          {
            type: "delta",
            stage: "evidence",
            chunk: "深度解析结论：盈利修复主要由成本回落与回款改善驱动。",
          },
          {
            type: "result",
            result,
          },
        ]);
      }

      const result = createInvestorAnalysisResponse(session, "investmentRecommendation");
      return createSseResponse([
        {
          type: "session",
          sessionContext: session,
        },
        {
          type: "progress",
          stage: "session",
          label: "加载会话上下文",
          progressPercent: 8,
          detail: "已注入历史画像与附件摘要",
          timelineEntry: result.timeline[0],
        },
        {
          type: "progress",
          stage: "debate",
          label: "进行第一轮辩论",
          progressPercent: 30,
          detail: "GLM 与 DeepSeek 对决，Qwen 裁决",
          timelineEntry: result.timeline[1],
        },
        {
          type: "debate_message",
          message: result.debate.rounds[0]!.messages[0],
        },
        {
          type: "debate_message",
          message: result.debate.rounds[0]!.messages[1],
        },
        {
          type: "delta",
          stage: "debate",
          chunk: "辩手与裁判换位，进行第二轮辩论",
        },
        {
          type: "delta",
          stage: "debate",
          chunk: "辩手与裁判换位，进行最后一轮辩论",
        },
        {
          type: "delta",
          stage: "writing",
          chunk: "总结结果确定方案：推荐关注。",
        },
        {
          type: "profile_update",
          profileUpdate: result.profileUpdate,
        },
        {
          type: "result",
          result,
        },
      ]);
    }

    if (pathname === "/api/investor/recommend") {
      const session = investorSessions.values().next().value as SessionContext | undefined;
      return createJsonResponse(createInvestorAnalysisResponse(session ?? buildInvestorContext()));
    }

    if (pathname === "/api/memory") {
      const userId = String(body.userId ?? DEFAULT_USER_ID);
      const nextMemory = {
        id: `memory-manual-${Date.now()}`,
        userId,
        summary: String(body.title ?? "未命名记忆"),
        tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
        details: String(body.content ?? ""),
        role: body.role === "enterprise" || body.role === "investor" ? body.role : "investor",
        source: "manual" as const,
        createdAt: "2026-03-31T08:16:00.000Z",
      } satisfies MemoryEntry;
      userMemories.set(userId, [nextMemory, ...(userMemories.get(userId) ?? [])]);
      return createJsonResponse({
        memory: nextMemory,
      });
    }

    if (pathname.startsWith("/api/memory/")) {
      const identifier = decodeURIComponent(pathname.replace("/api/memory/", "").split("?")[0] ?? DEFAULT_USER_ID);
      const method = init?.method ?? "GET";

      if (method === "PUT") {
        const userId = String(body.userId ?? DEFAULT_USER_ID);
        const currentMemories = userMemories.get(userId) ?? [];
        const nextMemories = currentMemories.map((memory) =>
          memory.id === identifier
            ? {
                ...memory,
                summary: String(body.title ?? memory.summary),
                details: String(body.content ?? memory.details ?? ""),
                tags: Array.isArray(body.tags) ? body.tags.map(String) : memory.tags,
              }
            : memory,
        );
        userMemories.set(userId, nextMemories);
        return createJsonResponse({
          memory: nextMemories.find((memory) => memory.id === identifier),
        });
      }

      if (method === "DELETE") {
        const userId = new URL(url, "http://localhost").searchParams.get("userId") ?? DEFAULT_USER_ID;
        userMemories.set(
          userId,
          (userMemories.get(userId) ?? []).filter((memory) => memory.id !== identifier),
        );
        return createJsonResponse({
          deletedMemoryId: identifier,
        });
      }

      const userId = identifier;
      return createJsonResponse({
        items: buildUserProfileResponse(userId).recentMemories,
      });
    }

    throw new Error(`未处理的请求路径：${pathname}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderApp() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<App />);
  });

  return {
    container,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function createCanvasContextMock() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  } as unknown as CanvasRenderingContext2D;
}

describe("App critical paths", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => createCanvasContextMock());
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("在预热时长内完成首屏启动并跑通企业分析路径", async () => {
    const fetchMock = installFetchMock();
    const view = renderApp();

    expect(view.container.textContent).toContain("锂电智诊");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1499);
    });
    expect(view.container.textContent).toContain("锂电智诊");

    await settleBootstrap();

    await waitFor(() => {
      expect(view.container.textContent).toContain("欢迎使用锂电智诊");
    });
    expect(fetchMock).toHaveBeenCalled();

    // 以前的测试点击了不存在的按钮，现在需要适配现有的 UI 流程
    await clickButton(view.container, "企业运营分析");
    
    await waitFor(() => {
      expect(view.container.textContent).toContain("企业数据收集");
    });

    await clickButton(view.container, "下一");
    await waitFor(() => {
      expect(view.container.textContent).toContain("当前季度核心数据");
    });
    await clickButton(view.container, "下一");
    await waitFor(() => {
      expect(view.container.textContent).toContain("历史季度对比数据");
    });
    await clickButton(view.container, "开始分");
    await waitFor(() => {
      expect(view.container.textContent).toContain("企业端图表系统");
      expect(view.container.textContent).toContain("经营总览");
    });

    view.unmount();
  });

  it("企业端首页可通过工作台入口闭环切换，并展示竞争力面板", async () => {
    installFetchMock();
    const view = renderApp();

    await settleBootstrap();
    await clickButton(view.container, "企业运营分析");
    await waitFor(() => {
      expect(view.container.textContent).toContain("企业数据收集");
    });
    await clickButton(view.container, "下一");
    await clickButton(view.container, "下一");
    await clickButton(view.container, "开始分");

    await waitFor(() => {
      expect(view.container.textContent).toContain("进入经营工作台");
      expect(view.container.textContent).toContain("Agent 竞争力面板");
      expect(view.container.textContent).toContain("双端审计");
      expect(view.container.textContent).toContain("真实接入");
      expect(view.container.textContent).toContain("降级可用");
      expect(view.container.textContent).toContain("预留占位");
    });

    await clickButton(view.container, "进入经营工作台");
    await waitFor(() => {
      expect(view.container.textContent).toContain("经营工作台闭环");
      expect(view.container.textContent).toContain("What-If 沙盘推演");
    });

    await clickButton(view.container, "维护基本信息");
    await waitFor(() => {
      expect(view.container.textContent).toContain("企业基本信息");
    });

    view.unmount();
  });

  it("企业端工作台调用真实接口完成诊断", async () => {
    const fetchMock = installFetchMock();
    const view = renderApp();

    await settleBootstrap();
    await clickButton(view.container, "企业运营分析");
    await waitFor(() => {
      expect(view.container.textContent).toContain("企业数据收集");
    });
    await clickButton(view.container, "下一");
    await clickButton(view.container, "下一");
    await clickButton(view.container, "开始分");
    await clickButton(view.container, "进入经营工作台");

    await waitFor(() => {
      expect(view.container.textContent).toContain("企业诊断：真实接入");
      expect(view.container.textContent).toContain("企业数据已通过真实接口同步");
    });

    const textarea = view.container.querySelector(".cia textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    await setFieldValue(textarea!, "请输出企业经营诊断与关键动作");
    await clickElement(view.container.querySelector(".cse") as HTMLElement | null);

    await waitFor(() => {
      expect(view.container.textContent).toContain("真实接口分析已返回");
      expect(view.container.textContent).toContain("企业端诊断：库存去化慢于订单恢复");
    });

    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        return url.includes("/api/enterprise/collect");
      }),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        return url.includes("/api/enterprise/analyze");
      }),
    ).toBe(true);

    view.unmount();
  });

  it("投资端首页可通过工作台入口闭环切换，并返回偏好设置", async () => {
    installFetchMock();
    const view = renderApp();

    await settleBootstrap();
    await clickButton(view.container, "投资人员");
    await waitFor(() => {
      expect(view.container.textContent).toContain("投资信息收集");
    });
    await clickButton(view.container, "下一");

    await waitFor(() => {
      expect(view.container.textContent).toContain("进入投资工作台");
      expect(view.container.textContent).toContain("双端审计");
      expect(view.container.textContent).toContain("真实接入");
    });

    await clickButton(view.container, "进入投资工作台");
    await waitFor(() => {
      expect(view.container.textContent).toContain("分析工作台");
      expect(view.container.textContent).toContain("返回首页");
    });

    await clickButton(view.container, "偏好设置");
    await waitFor(() => {
      expect(view.container.textContent).toContain("投资基本信息");
    });

    view.unmount();
  });

  it("企业端审计面板不会误展示投资端链路", async () => {
    installFetchMock();
    const view = renderApp();

    await settleBootstrap();
    await clickButton(view.container, "企业运营分析");
    await waitFor(() => {
      expect(view.container.textContent).toContain("企业数据收集");
    });
    await clickButton(view.container, "下一");
    await clickButton(view.container, "下一");
    await clickButton(view.container, "开始分");

    const panel = view.container.querySelector(".competitive-panel-card") as HTMLElement | null;
    expect(panel).not.toBeNull();
    await waitFor(() => {
      expect(panel?.textContent).toContain("双端审计");
    }, 50);
    const channelExpandButton = Array.from(panel!.querySelectorAll(".audit-accordion-header")).find((el) =>
      el.textContent?.includes("链路接入"),
    );
    if (channelExpandButton) {
      await clickElement(channelExpandButton as HTMLElement);
    }
    await waitFor(() => {
      expect(panel?.textContent).toContain("企业端数据采集输入");
      expect(panel?.textContent).toContain("企业端分析入口");
      expect(panel?.textContent).toContain("企业端首页");
      expect(panel?.textContent).not.toContain("投资端画像输入");
      expect(panel?.textContent).not.toContain("投资端分析入口");
    });

    view.unmount();
  });

  it("投资端审计面板不会误展示企业端链路", async () => {
    installFetchMock();
    const view = renderApp();

    await settleBootstrap();
    await clickButton(view.container, "投资人员");
    await waitFor(() => {
      expect(view.container.textContent).toContain("投资信息收集");
    });
    await clickButton(view.container, "下一");

    const panel = view.container.querySelector(".competitive-panel-card") as HTMLElement | null;
    expect(panel).not.toBeNull();
    await waitFor(() => {
      expect(panel?.textContent).toContain("双端审计");
    }, 50);
    const channelExpandButton = Array.from(panel!.querySelectorAll(".audit-accordion-header")).find((el) =>
      el.textContent?.includes("链路接入"),
    );
    if (channelExpandButton) {
      await clickElement(channelExpandButton as HTMLElement);
    }
    await waitFor(() => {
      expect(panel?.textContent).toContain("投资端画像输入");
      expect(panel?.textContent).toContain("投资端分析入口");
      expect(panel?.textContent).toContain("投资端首页");
      expect(panel?.textContent).not.toContain("企业端数据采集输入");
      expect(panel?.textContent).not.toContain("企业端分析入口");
    });

    view.unmount();
  });

  it("分析页侧栏展示对话历史并支持切换摘要与批量删除", async () => {
    const fetchMock = installFetchMock();
    const view = renderApp();

    await settleBootstrap();

    await clickButton(view.container, "投资人员");
    await waitFor(() => {
      expect(view.container.textContent).toContain("投资信息收集");
    });

    await clickButton(view.container, "下一");
    
    await waitFor(() => {
      expect(view.container.textContent).toContain("普通用户端图表系统");
    });

    await clickButton(view.container, "分析");
    await waitFor(() => {
      expect(view.container.textContent).toContain("分析工作台");
      expect(view.container.textContent).toContain("当前会话：");
    });

    const investorApp = view.container.querySelector("#ai2") as HTMLElement;

    await clickButton(view.container, "新建会话");
    await waitFor(() => {
      expect(view.container.textContent).toContain("已新建投资会话");
    });

    await clickButton(view.container, "新建会话");
    await waitFor(() => {
      expect(view.container.textContent).toContain("已新建投资会话");
    });

    await clickElement(findElementByText(investorApp, ".mt2", "行业状况分析") ?? null);
    await waitFor(() => {
      expect(view.container.textContent).toContain("当前模式：行业状况分析");
    });

    expect(investorApp.textContent).toContain("对话历史");
    expect(investorApp.textContent).not.toContain("会话事件");

    const beforeSwitchSessionId = getCurrentInvestorSessionId(investorApp);
    expect(beforeSwitchSessionId).not.toBeNull();
    const switchTarget = Array.from(investorApp.querySelectorAll(".iwb-history-entry-main")).find(
      (element) => !(element as HTMLButtonElement).disabled,
    ) as HTMLButtonElement | undefined;
    expect(switchTarget).toBeDefined();
    await clickElement(switchTarget ?? null);
    await waitFor(() => {
      expect(getCurrentInvestorSessionId(investorApp)).not.toBe(beforeSwitchSessionId);
    });

    const summaryAction = investorApp.querySelector(".iwb-history-entry-action") as HTMLButtonElement;
    expect(summaryAction).not.toBeNull();
    await clickElement(summaryAction);
    await waitFor(() => {
      expect(document.body.textContent).toContain("会话摘要");
      expect(document.body.textContent).toContain("会话编号");
    });
    await clickButton(document.body, "关闭");
    await waitFor(() => {
      expect(document.body.querySelector(".iwb-history-preview-modal")).toBeNull();
    });

    await clickButton(view.container, "历史对话");
    const historyModal = document.body.querySelector(".iwb-history-modal");
    expect(historyModal).not.toBeNull();
    const historyCheckboxes = historyModal?.querySelectorAll('input[type="checkbox"]') ?? [];
    expect(historyCheckboxes.length).toBeGreaterThanOrEqual(2);
    await clickElement(historyCheckboxes[1] as HTMLInputElement);
    await clickButton(document.body, "删除勾选");
    await waitFor(() => {
      expect(view.container.textContent).toContain("已删除 1 条历史对话。");
    });

    const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    const mockFile = new File(["test content"], "调研纪要.txt", { type: "text/plain" });
    Object.defineProperty(mockFile, "text", {
      value: vi.fn(async () => "test content"),
    });
    Object.defineProperty(fileInput, "files", {
      value: [mockFile],
    });

    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await waitFor(() => {
      expect(view.container.textContent).toContain("调研纪要.txt");
    });
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        return url.includes("/api/investor/attachments");
      }),
    ).toBe(true);

    view.unmount();
  });

  it("侧栏摘要弹层删除当前会话后同步刷新侧栏与历史弹窗", async () => {
    installFetchMock();
    const view = renderApp();

    await settleBootstrap();

    await clickButton(view.container, "投资人员");
    await waitFor(() => {
      expect(view.container.textContent).toContain("投资信息收集");
    });

    await clickButton(view.container, "下一");
    await waitFor(() => {
      expect(view.container.textContent).toContain("普通用户端图表系统");
    });

    await clickButton(view.container, "分析");
    await waitFor(() => {
      expect(view.container.textContent).toContain("分析工作台");
      expect(view.container.textContent).toContain("当前会话：");
    });

    const investorApp = view.container.querySelector("#ai2") as HTMLElement;
    await waitFor(() => {
      expect(investorApp.querySelectorAll(".iwb-history-item")).toHaveLength(1);
    });

    const currentHistoryItem = investorApp.querySelector(".iwb-history-item.on") as HTMLElement;
    expect(currentHistoryItem).not.toBeNull();
    await clickElement(currentHistoryItem.querySelector(".iwb-history-entry-action") as HTMLButtonElement);
    const deletedSessionId = getCurrentInvestorSessionId(investorApp);
    expect(deletedSessionId).not.toBeNull();
    await waitFor(() => {
      const previewModal = document.body.querySelector(".iwb-history-preview-modal") as HTMLElement | null;
      expect(previewModal).not.toBeNull();
      expect(previewModal?.textContent).toContain("当前会话");
      expect(previewModal?.textContent).toContain(deletedSessionId as string);
    });

    await clickButton(document.body, "删除会话");
    await waitFor(() => {
      expect(view.container.textContent).toContain("已删除 1 条历史对话。");
      expect(document.body.querySelector(".iwb-history-preview-modal")).toBeNull();
    });
    await waitFor(() => {
      const conversation = investorApp.querySelector(".cms") as HTMLElement | null;
      expect(conversation?.textContent).toContain("请输入信息进行对话");
      expect(conversation?.textContent).not.toContain("已载入");
      expect(conversation?.textContent).not.toContain("投资画像：");
      expect(conversation?.textContent).not.toContain("已删除 1 条历史对话");
    });

    await waitFor(() => {
      expect(investorApp.querySelectorAll(".iwb-history-item")).toHaveLength(1);
      expect(investorApp.querySelector(".iwb-history-item.on")).not.toBeNull();
      expect(investorApp.textContent).not.toContain(deletedSessionId as string);
    });

    const replacementHistoryItem = investorApp.querySelector(".iwb-history-item.on") as HTMLElement;
    expect(replacementHistoryItem).not.toBeNull();
    await clickElement(replacementHistoryItem.querySelector(".iwb-history-entry-action") as HTMLButtonElement);
    let replacementSessionId: string | null = null;
    await waitFor(() => {
      const previewModal = document.body.querySelector(".iwb-history-preview-modal") as HTMLElement | null;
      expect(previewModal).not.toBeNull();
      expect(previewModal?.textContent).toContain("当前会话");
      const matched = previewModal?.textContent?.match(/会话编号(.+)/);
      replacementSessionId = matched?.[1] ?? null;
      expect(replacementSessionId).not.toBeNull();
      expect(replacementSessionId).not.toContain(deletedSessionId as string);
    });
    await clickButton(document.body, "关闭");
    await waitFor(() => {
      expect(document.body.querySelector(".iwb-history-preview-modal")).toBeNull();
    });

    await clickButton(view.container, "历史对话");
    await waitFor(() => {
      const historyModal = document.body.querySelector(".iwb-history-modal") as HTMLElement | null;
      expect(historyModal).not.toBeNull();
      expect(historyModal?.querySelectorAll(".iwb-history-row")).toHaveLength(1);
      expect(historyModal?.textContent).toContain("共 1 条，已选择 0 条");
      expect(historyModal?.textContent).toContain("当前会话");
    });

    await clickElement(document.body.querySelector(".iwb-history-modal .iwb-modal-close") as HTMLButtonElement);
    await waitFor(() => {
      expect(document.body.querySelector(".iwb-history-modal")).toBeNull();
    });

    await clickButton(view.container, "新建会话");
    await waitFor(() => {
      expect(view.container.textContent).toContain("已新建投资会话");
      expect(getCurrentInvestorSessionId(investorApp)).not.toBe(replacementSessionId);
    });

    view.unmount();
  });

  it("深度解析会先澄清再研究，并保留辩论换位与总结独立消息", async () => {
    installFetchMock({ streamResponseDelayMs: 80 });
    const view = renderApp();

    await settleBootstrap();

    await clickButton(view.container, "投资人员");
    await waitFor(() => {
      expect(view.container.textContent).toContain("投资信息收集");
    });

    await clickButton(view.container, "下一");
    await waitFor(() => {
      expect(view.container.textContent).toContain("普通用户端图表系统");
    });

    await clickButton(view.container, "分析");
    await waitFor(() => {
      expect(view.container.textContent).toContain("分析工作台");
      expect(view.container.textContent).toContain("当前会话：");
    });

    const investorApp = view.container.querySelector("#ai2") as HTMLElement;

    await clickButton(view.container, "新建会话");
    await waitFor(() => {
      expect(view.container.textContent).toContain("已新建投资会话");
    });

    await clickElement(findElementByText(investorApp, ".mt2", "深度解析") ?? null);
    await waitFor(() => {
      expect(view.container.textContent).toContain("当前模式：深度解析");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => {
      expect(investorApp.querySelector(".cse")).not.toBeNull();
      expect(investorApp.querySelector(".ci")).not.toBeNull();
      expect(investorApp.querySelector(".cms")).not.toBeNull();
    });

    const chatInput = investorApp.querySelector(".ci") as HTMLTextAreaElement;
    const sendButton = investorApp.querySelector(".cse") as HTMLButtonElement;
    const chatMessages = investorApp.querySelector(".cms") as HTMLElement;

    await waitFor(() => {
      expect(investorApp.querySelector(".iwb-chain-wrap")).toBeNull();
    });

    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      nativeInputValueSetter?.call(chatInput, "请做一次正式深度解析。");
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      Object.defineProperty(enterEvent, 'shiftKey', { value: false });
      chatInput.dispatchEvent(enterEvent);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });

    await waitFor(() => {
      expect(view.container.textContent).toContain("待补充研究条件");
      expect(view.container.textContent).toContain("请确认本次深度解析最核心的研究目标");
    });

    await setFieldValue(
      chatInput,
      "研究目标：验证盈利修复是否可持续。\n时间窗口：未来四个季度。\n风险边界：重点关注海外扩产延期与回款波动。",
    );
    await clickElement(sendButton);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });

    await waitFor(() => {
      expect(view.container.textContent).toContain("深度解析结论：盈利修复主要由成本回落与回款改善驱动。");
      expect(view.container.textContent).toContain("确认研究边界");
    });
    expect(investorApp.querySelector(".iwb-chain-wrap")).toBeNull();
    expect(investorApp.querySelector(".iwb-live-progress-bar")).toBeNull();

    await clickElement(findElementByText(investorApp, ".mt2", "投资推荐") ?? null);
    await waitFor(() => {
      expect(view.container.textContent).toContain("当前模式：投资推荐");
      expect(chatMessages.textContent).toContain("请输入信息进行对话");
    });
    expect(chatMessages.textContent).not.toContain("深度解析结论：盈利修复主要由成本回落与回款改善驱动。");
    expect(chatMessages.textContent).not.toContain("待补充研究条件");
    expect(investorApp.querySelector(".iwb-chain-wrap")).toBeNull();

    await setFieldValue(chatInput, "请给出正式投资建议。");
    await clickElement(sendButton);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });

    await waitFor(() => {
      expect(view.container.textContent).toContain("正方一辩");
      expect(view.container.textContent).toContain("Qwen 裁判");
      expect(view.container.textContent).toContain("辩手与裁判换位，进行第二轮辩论");
      expect(view.container.textContent).toContain("辩手与裁判换位，进行最后一轮辩论");
      expect(view.container.textContent).toContain("总结结果确定方案：推荐关注。");
      expect(view.container.textContent).toContain("服务端RAG证据来源");
      expect(view.container.textContent).toContain("服务端RAG：命中 2 条行业来源，当前以降级模式聚合公开网页证据。");
      expect(view.container.textContent).toContain("来源：上海有色网");
      expect(view.container.textContent).toContain("来源：国家统计局公开摘要");
      expect(view.container.textContent).toContain("时间：2026-03-30 17:00 · 是否降级：是");
      expect(view.container.textContent).toContain("时间：2026-03-31 16:13 · 是否降级：是");
    });
    expect(investorApp.querySelector(".iwb-chain-wrap")).toBeNull();
    expect(investorApp.querySelector(".iwb-live-progress-bar")).toBeNull();

    const assistantMessages = Array.from(investorApp.querySelectorAll(".cms .m.a .mb"))
      .map((item) => item.textContent?.trim())
      .filter((item): item is string => Boolean(item));

    expect(assistantMessages).toContain("辩手与裁判换位，进行第二轮辩论");
    expect(assistantMessages).toContain("辩手与裁判换位，进行最后一轮辩论");
    expect(assistantMessages).toContain("总结结果确定方案：推荐关注。");

    const summaryOccurrences = assistantMessages.filter((item) => item === "总结结果确定方案：推荐关注。");
    expect(summaryOccurrences).toHaveLength(1);
    expect(assistantMessages.some((item) => item.includes("辩手与裁判换位，进行第二轮辩论总结结果确定方案"))).toBe(false);
    expect(assistantMessages.some((item) => item.includes("辩手与裁判换位，进行最后一轮辩论总结结果确定方案"))).toBe(false);
    expect(assistantMessages.some((item) => item === "投资端结论：景气改善已出现，但仍需验证现金流与订单兑现。")).toBe(false);

    await clickButton(view.container, "删除当前");
    await waitFor(() => {
      expect(view.container.textContent).toContain("已自动重建默认投资会话");
    });
    await waitFor(() => {
      const conversation = investorApp.querySelector(".cms") as HTMLElement | null;
      expect(conversation?.textContent).toContain("请输入信息进行对话");
      expect(conversation?.textContent).not.toContain("已载入");
      expect(conversation?.textContent).not.toContain("投资画像：");
    });

    view.unmount();
  });

  it("记忆页面使用真实用户历史与记忆数据渲染", async () => {
    installFetchMock();
    const view = renderApp();

    await settleBootstrap();
    await clickButton(view.container, "投资人员");
    await waitFor(() => {
      expect(view.container.textContent).toContain("投资信息收集");
    });

    await clickButton(view.container, "下一");
    await waitFor(() => {
      expect(view.container.textContent).toContain("普通用户端图表系统");
    });

    await clickButton(view.container, "分析");
    await waitFor(() => {
      expect(view.container.textContent).toContain("分析工作台");
    });
    await clickButton(view.container, "设置");
    await clickButton(view.container, "记忆中的");

    await waitFor(() => {
      expect(view.container.textContent).toContain("记忆中的你");
      expect(view.container.textContent).toContain("投资用户档案");
      expect(view.container.textContent).toContain("最近记忆");
    });

    const background = view.container.querySelector(".mbg");
    expect(background?.getAttribute("data-memory-mode")).toBe("startup");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });

    await waitFor(() => {
      const nextMode = background?.getAttribute("data-memory-mode");
      expect(["balanced", "full", "startup"]).toContain(nextMode);
    });

    await clickButton(view.container, "最近记忆");
    await clickButton(view.container, "profile"); // 点击展开后的二级节点以查看详情
    await waitFor(() => {
      expect(document.body.textContent).toContain("记忆详情");
      expect(document.body.textContent).toContain("初始化投资画像");
    });

    await clickButton(document.body, "关闭");
    await clickButton(view.container, "返回");

    await waitFor(() => {
      expect(document.body.textContent).toContain("偏好设置");
    });

    view.unmount();
  });

  it("用户主题与角色偏好会写入持久化并在重进时恢复", async () => {
    const fetchMock = installFetchMock();
    const firstView = renderApp();

    await settleBootstrap();
    await clickButton(firstView.container, "投资人员");
    await waitFor(() => {
      expect(firstView.container.textContent).toContain("投资信息收集");
    });
    await clickButton(firstView.container, "下一");
    await waitFor(() => {
      expect(firstView.container.textContent).toContain("普通用户端图表系统");
    });

    await clickButton(firstView.container, "设置");
    const settingToggles = firstView.container.querySelectorAll('.sw input[type="checkbox"]');
    expect(settingToggles.length).toBeGreaterThan(0);
    await clickElement(settingToggles[0] as HTMLInputElement);
    await clickButton(firstView.container, "青绿极光");

    await waitFor(() => {
      expect(localStorage.getItem("battery-diagnostic.themeMode")).toBe("light");
      expect(localStorage.getItem("battery-diagnostic.themeColor")).toBe("emerald-cyan");
      expect(localStorage.getItem("battery-diagnostic.preferredRole")).toBe("investor");
    });
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          return url.includes("/api/users/mock-user-001/preferences");
        }),
      ).toBe(true);
    });
    expect(document.documentElement.classList.contains("theme-light")).toBe(true);

    firstView.unmount();

    const secondView = renderApp();
    await settleBootstrap();

    await waitFor(() => {
      expect(secondView.container.textContent).toContain("普通用户端图表系统");
    });
    expect(document.documentElement.classList.contains("theme-light")).toBe(true);

    secondView.unmount();
  });

  it("企业设置页基本信息会先本地更新再持久化并同步到记忆树", async () => {
    const fetchMock = installFetchMock({ preferencesResponseDelayMs: 120 });
    const view = renderApp();

    await settleBootstrap();
    await clickButton(view.container, "企业运营分析");
    await waitFor(() => {
      expect(view.container.textContent).toContain("企业数据收集");
    });
    await clickButton(view.container, "下一");
    await waitFor(() => {
      expect(view.container.textContent).toContain("当前季度核心数据");
    });
    await clickButton(view.container, "下一");
    await waitFor(() => {
      expect(view.container.textContent).toContain("历史季度对比数据");
    });
    await clickButton(view.container, "开始分");
    await waitFor(() => {
      expect(view.container.textContent).toContain("企业端图表系统");
    });

    await clickButton(view.container, "设置");
    await clickButton(view.container, "填写基本信息");

    expect(view.container.textContent).not.toContain("外部证据接入");
    expect(view.container.textContent).not.toContain("无需手工填写价格 API 密钥");
    expect(view.container.textContent).not.toContain("输入 API 密钥");
    expect(view.container.textContent).not.toContain("碳酸锂价格 API");
    expect(view.container.textContent).not.toContain("六氟磷酸锂 API");

    const enterpriseRevenue = view.container.querySelector('input[aria-label="企业基本信息营业收入"]') as HTMLInputElement;
    const enterpriseGrossMargin = view.container.querySelector('input[aria-label="企业基本信息毛利率"]') as HTMLInputElement;
    const enterpriseOrders = view.container.querySelector('textarea[aria-label="企业基本信息订单"]') as HTMLTextAreaElement;
    const enterpriseInventory = view.container.querySelector('input[aria-label="企业基本信息库存"]') as HTMLInputElement;
    await setFieldValue(enterpriseRevenue, "18.6");
    await setFieldValue(enterpriseGrossMargin, "21.4");
    await setFieldValue(enterpriseOrders, "海外储能\n工商业");
    await setFieldValue(enterpriseInventory, "52");

    await clickButton(view.container, "保存基本信息");

    expect(view.container.textContent).toContain("营业收入");
    expect(view.container.textContent).toContain("18.6万元");
    expect(view.container.textContent).toContain("正在同步基本信息");

    const enterprisePreferenceCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const payload = init?.body && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      return url.includes("/api/users/mock-user-001/preferences") && typeof payload.enterpriseBaseInfo === "object";
    });
    expect(enterprisePreferenceCall).toBeTruthy();

    const enterprisePayload = enterprisePreferenceCall?.[1]?.body && typeof enterprisePreferenceCall[1].body === "string"
      ? JSON.parse(enterprisePreferenceCall[1].body)
      : {};
    expect(enterprisePayload.enterpriseBaseInfo).toEqual({
      营业收入: "18.6万元",
      毛利率: "21.4%",
      订单: ["海外储能", "工商业"],
      库存: "52天",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    await waitFor(() => {
      expect(view.container.textContent).toContain("21.4%");
      expect(view.container.textContent).toContain("海外储能");
      expect(view.container.textContent).toContain("已同步到用户偏好");
    });

    await clickButton(view.container, "记忆中的你");
    await waitFor(() => {
      expect(view.container.textContent).toContain("记忆中的你");
    });
    await clickButton(view.container, "关注与偏好");
    await clickElement(findElementByText(view.container, ".tn.l2", "营业收入") ?? null);
    await waitFor(() => {
      expect(document.body.textContent).toContain("关键信息");
      expect(document.body.textContent).toContain("18.6万元");
    });

    view.unmount();
  });

  it("投资设置页基本信息会持久化 investorBaseInfo 并展示到记忆树", async () => {
    const fetchMock = installFetchMock();
    const view = renderApp();

    await settleBootstrap();
    await clickButton(view.container, "投资人员");
    await waitFor(() => {
      expect(view.container.textContent).toContain("投资信息收集");
    });
    await clickButton(view.container, "下一");
    await waitFor(() => {
      expect(view.container.textContent).toContain("普通用户端图表系统");
    });

    await clickButton(view.container, "设置");
    await clickButton(view.container, "填写基本信息");

    expect(view.container.textContent).not.toContain("外部证据接入");
    expect(view.container.textContent).not.toContain("无需手工填写价格 API 密钥");
    expect(view.container.textContent).not.toContain("输入 API 密钥");
    expect(view.container.textContent).not.toContain("碳酸锂价格 API");
    expect(view.container.textContent).not.toContain("六氟磷酸锂 API");

    const investorAssets = view.container.querySelector('input[aria-label="投资基本信息可投资资产"]') as HTMLInputElement;
    const investorAssetAllocation = view.container.querySelector('textarea[aria-label="投资基本信息资产分布"]') as HTMLTextAreaElement;
    const investorCompanies = view.container.querySelector('textarea[aria-label="投资基本信息已投资公司"]') as HTMLTextAreaElement;
    const investorWatchlist = view.container.querySelector('textarea[aria-label="投资基本信息关注企业"]') as HTMLTextAreaElement;
    await setFieldValue(investorAssets, "25");
    await setFieldValue(investorAssetAllocation, "一级股权\n可转债");
    await setFieldValue(investorCompanies, "星海电池\n蓝峰材料");
    await setFieldValue(investorWatchlist, "海辰储能\n鹏辉能源");

    await clickButton(view.container, "保存基本信息");

    await waitFor(() => {
      expect(view.container.textContent).toContain("25万元");
      expect(view.container.textContent).toContain("一级股权");
      expect(view.container.textContent).toContain("海辰储能");
    });

    const investorPreferenceCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const payload = init?.body && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      return url.includes("/api/users/mock-user-001/preferences") && typeof payload.investorBaseInfo === "object";
    });
    expect(investorPreferenceCall).toBeTruthy();

    const investorPayload = investorPreferenceCall?.[1]?.body && typeof investorPreferenceCall[1].body === "string"
      ? JSON.parse(investorPreferenceCall[1].body)
      : {};
    expect(investorPayload.investorBaseInfo).toEqual({
      可投资资产: "25万元",
      资产分布: ["一级股权", "可转债"],
      已投资公司: ["星海电池", "蓝峰材料"],
      关注企业: ["海辰储能", "鹏辉能源"],
    });

    await clickButton(view.container, "记忆中的");
    await waitFor(() => {
      expect(view.container.textContent).toContain("记忆中的你");
    });
    await clickButton(view.container, "关注与偏好");
    await clickElement(findElementByText(view.container, ".tn.l2", "可投资资产") ?? null);
    await waitFor(() => {
      expect(document.body.textContent).toContain("投资基本信息");
      expect(document.body.textContent).toContain("25万元");
    });

    view.unmount();
  });

  it("内容切换时会清理悬浮提示与弹层并保持 portal 稳定", async () => {
    installFetchMock();
    const view = renderApp();

    await settleBootstrap();
    await clickButton(view.container, "投资人员");
    await waitFor(() => {
      expect(view.container.textContent).toContain("投资信息收集");
    });
    await clickButton(view.container, "下一");
    await waitFor(() => {
      expect(view.container.textContent).toContain("普通用户端图表系统");
    });

    const expandButton = Array.from(view.container.querySelectorAll(".viz-inline-btn")).find(
      (element) => element.textContent === "展开",
    ) as HTMLButtonElement | undefined;
    expect(expandButton).toBeDefined();
    await clickElement(expandButton ?? null);
    await waitFor(() => {
      expect(view.container.textContent).toContain("收起");
    });
    expect(document.body.querySelector(".chart-tooltip")).toBeNull();
    expect(document.body.querySelector(".chart-modal")).toBeNull();

    await clickButton(view.container, "设置");
    await waitFor(() => {
      expect(view.container.textContent).toContain("偏好设置");
      expect(document.body.querySelector(".chart-tooltip")).toBeNull();
      expect(document.body.querySelector(".chart-modal")).toBeNull();
    });

    await clickButton(view.container, "记忆中的");
    await waitFor(() => {
      expect(view.container.textContent).toContain("记忆中的你");
    });

    await clickButton(view.container, "最近记忆");
    await clickButton(view.container, "投资用户档案");
    await waitFor(() => {
      expect(document.body.querySelector(".nd[role='dialog']")).not.toBeNull();
    });

    await clickButton(document.body, "关闭");
    await waitFor(() => {
      expect(document.body.querySelector(".ndo")).toBeNull();
      expect(document.body.textContent).not.toContain("记忆详情");
    });

    view.unmount();
  });

  it("记忆页面支持新增编辑删除并保持数据同步", async () => {
    installFetchMock();
    const view = renderApp();

    await settleBootstrap();
    await clickButton(view.container, "投资人员");
    await waitFor(() => {
      expect(view.container.textContent).toContain("投资信息收集");
    });
    await clickButton(view.container, "下一");
    await waitFor(() => {
      expect(view.container.textContent).toContain("普通用户端图表系统");
    });

    await clickButton(view.container, "设置");
    await clickButton(view.container, "记忆中的");

    await waitFor(() => {
      expect(view.container.textContent).toContain("记忆中的你");
    });

    await clickButton(view.container, "新增记忆");
    await waitFor(() => {
      expect(document.body.textContent).toContain("新增记忆");
    });

    const createTitle = document.body.querySelector(".memory-form input") as HTMLInputElement;
    const createContent = document.body.querySelector(".memory-form textarea") as HTMLTextAreaElement;
    const createTags = document.body.querySelectorAll(".memory-form input")[1] as HTMLInputElement;
    await setFieldValue(createTitle, "新增记忆摘要");
    await setFieldValue(createContent, "新增记忆详细内容");
    await setFieldValue(createTags, "新增、测试");
    await clickButton(document.body, "保存");

    await waitFor(() => {
      expect(view.container.textContent).toContain("新增记忆摘要");
    });

    await clickButton(view.container, "最近记忆");
    const createdMemoryNode = findElementByText(view.container, ".tn.l2", "新增记忆摘要");
    await clickElement(createdMemoryNode ?? null);
    await waitFor(() => {
      expect(document.body.textContent).toContain("记忆详情");
      expect(document.body.textContent).toContain("新增记忆摘要");
    });

    await clickButton(document.body, "编辑");
    const editTitle = document.body.querySelector(".memory-form input") as HTMLInputElement;
    const editContent = document.body.querySelector(".memory-form textarea") as HTMLTextAreaElement;
    await setFieldValue(editTitle, "已编辑记忆摘要");
    await setFieldValue(editContent, "已编辑记忆详细内容");
    await clickButton(document.body, "保存");

    await waitFor(() => {
      expect(view.container.textContent).toContain("已编辑记忆摘要");
    });

    const editedMemoryNode = findElementByText(view.container, ".tn.l2", "已编辑记忆摘要");
    await clickElement(editedMemoryNode ?? null);
    await waitFor(() => {
      expect(document.body.textContent).toContain("已编辑记忆摘要");
    });
    await clickButton(document.body, "删除");

    await waitFor(() => {
      expect(document.body.querySelector(".ndo")).toBeNull();
      expect(view.container.textContent).not.toContain("已编辑记忆摘要");
    });

    view.unmount();
  });
});

describe("memory visual profile resolver", () => {
  it("优先为启动、后台和高负载场景切换不同性能档位，并保持点击时视觉密度稳定", () => {
    expect(
      resolveMemoryVisualProfile({
        isDark: true,
        isVisible: true,
        devicePixelRatio: 1,
        prefersReducedMotion: false,
        interactionActive: false,
        booting: true,
      }).mode,
    ).toBe("startup");

    expect(
      resolveMemoryVisualProfile({
        isDark: true,
        isVisible: true,
        devicePixelRatio: 1,
        prefersReducedMotion: false,
        interactionActive: true,
        booting: false,
      }).mode,
    ).toBe("full");

    expect(
      resolveMemoryVisualProfile({
        isDark: true,
        isVisible: true,
        devicePixelRatio: 2,
        prefersReducedMotion: false,
        interactionActive: true,
        booting: false,
      }).mode,
    ).toBe("balanced");

    expect(
      resolveMemoryVisualProfile({
        isDark: true,
        isVisible: false,
        devicePixelRatio: 1,
        prefersReducedMotion: false,
        interactionActive: false,
        booting: false,
      }).mode,
    ).toBe("light");
  });

  it("按批次扩展背景对象池，避免首次进入时同步创建完整场景", () => {
    const startupGrowth = expandMemoryVisualObjectCounts(
      createMemoryVisualObjectCounts(),
      MEMORY_VISUAL_PROFILES.startup,
      "immediate",
    );

    expect(startupGrowth.completed).toBe(true);
    expect(startupGrowth.next).toEqual({
      stars: 90,
      nebulae: 2,
      ribbons: 2,
      sparkles: 48,
      clouds: 4,
    });

    const deferredFullGrowth = expandMemoryVisualObjectCounts(
      startupGrowth.next,
      MEMORY_VISUAL_PROFILES.full,
      "deferred",
    );

    expect(deferredFullGrowth.completed).toBe(false);
    expect(deferredFullGrowth.next.stars).toBeGreaterThan(startupGrowth.next.stars);
    expect(deferredFullGrowth.next.stars).toBeLessThan(MEMORY_VISUAL_PROFILES.full.stars);
    expect(deferredFullGrowth.next.sparkles).toBeGreaterThan(startupGrowth.next.sparkles);
    expect(deferredFullGrowth.next.sparkles).toBeLessThan(MEMORY_VISUAL_PROFILES.full.sparkles);

    let current = deferredFullGrowth.next;
    for (let index = 0; index < 8; index += 1) {
      const growth = expandMemoryVisualObjectCounts(current, MEMORY_VISUAL_PROFILES.full, "deferred");
      current = growth.next;
      if (growth.completed) {
        break;
      }
    }

    expect(current).toEqual({
      stars: 260,
      nebulae: 6,
      ribbons: 4,
      sparkles: 180,
      clouds: 9,
    });
  });
});
