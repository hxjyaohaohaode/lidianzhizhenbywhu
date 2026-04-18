import { z } from "zod";

import {
  diagnosticRoleSchema,
  type FocusMode,
  type MemoryEntry,
} from "./agents.js";
import {
  grossMarginPressureInputSchema,
  operatingQualityInputSchema,
} from "./diagnostics.js";

const nonEmptyString = z.string().min(1);
const percentageNumber = z.coerce
  .number()
  .min(0, "百分比不能低于 0。")
  .max(100, "百分比不能高于 100。")
  .finite("请输入有效百分比。");
const themeModeSchema = z.enum(["light", "dark", "system"]);
const editableBusinessInfoValueSchema = z.union([
  nonEmptyString.max(200),
  z.array(nonEmptyString.max(200)).max(20),
]);
const editableBusinessInfoSchema = z.record(nonEmptyString.max(60), editableBusinessInfoValueSchema);
const userFocusModeSchema = z.enum([
  "operationalDiagnosis",
  "industryStatus",
  "investmentRecommendation",
  "deepDive",
]);

export const sessionSummaryLimit = 5;
export const memoryPreviewLimit = 3;
export const enterpriseConfidentialityNotice = "我们承诺对贵企业的信息进行保密，数据只用于数据分析。";

export const sharedIndustryContextSchema = z.object({
  marketDemandIndex: z.coerce.number().min(0).max(200).optional(),
  materialCostTrend: z.enum(["up", "flat", "down"]).optional(),
  policySignals: z.array(nonEmptyString).max(6).default([]),
});

export const enterpriseCollectionRequestSchema = z.object({
  userId: nonEmptyString,
  role: z.literal("enterprise").default("enterprise"),
  sessionId: nonEmptyString.optional(),
  enterpriseName: nonEmptyString,
  hasFullQuarterHistory: z.boolean(),
  currentQuarterLabel: nonEmptyString.default("本季度"),
  baselineQuarterLabel: nonEmptyString.default("去年同季度"),
  recentQuarterLabels: z.array(nonEmptyString).max(4).default([]),
  grossMarginInput: grossMarginPressureInputSchema.optional(),
  operatingQualityInput: operatingQualityInputSchema.optional(),
  industryContext: sharedIndustryContextSchema.optional(),
  notes: z.array(nonEmptyString).max(8).default([]),
  enterpriseBaseInfo: editableBusinessInfoSchema.default({}),
});

export const enterpriseAnalysisRequestSchema = z.object({
  userId: nonEmptyString,
  role: z.literal("enterprise").default("enterprise"),
  sessionId: nonEmptyString.optional(),
  enterpriseName: nonEmptyString.optional(),
  query: nonEmptyString.default("请基于已采集数据输出企业经营诊断结论"),
  focusMode: z.enum(["operationalDiagnosis", "deepDive"]).default("operationalDiagnosis"),
  grossMarginInput: grossMarginPressureInputSchema.optional(),
  operatingQualityInput: operatingQualityInputSchema.optional(),
  industryContext: sharedIndustryContextSchema.optional(),
  memoryNotes: z.array(nonEmptyString).max(8).default([]),
  complexity: z.enum(["simple", "moderate", "full"]).default("moderate"),
});

export const investorProfileRequestSchema = z.object({
  userId: nonEmptyString,
  role: z.literal("investor").default("investor"),
  sessionId: nonEmptyString.optional(),
  investorName: nonEmptyString.optional(),
  investedEnterprises: z.array(nonEmptyString).max(12).default([]),
  capitalCostRate: percentageNumber,
  riskAppetite: z.enum(["low", "medium", "high"]),
  investmentHorizon: z.enum(["short", "medium", "long"]),
  interests: z.array(nonEmptyString).max(8).default([]),
  notes: z.array(nonEmptyString).max(8).default([]),
  investorBaseInfo: editableBusinessInfoSchema.default({}),
});

