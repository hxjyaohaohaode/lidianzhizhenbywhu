import { randomUUID } from "node:crypto";

import type {
  DiagnosticWorkflowResponse,
  EvidenceReviewOutput,
  FocusMode,
  IndustryRetrievalOutput,
  MathAnalysisOutput,
} from "../shared/agents.js";
import {
  investorAttachmentUploadRequestSchema,
  enterpriseAttachmentUploadRequestSchema,
  enterpriseAnalysisRequestSchema,
  enterpriseCollectionRequestSchema,
  enterpriseConfidentialityNotice,
  historyViewerSchema,
  investorAnalysisRequestSchema,
  investorSessionBatchDeleteRequestSchema,
  investorSessionCreateRequestSchema,
  investorSessionDeleteRequestSchema,
  investorModeSwitchRequestSchema,
  investorProfileRequestSchema,
  privateMemoryDeleteRequestSchema,
  privateMemoryUpdateRequestSchema,
  privateMemoryWriteRequestSchema,
  userIdentityBootstrapRequestSchema,
  userPreferencesUpdateRequestSchema,
  userFeedbackRequestSchema,
  type AnalysisTimelineEntry,
  type DebateMessage,
  type DebateRound,
  type EnterpriseCollectionRequest,
  type EnterpriseAttachmentUploadRequest,
  type EnterpriseAnalysisStreamEvent,
  type InvestorAnalysisRequest,
  type InvestorAnalysisStreamEvent,
  type InvestorAttachmentUploadRequest,
  type InvestorProfileRequest,
  type ProfileInsight,
  type ProfileUpdateReceipt,
  type SessionContext,
  type SessionHistorySummary,
  type SessionAttachment,
  type SessionEvent,
  type UserProfileResponse,
} from "../shared/business.js";
import type { ServerEnv } from "../shared/config.js";
import type { ModelGovernance } from "../shared/diagnostics.js";
import { AppError } from "./errors.js";
import { DiagnosticWorkflowService } from "./agent-service.js";
import { createLogger } from "./logger.js";
import type { Logger } from "pino";
import { InMemoryMemoryStore } from "./memory.js";
import { PlatformStore, type PersistedUserRecord, type ChatMessage } from "./platform-store.js";
import { InMemorySessionStore } from "./session-store.js";

type BusinessPortalDependencies = {
  memoryStore?: InMemoryMemoryStore;
  sessionStore?: InMemorySessionStore;
  workflowService?: DiagnosticWorkflowService;
  platformStore?: PlatformStore;
  modelRouter?: import("./llm.js").ModelRouter;
  logger?: Logger;
};

type RecommendationStance = "推荐关注" | "谨慎跟踪" | "暂缓配置";
type DebateModel = "deepseekReasoner" | "glm5" | "qwen35Plus";
type InvestorAnalysisResponsePayload = {
  sessionContext: SessionContext;
  diagnostic: DiagnosticWorkflowResponse;
  recommendation: ReturnType<typeof buildRecommendation>;
  deepDive: ReturnType<typeof buildDeepDive>;
  industryReport: {
    overview: string;
    keyDrivers: string[];
    risks: string[];
    opportunities: string[];
    evidenceSources: string[];
  };
  debate: {
    rounds: DebateRound[];
    finalDecision: string;
    summary: string;
  };
  timeline: AnalysisTimelineEntry[];
  evidenceSummary: string[];
  usedAttachments: SessionAttachment[];
  profileUpdate?: ProfileUpdateReceipt;
  personalization: {
    summary: string;
    serviceHints: string[];
  };
};

function createInvalidRequestError(details: unknown) {
  return new AppError({
    code: "INVALID_REQUEST",
    message: "请求参数校验失败。",
    statusCode: 400,
    details,
  });
}

function createNotFoundError(message: string) {
  return new AppError({
    code: "NOT_FOUND",
    message,
    statusCode: 404,
  });
}

function parseSchema<T>(payload: unknown, parser: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ path: Array<string | number>; message: string }> } } }) {
  const parsed = parser.safeParse(payload);

  if (parsed.success) {
    return parsed.data;
  }

  throw createInvalidRequestError(
    parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  );
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function mergeBusinessInfo(
  current: PersistedUserRecord["enterpriseBaseInfo"],
  incoming?: PersistedUserRecord["enterpriseBaseInfo"],
) {
  if (!incoming) {
    return current ?? {};
  }

  return {
    ...(current ?? {}),
    ...incoming,
  };
}

function createSessionEvent(type: SessionEvent["type"], summary: string): SessionEvent {
  return {
    id: randomUUID(),
    type,
    summary,
    occurredAt: new Date().toISOString(),
  };
}

function getMathAnalysisOutput(diagnostic: DiagnosticWorkflowResponse) {
  return diagnostic.agents.find((agent) => agent.agentId === "mathAnalysis")
    ?.output as MathAnalysisOutput | undefined;
}

function getEvidenceReviewOutput(diagnostic: DiagnosticWorkflowResponse) {
  return diagnostic.agents.find((agent) => agent.agentId === "evidenceReview")
    ?.output as EvidenceReviewOutput | undefined;
}

function buildEnterpriseCollectionSummary(input: EnterpriseCollectionRequest) {
  const capturedModules = uniqueStrings([
    input.grossMarginInput ? "毛利承压" : "",
    input.operatingQualityInput ? "经营质量" : "",
    input.industryContext ? "行业上下文" : "",
  ]);
  const limitations = uniqueStrings([
    input.hasFullQuarterHistory ? "" : "缺少完整近四季度历史，仅能进行基线对比分析",
    input.grossMarginInput ? "" : "缺少毛利承压模型输入",
    input.operatingQualityInput ? "" : "缺少经营质量模型输入",
    input.industryContext ? "" : "缺少行业需求、材料成本或政策信号",
  ]);

  return {
    confidentialityNotice: enterpriseConfidentialityNotice,
    historyCoverage: input.hasFullQuarterHistory ? "fullHistory" : "baselineComparison",
    capturedModules,
    quarterScope: {
      currentQuarter: input.currentQuarterLabel,
      baselineQuarter: input.baselineQuarterLabel,
      recentQuarterLabels: input.recentQuarterLabels,
    },
    confidenceLabel: limitations.length === 0 ? "high" : limitations.length <= 2 ? "medium" : "low",
    limitations,
  };
}

function buildInvestorProfileSummary(input: InvestorProfileRequest) {
  const enterpriseCount = input.investedEnterprises.length;
  const capitalCostSummary =
    input.capitalCostRate >= 12
      ? "资金成本偏高，更适合高确定性标的"
      : input.capitalCostRate >= 8
        ? "资金成本处于中位，需要兼顾赔率与胜率"
        : "资金成本较低，可容纳更长期的验证周期";
  const horizonSummary =
    input.investmentHorizon === "short"
      ? "偏好短周期催化"
      : input.investmentHorizon === "medium"
        ? "偏好中周期景气兑现"
        : "偏好长周期能力建设";

  return `当前已跟踪 ${enterpriseCount} 家企业，风险偏好为 ${input.riskAppetite}，${capitalCostSummary}，${horizonSummary}。`;
}

function getRecommendedMode(input: InvestorProfileRequest): FocusMode {
  if (input.interests.some((item) => item.includes("深度") || item.includes("基本面"))) {
    return "deepDive";
  }

  if (input.interests.some((item) => item.includes("行业") || item.includes("景气"))) {
    return "industryStatus";
  }

  return "investmentRecommendation";
}

function buildModeSummary(mode: FocusMode, enterpriseName?: string) {
  if (mode === "industryStatus") {
    return "已切换到行业状况分析模式，优先输出景气、供需与政策信号。";
  }

  if (mode === "deepDive") {
    return `已切换到深度解析模式${enterpriseName ? `，聚焦 ${enterpriseName}` : ""}，优先展开盈利质量、经营韧性与证据链复核。`;
  }

  return `已切换到投资推荐模式${enterpriseName ? `，聚焦 ${enterpriseName}` : ""}，优先输出可执行配置建议。`;
}

function buildWorkflowMemoryNotes(userId: string, baseNotes: string[], session?: SessionContext, memoryStore?: InMemoryMemoryStore, role?: string) {
  return uniqueStrings([
    ...baseNotes,
    session ? `会话上下文：${session.summary}` : "",
    ...(memoryStore?.list(userId, 5, role).map((entry) => `历史记忆：${entry.summary}`) ?? []),
  ]).slice(0, 6);
}

function buildRecommendation(
  profile: InvestorProfileRequest | undefined,
  diagnostic: DiagnosticWorkflowResponse,
  userRecord?: PersistedUserRecord,
) {
  const mathAnalysis = getMathAnalysisOutput(diagnostic);
  const evidenceReview = getEvidenceReviewOutput(diagnostic);
  let score = 60;

  if (mathAnalysis?.combinedRiskLevel === "low") {
    score += 16;
  } else if (mathAnalysis?.combinedRiskLevel === "medium") {
    score += 4;
  } else {
    score -= 14;
  }

  if ((evidenceReview?.confidenceScore ?? 0.6) >= 0.76) {
    score += 10;
  } else if ((evidenceReview?.confidenceScore ?? 0.6) < 0.56) {
    score -= 8;
  }

  if (profile) {
    score += profile.riskAppetite === "high" ? 6 : profile.riskAppetite === "medium" ? 2 : -4;
    score -= profile.capitalCostRate >= 12 ? 6 : profile.capitalCostRate >= 8 ? 3 : 0;
  }

  score += Math.min(6, (userRecord?.feedback.averageRating ?? 0) * 1.2);

  const boundedScore = Math.max(0, Math.min(100, score));
  const stance: RecommendationStance =
    boundedScore >= 74 ? "推荐关注" : boundedScore >= 58 ? "谨慎跟踪" : "暂缓配置";
  const fitSignals = uniqueStrings([
    mathAnalysis?.combinedRiskLevel
      ? `综合经营风险为 ${mathAnalysis.combinedRiskLevel}`
      : "暂缺经营风险评分",
    evidenceReview?.confidence
      ? `证据可信度为 ${evidenceReview.confidence}`
      : "证据可信度仍需补强",
    profile ? `投资画像风险偏好为 ${profile.riskAppetite}` : "",
    profile?.capitalCostRate !== undefined ? `资金成本为 ${profile.capitalCostRate}%` : "",
  ]).slice(0, 4);

  return {
    stance,
    score: boundedScore,
    fitSignals,
    rationale: `${stance}，当前评分 ${boundedScore}，建议结合现金流质量、订单兑现率和外部景气信号持续验证。${userRecord?.behaviorSummary ? ` 用户画像：${userRecord.behaviorSummary}。` : ""}`,
  };
}

function buildDeepDive(diagnostic: DiagnosticWorkflowResponse) {
  const mathAnalysis = getMathAnalysisOutput(diagnostic);
  const evidenceReview = getEvidenceReviewOutput(diagnostic);

  return {
    thesis: diagnostic.summary,
    modules: [
      {
        name: "盈利与毛利韧性",
        summary:
          mathAnalysis?.grossMargin?.trend.summary ?? "缺少毛利承压输入，无法形成盈利韧性判断。",
      },
      {
        name: "经营质量与现金流",
        summary:
          mathAnalysis?.operatingQuality?.trend.summary ?? "缺少经营质量输入，需补充现金流与杠杆数据。",
      },
      {
        name: "外部证据与可信度",
        summary:
          evidenceReview?.reviewSummary ?? "当前主要依赖结构化输入，外部证据闭环仍需补充。",
      },
    ],
    challengedClaims: evidenceReview?.challengedClaims ?? [],
  };
}

function getIndustryRetrievalOutput(diagnostic: DiagnosticWorkflowResponse) {
  return diagnostic.agents.find((agent) => agent.agentId === "industryRetrieval")
    ?.output as IndustryRetrievalOutput | undefined;
}

function buildEvidenceSummary(diagnostic: DiagnosticWorkflowResponse) {
  const evidenceReview = getEvidenceReviewOutput(diagnostic);
  const industryRetrieval = getIndustryRetrievalOutput(diagnostic);

  return uniqueStrings([
    ...(evidenceReview?.verifiedClaims ?? []).slice(0, 2),
    ...(evidenceReview?.challengedClaims ?? []).slice(0, 1).map((item) => `待继续验证：${item}`),
    ...(industryRetrieval?.evidence ?? []).slice(0, 2).map((item) => `${item.source}：${item.finding}`),
  ]).slice(0, 4);
}

function createTimelineEntry(
  stage: AnalysisTimelineEntry["stage"],
  label: string,
  progressPercent: number,
  detail?: string,
): AnalysisTimelineEntry {
  return {
    id: randomUUID(),
    stage,
    label,
    status: "completed",
    detail,
    progressPercent,
    occurredAt: new Date().toISOString(),
  };
}

function buildTimeline(
  focusMode: FocusMode,
  attachmentCount: number,
  hasProfileUpdate: boolean,
  clarificationQuestions: string[] = [],
) {
  if (focusMode === "industryStatus") {
    return [
      createTimelineEntry("session", "加载会话上下文", 8, attachmentCount > 0 ? `已注入 ${attachmentCount} 个附件摘要` : "未附带附件"),
      createTimelineEntry("understanding", "理解行业问题", 24, "整理景气、供需与政策线索"),
      createTimelineEntry("retrieval", "检索外部证据", 52, "整合行业检索与证据摘要"),
      createTimelineEntry("feasibility", "判断可行性与分歧", 76, "区分外部事实与模型推断"),
      createTimelineEntry("writing", "生成行业报告", 92, "输出行业现状、驱动、风险与机会"),
      ...(hasProfileUpdate ? [createTimelineEntry("profile_update", "沉淀用户画像", 97, "写入长期关注主题")] : []),
      createTimelineEntry("completed", "完成行业状况分析", 100),
    ];
  }

  if (focusMode === "deepDive") {
    return [
      createTimelineEntry(
        "clarification",
        "确认研究边界",
        clarificationQuestions.length > 0 ? 18 : 24,
        clarificationQuestions.length > 0 ? `仍待补充 ${clarificationQuestions.length} 个关键条件` : "已具备研究范围、时间窗口与风险边界",
      ),
      createTimelineEntry("retrieval", "检索研究资料", clarificationQuestions.length > 0 ? 34 : 52, "汇总外部证据与历史记忆"),
      createTimelineEntry("evidence", "整理证据链", clarificationQuestions.length > 0 ? 48 : 74, "核对关键结论与反证"),
      createTimelineEntry("writing", "撰写研究报告", clarificationQuestions.length > 0 ? 65 : 92, "形成问题、假设、发现与建议"),
      ...(hasProfileUpdate ? [createTimelineEntry("profile_update", "沉淀用户画像", clarificationQuestions.length > 0 ? 78 : 97)] : []),
      createTimelineEntry("completed", clarificationQuestions.length > 0 ? "输出澄清问题" : "完成深度解析", 100),
    ];
  }

  return [
    createTimelineEntry("session", "加载会话上下文", 8, attachmentCount > 0 ? `已注入 ${attachmentCount} 个附件摘要` : "未附带附件"),
    createTimelineEntry("debate", "进行第一轮辩论", 30, "GLM 与 DeepSeek 对决，Qwen 裁决"),
    createTimelineEntry("debate", "进行第二轮辩论", 56, "DeepSeek 与 Qwen 对决，GLM 裁决"),
    createTimelineEntry("debate", "进行第三轮辩论", 82, "GLM 与 Qwen 对决，DeepSeek 裁决"),
    createTimelineEntry("writing", "总结最终方案", 93, "综合三轮辩论与现实信息"),
    ...(hasProfileUpdate ? [createTimelineEntry("profile_update", "沉淀用户画像", 97, "记录目标、偏好与决策习惯")] : []),
    createTimelineEntry("completed", "完成投资建议辩论", 100),
  ];
}

function inferMimeType(fileName: string, mimeType?: string) {
  if (mimeType) {
    return mimeType;
  }

  const lower = fileName.toLowerCase();

  if (lower.endsWith(".json")) {
    return "application/json";
  }

  if (lower.endsWith(".csv")) {
    return "text/csv";
  }

  if (lower.endsWith(".md")) {
    return "text/markdown";
  }

  return "text/plain";
}

function buildAttachmentSummary(input: { fileName: string; mimeType?: string; content: string; sessionId: string; userId: string }) {
  const mimeType = inferMimeType(input.fileName, input.mimeType);
  const normalizedContent = input.content.replace(/\s+/g, " ").trim();
  const excerpt = normalizedContent.slice(0, 220);
  const sizeBytes = Buffer.byteLength(input.content, "utf8");
  const warnings: string[] = [];
  let status: SessionAttachment["status"] = "ready";
  let summary = `${input.fileName} 已完成解析。`;

  if (mimeType === "application/json") {
    try {
      const parsed = JSON.parse(input.content) as Record<string, unknown>;
      const keys = Object.keys(parsed).slice(0, 5);
      summary = `${input.fileName} 识别为 JSON，关键字段：${keys.join("、") || "空对象"}。`;
    } catch {
      status = "metadata_only";
      warnings.push("JSON 解析失败，已降级为文本摘要。");
      summary = `${input.fileName} JSON 解析失败，已按原文摘要纳入上下文。`;
    }
  } else if (mimeType === "text/csv") {
    const [header, firstRow] = input.content.split(/\r?\n/);
    const columns = header?.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 6) ?? [];
    summary = `${input.fileName} 识别为表格，字段包含 ${columns.join("、") || "未知字段"}${firstRow ? "，已抓取首行样本" : ""}。`;
  } else if (!mimeType.startsWith("text/")) {
    status = "metadata_only";
    warnings.push("当前文件类型暂不支持结构化解析，仅保留元数据与片段摘要。");
    summary = `${input.fileName} 已接收，但当前仅支持保留文件元数据与文本片段。`;
  }

  return {
    attachmentId: randomUUID(),
    sessionId: input.sessionId,
    userId: input.userId,
    fileName: input.fileName,
    mimeType,
    sizeBytes,
    status,
    summary,
    excerpt,
    tags: uniqueStrings(
      [
        input.fileName,
        excerpt.includes("现金流") ? "现金流" : "",
        excerpt.includes("景气") ? "行业景气" : "",
        excerpt.includes("储能") ? "储能" : "",
        excerpt.includes("海外") ? "海外" : "",
      ].map((item) => item.replace(/\.[^.]+$/, "")),
    ).slice(0, 6),
    warnings,
    uploadedAt: new Date().toISOString(),
  } satisfies SessionAttachment;
}