export const investorModeSwitchRequestSchema = z.object({
  userId: nonEmptyString,
  role: z.literal("investor").default("investor"),
  sessionId: nonEmptyString,
  focusMode: z.enum(["industryStatus", "investmentRecommendation", "deepDive"]),
  enterpriseName: nonEmptyString.optional(),
  query: nonEmptyString.optional(),
});

export const investorAnalysisRequestSchema = z.object({
  userId: nonEmptyString,
  role: z.literal("investor").default("investor"),
  sessionId: nonEmptyString.optional(),
  enterpriseName: nonEmptyString.optional(),
  query: nonEmptyString,
  focusMode: z.enum(["industryStatus", "investmentRecommendation", "deepDive"]).default(
    "investmentRecommendation",
  ),
  grossMarginInput: grossMarginPressureInputSchema.optional(),
  operatingQualityInput: operatingQualityInputSchema.optional(),
  industryContext: sharedIndustryContextSchema.optional(),
  memoryNotes: z.array(nonEmptyString).max(8).default([]),
  deepDiveContext: z
    .object({
      objective: nonEmptyString.optional(),
      timeWindow: nonEmptyString.optional(),
      riskBoundary: nonEmptyString.optional(),
      constraints: z.array(nonEmptyString).max(6).default([]),
      answeredQuestions: z.array(nonEmptyString).max(6).default([]),
    })
    .optional(),
  complexity: z.enum(["simple", "moderate", "full"]).default("moderate"),
});

export const investorSessionCreateRequestSchema = z.object({
  userId: nonEmptyString,
  role: z.literal("investor").default("investor"),
  focusMode: z.enum(["industryStatus", "investmentRecommendation", "deepDive"]).default("industryStatus"),
  enterpriseName: nonEmptyString.optional(),
});

export const investorSessionDeleteRequestSchema = z.object({
  userId: nonEmptyString,
  role: z.literal("investor").default("investor"),
  sessionId: nonEmptyString,
});

export const investorSessionBatchDeleteRequestSchema = z.object({
  userId: nonEmptyString,
  role: z.literal("investor").default("investor"),
  sessionIds: z.array(nonEmptyString).min(1).max(20),
});

export const investorAttachmentUploadRequestSchema = z.object({
  userId: nonEmptyString,
  role: z.literal("investor").default("investor"),
  sessionId: nonEmptyString,
  fileName: nonEmptyString.max(120),
  mimeType: nonEmptyString.max(120).optional(),
  content: z.string().min(1).max(40000),
});

export const enterpriseAttachmentUploadRequestSchema = z.object({
  userId: nonEmptyString,
  role: z.literal("enterprise").default("enterprise"),
  sessionId: nonEmptyString,
  fileName: nonEmptyString.max(120),
  mimeType: nonEmptyString.max(120).optional(),
  content: z.string().min(1).max(40000),
});

export const enterpriseSessionCreateRequestSchema = z.object({
  userId: nonEmptyString,
  role: z.literal("enterprise").default("enterprise"),
  focusMode: z.enum(["operationalDiagnosis", "deepDive"]).default("operationalDiagnosis"),
  enterpriseName: nonEmptyString.optional(),
});

export const enterpriseSessionDeleteRequestSchema = z.object({
  userId: nonEmptyString,
  role: z.literal("enterprise").default("enterprise"),
  sessionId: nonEmptyString,
});

export const enterpriseSessionBatchDeleteRequestSchema = z.object({
  userId: nonEmptyString,
  role: z.literal("enterprise").default("enterprise"),
  sessionIds: z.array(nonEmptyString).min(1).max(20),
});

export const privateMemoryWriteRequestSchema = z.object({
  userId: nonEmptyString,
  sessionId: nonEmptyString.optional(),
  role: diagnosticRoleSchema.optional(),
  title: nonEmptyString,
  content: nonEmptyString,
  tags: z.array(nonEmptyString).max(8).default([]),
});

export const privateMemoryUpdateRequestSchema = z.object({
  userId: nonEmptyString,
  title: nonEmptyString,
  content: nonEmptyString,
  tags: z.array(nonEmptyString).max(8).default([]),
});

export const privateMemoryDeleteRequestSchema = z.object({
  userId: nonEmptyString,
});

export const userFeedbackRequestSchema = z.object({
  userId: nonEmptyString,
  sessionId: nonEmptyString.optional(),
  role: diagnosticRoleSchema.optional(),
  rating: z.coerce.number().int().min(1).max(5),
  comment: nonEmptyString.optional(),
  signalTags: z.array(nonEmptyString).max(6).default([]),
});

export const userIdentityBootstrapRequestSchema = z.object({
  userId: nonEmptyString.optional(),
  role: diagnosticRoleSchema.optional(),
  displayName: nonEmptyString.max(60).optional(),
  preferredRole: diagnosticRoleSchema.optional(),
  themeMode: themeModeSchema.optional(),
  themeColor: nonEmptyString.max(40).optional(),
  enterpriseName: nonEmptyString.optional(),
  investedEnterprises: z.array(nonEmptyString).max(12).default([]),
  focusMode: userFocusModeSchema.optional(),
  riskAppetite: z.enum(["low", "medium", "high"]).optional(),
  investmentHorizon: z.enum(["short", "medium", "long"]).optional(),
  interests: z.array(nonEmptyString).max(8).default([]),
  attentionTags: z.array(nonEmptyString).max(12).default([]),
  goals: z.array(nonEmptyString).max(8).default([]),
  constraints: z.array(nonEmptyString).max(8).default([]),
  decisionStyleHints: z.array(nonEmptyString).max(8).default([]),
  enterpriseBaseInfo: editableBusinessInfoSchema.default({}),
  investorBaseInfo: editableBusinessInfoSchema.default({}),
});

export const userPreferencesUpdateRequestSchema = z.object({
  userId: nonEmptyString,
  role: diagnosticRoleSchema.optional(),
  displayName: nonEmptyString.max(60).optional(),
  preferredRole: diagnosticRoleSchema.optional(),
  themeMode: themeModeSchema.optional(),
  themeColor: nonEmptyString.max(40).optional(),
  enterpriseName: nonEmptyString.optional(),
  investedEnterprises: z.array(nonEmptyString).max(12).optional(),
  focusMode: userFocusModeSchema.optional(),
  focusModes: z.array(userFocusModeSchema).max(6).optional(),
  riskAppetite: z.enum(["low", "medium", "high"]).optional(),
  investmentHorizon: z.enum(["short", "medium", "long"]).optional(),
  interests: z.array(nonEmptyString).max(8).optional(),
  attentionTags: z.array(nonEmptyString).max(12).optional(),
  goals: z.array(nonEmptyString).max(8).optional(),
  constraints: z.array(nonEmptyString).max(8).optional(),
  decisionStyleHints: z.array(nonEmptyString).max(8).optional(),
  enterpriseBaseInfo: editableBusinessInfoSchema.optional(),
  investorBaseInfo: editableBusinessInfoSchema.optional(),
  profileSummary: nonEmptyString.max(400).optional(),
  behaviorSummary: nonEmptyString.max(400).optional(),
  amountUnit: z.enum(["yuan", "wan", "yi"]).optional(),
  percentageUnit: z.enum(["percent", "decimal"]).optional(),
  volumeUnit: z.enum(["piece", "k", "m"]).optional(),
});

export const historyViewerSchema = z.enum(["owner", "operations", "admin"]).default("owner");
export const operationsViewerSchema = z.enum(["operations", "admin"]).default("operations");