function normalizeProfileClause(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 36);
}

function buildProfileUpdate(input: {
  query: string;
  memoryNotes: string[];
  deepDiveContext?: InvestorAnalysisRequest["deepDiveContext"];
  attachments: SessionAttachment[];
  profile?: InvestorProfileRequest;
  userRecord?: PersistedUserRecord;
}) {
  const sources = [
    input.query,
    ...input.memoryNotes,
    input.deepDiveContext?.objective ?? "",
    input.deepDiveContext?.timeWindow ?? "",
    input.deepDiveContext?.riskBoundary ?? "",
    ...(input.deepDiveContext?.constraints ?? []),
    ...(input.deepDiveContext?.answeredQuestions ?? []),
    ...input.attachments.map((item) => `${item.summary} ${item.excerpt ?? ""}`),
  ]
    .join("；")
    .replace(/\s+/g, " ");
  const extractedInsights: ProfileInsight[] = [];
  let riskAppetite = input.profile?.riskAppetite ?? input.userRecord?.preferences.riskAppetite;
  let investmentHorizon = input.profile?.investmentHorizon ?? input.userRecord?.preferences.investmentHorizon;

  if (!riskAppetite && /稳健|保守|下行保护|低回撤|确定性/.test(sources)) {
    riskAppetite = "low";
    extractedInsights.push({ category: "riskAppetite", value: "low", confidence: "high", source: "query" });
  } else if (!riskAppetite && /平衡|兼顾|赔率与胜率|中性/.test(sources)) {
    riskAppetite = "medium";
    extractedInsights.push({ category: "riskAppetite", value: "medium", confidence: "medium", source: "query" });
  } else if (!riskAppetite && /激进|高弹性|进攻|高波动/.test(sources)) {
    riskAppetite = "high";
    extractedInsights.push({ category: "riskAppetite", value: "high", confidence: "medium", source: "query" });
  }

  if (!investmentHorizon && /长期|两年|三年|长期持有/.test(sources)) {
    investmentHorizon = "long";
    extractedInsights.push({ category: "investmentHorizon", value: "long", confidence: "high", source: "query" });
  } else if (!investmentHorizon && /一年|中期|12个月/.test(sources)) {
    investmentHorizon = "medium";
    extractedInsights.push({ category: "investmentHorizon", value: "medium", confidence: "medium", source: "query" });
  } else if (!investmentHorizon && /短线|季度|一个月|短周期/.test(sources)) {
    investmentHorizon = "short";
    extractedInsights.push({ category: "investmentHorizon", value: "short", confidence: "medium", source: "query" });
  }

  const interests = uniqueStrings([
    ...(input.profile?.interests ?? []),
    ...(input.userRecord?.preferences.interests ?? []),
    /行业|景气/.test(sources) ? "行业景气" : "",
    /现金流/.test(sources) ? "现金流质量" : "",
    /储能/.test(sources) ? "储能需求" : "",
    /海外/.test(sources) ? "海外订单" : "",
    /估值/.test(sources) ? "估值性价比" : "",
    /技术|路线/.test(sources) ? "技术路线" : "",
  ]).slice(0, 12);

  interests
    .filter((item) => ![...(input.profile?.interests ?? []), ...(input.userRecord?.preferences.interests ?? [])].includes(item))
    .forEach((item) => {
      extractedInsights.push({ category: "interest", value: item, confidence: "medium", source: "query" });
    });

  const goals = uniqueStrings(
    sources
      .split(/[；。！？\n]/)
      .map((item) => normalizeProfileClause(item))
      .filter((item) => /(目标|希望|优先|计划|想要|重点看)/.test(item)),
  ).slice(0, 6);
  const constraints = uniqueStrings(
    sources
      .split(/[；。！？\n]/)
      .map((item) => normalizeProfileClause(item))
      .filter((item) => /(限制|约束|不接受|不希望|只看|回撤|止损|仓位|下行)/.test(item)),
  ).slice(0, 6);
  const decisionStyleHints = uniqueStrings(
    sources
      .split(/[；。！？\n]/)
      .map((item) => normalizeProfileClause(item))
      .filter((item) => /(分批|先验证|等待催化|证据优先|左侧|右侧|观察清单)/.test(item)),
  ).slice(0, 6);

  goals.forEach((item) => {
    extractedInsights.push({ category: "goal", value: item, confidence: "medium", source: "clarification" });
  });
  constraints.forEach((item) => {
    extractedInsights.push({ category: "constraint", value: item, confidence: "medium", source: "clarification" });
  });
  decisionStyleHints.forEach((item) => {
    extractedInsights.push({ category: "decisionStyle", value: item, confidence: "medium", source: "query" });
  });

  const updatedFields = uniqueStrings([
    riskAppetite !== input.userRecord?.preferences.riskAppetite && riskAppetite ? "riskAppetite" : "",
    investmentHorizon !== input.userRecord?.preferences.investmentHorizon && investmentHorizon
      ? "investmentHorizon"
      : "",
    interests.some((item) => !(input.userRecord?.preferences.interests ?? []).includes(item)) ? "interests" : "",
    goals.length > 0 ? "goals" : "",
    constraints.length > 0 ? "constraints" : "",
    decisionStyleHints.length > 0 ? "decisionStyleHints" : "",
  ]);
  const summary =
    updatedFields.length === 0
      ? "本轮未识别新的长期画像信息。"
      : `已自动沉淀画像：${updatedFields.join("、")}。`;

  return {
    riskAppetite,
    investmentHorizon,
    interests,
    goals,
    constraints,
    decisionStyleHints,
    attentionTags: uniqueStrings([...interests, ...constraints, ...goals]).slice(0, 12),
    receipt:
      updatedFields.length > 0
        ? {
            summary,
            updatedFields,
            extractedInsights,
          }
        : undefined,
  };
}

function buildClarificationQuestions(
  input: InvestorAnalysisRequest,
  userRecord?: PersistedUserRecord,
) {
  if (input.focusMode !== "deepDive") {
    return [];
  }

  const questions: string[] = [];
  const objective = input.deepDiveContext?.objective;
  const timeWindow = input.deepDiveContext?.timeWindow ?? userRecord?.preferences.investmentHorizon;
  const riskBoundary = input.deepDiveContext?.riskBoundary ?? userRecord?.preferences.riskAppetite;

  if (!objective) {
    questions.push("请确认本次深度解析最核心的研究目标，例如估值判断、竞争格局还是现金流验证。");
  }

  if (!timeWindow) {
    questions.push("请补充研究时间窗口，例如未来一个季度、一年或三年。");
  }

  if (!riskBoundary) {
    questions.push("请说明可接受的风险边界或最关注的下行情景。");
  }

  return questions.slice(0, 3);
}

function buildIndustryReport(
  diagnostic: DiagnosticWorkflowResponse,
  attachments: SessionAttachment[],
  userRecord?: PersistedUserRecord,
) {
  const retrieval = getIndustryRetrievalOutput(diagnostic);
  const evidenceReview = getEvidenceReviewOutput(diagnostic);
  const mathAnalysis = getMathAnalysisOutput(diagnostic);

  return {
    overview: retrieval?.synthesis ?? diagnostic.summary,
    keyDrivers: uniqueStrings([
      ...(retrieval?.evidence ?? []).slice(0, 2).map((item) => item.finding),
      ...(attachments[0] ? [`附件重点：${attachments[0].summary}`] : []),
      ...(userRecord?.preferences.interests ?? []).slice(0, 1).map((item) => `画像关注：${item}`),
    ]).slice(0, 4),
    risks: uniqueStrings([
      ...(evidenceReview?.challengedClaims ?? []).slice(0, 2),
      mathAnalysis?.combinedRiskLevel === "high" ? "经营风险仍偏高，景气改善需警惕兑现偏差" : "",
    ]).slice(0, 4),
    opportunities: uniqueStrings([
      ...(evidenceReview?.verifiedClaims ?? []).slice(0, 2),
      retrieval?.retrievalSummary ?? "",
    ]).slice(0, 4),
    evidenceSources: uniqueStrings([
      ...(retrieval?.citations ?? []).slice(0, 3).map((item) => item.title),
      ...(retrieval?.evidence ?? []).slice(0, 2).map((item) => item.source),
    ]).slice(0, 5),
  };
}