export type EnterpriseCollectionRequest = z.output<typeof enterpriseCollectionRequestSchema>;
export type EnterpriseAnalysisRequest = z.output<typeof enterpriseAnalysisRequestSchema>;
export type InvestorProfileRequest = z.output<typeof investorProfileRequestSchema>;
export type InvestorModeSwitchRequest = z.output<typeof investorModeSwitchRequestSchema>;
export type InvestorAnalysisRequest = z.output<typeof investorAnalysisRequestSchema>;
export type InvestorSessionCreateRequest = z.output<typeof investorSessionCreateRequestSchema>;
export type InvestorSessionDeleteRequest = z.output<typeof investorSessionDeleteRequestSchema>;
export type InvestorSessionBatchDeleteRequest = z.output<typeof investorSessionBatchDeleteRequestSchema>;
export type InvestorAttachmentUploadRequest = z.output<typeof investorAttachmentUploadRequestSchema>;
export type EnterpriseAttachmentUploadRequest = z.output<typeof enterpriseAttachmentUploadRequestSchema>;
export type EnterpriseSessionCreateRequest = z.output<typeof enterpriseSessionCreateRequestSchema>;
export type EnterpriseSessionDeleteRequest = z.output<typeof enterpriseSessionDeleteRequestSchema>;
export type EnterpriseSessionBatchDeleteRequest = z.output<typeof enterpriseSessionBatchDeleteRequestSchema>;
export type PrivateMemoryWriteRequest = z.output<typeof privateMemoryWriteRequestSchema>;
export type PrivateMemoryUpdateRequest = z.output<typeof privateMemoryUpdateRequestSchema>;
export type PrivateMemoryDeleteRequest = z.output<typeof privateMemoryDeleteRequestSchema>;
export type UserFeedbackRequest = z.output<typeof userFeedbackRequestSchema>;
export type UserIdentityBootstrapRequest = z.output<typeof userIdentityBootstrapRequestSchema>;
export type UserPreferencesUpdateRequest = z.output<typeof userPreferencesUpdateRequestSchema>;
export type EditableBusinessInfoValue = z.output<typeof editableBusinessInfoValueSchema>;
export type EditableBusinessInfo = z.output<typeof editableBusinessInfoSchema>;

export type SessionAttachment = {
  attachmentId: string;
  sessionId: string;
  userId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: "ready" | "metadata_only" | "rejected";
  summary: string;
  excerpt?: string;
  tags: string[];
  warnings: string[];
  uploadedAt: string;
};

export type AnalysisTimelineEntry = {
  id: string;
  stage:
    | "session"
    | "clarification"
    | "understanding"
    | "retrieval"
    | "feasibility"
    | "debate"
    | "evidence"
    | "writing"
    | "profile_update"
    | "completed";
  label: string;
  status: "pending" | "running" | "completed";
  detail?: string;
  progressPercent: number;
  occurredAt: string;
};

export type DebateMessage = {
  id: string;
  round: number;
  speakerRole: "debater" | "judge" | "system";
  speakerModel: "deepseekReasoner" | "glm5" | "qwen35Plus" | "system";
  speakerLabel: string;
  sequence: number;
  content: string;
  occurredAt: string;
  source?: "llm" | "template";
};

export type DebateRound = {
  round: number;
  debaters: ["deepseekReasoner" | "glm5" | "qwen35Plus", "deepseekReasoner" | "glm5" | "qwen35Plus"];
  judge: "deepseekReasoner" | "glm5" | "qwen35Plus";
  verdict: string;
  messages: DebateMessage[];
  degraded?: boolean;
};

export type ProfileInsight = {
  category: "riskAppetite" | "investmentHorizon" | "interest" | "goal" | "constraint" | "decisionStyle";
  value: string;
  confidence: "high" | "medium";
  source: "profile" | "query" | "memory" | "attachment" | "clarification";
};

export type ProfileUpdateReceipt = {
  summary: string;
  updatedFields: string[];
  extractedInsights: ProfileInsight[];
};

export type SessionHistorySummary = {
  sessionId: string;
  userId: string;
  role: z.infer<typeof diagnosticRoleSchema>;
  activeMode: FocusMode;
  enterpriseName?: string;
  summary: string;
  investedEnterprises: string[];
  updatedAt: string;
  attachmentCount: number;
  hasAttachments: boolean;
  lastEventType?: SessionEvent["type"];
};

export type InvestorAnalysisStreamEvent =
  | {
      type: "session";
      sessionContext: SessionContext;
    }
  | {
      type: "progress";
      stage: AnalysisTimelineEntry["stage"];
      label: string;
      progressPercent: number;
      detail?: string;
      timelineEntry: AnalysisTimelineEntry;
    }
  | {
      type: "delta";
      stage: AnalysisTimelineEntry["stage"];
      chunk: string;
    }
  | {
      type: "debate_message";
      message: DebateMessage;
    }
  | {
      type: "profile_update";
      profileUpdate: ProfileUpdateReceipt;
    }
  | {
      type: "clarification_required";
      questions: string[];
      sessionContext?: SessionContext;
    }
  | {
      type: "result";
      result: Record<string, unknown>;
    }
  | {
      type: "error";
      message: string;
    };

export type EnterpriseAnalysisStreamEvent =
  | {
      type: "session";
      sessionContext: SessionContext;
    }
  | {
      type: "progress";
      stage: AnalysisTimelineEntry["stage"];
      label: string;
      progressPercent: number;
      detail?: string;
      timelineEntry: AnalysisTimelineEntry;
    }
  | {
      type: "delta";
      stage: AnalysisTimelineEntry["stage"];
      chunk: string;
    }
  | {
      type: "result";
      result: Record<string, unknown>;
    }
  | {
      type: "error";
      message: string;
    };

export type SessionEvent = {
  id: string;
  type:
    | "enterprise_collection"
    | "enterprise_analysis"
    | "session_created"
    | "session_deleted"
    | "investor_profile"
    | "mode_switch"
    | "attachment_uploaded"
    | "investor_industry_status"
    | "investor_recommendation"
    | "investor_deep_dive"
    | "profile_auto_update"
    | "private_memory_write";
  summary: string;
  occurredAt: string;
};

export type SessionContext = {
  sessionId: string;
  userId: string;
  role: z.infer<typeof diagnosticRoleSchema>;
  activeMode: FocusMode;
  enterpriseName?: string;
  summary: string;
  investedEnterprises: string[];
  investorProfileSummary?: string;
  lastQuery?: string;
  recentEvents: SessionEvent[];
  memoryPreview: MemoryEntry[];
  attachments: SessionAttachment[];
  latestTimeline: AnalysisTimelineEntry[];
  latestDebate: DebateMessage[];
  latestEvidenceSummary: string[];
  latestProfileUpdate?: ProfileUpdateReceipt;
  pendingClarificationQuestions: string[];
  updatedAt: string;
};

export type VisualizationRole = "enterprise" | "investor";
export type VisualizationPage = "home" | "analysis";
export type VisualizationStatus = "good" | "watch" | "risk" | "neutral";

export type VisualizationFilter = {
  id: string;
  label: string;
  defaultValue: string;
  options: Array<{
    value: string;
    label: string;
  }>;
};

export type VisualizationMetricCard = {
  id: string;
  label: string;
  value: string;
  delta?: string;
  benchmark?: string;
  status: VisualizationStatus;
  description?: string;
};

export type VisualizationBarDatum = {
  id: string;
  label: string;
  value: number;
  displayValue: string;
  benchmark?: string;
  detail: string;
  status: VisualizationStatus;
};

export type VisualizationBenchmarkRow = {
  id: string;
  item: string;
  current: string;
  benchmark: string;
  gap: string;
  status: VisualizationStatus;
  note: string;
};

export type VisualizationZebraRow = {
  id: string;
  cells: string[];
  status?: VisualizationStatus;
};

export type VisualizationHeatmapRow = {
  id: string;
  label: string;
  values: number[];
  displayValues: string[];
  notes: string[];
};

export type VisualizationSparkRow = {
  id: string;
  label: string;
  value: string;
  trend: number[];
  trendLabel: string;
  benchmark?: string;
  status: VisualizationStatus;
  note: string;
};

export type VisualizationAlertRow = {
  id: string;
  rule: string;
  current: string;
  threshold: string;
  severity: VisualizationStatus;
  action: string;
};

export type VisualizationCardGroup = {
  id: string;
  title: string;
  description: string;
  items: Array<{
    id: string;
    label: string;
    value: string;
    meta?: string;
    status: VisualizationStatus;
  }>;
};

export type VisualizationTreeRow = {
  id: string;
  parentId?: string;
  label: string;
  owner: string;
  metric: string;
  status: VisualizationStatus;
  note: string;
};