async function buildDebate(
  recommendation: ReturnType<typeof buildRecommendation>,
  diagnostic: DiagnosticWorkflowResponse,
  userRecord?: PersistedUserRecord,
  modelRouter?: import("./llm.js").ModelRouter,
  signal?: { aborted: boolean },
  logger?: Logger,
  enterpriseName?: string,
) {
  const modelLabel: Record<DebateModel, string> = { glm5: "GLM", deepseekReasoner: "DeepSeek", qwen35Plus: "Qwen" };
  const roundConfigs: Array<{ round: number; debaters: [DebateModel, DebateModel]; judge: DebateModel }> = [
    { round: 1, debaters: ["glm5", "deepseekReasoner"], judge: "qwen35Plus" },
    { round: 2, debaters: ["deepseekReasoner", "qwen35Plus"], judge: "glm5" },
    { round: 3, debaters: ["glm5", "qwen35Plus"], judge: "deepseekReasoner" },
  ];
  const mathAnalysis = diagnostic.agents.find((agent) => agent.agentId === "mathAnalysis")?.output as { dqiModel?: { dqi: number; status: string; driver: string }; gmpsModel?: { gmps: number; level: string; riskProbability: number }; grossMargin?: { riskLevel: string }; operatingQuality?: { riskLevel: string }; combinedRiskLevel: string; combinedInsights: string[] } | undefined;
  const dqiInfo = mathAnalysis?.dqiModel ? `DQI经营质量指数=${mathAnalysis.dqiModel.dqi.toFixed(3)}，状态="${mathAnalysis.dqiModel.status}"，驱动因素=${mathAnalysis.dqiModel.driver}` : "DQI数据不足";
  const gmpsInfo = mathAnalysis?.gmpsModel ? `GMPS毛利承压得分=${mathAnalysis.gmpsModel.gmps.toFixed(1)}，等级="${mathAnalysis.gmpsModel.level}"，风险概率=${(mathAnalysis.gmpsModel.riskProbability * 100).toFixed(1)}%` : "GMPS数据不足";
  const riskInfo = mathAnalysis?.combinedRiskLevel ? `综合风险等级=${mathAnalysis.combinedRiskLevel}` : "风险等级未知";
  const debateModelConstraint = `【辩论模型约束——所有辩论内容必须严格基于以下数学模型计算结果】

当前企业数学模型计算结果：
- ${dqiInfo}
- ${gmpsInfo}  
- ${riskInfo}

辩论主题仅限于以下四个方面：
1. 经营质量变化的驱动因素分析（基于DQI分解：盈利能力w1=0.4、成长能力w2=0.3、现金流质量w3=0.3）
2. 毛利承压的来源归因分析（基于GMPS五维度得分：A毛利率结果、B材料成本冲击、C产销负荷、D外部风险、E现金流安全）
3. 下一季度风险预测的依据讨论（基于Logistic回归概率P=1/(1+exp(-(β0+β1·GMPS+Σβd·S_d)))）
4. 改善建议的优先级排序（基于DQI指数和GMPS等级的综合判断）

辩论引用要求：
- 每个论点必须引用具体模型名称（DQI或GMPS）和对应计算结果
- 禁止脱离模型数据的主观推测
- 示例："根据DQI模型，现金流质量维度贡献度为-0.15，表明OCF同比下滑是经营恶化的主因"`;
  const positiveCase = `支持当前建议"${recommendation.stance}"，理由是 ${recommendation.fitSignals[0] ?? "景气与经营质量共振"}，且 ${diagnostic.summary}`;
  const cautiousCase = `我保留审慎意见，主要担心 ${buildEvidenceSummary(diagnostic)[0] ?? "证据链仍有缺口"}，需要继续验证现金流与订单兑现。`;
  let llmAvailable = false;
  if (modelRouter) { try { llmAvailable = modelRouter.listProviders().some((p) => p.available); } catch { llmAvailable = false; } }
  if (!llmAvailable) {
    logger?.warn({ providers: modelRouter?.listProviders() }, "辩论AI不可用，将使用模板");
  }
  let sequence = 1;
  let previousRoundSummary = "";
  const rounds: DebateRound[] = [];
  const resolvedEnterpriseName = enterpriseName ?? "目标企业";
  for (const config of roundConfigs) {
    if (signal?.aborted) break;
    const [debaterA, debaterB] = config.debaters;
    let usedLlm = false;
    let msgA1 = "", msgB1 = "", msgA2 = "", msgB2 = "", msgJudge = "";
    if (llmAvailable && modelRouter) {
      try {
        const ctx = `企业：${resolvedEnterpriseName}，立场：${recommendation.stance}，理由：${recommendation.rationale}，证据：${buildEvidenceSummary(diagnostic).join("；")}，用户关注：${userRecord?.preferences.constraints[0] ?? "下行保护"}`;
        const prev = previousRoundSummary ? `\n前一轮辩论摘要：${previousRoundSummary}` : "";
        const modelPrompt = `\n${debateModelConstraint}`;
        logger?.info({ round: config.round, debaterA, debaterB, enterpriseName: resolvedEnterpriseName }, "开始辩论AI调用");
        const [rA1, rB1] = await Promise.all([
          modelRouter.complete({ agentId: "expressionGeneration", capability: "expression", prompt: `你是${modelLabel[debaterA]}辩手，支持立场"${recommendation.stance}"。基于以下信息陈述你的论点：${ctx}${prev}${modelPrompt}。请用2-3句话陈述你的核心论点，必须引用DQI或GMPS模型的具体计算结果。`, context: { query: recommendation.stance, enterpriseName: resolvedEnterpriseName, focusMode: "investmentRecommendation" }, preferredProviders: [debaterA] }).then((r) => { logger?.info({ round: config.round, debater: debaterA, textLength: r.result.text.length }, "辩手A1响应成功"); return r.result.text; }).catch((err) => { logger?.error({ err, round: config.round, debater: debaterA }, "辩论辩手A1调用失败"); return null; }),
          modelRouter.complete({ agentId: "expressionGeneration", capability: "expression", prompt: `你是${modelLabel[debaterB]}辩手，对立场"${recommendation.stance}"持审慎态度。基于以下信息提出你的质疑：${ctx}${prev}${modelPrompt}。请用2-3句话陈述你的核心质疑，必须引用DQI或GMPS模型的具体计算结果。`, context: { query: recommendation.stance, enterpriseName: resolvedEnterpriseName, focusMode: "investmentRecommendation" }, preferredProviders: [debaterB] }).then((r) => { logger?.info({ round: config.round, debater: debaterB, textLength: r.result.text.length }, "辩手B1响应成功"); return r.result.text; }).catch((err) => { logger?.error({ err, round: config.round, debater: debaterB }, "辩论辩手B1调用失败"); return null; }),
        ]);
        if (rA1 && rB1) {
          const rA2 = await modelRouter.complete({ agentId: "expressionGeneration", capability: "expression", prompt: `你是${modelLabel[debaterA]}辩手。对方质疑：${rB1}。请回应对方质疑并强化你的支持论点。${modelPrompt}。用2-3句话，必须引用模型数据支撑你的回应。`, context: { query: recommendation.stance, enterpriseName: resolvedEnterpriseName, focusMode: "investmentRecommendation" }, preferredProviders: [debaterA] }).then((r) => { logger?.info({ round: config.round, debater: debaterA, textLength: r.result.text.length }, "辩手A2响应成功"); return r.result.text; }).catch((err) => { logger?.error({ err, round: config.round, debater: debaterA }, "辩论辩手A2调用失败"); return null; });
          const rB2 = await modelRouter.complete({ agentId: "expressionGeneration", capability: "expression", prompt: `你是${modelLabel[debaterB]}辩手。对方回应：${rA2 ?? "对方坚持原有立场"}。请做最后反驳。${modelPrompt}。用2-3句话，必须引用模型数据支撑你的反驳。`, context: { query: recommendation.stance, enterpriseName: resolvedEnterpriseName, focusMode: "investmentRecommendation" }, preferredProviders: [debaterB] }).then((r) => { logger?.info({ round: config.round, debater: debaterB, textLength: r.result.text.length }, "辩手B2响应成功"); return r.result.text; }).catch((err) => { logger?.error({ err, round: config.round, debater: debaterB }, "辩论辩手B2调用失败"); return null; });
          const rJ = await modelRouter.complete({ agentId: "expressionGeneration", capability: "review", prompt: `你是${modelLabel[config.judge]}裁判。正方论点：${rA1}，反方质疑：${rB1}，正方回应：${rA2 ?? ""}，反方反驳：${rB2 ?? ""}。${modelPrompt}。请做出裁决，指出双方优劣，给出最终判断。用2-3句话，基于模型数据评估辩论质量。`, context: { query: recommendation.stance, enterpriseName: resolvedEnterpriseName, focusMode: "investmentRecommendation" }, preferredProviders: [config.judge] }).then((r) => { logger?.info({ round: config.round, judge: config.judge, textLength: r.result.text.length }, "裁判响应成功"); return r.result.text; }).catch((err) => { logger?.error({ err, round: config.round, judge: config.judge }, "辩论裁判调用失败"); return null; });
          if (rJ) { msgA1 = rA1; msgB1 = rB1; msgA2 = rA2 ?? `我承认对方指出的局限成立，但优势在于 ${recommendation.fitSignals[1] ?? "证据可信度尚可"}。`; msgB2 = rB2 ?? `我复述对方优势：经营风险并未失控，且存在改善信号；但局限在于外部证据更新仍不足。`; msgJudge = rJ; usedLlm = true; logger?.info({ round: config.round }, "辩论轮次AI调用成功"); }
        } else {
          logger?.warn({ round: config.round, rA1: !!rA1, rB1: !!rB1 }, "辩论首轮AI调用失败，回退到模板");
        }
      } catch (err) { 
        logger?.error({ err }, "辩论AI调用异常");
        usedLlm = false; 
      }
    }
    if (!usedLlm) {
      msgA1 = `${positiveCase} 本轮由我先陈述，看多逻辑集中在 ${recommendation.rationale}`;
      msgB1 = `${cautiousCase} 如果用户更重视${userRecord?.preferences.constraints[0] ?? "下行保护"}，当前结论仍需保守处理。`;
      msgA2 = `我承认对方指出的局限成立，但优势在于 ${recommendation.fitSignals[1] ?? "证据可信度尚可"}。对方忽略了需求与盈利修复的同步性。`;
      msgB2 = `我复述对方优势：经营风险并未失控，且存在改善信号；但局限在于外部证据更新仍不足，我反对过早下结论。`;
      msgJudge = `本轮裁决：维持"${recommendation.stance}"方向，但要求继续跟踪 ${buildEvidenceSummary(diagnostic)[0] ?? "关键反证"}。`;
    }
    const source: "llm" | "template" = usedLlm ? "llm" : "template";
    const messages: DebateMessage[] = [
      { id: randomUUID(), round: config.round, speakerRole: "debater", speakerModel: debaterA, speakerLabel: `${modelLabel[debaterA]} 辩手`, sequence: sequence++, content: msgA1, occurredAt: new Date().toISOString(), source },
      { id: randomUUID(), round: config.round, speakerRole: "debater", speakerModel: debaterB, speakerLabel: `${modelLabel[debaterB]} 辩手`, sequence: sequence++, content: msgB1, occurredAt: new Date().toISOString(), source },
      { id: randomUUID(), round: config.round, speakerRole: "debater", speakerModel: debaterA, speakerLabel: `${modelLabel[debaterA]} 辩手`, sequence: sequence++, content: msgA2, occurredAt: new Date().toISOString(), source },
      { id: randomUUID(), round: config.round, speakerRole: "debater", speakerModel: debaterB, speakerLabel: `${modelLabel[debaterB]} 辩手`, sequence: sequence++, content: msgB2, occurredAt: new Date().toISOString(), source },
      { id: randomUUID(), round: config.round, speakerRole: "judge", speakerModel: config.judge, speakerLabel: `${modelLabel[config.judge]} 裁判`, sequence: sequence++, content: msgJudge, occurredAt: new Date().toISOString(), source },
    ];
    previousRoundSummary = `正方：${msgA1.slice(0, 80)}；反方：${msgB1.slice(0, 80)}；裁判：${msgJudge.slice(0, 80)}`;
    rounds.push({ round: config.round, debaters: config.debaters, judge: config.judge, verdict: msgJudge, messages, degraded: !usedLlm } satisfies DebateRound);
  }
  return {
    rounds,
    finalDecision: `总结结果确定方案：${recommendation.stance}。由 DeepSeek 综合三轮辩论与现实信息，建议围绕 ${recommendation.fitSignals.slice(0, 2).join("、") || "证据强度"} 制定后续动作。`,
    summary: `三轮正式辩论完成，最终结论为 ${recommendation.stance}。`,
  };
}

type DebateResult = { rounds: DebateRound[]; finalDecision: string; summary: string };