export type VisualizationPivotRow = {
  id: string;
  dimension: string;
  values: string[];
  status: VisualizationStatus;
};

export type VisualizationCalendarEntry = {
  id: string;
  date: string;
  label: string;
  value: string;
  status: VisualizationStatus;
  detail: string;
};

export type VisualizationWaterfallDatum = {
  id: string;
  label: string;
  value: number;
  displayValue: string;
  isTotal?: boolean;
  status?: VisualizationStatus;
  detail?: string;
};

export type VisualizationBoxPlotGroup = {
  id: string;
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers?: number[];
  displayValues: {
    min: string;
    q1: string;
    median: string;
    q3: string;
    max: string;
  };
  status: VisualizationStatus;
  detail: string;
};

export type VisualizationScatterDatum = {
  id: string;
  label: string;
  x: number;
  y: number;
  displayX: string;
  displayY: string;
  status: VisualizationStatus;
  detail: string;
};

export type VisualizationBubbleDatum = {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  displayX: string;
  displayY: string;
  displayZ: string;
  status: VisualizationStatus;
  detail: string;
};

export type VisualizationHeatmapCell = {
  row: string;
  column: string;
  value: number;
  displayValue: string;
  note: string;
};

export type VisualizationRadarDimension = {
  dimension: string;
  current: number;
  baseline: number;
  displayCurrent: string;
  displayBaseline: string;
};

export type VisualizationLineDatum = {
  id: string;
  label: string;
  value: number;
  displayValue: string;
  benchmark?: string;
  detail: string;
  status: VisualizationStatus;
};

export type VisualizationSourceConfidence = "high" | "medium" | "low";
export type VisualizationSourceCategory =
  | "enterprise_input"
  | "user_profile"
  | "industry_benchmark"
  | "industry_retrieval"
  | "math_model"
  | "evidence_review"
  | "session_context"
  | "debate"
  | "attachment";

export type VisualizationSourceMeta = {
  id: string;
  label: string;
  category: VisualizationSourceCategory;
  description: string;
  freshnessLabel: string;
  timestamp?: string;
  confidence: VisualizationSourceConfidence;
  ownerLabel?: string;
  actualSource?: string;
  trace: string[];
};

export type VisualizationSankeyNode = {
  id: string;
  label: string;
  color: string;
  column: number;
};

export type VisualizationSankeyLink = {
  source: string;
  target: string;
  value: number;
};

export type VisualizationWidgetEnhancement = {
  footnote?: string;
  emphasisTag?: string;
  sourceIds?: string[];
};