function flattenDebateMessages(debate: DebateResult) {
  const transitions: DebateMessage[] = [];

  debate.rounds.forEach((round, index) => {
    if (index > 0) {
      transitions.push({
        id: randomUUID(),
        round: round.round,
        speakerRole: "system",
        speakerModel: "system",
        speakerLabel: "系统",
        sequence: (round.messages[0]?.sequence ?? 1) - 1,
        content: round.round === 2 ? "辩手与裁判换位，进行第二轮辩论" : "辩手与裁判换位，进行最后一轮辩论",
        occurredAt: new Date().toISOString(),
      });
    }
  });

  return [...debate.rounds.flatMap((round) => round.messages), ...transitions].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

function chunkText(text: string, size = 70) {
  const chunks: string[] = [];

  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }

  return chunks.filter((item) => item.length > 0);
}

function createUserRecord(userId: string): PersistedUserRecord {
  const now = new Date().toISOString();
  return {
    userId,
    identitySource: "generated",
    createdAt: now,
    lastActiveAt: now,
    roles: [],
    enterpriseNames: [],
    investedEnterprises: [],
    enterpriseBaseInfo: {},
    investorBaseInfo: {},
    preferences: {
      themeMode: "system",
      themeColor: "#8b5cf6",
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
  };
}

export class BusinessPortalService {
  private readonly memoryStore: InMemoryMemoryStore;

  private readonly sessionStore: InMemorySessionStore;

  private readonly workflowService: DiagnosticWorkflowService;

  private readonly platformStore: PlatformStore;

  private readonly modelRouter?: import("./llm.js").ModelRouter;

  private readonly logger: Logger;

  constructor(env: ServerEnv, dependencies: BusinessPortalDependencies = {}) {
    this.platformStore = dependencies.platformStore ?? new PlatformStore(env.STORAGE_DIR);
    this.memoryStore = dependencies.memoryStore ?? new InMemoryMemoryStore(this.platformStore);
    this.sessionStore = dependencies.sessionStore ?? new InMemorySessionStore(this.platformStore);
    this.workflowService =
      dependencies.workflowService ??
      new DiagnosticWorkflowService(env, {
        memoryStore: this.memoryStore,
        platformStore: this.platformStore,
      });
    this.modelRouter = dependencies.modelRouter;
    this.logger = dependencies.logger ?? createLogger(env);
  }

  private async touchUserProfile(input: {
    userId: string;
    role?: "enterprise" | "investor";
    displayName?: string;
    identitySource?: "generated" | "provided";
    preferredRole?: "enterprise" | "investor";
    themeMode?: "light" | "dark" | "system";
    themeColor?: string;
    enterpriseName?: string;
    investedEnterprises?: string[];
    focusMode?: FocusMode;
    focusModes?: FocusMode[];
    profileSummary?: string;
    behaviorSummary?: string;
    attentionTags?: string[];
    riskAppetite?: string;
    investmentHorizon?: string;
    interests?: string[];
    goals?: string[];
    constraints?: string[];
    decisionStyleHints?: string[];
    enterpriseBaseInfo?: PersistedUserRecord["enterpriseBaseInfo"];
    investorBaseInfo?: PersistedUserRecord["investorBaseInfo"];
    replaceBaseInfo?: boolean;
    amountUnit?: "yuan" | "wan" | "yi";
    percentageUnit?: "percent" | "decimal";
    volumeUnit?: "piece" | "k" | "m";
  }) {
    return await this.platformStore.upsertUser(input.userId, (current) => {
      const fallback = createUserRecord(input.userId);
      const base = current
        ? {
            ...fallback,
            ...current,
            preferences: {
              ...fallback.preferences,
              ...current.preferences,
            },
            feedback: {
              ...fallback.feedback,
              ...current.feedback,
            },
          }
        : fallback;
      const roles = input.role
        ? (uniqueStrings([...base.roles, input.role]) as PersistedUserRecord["roles"])
        : base.roles;
      let behaviorSummary = input.behaviorSummary ?? base.behaviorSummary;

      if (!input.behaviorSummary && input.role === "investor") {
        behaviorSummary = `偏好 ${input.riskAppetite ?? base.preferences.riskAppetite ?? "medium"} 风险，重点关注 ${uniqueStrings(input.interests ?? base.preferences.interests).slice(0, 2).join("、") || "景气与现金流"}，约束 ${uniqueStrings(input.constraints ?? base.preferences.constraints).slice(0, 1).join("、") || "下行保护优先"}。`;
      }

      if (!input.behaviorSummary && input.role === "enterprise") {
        behaviorSummary = `关注 ${uniqueStrings(input.attentionTags ?? base.preferences.attentionTags).slice(0, 2).join("、") || "经营质量与风险修复"}。`;
      }

      return {
        ...base,
        displayName: input.displayName ?? base.displayName,
        identitySource: input.identitySource ?? base.identitySource,
        lastActiveAt: new Date().toISOString(),
        roles,
        enterpriseNames: uniqueStrings([...base.enterpriseNames, input.enterpriseName ?? ""]).slice(0, 12),
        investedEnterprises: uniqueStrings([
          ...base.investedEnterprises,
          ...(input.investedEnterprises ?? []),
        ]).slice(0, 20),
        enterpriseBaseInfo: input.replaceBaseInfo
          ? (input.enterpriseBaseInfo ?? base.enterpriseBaseInfo)
          : mergeBusinessInfo(base.enterpriseBaseInfo, input.enterpriseBaseInfo),
        investorBaseInfo: input.replaceBaseInfo
          ? (input.investorBaseInfo ?? base.investorBaseInfo)
          : mergeBusinessInfo(base.investorBaseInfo, input.investorBaseInfo),
        preferences: {
          themeMode: input.themeMode ?? base.preferences.themeMode,
          themeColor: input.themeColor ?? base.preferences.themeColor,
          preferredRole: input.preferredRole ?? base.preferences.preferredRole,
          focusModes: uniqueStrings([
            ...base.preferences.focusModes,
            ...(input.focusModes ?? []),
            input.focusMode ?? "",
          ]) as FocusMode[],
          riskAppetite: input.riskAppetite ?? base.preferences.riskAppetite,
          investmentHorizon: input.investmentHorizon ?? base.preferences.investmentHorizon,
          interests: uniqueStrings([...base.preferences.interests, ...(input.interests ?? [])]).slice(0, 12),
          attentionTags: uniqueStrings([
            ...base.preferences.attentionTags,
            ...(input.attentionTags ?? []),
          ]).slice(0, 12),
          goals: uniqueStrings([...base.preferences.goals, ...(input.goals ?? [])]).slice(0, 8),
          constraints: uniqueStrings([
            ...base.preferences.constraints,
            ...(input.constraints ?? []),
          ]).slice(0, 8),
          decisionStyleHints: uniqueStrings([
            ...base.preferences.decisionStyleHints,
            ...(input.decisionStyleHints ?? []),
          ]).slice(0, 8),
          amountUnit: input.amountUnit ?? (base.preferences as Record<string, unknown>).amountUnit as "yuan" | "wan" | "yi" | undefined,
          percentageUnit: input.percentageUnit ?? (base.preferences as Record<string, unknown>).percentageUnit as "percent" | "decimal" | undefined,
          volumeUnit: input.volumeUnit ?? (base.preferences as Record<string, unknown>).volumeUnit as "piece" | "k" | "m" | undefined,
        },
        profileSummary: input.profileSummary ?? base.profileSummary,
        behaviorSummary,
        feedback: base.feedback,
      };
    });
  }

  private async recordAnalysis(input: {
    userId: string;
    role: "enterprise" | "investor";
    sessionId?: string;
    enterpriseName?: string;
    focusMode: FocusMode;
    query: string;
    diagnostic: DiagnosticWorkflowResponse;
    personalizedSummary?: string;
    taskId?: string;
  }) {
    const mathAnalysis = getMathAnalysisOutput(input.diagnostic);
    const evidenceReview = getEvidenceReviewOutput(input.diagnostic);
    await this.platformStore.saveAnalysis({
      analysisId: randomUUID(),
      workflowId: input.diagnostic.workflowId,
      userId: input.userId,
      role: input.role,
      sessionId: input.sessionId,
      enterpriseName: input.enterpriseName,
      focusMode: input.focusMode,
      query: input.query,
      summary: input.diagnostic.summary,
      createdAt: new Date().toISOString(),
      personalizedSummary: input.personalizedSummary,
      combinedRiskLevel: mathAnalysis?.combinedRiskLevel,
      evidenceConfidence: evidenceReview?.confidence,
      taskId: input.taskId,
      modelAudits: [mathAnalysis?.grossMargin?.governance, mathAnalysis?.operatingQuality?.governance]
        .filter((governance): governance is ModelGovernance => Boolean(governance))
        .map((governance) => ({
          modelId: governance.modelVersion.startsWith("gross")
            ? "grossMarginPressure"
            : "operatingQuality",
          modelVersion: governance.modelVersion,
          parameterVersion: governance.parameterVersion,
          reproducibilityKey: governance.reproducibilityKey,
        })),
    });
  }

  private requireInvestorSession(sessionId: string, userId: string) {
    const snapshot = this.sessionStore.get(sessionId);

    if (!snapshot || snapshot.role !== "investor") {
      throw createNotFoundError("投资会话不存在。");
    }

    if (snapshot.userId !== userId) {
      throw new AppError({
        code: "FORBIDDEN",
        message: "无权操作该投资会话。",
        statusCode: 403,
      });
    }

    return snapshot;
  }

  private requireEnterpriseSession(sessionId: string, userId: string) {
    const snapshot = this.sessionStore.get(sessionId);

    if (!snapshot || snapshot.role !== "enterprise") {
      throw createNotFoundError("企业会话不存在。");
    }

    if (snapshot.userId !== userId) {
      throw new AppError({
        code: "FORBIDDEN",
        message: "无权操作该企业会话。",
        statusCode: 403,
      });
    }

    return snapshot;
  }

  private buildSessionSummary(snapshot: SessionContext): SessionHistorySummary {
    return {
      sessionId: snapshot.sessionId,
      userId: snapshot.userId,
      role: snapshot.role,
      activeMode: snapshot.activeMode,
      enterpriseName: snapshot.enterpriseName,
      summary: snapshot.summary,
      investedEnterprises: snapshot.investedEnterprises,
      updatedAt: snapshot.updatedAt,
      attachmentCount: snapshot.attachments.length,
      hasAttachments: snapshot.attachments.length > 0,
      lastEventType: snapshot.recentEvents[0]?.type,
    };
  }

  private buildUserProfileResponse(userId: string, viewerRole?: string): UserProfileResponse {
    const user = this.platformStore.getUser(userId);

    if (!user) {
      throw createNotFoundError("用户档案不存在。");
    }

    const sessions = this.sessionStore.listByUser(userId);
    const analyses = this.platformStore.listAnalysesByUser(userId);
    const tasks = this.platformStore.listTasksByUser(userId);
    const allMemories = this.platformStore.listMemories(userId);
    const latestSession = sessions[0];
    const workflowCount = uniqueStrings(analyses.map((item) => item.workflowId ?? "")).length;

    return {
      profile: {
        userId: user.userId,
        displayName: user.displayName,
        identitySource: user.identitySource,
        createdAt: user.createdAt,
        lastActiveAt: user.lastActiveAt,
        roles: user.roles,
        enterpriseNames: user.enterpriseNames,
        investedEnterprises: user.investedEnterprises,
        enterpriseBaseInfo: viewerRole === "investor" ? {} : (user.enterpriseBaseInfo ?? {}),
        investorBaseInfo: viewerRole === "enterprise" ? {} : (user.investorBaseInfo ?? {}),
        preferences: {
          themeMode: user.preferences.themeMode,
          themeColor: user.preferences.themeColor,
          preferredRole: user.preferences.preferredRole,
          focusModes: user.preferences.focusModes,
          riskAppetite: user.preferences.riskAppetite as UserProfileResponse["profile"]["preferences"]["riskAppetite"],
          investmentHorizon:
            user.preferences.investmentHorizon as UserProfileResponse["profile"]["preferences"]["investmentHorizon"],
          interests: user.preferences.interests,
          attentionTags: user.preferences.attentionTags,
          goals: user.preferences.goals,
          constraints: user.preferences.constraints,
          decisionStyleHints: user.preferences.decisionStyleHints,
          amountUnit: (user.preferences as Record<string, unknown>).amountUnit as UserProfileResponse["profile"]["preferences"]["amountUnit"],
          percentageUnit: (user.preferences as Record<string, unknown>).percentageUnit as UserProfileResponse["profile"]["preferences"]["percentageUnit"],
          volumeUnit: (user.preferences as Record<string, unknown>).volumeUnit as UserProfileResponse["profile"]["preferences"]["volumeUnit"],
        },
        profileSummary: user.profileSummary,
        behaviorSummary: user.behaviorSummary,
        feedback: user.feedback,
      },
      stats: {
        sessionCount: sessions.length,
        memoryCount: allMemories.length,
        analysisCount: analyses.length,
        taskCount: tasks.length,
        workflowCount,
      },
      recentSessions: sessions
        .slice(0, 15)
        .map((snapshot) => this.buildSessionSummary(this.sessionStore.toContext(snapshot, this.memoryStore.list(userId, 3)))),
      recentMemories: allMemories.slice(0, 15),
      recentAnalyses: analyses.slice(0, 15).map((item) => ({
        analysisId: item.analysisId,
        createdAt: item.createdAt,
        summary: item.summary,
        focusMode: item.focusMode,
        combinedRiskLevel: item.combinedRiskLevel,
        evidenceConfidence: item.evidenceConfidence,
      })),
      latestSessionContext: latestSession
        ? this.sessionStore.toContext(latestSession, this.memoryStore.list(userId, 3))
        : undefined,
    };
  }

  async collectEnterpriseData(payload: unknown) {
    const input = parseSchema(payload, enterpriseCollectionRequestSchema);
    const summary = `${input.enterpriseName} 已完成企业数据采集，当前覆盖 ${input.hasFullQuarterHistory ? "近四季度历史数据" : "本期与四季度前对比数据"}。`;
    const snapshot = await this.sessionStore.upsert({
      sessionId: input.sessionId,
      userId: input.userId,
      role: "enterprise",
      activeMode: "operationalDiagnosis",
      enterpriseName: input.enterpriseName,
      summary,
      lastQuery: "企业数据采集",
      recentEvent: createSessionEvent("enterprise_collection", summary),
      metadata: {
        enterpriseCollection: input as unknown as Record<string, unknown>,
      },
    });
    await this.touchUserProfile({
      userId: input.userId,
      role: "enterprise",
      enterpriseName: input.enterpriseName,
      focusMode: "operationalDiagnosis",
      profileSummary: summary,
      attentionTags: [
        ...(input.notes ?? []),
        ...(input.grossMarginInput ? ["毛利承压"] : []),
        ...(input.operatingQualityInput ? ["经营质量"] : []),
      ],
      enterpriseBaseInfo: input.enterpriseBaseInfo,
    });

    return {
      sessionContext: this.sessionStore.toContext(snapshot, this.memoryStore.list(input.userId, 3)),
      collectionSummary: buildEnterpriseCollectionSummary(input),
    };
  }

  async analyzeEnterprise(payload: unknown) {
    const input = parseSchema(payload, enterpriseAnalysisRequestSchema);
    const snapshot = input.sessionId ? this.requireEnterpriseSession(input.sessionId, input.userId) : undefined;
    const collectedData = snapshot?.metadata.enterpriseCollection as EnterpriseCollectionRequest | undefined;
    const enterpriseName = input.enterpriseName ?? collectedData?.enterpriseName;

    if (!enterpriseName) {
      throw createInvalidRequestError([{ path: "enterpriseName", message: "请提供企业名称或先完成数据采集。" }]);
    }

    const diagnostic = await this.workflowService.diagnose({
      role: "enterprise",
      userId: input.userId,
      conversationId: snapshot?.sessionId,
      enterpriseName,
      query: input.query,
      focusMode: input.focusMode,
      grossMarginInput: input.grossMarginInput ?? collectedData?.grossMarginInput,
      operatingQualityInput: input.operatingQualityInput ?? collectedData?.operatingQualityInput,
      industryContext: input.industryContext ?? collectedData?.industryContext,
      memoryNotes: buildWorkflowMemoryNotes(
        input.userId,
        [
          ...(collectedData?.notes ?? []),
          ...input.memoryNotes,
        ],
        snapshot
          ? this.sessionStore.toContext(snapshot, this.memoryStore.list(input.userId, 3, "enterprise"))
          : undefined,
        this.memoryStore,
        "enterprise",
      ),
    });

    const mathAnalysis = getMathAnalysisOutput(diagnostic);
    const summary = `${enterpriseName} 已完成企业分析，综合风险为 ${mathAnalysis?.combinedRiskLevel ?? "medium"}。`;
    const personalizedSummary = `结合长期画像，当前优先建议关注 ${uniqueStrings([
      ...(this.platformStore.getUser(input.userId)?.preferences.attentionTags ?? []),
      ...(mathAnalysis?.combinedInsights ?? []),
    ]).slice(0, 2).join("、") || "现金流与库存周转"}。`;
    const nextSession = await this.sessionStore.upsert({
      sessionId: snapshot?.sessionId ?? input.sessionId,
      userId: input.userId,
      role: "enterprise",
      activeMode: input.focusMode,
      enterpriseName,
      summary,
      lastQuery: input.query,
      recentEvent: createSessionEvent("enterprise_analysis", summary),
      metadata: {
        enterpriseCollection: (collectedData ?? input) as unknown as Record<string, unknown>,
        lastWorkflowId: diagnostic.workflowId,
      },
    });
    await this.touchUserProfile({
      userId: input.userId,
      role: "enterprise",
      enterpriseName,
      focusMode: input.focusMode,
      profileSummary: summary,
      attentionTags: [...(mathAnalysis?.combinedInsights ?? []), ...input.memoryNotes],
    });
    await this.recordAnalysis({
      userId: input.userId,
      role: "enterprise",
      sessionId: nextSession.sessionId,
      enterpriseName,
      focusMode: input.focusMode,
      query: input.query,
      diagnostic,
      personalizedSummary,
    });

    const now = new Date().toISOString();
    await this.platformStore.saveChatMessage({
      id: randomUUID(),
      sessionId: nextSession.sessionId,
      role: "user",
      content: input.query,
      timestamp: now,
    });
    await this.platformStore.saveChatMessage({
      id: randomUUID(),
      sessionId: nextSession.sessionId,
      role: "assistant",
      content: diagnostic.finalAnswer ?? diagnostic.summary,
      timestamp: new Date().toISOString(),
      metadata: { combinedRiskLevel: mathAnalysis?.combinedRiskLevel, enterpriseName },
    });

    return {
      sessionContext: this.sessionStore.toContext(nextSession, this.memoryStore.list(input.userId, 3)),
      collectionSummary: collectedData
        ? buildEnterpriseCollectionSummary(collectedData)
        : buildEnterpriseCollectionSummary({
            userId: input.userId,
            role: "enterprise",
            sessionId: nextSession.sessionId,
            enterpriseName,
            hasFullQuarterHistory: false,
            currentQuarterLabel: "本季度",
            baselineQuarterLabel: "去年同季度",
            recentQuarterLabels: [],
            grossMarginInput: input.grossMarginInput,
            operatingQualityInput: input.operatingQualityInput,
            industryContext: input.industryContext,
            notes: input.memoryNotes,
            enterpriseBaseInfo: {},
          }),
      diagnostic,
      highlights: {
        combinedRiskLevel: mathAnalysis?.combinedRiskLevel ?? "medium",
        combinedInsights: mathAnalysis?.combinedInsights ?? [],
      },
      personalization: {
        summary: personalizedSummary,
        nextTasks: uniqueStrings([
          "关注经营质量趋势变化",
          mathAnalysis?.combinedRiskLevel === "high" ? "安排专项降本与库存复盘" : "建立周度跟踪节奏",
          diagnostic.governance?.manualTakeoverAvailable ? "必要时请求人工复核" : "",
        ]).slice(0, 3),
      },
    };
  }

  async streamEnterpriseAnalysis(
    payload: unknown,
    onEvent: (event: EnterpriseAnalysisStreamEvent) => void | Promise<void>,
    options?: { signal?: { aborted: boolean } },
  ) {
    const signal = options?.signal;
    const input = parseSchema(payload, enterpriseAnalysisRequestSchema);
    const snapshot = input.sessionId ? this.requireEnterpriseSession(input.sessionId, input.userId) : undefined;
    const collectedData = snapshot?.metadata.enterpriseCollection as EnterpriseCollectionRequest | undefined;
    const enterpriseName = input.enterpriseName ?? collectedData?.enterpriseName;

    if (!enterpriseName) {
      throw createInvalidRequestError([{ path: "enterpriseName", message: "请提供企业名称或先完成数据采集。" }]);
    }

    if (snapshot) {
      await onEvent({
        type: "session",
        sessionContext: this.sessionStore.toContext(snapshot, this.memoryStore.list(input.userId, 3, "enterprise")),
      });
    }

    if (signal?.aborted) return;

    const timelineEntries: AnalysisTimelineEntry[] = [];

    const onProgress = async (stage: "session" | "clarification" | "understanding" | "retrieval" | "feasibility" | "debate" | "evidence" | "writing" | "profile_update" | "completed", label: string, progressPercent: number, detail?: string) => {
      const entry = createTimelineEntry(stage, label, progressPercent, detail);
      timelineEntries.push(entry);
      await onEvent({
        type: "progress",
        stage,
        label,
        progressPercent,
        detail,
        timelineEntry: entry,
      });
    };

    const diagnostic = await this.workflowService.diagnose({
      role: "enterprise",
      userId: input.userId,
      conversationId: snapshot?.sessionId,
      enterpriseName,
      query: input.query,
      focusMode: input.focusMode,
      grossMarginInput: input.grossMarginInput ?? collectedData?.grossMarginInput,
      operatingQualityInput: input.operatingQualityInput ?? collectedData?.operatingQualityInput,
      industryContext: input.industryContext ?? collectedData?.industryContext,
      memoryNotes: buildWorkflowMemoryNotes(
        input.userId,
        [
          ...(collectedData?.notes ?? []),
          ...input.memoryNotes,
        ],
        snapshot
          ? this.sessionStore.toContext(snapshot, this.memoryStore.list(input.userId, 3, "enterprise"))
          : undefined,
        this.memoryStore,
        "enterprise",
      ),
    }, onProgress);

    if (signal?.aborted) return;

    const mathAnalysis = getMathAnalysisOutput(diagnostic);
    const summary = `${enterpriseName} 已完成企业分析，综合风险为 ${mathAnalysis?.combinedRiskLevel ?? "medium"}。`;
    const personalizedSummary = `结合长期画像，当前优先建议关注 ${uniqueStrings([
      ...(this.platformStore.getUser(input.userId)?.preferences.attentionTags ?? []),
      ...(mathAnalysis?.combinedInsights ?? []),
    ]).slice(0, 2).join("、") || "现金流与库存周转"}。`;
    const nextSession = await this.sessionStore.upsert({
      sessionId: snapshot?.sessionId ?? input.sessionId,
      userId: input.userId,
      role: "enterprise",
      activeMode: input.focusMode,
      enterpriseName,
      summary,
      lastQuery: input.query,
      recentEvent: createSessionEvent("enterprise_analysis", summary),
      metadata: {
        enterpriseCollection: (collectedData ?? input) as unknown as Record<string, unknown>,
        lastWorkflowId: diagnostic.workflowId,
      },
    });
    await this.touchUserProfile({
      userId: input.userId,
      role: "enterprise",
      enterpriseName,
      focusMode: input.focusMode,
      profileSummary: summary,
      attentionTags: [...(mathAnalysis?.combinedInsights ?? []), ...input.memoryNotes],
    });
    await this.recordAnalysis({
      userId: input.userId,
      role: "enterprise",
      sessionId: nextSession.sessionId,
      enterpriseName,
      focusMode: input.focusMode,
      query: input.query,
      diagnostic,
      personalizedSummary,
    });

    const result = {
      sessionContext: this.sessionStore.toContext(nextSession, this.memoryStore.list(input.userId, 3)),
      collectionSummary: collectedData
        ? buildEnterpriseCollectionSummary(collectedData)
        : buildEnterpriseCollectionSummary({
            userId: input.userId,
            role: "enterprise",
            sessionId: nextSession.sessionId,
            enterpriseName,
            hasFullQuarterHistory: false,
            currentQuarterLabel: "本季度",
            baselineQuarterLabel: "去年同季度",
            recentQuarterLabels: [],
            grossMarginInput: input.grossMarginInput,
            operatingQualityInput: input.operatingQualityInput,
            industryContext: input.industryContext,
            notes: input.memoryNotes,
            enterpriseBaseInfo: {},
          }),
      diagnostic,
      highlights: {
        combinedRiskLevel: mathAnalysis?.combinedRiskLevel ?? "medium",
        combinedInsights: mathAnalysis?.combinedInsights ?? [],
      },
      personalization: {
        summary: personalizedSummary,
        nextTasks: uniqueStrings([
          "关注经营质量趋势变化",
          mathAnalysis?.combinedRiskLevel === "high" ? "安排专项降本与库存复盘" : "建立周度跟踪节奏",
          diagnostic.governance?.manualTakeoverAvailable ? "必要时请求人工复核" : "",
        ]).slice(0, 3),
      },
    };

    if (signal?.aborted) return;

    const text = diagnostic.finalAnswer ?? "";
    const chunks = chunkText(text);
    const shouldDelay = text.length > 100;
    for (const chunk of chunks) {
      await onEvent({
        type: "delta",
        stage: "writing",
        chunk,
      });
      if (shouldDelay) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    await onEvent({
      type: "result",
      result: result as unknown as Record<string, unknown>,
    });
  }

  async createInvestorProfile(payload: unknown) {
    const input = parseSchema(payload, investorProfileRequestSchema);
    const portraitSummary = buildInvestorProfileSummary(input);
    const recommendedMode = getRecommendedMode(input);
    const snapshot = await this.sessionStore.upsert({
      sessionId: input.sessionId,
      userId: input.userId,
      role: "investor",
      activeMode: recommendedMode,
      enterpriseName: input.investedEnterprises[0],
      summary: portraitSummary,
      investedEnterprises: input.investedEnterprises,
      investorProfileSummary: portraitSummary,
      lastQuery: "投资画像初始化",
      recentEvent: createSessionEvent("investor_profile", portraitSummary),
      metadata: {
        investorProfile: input as unknown as Record<string, unknown>,
      },
    });
    await this.touchUserProfile({
      userId: input.userId,
      role: "investor",
      enterpriseName: input.investedEnterprises[0],
      investedEnterprises: input.investedEnterprises,
      focusMode: recommendedMode,
      profileSummary: portraitSummary,
      riskAppetite: input.riskAppetite,
      investmentHorizon: input.investmentHorizon,
      interests: input.interests,
      attentionTags: [...input.notes, ...input.interests],
      investorBaseInfo: input.investorBaseInfo,
    });

    return {
      profileId: snapshot.sessionId,
      portraitSummary,
      recommendedMode,
      sessionContext: this.sessionStore.toContext(snapshot, this.memoryStore.list(input.userId, 3)),
    };
  }

  async createInvestorSession(payload: unknown) {
    const input = parseSchema(payload, investorSessionCreateRequestSchema);
    const existingUser = this.platformStore.getUser(input.userId);
    const summary = buildModeSummary(input.focusMode, input.enterpriseName);
    const snapshot = await this.sessionStore.upsert({
      userId: input.userId,
      role: "investor",
      activeMode: input.focusMode,
      enterpriseName: input.enterpriseName,
      summary,
      investedEnterprises: existingUser?.investedEnterprises ?? [],
      investorProfileSummary: existingUser?.profileSummary,
      lastQuery: "新建投资会话",
      recentEvent: createSessionEvent("session_created", "已新建投资会话"),
      metadata: {
        pendingClarificationQuestions: [],
      },
    });

    await this.touchUserProfile({
      userId: input.userId,
      role: "investor",
      enterpriseName: input.enterpriseName,
      focusMode: input.focusMode,
      profileSummary: summary,
    });

    return {
      sessionContext: this.sessionStore.toContext(snapshot, this.memoryStore.list(input.userId, 3)),
    };
  }

  listInvestorSessions(userId: string) {
    return {
      items: this.sessionStore
        .listByUser(userId, "investor")
        .map((snapshot) => this.buildSessionSummary(this.sessionStore.toContext(snapshot, this.memoryStore.list(userId, 3)))),
    };
  }

  listEnterpriseSessions(userId: string) {
    return {
      items: this.sessionStore
        .listByUser(userId, "enterprise")
        .map((snapshot) => this.buildSessionSummary(this.sessionStore.toContext(snapshot, this.memoryStore.list(userId, 3)))),
    };
  }

  async deleteCurrentInvestorSession(payload: unknown) {
    const input = parseSchema(payload, investorSessionDeleteRequestSchema);
    const snapshot = this.requireInvestorSession(input.sessionId, input.userId);
    const previousMode = snapshot.activeMode;
    const previousEnterprise = snapshot.enterpriseName;
    await this.sessionStore.delete(snapshot.sessionId);

    const replacement = await this.sessionStore.upsert({
      userId: input.userId,
      role: "investor",
      activeMode: previousMode,
      enterpriseName: previousEnterprise,
      summary: buildModeSummary(previousMode, previousEnterprise),
      investedEnterprises: snapshot.investedEnterprises,
      investorProfileSummary: snapshot.investorProfileSummary,
      lastQuery: "删除当前会话后自动新建",
      recentEvent: createSessionEvent("session_created", "已自动重建默认投资会话"),
      metadata: {
        investorProfile: snapshot.metadata.investorProfile,
        pendingClarificationQuestions: [],
      },
    });

    return {
      deletedSessionIds: [snapshot.sessionId],
      replacementSessionContext: this.sessionStore.toContext(replacement, this.memoryStore.list(input.userId, 3)),
    };
  }

  async deleteInvestorSessions(payload: unknown) {
    const input = parseSchema(payload, investorSessionBatchDeleteRequestSchema);
    const ownedSessions = input.sessionIds.map((sessionId) => this.requireInvestorSession(sessionId, input.userId));
    await this.sessionStore.deleteMany(ownedSessions.map((item) => item.sessionId));

    return {
      deletedSessionIds: ownedSessions.map((item) => item.sessionId),
      deletedCount: ownedSessions.length,
    };
  }

  async uploadInvestorAttachment(payload: unknown) {
    const input = parseSchema(payload, investorAttachmentUploadRequestSchema);
    const snapshot = this.requireInvestorSession(input.sessionId, input.userId);
    const attachment = buildAttachmentSummary(input);
    const attachments = [attachment, ...snapshot.attachments].slice(0, 8);
    const nextSnapshot = await this.sessionStore.upsert({
      sessionId: snapshot.sessionId,
      userId: snapshot.userId,
      role: snapshot.role,
      activeMode: snapshot.activeMode,
      enterpriseName: snapshot.enterpriseName,
      summary: `${snapshot.summary} 已纳入附件 ${attachment.fileName}。`,
      investedEnterprises: snapshot.investedEnterprises,
      investorProfileSummary: snapshot.investorProfileSummary,
      lastQuery: snapshot.lastQuery,
      recentEvent: createSessionEvent("attachment_uploaded", `已上传并解析附件：${attachment.fileName}`),
      metadata: {
        ...snapshot.metadata,
        attachments,
      },
    });

    return {
      attachment,
      warnings: attachment.warnings,
      sessionContext: this.sessionStore.toContext(nextSnapshot, this.memoryStore.list(input.userId, 3)),
    };
  }

  async uploadEnterpriseAttachment(payload: unknown) {
    const input = parseSchema(payload, enterpriseAttachmentUploadRequestSchema);
    const snapshot = this.requireEnterpriseSession(input.sessionId, input.userId);
    const attachment = buildAttachmentSummary(input);
    const attachments = [attachment, ...snapshot.attachments].slice(0, 8);
    const nextSnapshot = await this.sessionStore.upsert({
      sessionId: snapshot.sessionId,
      userId: snapshot.userId,
      role: snapshot.role,
      activeMode: snapshot.activeMode,
      enterpriseName: snapshot.enterpriseName,
      summary: `${snapshot.summary} 已纳入附件 ${attachment.fileName}。`,
      investedEnterprises: snapshot.investedEnterprises,
      investorProfileSummary: snapshot.investorProfileSummary,
      lastQuery: snapshot.lastQuery,
      recentEvent: createSessionEvent("attachment_uploaded", `已上传并解析附件：${attachment.fileName}`),
      metadata: {
        ...snapshot.metadata,
        attachments,
      },
    });

    return {
      attachment,
      warnings: attachment.warnings,
      sessionContext: this.sessionStore.toContext(nextSnapshot, this.memoryStore.list(input.userId, 3)),
    };
  }

  async switchInvestorMode(payload: unknown) {
    const input = parseSchema(payload, investorModeSwitchRequestSchema);
    const snapshot = this.requireInvestorSession(input.sessionId, input.userId);

    const modeSummary = buildModeSummary(input.focusMode, input.enterpriseName ?? snapshot.enterpriseName);
    const nextSession = await this.sessionStore.upsert({
      sessionId: snapshot.sessionId,
      userId: input.userId,
      role: "investor",
      activeMode: input.focusMode,
      enterpriseName: input.enterpriseName ?? snapshot.enterpriseName,
      summary: modeSummary,
      investedEnterprises: snapshot.investedEnterprises,
      investorProfileSummary: snapshot.investorProfileSummary,
      lastQuery: input.query ?? snapshot.lastQuery,
      recentEvent: createSessionEvent("mode_switch", modeSummary),
      metadata: snapshot.metadata,
    });
    await this.touchUserProfile({
      userId: input.userId,
      role: "investor",
      enterpriseName: input.enterpriseName ?? snapshot.enterpriseName,
      investedEnterprises: snapshot.investedEnterprises,
      focusMode: input.focusMode,
      profileSummary: modeSummary,
    });

    return {
      activeMode: nextSession.activeMode,
      modeSummary,
      sessionContext: this.sessionStore.toContext(nextSession, this.memoryStore.list(input.userId, 3)),
    };
  }

  async analyzeInvestor(payload: unknown) {
    const input = parseSchema(payload, investorAnalysisRequestSchema);
    const snapshot = input.sessionId ? this.sessionStore.get(input.sessionId) : undefined;
    const profile = snapshot?.metadata.investorProfile as InvestorProfileRequest | undefined;
    const userRecord = this.platformStore.getUser(input.userId);
    const enterpriseName = input.enterpriseName ?? snapshot?.enterpriseName ?? profile?.investedEnterprises[0];
    const attachments = snapshot?.attachments ?? [];
    const profileUpdate = buildProfileUpdate({
      query: input.query,
      memoryNotes: input.memoryNotes,
      deepDiveContext: input.deepDiveContext,
      attachments,
      profile,
      userRecord,
    });

    const diagnostic = await this.workflowService.diagnose({
      role: "investor",
      userId: input.userId,
      conversationId: snapshot?.sessionId,
      enterpriseName,
      query: input.query,
      focusMode: input.focusMode,
      grossMarginInput: input.grossMarginInput,
      operatingQualityInput: input.operatingQualityInput,
      industryContext: input.industryContext,
      memoryNotes: buildWorkflowMemoryNotes(
        input.userId,
        [
          ...(profile?.notes ?? []),
          ...input.memoryNotes,
          ...attachments.map((item) => `附件摘要：${item.summary}`),
          profileUpdate.riskAppetite ? `长期风险偏好：${profileUpdate.riskAppetite}` : "",
          profileUpdate.investmentHorizon ? `长期投资周期：${profileUpdate.investmentHorizon}` : "",
          ...profileUpdate.constraints.map((item) => `长期约束：${item}`),
          ...profileUpdate.goals.map((item) => `长期目标：${item}`),
          ...profileUpdate.decisionStyleHints.map((item) => `决策习惯：${item}`),
        ],
        snapshot
          ? this.sessionStore.toContext(snapshot, this.memoryStore.list(input.userId, 3, "investor"))
          : undefined,
        this.memoryStore,
        "investor",
      ),
    });

    const summary =
      input.focusMode === "industryStatus"
        ? `${enterpriseName ?? "目标企业"} 已完成行业状况分析。`
        : input.focusMode === "deepDive"
        ? `${enterpriseName ?? "目标企业"} 已完成投资深度解析。`
        : `${enterpriseName ?? "目标企业"} 已完成投资推荐分析。`;
    const eventType =
      input.focusMode === "industryStatus"
        ? "investor_industry_status"
        : input.focusMode === "deepDive"
          ? "investor_deep_dive"
          : "investor_recommendation";
    const personalizedSummary = `画像驱动下优先强调 ${uniqueStrings([
      ...profileUpdate.interests,
      ...(input.memoryNotes ?? []),
      ...profileUpdate.constraints,
    ]).slice(0, 2).join("、") || "景气与现金流"}。`;
    const recommendation = buildRecommendation(profile, diagnostic, userRecord);
    const industryReport = buildIndustryReport(diagnostic, attachments, userRecord);
    const debate = await buildDebate(recommendation, diagnostic, userRecord, this.modelRouter, undefined, this.logger, enterpriseName);
    const evidenceSummary = buildEvidenceSummary(diagnostic);
    const clarificationQuestions = buildClarificationQuestions(input, userRecord);
    const timeline = buildTimeline(
      input.focusMode,
      attachments.length,
      Boolean(profileUpdate.receipt),
      clarificationQuestions,
    );
    const nextSession = await this.sessionStore.upsert({
      sessionId: snapshot?.sessionId ?? input.sessionId,
      userId: input.userId,
      role: "investor",
      activeMode: input.focusMode,
      enterpriseName,
      summary,
      investedEnterprises: profile?.investedEnterprises ?? snapshot?.investedEnterprises,
      investorProfileSummary: snapshot?.investorProfileSummary,
      lastQuery: input.query,
      recentEvent: createSessionEvent(eventType, summary),
      metadata: {
        investorProfile: {
          ...(profile ?? {}),
          riskAppetite: profileUpdate.riskAppetite,
          investmentHorizon: profileUpdate.investmentHorizon,
          interests: profileUpdate.interests,
          notes: uniqueStrings([
            ...((profile?.notes ?? []) as string[]),
            ...profileUpdate.constraints,
            ...profileUpdate.goals,
          ]).slice(0, 8),
        } as Record<string, unknown>,
        lastWorkflowId: diagnostic.workflowId,
        attachments,
        latestTimeline: timeline,
        latestDebate: flattenDebateMessages(debate),
        latestEvidenceSummary: evidenceSummary,
        latestProfileUpdate: profileUpdate.receipt,
        pendingClarificationQuestions: clarificationQuestions,
      },
    });
    await this.touchUserProfile({
      userId: input.userId,
      role: "investor",
      enterpriseName,
      investedEnterprises: profile?.investedEnterprises ?? snapshot?.investedEnterprises,
      focusMode: input.focusMode,
      profileSummary: summary,
      riskAppetite: profileUpdate.riskAppetite,
      investmentHorizon: profileUpdate.investmentHorizon,
      interests: profileUpdate.interests,
      attentionTags: uniqueStrings([...(profile?.notes ?? []), ...input.memoryNotes, ...profileUpdate.attentionTags]),
      goals: profileUpdate.goals,
      constraints: profileUpdate.constraints,
      decisionStyleHints: profileUpdate.decisionStyleHints,
    });
    await this.recordAnalysis({
      userId: input.userId,
      role: "investor",
      sessionId: nextSession.sessionId,
      enterpriseName,
      focusMode: input.focusMode,
      query: input.query,
      diagnostic,
      personalizedSummary,
    });

    const now = new Date().toISOString();
    await this.platformStore.saveChatMessage({
      id: randomUUID(),
      sessionId: nextSession.sessionId,
      role: "user",
      content: input.query,
      timestamp: now,
    });
    await this.platformStore.saveChatMessage({
      id: randomUUID(),
      sessionId: nextSession.sessionId,
      role: "assistant",
      content: diagnostic.finalAnswer ?? diagnostic.summary,
      timestamp: new Date().toISOString(),
      metadata: { focusMode: input.focusMode, enterpriseName, stance: recommendation.stance },
    });

    return {
      sessionContext: this.sessionStore.toContext(nextSession, this.memoryStore.list(input.userId, 3)),
      diagnostic,
      recommendation,
      deepDive: buildDeepDive(diagnostic),
      industryReport,
      debate,
      timeline,
      evidenceSummary,
      usedAttachments: attachments,
      profileUpdate: profileUpdate.receipt,
      personalization: {
        summary: personalizedSummary,
        serviceHints: uniqueStrings([
          profileUpdate.riskAppetite === "low" ? "突出确定性与下行保护" : "",
          profileUpdate.constraints[0] ? `尊重长期约束：${profileUpdate.constraints[0]}` : "",
          diagnostic.governance?.manualTakeoverAvailable ? "建议发起人工复核" : "维持自动跟踪",
          "保留关键证据链供下次追问复用",
        ]).slice(0, 3),
      },
    } satisfies InvestorAnalysisResponsePayload;
  }

  async streamInvestorAnalysis(
    payload: unknown,
    onEvent: (event: InvestorAnalysisStreamEvent) => void | Promise<void>,
    options?: { signal?: { aborted: boolean } },
  ) {
    const signal = options?.signal;
    const input = parseSchema(payload, investorAnalysisRequestSchema);
    const snapshot = input.sessionId ? this.sessionStore.get(input.sessionId) : undefined;
    const userRecord = this.platformStore.getUser(input.userId);
    const clarificationQuestions = buildClarificationQuestions(input, userRecord);

    if (snapshot) {
      await onEvent({
        type: "session",
        sessionContext: this.sessionStore.toContext(snapshot, this.memoryStore.list(snapshot.userId, 3)),
      });
    }

    if (input.focusMode === "deepDive" && clarificationQuestions.length > 0) {
      const updatedSnapshot = snapshot
        ? await this.sessionStore.upsert({
            sessionId: snapshot.sessionId,
            userId: snapshot.userId,
            role: snapshot.role,
            activeMode: snapshot.activeMode,
            enterpriseName: snapshot.enterpriseName,
            summary: "深度解析待补充关键研究条件。",
            investedEnterprises: snapshot.investedEnterprises,
            investorProfileSummary: snapshot.investorProfileSummary,
            lastQuery: input.query,
            recentEvent: createSessionEvent("investor_deep_dive", "深度解析待补充关键研究条件"),
            metadata: {
              ...snapshot.metadata,
              latestTimeline: buildTimeline("deepDive", snapshot.attachments.length, false, clarificationQuestions),
              pendingClarificationQuestions: clarificationQuestions,
            },
          })
        : undefined;

      if (updatedSnapshot) {
        await onEvent({
          type: "session",
          sessionContext: this.sessionStore.toContext(updatedSnapshot, this.memoryStore.list(updatedSnapshot.userId, 3)),
        });
      }

      await onEvent({
        type: "clarification_required",
        questions: clarificationQuestions,
        sessionContext: updatedSnapshot
          ? this.sessionStore.toContext(updatedSnapshot, this.memoryStore.list(updatedSnapshot.userId, 3))
          : undefined,
      });
      return;
    }

    if (signal?.aborted) return;

    const result = await this.analyzeInvestorWithProgress(input, onEvent, signal);

    const complexity = input.complexity ?? "moderate";

    if (input.focusMode === "investmentRecommendation") {
      if (signal?.aborted) return;

      if (complexity === "simple") {
        await onEvent({
          type: "delta",
          stage: "writing",
          chunk: result.debate.finalDecision,
        });
      } else {
        for (const [index, round] of result.debate.rounds.entries()) {
          if (index === 1) {
            await onEvent({
              type: "delta",
              stage: "debate",
              chunk: "辩手与裁判换位，进行第二轮辩论",
            });
          }

          if (index === 2) {
            await onEvent({
              type: "delta",
              stage: "debate",
              chunk: "辩手与裁判换位，进行最后一轮辩论",
            });
          }

          for (const message of round.messages) {
            await onEvent({
              type: "debate_message",
              message,
            });
          }
        }

        await onEvent({
          type: "delta",
          stage: "writing",
          chunk: result.debate.finalDecision,
        });
      }
    } else {
      if (signal?.aborted) return;
      const text =
        input.focusMode === "industryStatus"
          ? [
              result.industryReport.overview,
              ...result.industryReport.keyDrivers,
              ...result.industryReport.risks,
              ...result.industryReport.opportunities,
            ].join(" ")
          : [result.deepDive.thesis, ...result.deepDive.modules.map((item) => `${item.name}：${item.summary}`)].join(" ");

      const chunks = chunkText(text);
      const shouldDelay = text.length > 100;
      for (const chunk of chunks) {
        await onEvent({
          type: "delta",
          stage: input.focusMode === "industryStatus" ? "writing" : "evidence",
          chunk,
        });
        if (shouldDelay) {
          await new Promise((r) => setTimeout(r, 20));
        }
      }
    }

    if (result.profileUpdate) {
      await onEvent({
        type: "profile_update",
        profileUpdate: result.profileUpdate,
      });
    }

    const completedLabel = input.focusMode === "investmentRecommendation" ? "分析完成"
      : input.focusMode === "deepDive" ? "解析完成"
        : "分析完成";
    const completedEntry: AnalysisTimelineEntry = {
      id: `tl-${Date.now()}-completed`,
      stage: "completed",
      label: completedLabel,
      progressPercent: 100,
      occurredAt: new Date().toISOString(),
      status: "completed",
    };
    await onEvent({
      type: "progress",
      stage: "completed",
      label: completedLabel,
      progressPercent: 100,
      timelineEntry: completedEntry,
    });

    await onEvent({
      type: "result",
      result: result as unknown as Record<string, unknown>,
    });
  }

  private async analyzeInvestorWithProgress(
    input: InvestorAnalysisRequest,
    onEvent: (event: InvestorAnalysisStreamEvent) => void | Promise<void>,
    signal?: { aborted: boolean },
  ) {
    const timelineEntries: AnalysisTimelineEntry[] = [];

    const onProgress = async (stage: "session" | "clarification" | "understanding" | "retrieval" | "feasibility" | "debate" | "evidence" | "writing" | "profile_update" | "completed", label: string, progressPercent: number, detail?: string) => {
      const entry = createTimelineEntry(stage, label, progressPercent, detail);
      timelineEntries.push(entry);
      await onEvent({
        type: "progress",
        stage,
        label,
        progressPercent,
        detail,
        timelineEntry: entry,
      });
    };

    const snapshot = input.sessionId ? this.sessionStore.get(input.sessionId) : undefined;
    const profile = snapshot?.metadata.investorProfile as InvestorProfileRequest | undefined;
    const userRecord = this.platformStore.getUser(input.userId);
    const enterpriseName = input.enterpriseName ?? snapshot?.enterpriseName ?? profile?.investedEnterprises[0];
    const attachments = snapshot?.attachments ?? [];
    const profileUpdate = buildProfileUpdate({
      query: input.query,
      memoryNotes: input.memoryNotes,
      deepDiveContext: input.deepDiveContext,
      attachments,
      profile,
      userRecord,
    });

    if (signal?.aborted) {
      throw new AppError({ code: "ABORTED", message: "分析已被用户取消。", statusCode: 499 });
    }

    const diagnostic = await this.workflowService.diagnose({
      role: "investor",
      userId: input.userId,
      conversationId: snapshot?.sessionId,
      enterpriseName,
      query: input.query,
      focusMode: input.focusMode,
      grossMarginInput: input.grossMarginInput,
      operatingQualityInput: input.operatingQualityInput,
      industryContext: input.industryContext,
      memoryNotes: buildWorkflowMemoryNotes(
        input.userId,
        [
          ...(profile?.notes ?? []),
          ...input.memoryNotes,
          ...attachments.map((item) => `附件摘要：${item.summary}`),
          profileUpdate.riskAppetite ? `长期风险偏好：${profileUpdate.riskAppetite}` : "",
          profileUpdate.investmentHorizon ? `长期投资周期：${profileUpdate.investmentHorizon}` : "",
          ...profileUpdate.constraints.map((item) => `长期约束：${item}`),
          ...profileUpdate.goals.map((item) => `长期目标：${item}`),
          ...profileUpdate.decisionStyleHints.map((item) => `决策习惯：${item}`),
        ],
        snapshot
          ? this.sessionStore.toContext(snapshot, this.memoryStore.list(input.userId, 3, "investor"))
          : undefined,
        this.memoryStore,
        "investor",
      ),
    }, onProgress);

    if (signal?.aborted) {
      throw new AppError({ code: "ABORTED", message: "分析已被用户取消。", statusCode: 499 });
    }

    const summary =
      input.focusMode === "industryStatus"
        ? `${enterpriseName ?? "目标企业"} 已完成行业状况分析。`
        : input.focusMode === "deepDive"
        ? `${enterpriseName ?? "目标企业"} 已完成投资深度解析。`
        : `${enterpriseName ?? "目标企业"} 已完成投资推荐分析。`;
    const eventType =
      input.focusMode === "industryStatus"
        ? "investor_industry_status"
        : input.focusMode === "deepDive"
          ? "investor_deep_dive"
          : "investor_recommendation";
    const personalizedSummary = `画像驱动下优先强调 ${uniqueStrings([
      ...profileUpdate.interests,
      ...(input.memoryNotes ?? []),
      ...profileUpdate.constraints,
    ]).slice(0, 2).join("、") || "景气与现金流"}。`;
    const recommendation = buildRecommendation(profile, diagnostic, userRecord);
    const industryReport = buildIndustryReport(diagnostic, attachments, userRecord);
    if (signal?.aborted) {
      throw new AppError({ code: "ABORTED", message: "分析已被用户取消。", statusCode: 499 });
    }
    const isSimpleQuery = input.complexity === "simple" || diagnostic.complexity === "simple";
    const debate = await buildDebate(recommendation, diagnostic, userRecord, this.modelRouter, signal, this.logger, enterpriseName);
    const evidenceSummary = buildEvidenceSummary(diagnostic);
    const clarificationQuestions = buildClarificationQuestions(input, userRecord);

    const nextSession = await this.sessionStore.upsert({
      sessionId: snapshot?.sessionId ?? input.sessionId,
      userId: input.userId,
      role: "investor",
      activeMode: input.focusMode,
      enterpriseName,
      summary,
      investedEnterprises: profile?.investedEnterprises ?? snapshot?.investedEnterprises,
      investorProfileSummary: snapshot?.investorProfileSummary,
      lastQuery: input.query,
      recentEvent: createSessionEvent(eventType, summary),
      metadata: {
        investorProfile: {
          ...(profile ?? {}),
          riskAppetite: profileUpdate.riskAppetite,
          investmentHorizon: profileUpdate.investmentHorizon,
          interests: profileUpdate.interests,
          notes: uniqueStrings([
            ...((profile?.notes ?? []) as string[]),
            ...profileUpdate.constraints,
            ...profileUpdate.goals,
          ]).slice(0, 8),
        } as Record<string, unknown>,
        lastWorkflowId: diagnostic.workflowId,
        attachments,
        latestTimeline: timelineEntries,
        latestDebate: flattenDebateMessages(debate),
        latestEvidenceSummary: evidenceSummary,
        latestProfileUpdate: profileUpdate.receipt,
        pendingClarificationQuestions: clarificationQuestions,
      },
    });
    await this.touchUserProfile({
      userId: input.userId,
      role: "investor",
      enterpriseName,
      investedEnterprises: profile?.investedEnterprises ?? snapshot?.investedEnterprises,
      focusMode: input.focusMode,
      profileSummary: summary,
      riskAppetite: profileUpdate.riskAppetite,
      investmentHorizon: profileUpdate.investmentHorizon,
      interests: profileUpdate.interests,
      attentionTags: uniqueStrings([...(profile?.notes ?? []), ...input.memoryNotes, ...profileUpdate.attentionTags]),
      goals: profileUpdate.goals,
      constraints: profileUpdate.constraints,
      decisionStyleHints: profileUpdate.decisionStyleHints,
    });
    await this.recordAnalysis({
      userId: input.userId,
      role: "investor",
      sessionId: nextSession.sessionId,
      enterpriseName,
      focusMode: input.focusMode,
      query: input.query,
      diagnostic,
      personalizedSummary,
    });

    const now = new Date().toISOString();
    await this.platformStore.saveChatMessage({
      id: randomUUID(),
      sessionId: nextSession.sessionId,
      role: "user",
      content: input.query,
      timestamp: now,
    });
    await this.platformStore.saveChatMessage({
      id: randomUUID(),
      sessionId: nextSession.sessionId,
      role: "assistant",
      content: diagnostic.finalAnswer ?? diagnostic.summary,
      timestamp: new Date().toISOString(),
      metadata: { focusMode: input.focusMode, enterpriseName, stance: recommendation.stance },
    });

    return {
      sessionContext: this.sessionStore.toContext(nextSession, this.memoryStore.list(input.userId, 3)),
      diagnostic,
      recommendation,
      deepDive: buildDeepDive(diagnostic),
      industryReport,
      debate,
      timeline: timelineEntries,
      evidenceSummary,
      usedAttachments: attachments,
      profileUpdate: profileUpdate.receipt,
      personalization: {
        summary: personalizedSummary,
        serviceHints: uniqueStrings([
          profileUpdate.riskAppetite === "low" ? "突出确定性与下行保护" : "",
          profileUpdate.constraints[0] ? `尊重长期约束：${profileUpdate.constraints[0]}` : "",
          diagnostic.governance?.manualTakeoverAvailable ? "建议发起人工复核" : "维持自动跟踪",
          "保留关键证据链供下次追问复用",
        ]).slice(0, 3),
      },
    } satisfies InvestorAnalysisResponsePayload;
  }

  async bootstrapUserIdentity(payload: unknown) {
    const input = parseSchema(payload, userIdentityBootstrapRequestSchema);
    const userId = input.userId ?? `user_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

    await this.touchUserProfile({
      userId,
      role: input.role,
      displayName: input.displayName,
      identitySource: input.userId ? "provided" : "generated",
      preferredRole: input.preferredRole,
      themeMode: input.themeMode,
      themeColor: input.themeColor,
      enterpriseName: input.enterpriseName,
      investedEnterprises: input.investedEnterprises,
      focusMode: input.focusMode,
      riskAppetite: input.riskAppetite,
      investmentHorizon: input.investmentHorizon,
      interests: input.interests,
      attentionTags: input.attentionTags,
      goals: input.goals,
      constraints: input.constraints,
      decisionStyleHints: input.decisionStyleHints,
      enterpriseBaseInfo: input.enterpriseBaseInfo,
      investorBaseInfo: input.investorBaseInfo,
    });

    return this.buildUserProfileResponse(userId);
  }

  getUserProfile(userId: string, viewerRole?: string) {
    return this.buildUserProfileResponse(userId, viewerRole);
  }

  async updateUserPreferences(payload: unknown) {
    const input = parseSchema(payload, userPreferencesUpdateRequestSchema);

    await this.touchUserProfile({
      userId: input.userId,
      role: input.role,
      displayName: input.displayName,
      preferredRole: input.preferredRole,
      themeMode: input.themeMode,
      themeColor: input.themeColor,
      enterpriseName: input.enterpriseName,
      investedEnterprises: input.investedEnterprises,
      focusMode: input.focusMode,
      focusModes: input.focusModes,
      riskAppetite: input.riskAppetite,
      investmentHorizon: input.investmentHorizon,
      interests: input.interests,
      attentionTags: input.attentionTags,
      goals: input.goals,
      constraints: input.constraints,
      decisionStyleHints: input.decisionStyleHints,
      enterpriseBaseInfo: input.enterpriseBaseInfo,
      investorBaseInfo: input.investorBaseInfo,
      profileSummary: input.profileSummary,
      behaviorSummary: input.behaviorSummary,
      amountUnit: input.amountUnit,
      percentageUnit: input.percentageUnit,
      volumeUnit: input.volumeUnit,
      replaceBaseInfo: false,
    });

    return this.buildUserProfileResponse(input.userId);
  }

  async writePrivateMemory(payload: unknown) {
    const input = parseSchema(payload, privateMemoryWriteRequestSchema);
    const memory = await this.memoryStore.write({
      userId: input.userId,
      summary: input.title,
      details: input.content,
      tags: uniqueStrings([
        ...(input.tags ?? []),
        input.role ?? "",
      ]).slice(0, 8),
      role: input.role,
      conversationId: input.sessionId,
      source: "manual",
    });

    const snapshot = input.sessionId ? this.sessionStore.get(input.sessionId) : undefined;
    const sessionContext = snapshot
      ? this.sessionStore.toContext(
          await this.sessionStore.upsert({
            sessionId: snapshot.sessionId,
            userId: snapshot.userId,
            role: snapshot.role,
            activeMode: snapshot.activeMode,
            enterpriseName: snapshot.enterpriseName,
            summary: `${snapshot.summary} 已写入一条私有记忆。`,
            investedEnterprises: snapshot.investedEnterprises,
            investorProfileSummary: snapshot.investorProfileSummary,
            lastQuery: snapshot.lastQuery,
            recentEvent: createSessionEvent("private_memory_write", `已保存私有记忆：${input.title}`),
            metadata: snapshot.metadata,
          }),
          this.memoryStore.list(input.userId, 3),
        )
      : undefined;
    await this.touchUserProfile({
      userId: input.userId,
      role: input.role ?? snapshot?.role ?? "investor",
      enterpriseName: snapshot?.enterpriseName,
      investedEnterprises: snapshot?.investedEnterprises,
      focusMode: snapshot?.activeMode,
      attentionTags: [...(input.tags ?? []), input.title],
    });

    return {
      memory,
      sessionContext,
    };
  }

  async updatePrivateMemory(memoryId: string, payload: unknown) {
    const input = parseSchema(payload, privateMemoryUpdateRequestSchema);
    const current = this.memoryStore.get(input.userId, memoryId);

    if (!current) {
      throw createNotFoundError("记忆不存在或已被删除。");
    }

    const memory = await this.memoryStore.update(input.userId, memoryId, {
      summary: input.title,
      details: input.content,
      tags: uniqueStrings(input.tags).slice(0, 8),
    });

    if (!memory) {
      throw createNotFoundError("记忆不存在或已被删除。");
    }

    await this.touchUserProfile({
      userId: input.userId,
      role: current.role ?? "investor",
      attentionTags: [...memory.tags, memory.summary],
    });

    return {
      memory,
    };
  }

  async deletePrivateMemory(memoryId: string, payload: unknown) {
    const input = parseSchema(payload, privateMemoryDeleteRequestSchema);
    const current = this.memoryStore.get(input.userId, memoryId);

    if (!current) {
      throw createNotFoundError("记忆不存在或已被删除。");
    }

    const deletedMemory = await this.memoryStore.delete(input.userId, memoryId);

    if (!deletedMemory) {
      throw createNotFoundError("记忆不存在或已被删除。");
    }

    await this.touchUserProfile({
      userId: input.userId,
      role: current.role ?? "investor",
      attentionTags: current.tags,
    });

    return {
      deletedMemoryId: deletedMemory.id,
    };
  }

  async recordUserFeedback(payload: unknown) {
    const input = parseSchema(payload, userFeedbackRequestSchema);
    const snapshot = input.sessionId ? this.sessionStore.get(input.sessionId) : undefined;
    const user = await this.platformStore.upsertUser(input.userId, (current) => {
      const base = current ?? createUserRecord(input.userId);
      const totalScore = (base.feedback.averageRating ?? 0) * base.feedback.ratingCount + input.rating;
      const ratingCount = base.feedback.ratingCount + 1;
      return {
        ...base,
        lastActiveAt: new Date().toISOString(),
        roles: uniqueStrings([...base.roles, input.role ?? snapshot?.role ?? "investor"]) as PersistedUserRecord["roles"],
        feedback: {
          averageRating: Number((totalScore / ratingCount).toFixed(2)),
          ratingCount,
          latestComment: input.comment ?? base.feedback.latestComment,
          learnedSignals: uniqueStrings([
            ...base.feedback.learnedSignals,
            ...(input.signalTags ?? []),
          ]).slice(0, 12),
        },
      };
    });

    return {
      userId: input.userId,
      averageRating: user.feedback.averageRating ?? input.rating,
      ratingCount: user.feedback.ratingCount,
      learnedSignals: user.feedback.learnedSignals,
    };
  }

  getUserHistory(userId: string, viewer: unknown) {
    const role = parseSchema(viewer, historyViewerSchema);
    const analyses = this.platformStore.listAnalysesByUser(userId);
    const tasks = this.platformStore.listTasksByUser(userId);
    const memories = this.memoryStore.list(userId, 20);
    const sessions = this.sessionStore.listByUser(userId);
    const latestSession = sessions[0];
    const user = this.platformStore.getUser(userId);
    const workflowSnapshots = uniqueStrings(analyses.map((item) => item.workflowId ?? ""))
      .map((workflowId) => this.platformStore.getWorkflowSnapshot(workflowId))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return {
      userId,
      viewer: role,
      profile: user
        ? role === "owner"
          ? this.buildUserProfileResponse(userId).profile
          : {
              userId: user.userId,
              displayName: user.displayName,
              identitySource: user.identitySource,
              createdAt: user.createdAt,
              lastActiveAt: user.lastActiveAt,
              roles: user.roles,
              enterpriseNames: user.enterpriseNames,
              investedEnterprises: user.investedEnterprises,
              preferences: {
                preferredRole: user.preferences.preferredRole,
                focusModes: user.preferences.focusModes,
                interests: user.preferences.interests,
                attentionTags: user.preferences.attentionTags,
                goals: [],
                constraints: [],
                decisionStyleHints: [],
              },
              profileSummary: user.profileSummary,
              behaviorSummary: user.behaviorSummary,
              feedback: {
                averageRating: user.feedback.averageRating,
                ratingCount: user.feedback.ratingCount,
                learnedSignals: user.feedback.learnedSignals,
              },
            }
        : undefined,
      summary: {
        sessionCount: sessions.length,
        analysisCount: analyses.length,
        taskCount: tasks.length,
        memoryCount: memories.length,
        workflowCount: workflowSnapshots.length,
      },
      sessions: sessions
        .slice(0, 12)
        .map((snapshot) => this.buildSessionSummary(this.sessionStore.toContext(snapshot, this.memoryStore.list(userId, 3)))),
      latestSessionContext: latestSession
        ? this.sessionStore.toContext(latestSession, this.memoryStore.list(userId, 3))
        : undefined,
      analyses:
        role === "owner"
          ? analyses
          : analyses.map((item) => ({
              analysisId: item.analysisId,
              createdAt: item.createdAt,
              summary: item.summary,
              focusMode: item.focusMode,
              combinedRiskLevel: item.combinedRiskLevel,
              evidenceConfidence: item.evidenceConfidence,
            })),
      tasks:
        role === "owner"
          ? tasks
          : tasks.map((item) => ({
              taskId: item.taskId,
              status: item.status,
              progressPercent: item.progressPercent,
              currentStage: item.currentStage,
              updatedAt: item.updatedAt,
            })),
      memories:
        role === "owner"
          ? memories
          : memories.map((item) => ({
              id: item.id,
              summary: item.summary,
              createdAt: item.createdAt,
            })),
      workflows:
        role === "owner"
          ? workflowSnapshots
          : workflowSnapshots.map((item) => ({
              workflowId: item.workflowId,
              createdAt: item.createdAt,
              summary: item.summary,
              manualTakeoverAvailable: item.manualTakeoverAvailable,
            })),
    };
  }

  getOperationsDashboard(viewer: "operations" | "admin") {
    const users = this.platformStore.listUsers();
    const tasks = this.platformStore.listTasks();
    const analyses = this.platformStore.listAnalyses();
    const failedTasks = tasks.filter((item) => item.status === "failed" || item.status === "manual_takeover");

    return {
      viewer,
      overview: {
        userCount: users.length,
        activeUserCount: users.filter((item) => {
          return new Date().getTime() - new Date(item.lastActiveAt).getTime() <= 7 * 24 * 60 * 60 * 1000;
        }).length,
        analysisCount: analyses.length,
        failedTaskCount: failedTasks.length,
      },
      serviceOpportunities: users
        .map((item) => ({
          userId: item.userId,
          summary: item.profileSummary ?? item.behaviorSummary ?? "缺少长期画像摘要",
          hint:
            item.feedback.averageRating !== undefined && item.feedback.averageRating < 3.5
              ? "优先回访低评分用户并补充人工解释"
              : failedTasks.some((task) => task.userId === item.userId)
                ? "存在失败任务，建议人工接管或补录数据"
                : "可推动升级为持续跟踪服务",
        }))
        .slice(0, viewer === "admin" ? 8 : 5),
      failures: failedTasks.slice(0, 10),
    };
  }

  listPrivateMemories(userId: string, limit = 10, role?: string, tags?: string[]) {
    return {
      items: this.memoryStore.list(userId, limit, role, tags),
    };
  }

  getSessionContext(sessionId: string) {
    const snapshot = this.sessionStore.get(sessionId);

    if (!snapshot) {
      throw createNotFoundError("会话上下文不存在。");
    }

    return this.sessionStore.toContext(snapshot, this.memoryStore.list(snapshot.userId, 3));
  }
}