export type VisualizationWidget =
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "metricCards";
      title: string;
      subtitle?: string;
      description?: string;
      cards: VisualizationMetricCard[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "barChart";
      title: string;
      subtitle?: string;
      description?: string;
      unit: string;
      data: VisualizationBarDatum[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "lineChart";
      title: string;
      subtitle?: string;
      description?: string;
      unit: string;
      threshold?: number;
      thresholdLabel?: string;
      data: VisualizationLineDatum[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "waterfallChart";
      title: string;
      subtitle?: string;
      description?: string;
      unit: string;
      data: VisualizationWaterfallDatum[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "benchmarkTable";
      title: string;
      subtitle?: string;
      description?: string;
      rows: VisualizationBenchmarkRow[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "zebraTable";
      title: string;
      subtitle?: string;
      description?: string;
      columns: string[];
      rows: VisualizationZebraRow[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "heatmapTable";
      title: string;
      subtitle?: string;
      description?: string;
      columns: string[];
      rows: VisualizationHeatmapRow[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "sparklineTable";
      title: string;
      subtitle?: string;
      description?: string;
      rows: VisualizationSparkRow[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "alertTable";
      title: string;
      subtitle?: string;
      description?: string;
      rows: VisualizationAlertRow[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "cardTable";
      title: string;
      subtitle?: string;
      description?: string;
      groups: VisualizationCardGroup[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "treeTable";
      title: string;
      subtitle?: string;
      description?: string;
      rows: VisualizationTreeRow[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "pivotMatrix";
      title: string;
      subtitle?: string;
      description?: string;
      columns: string[];
      rows: VisualizationPivotRow[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "calendarTable";
      title: string;
      subtitle?: string;
      description?: string;
      entries: VisualizationCalendarEntry[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "boxPlotChart";
      title: string;
      subtitle?: string;
      description?: string;
      xLabel: string;
      yLabel: string;
      groups: VisualizationBoxPlotGroup[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "scatterChart";
      title: string;
      subtitle?: string;
      description?: string;
      xLabel: string;
      yLabel: string;
      data: VisualizationScatterDatum[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "bubbleChart";
      title: string;
      subtitle?: string;
      description?: string;
      xLabel: string;
      yLabel: string;
      zLabel: string;
      data: VisualizationBubbleDatum[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "heatmapChart";
      title: string;
      subtitle?: string;
      description?: string;
      rows: string[];
      columns: string[];
      cells: VisualizationHeatmapCell[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "radarChart";
      title: string;
      subtitle?: string;
      description?: string;
      currentLabel: string;
      baselineLabel: string;
      dimensions: VisualizationRadarDimension[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "mulberryChart";
      title: string;
      subtitle?: string;
      description?: string;
      categories: string[];
      series: {
        name: string;
        data: { category: string; value: number; subValue?: number }[];
      }[];
    })
  | (VisualizationWidgetEnhancement & {
      id: string;
      kind: "sankeyChart";
      title: string;
      subtitle?: string;
      description?: string;
      nodes: VisualizationSankeyNode[];
      links: VisualizationSankeyLink[];
    });

export type VisualizationSection = {
  id: string;
  page: VisualizationPage;
  title: string;
  subtitle?: string;
  emphasis?: string;
  widgets: VisualizationWidget[];
};

export type VisualizationPayload = {
  role: VisualizationRole;
  updatedAt: string;
  autoRefreshMs: number;
  sourceSummary: string;
  refreshLabel: string;
  sourceMeta: VisualizationSourceMeta[];
  filters: VisualizationFilter[];
  sections: VisualizationSection[];
};

export type UserProfileSnapshot = {
  userId: string;
  displayName?: string;
  identitySource: "generated" | "provided";
  createdAt: string;
  lastActiveAt: string;
  roles: Array<z.infer<typeof diagnosticRoleSchema>>;
  enterpriseNames: string[];
  investedEnterprises: string[];
  enterpriseBaseInfo?: EditableBusinessInfo;
  investorBaseInfo?: EditableBusinessInfo;
  preferences: {
    themeMode?: z.infer<typeof themeModeSchema>;
    themeColor?: string;
    preferredRole?: z.infer<typeof diagnosticRoleSchema>;
    focusModes: Array<z.infer<typeof userFocusModeSchema>>;
    riskAppetite?: "low" | "medium" | "high";
    investmentHorizon?: "short" | "medium" | "long";
    interests: string[];
    attentionTags: string[];
    goals: string[];
    constraints: string[];
    decisionStyleHints: string[];
    amountUnit?: "yuan" | "wan" | "yi";
    percentageUnit?: "percent" | "decimal";
    volumeUnit?: "piece" | "k" | "m";
  };
  profileSummary?: string;
  behaviorSummary?: string;
  feedback: {
    averageRating?: number;
    ratingCount: number;
    latestComment?: string;
    learnedSignals: string[];
  };
};

export type UserProfileResponse = {
  profile: UserProfileSnapshot;
  stats: {
    sessionCount: number;
    memoryCount: number;
    analysisCount: number;
    taskCount: number;
    workflowCount: number;
  };
  recentSessions: SessionHistorySummary[];
  recentMemories: MemoryEntry[];
  recentAnalyses: Array<{
    analysisId: string;
    createdAt: string;
    summary: string;
    focusMode: FocusMode;
    combinedRiskLevel?: "low" | "medium" | "high";
    evidenceConfidence?: "low" | "medium" | "high";
  }>;
  latestSessionContext?: SessionContext;
};
