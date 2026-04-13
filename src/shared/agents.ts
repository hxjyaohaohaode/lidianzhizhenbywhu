import { z } from "zod";

import {
  grossMarginPressureInputSchema,
  operatingQualityInputSchema,
  type GrossMarginPressureResult,
  type OperatingQualityResult,
} from "./diagnostics.js";
import type { DeploymentReadiness, ProviderStatus, RuntimeReadiness } from "./types.js";

export const providerIdSchema = z.enum(["deepseekReasoner", "glm5", "qwen35Plus"]);
export const diagnosticRoleSchema = z.enum(["enterprise", "investor"]);
export const focusModeSchema = z.enum([
  "operationalDiagnosis",
  "industryStatus",
  "investmentRecommendation",
  "deepDive",
]);
export const agentIdSchema = z.enum([
  "taskOrchestrator",
  "memoryManagement",
  "dataGathering",
  "dataUnderstanding",
  "mathAnalysis",
  "industryRetrieval",
  "evidenceReview",
  "expressionGeneration",
]);

const industryContextSchema = z.object({
  marketDemandIndex: z.coerce.number().min(0).max(200).optional(),
  materialCostTrend: z.enum(["up", "flat", "down"]).optional(),
  policySignals: z.array(z.string().min(1)).max(6).default([]),
});

export const diagnosticAgentRequestSchema = z.object({
  role: diagnosticRoleSchema,
  userId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  enterpriseName: z.string().min(1).optional(),
  query: z.string().min(1),
  focusMode: focusModeSchema.default("operationalDiagnosis"),
  grossMarginInput: grossMarginPressureInputSchema.optional(),
  operatingQualityInput: operatingQualityInputSchema.optional(),
  memoryNotes: z.array(z.string().min(1)).default([]),
  industryContext: industryContextSchema.optional(),
  complexity: z.enum(["simple", "moderate", "full"]).optional(),
});

export type ProviderId = z.infer<typeof providerIdSchema>;
export type DiagnosticRole = z.infer<typeof diagnosticRoleSchema>;
export type FocusMode = z.infer<typeof focusModeSchema>;
export type TaskComplexity = "simple" | "moderate" | "full";
export type QueryIntent = "diagnostic" | "chitchat" | "meta";
export type AgentId = z.infer<typeof agentIdSchema>;
export type DiagnosticAgentRequest = z.output<typeof diagnosticAgentRequestSchema>;

export type TaskPlanStep = {
  agentId: AgentId;
  goal: string;
  dependsOn: AgentId[];
  executionMode: "serial" | "parallel";
};

export type ProviderAttempt = {
  provider: ProviderId;
  model: string;
  status: "success" | "unavailable" | "failed";
  latencyMs: number;
  error?: string;
};

export type DegradationEvent = {
  agentId: AgentId;
  reason: "provider_unavailable" | "provider_failed" | "heuristic_fallback";
  message: string;
  provider?: ProviderId;
  occurredAt: string;
};

export type MemoryEntry = {
  id: string;
  userId: string;
  summary: string;
  tags: string[];
  details?: string;
  role?: DiagnosticRole;
  conversationId?: string;
  source?: "workflow" | "manual";
  createdAt: string;
};

export type DataUnderstandingOutput = {
  objective: string;
  extractedFocus: string[];
  datasetCompleteness: "high" | "medium" | "low";
  missingInputs: string[];
};

export type MathAnalysisOutput = {
  grossMargin?: GrossMarginPressureResult;
  operatingQuality?: OperatingQualityResult;
  combinedRiskLevel: "low" | "medium" | "high";
  combinedInsights: string[];

  // 新增DQI结果（完整版）
  dqiModel?: {
    dqi: number;
    status: "改善" | "稳定" | "恶化";
    driver: "盈利能力" | "成长能力" | "现金流质量" | "无明显驱动";
    decomposition: {
      profitabilityContribution: number;
      growthContribution: number;
      cashflowContribution: number;
    };
    metrics: {
      currentROE: number;
      baselineROE: number;
      roeRatio: number;
      currentGrowth: number;
      baselineGrowth: number;
      growthRatio: number;
      currentOCFRatio: number;
      baselineOCFRatio: number;
      ocfRatioChange: number;
    };
    trend: string;
    confidence: number;
  };

  // 新增GMPS结果（完整版）
  gmpsModel?: {
    gmps: number;
    level: "低压" | "中压" | "高压";
    probabilityNextQuarter: number;
    riskLevel: "低风险" | "中风险" | "高风险";
    dimensionScores: {
      A_毛利率结果: number;
      B_材料成本冲击: number;
      C_产销负荷: number;
      D_外部风险: number;
      E_现金流安全: number;
    };
    featureScores: Record<string, number>;
    keyFindings: string[];
  };

  dataProvenance?: {
    estimatedFields: string[];
    estimationMethod: string;
  };
};

export type CitationConfidence = "high" | "medium" | "low";

// 新增：模型请求接口（用于内部类型安全）
export type ModelRequest = {
  modelType: 'DQI' | 'GMPS' | 'BOTH';
  enterpriseData: {
    // DQI所需数据
    netProfit?: number;
    beginningEquity?: number;
    endingEquity?: number;
    revenue?: number;
    operatingCashFlow?: number;

    // GMPS所需数据
    grossMargin?: number;
    operatingCost?: number;
    salesVolume?: number;
    productionVolume?: number;
    inventory?: number;
    manufacturingExpense?: number;
    totalLiabilities?: number;
    totalAssets?: number;

    // 时间标识
    currentPeriod?: string;
    baselinePeriod?: string;
  };

  industryData?: {
    lithiumPrice?: number;
    lithiumPriceBaseline?: number;
    industryVolatility?: number;
  };
};

export type RagDocumentType =
  | "financialReport"
  | "industryReport"
  | "marketNews"
  | "macroData"
  | "unknown";

export type RagCitationTrace = {
  documentId: string;
  documentType: RagDocumentType;
  chunkId: string;
  chunkIndex: number;
  chunkLength: number;
  contentHash: string;
  matchedMetrics: string[];
  matchedTerms: string[];
  searchProvider: string;
  fallbackUsed: boolean;
  rankingSignals: {
    lexicalScore: number;
    metadataScore: number;
    authorityScore: number;
    freshnessScore: number;
    searchRankScore: number;
    relevanceScore: number;
    confidenceScore: number;
  };
};

export type IndustryCitation = {
  id: string;
  title: string;
  url: string;
  source: string;
  summary: string;
  excerpt: string;
  confidence: CitationConfidence;
  confidenceScore: number;
  relevanceScore: number;
  publishedAt?: string;
  retrievedAt: string;
  trace: RagCitationTrace;
};

export type IndustryEvidence = {
  source: string;
  finding: string;
  confidence: CitationConfidence;
  confidenceScore?: number;
  citationId?: string;
  citationUrl?: string;
  summary?: string;
};

export type IndustryRetrievalOutput = {
  query: string;
  synthesis: string;
  retrievalSummary: string;
  referenceAbstract: string;
  evidence: IndustryEvidence[];
  citations: IndustryCitation[];
  indexStats: {
    searchHits: number;
    fetchedPages: number;
    chunkCount: number;
    rankedChunks: number;
    searchProvider: string;
    fallbackUsed: boolean;
    cacheHit?: boolean;
    filteredSources?: number;
    staleFiltered?: number;
    conflictWarnings?: string[];
  };
};

export type EvidenceReviewOutput = {
  confidence: "high" | "medium" | "low";
  confidenceScore: number;
  verifiedClaims: string[];
  challengedClaims: string[];
  citations: string[];
  citationAbstracts: string[];
  reviewSummary: string;
};

export type MemoryManagementOutput = {
  workingMemoryDigest: string;
  recalledMemories: MemoryEntry[];
  savedMemory?: MemoryEntry;
};

export type DataGatheringOutput = {
  gatheredData: Record<string, unknown>;
  status: string;
  source: string;
};

export type ExpressionGenerationOutput = {
  executiveSummary: string;
  recommendedActions: string[];
  citationAbstract: string;
  finalAnswer: string;
};

export type CompetitiveMetricId =
  | "timeliness"
  | "credibility"
  | "personalization"
  | "collaborationEfficiency";

export type CompetitiveMetricResult = {
  metricId: CompetitiveMetricId;
  label: string;
  score: number;
  threshold: number;
  passed: boolean;
  evidence: string[];
};

export type WorkflowAcceptanceResult = {
  overallScore: number;
  overallPassed: boolean;
  metrics: CompetitiveMetricResult[];
};

export type CompetitiveAcceptanceScenarioResult = {
  scenarioId: string;
  label: string;
  role: DiagnosticRole;
  focusMode: FocusMode;
  workflowId: string;
  summary: string;
  acceptance: WorkflowAcceptanceResult;
};

export type RagTraceabilityScenarioResult = {
  scenarioId: string;
  label: string;
  query: string;
  citationCount: number;
  traceCoverage: number;
  documentTypes: RagDocumentType[];
  searchProvider: string;
  fallbackUsed: boolean;
  passed: boolean;
  evidence: string[];
};

export type RagTraceabilityReport = {
  totalScenarioCount: number;
  passedScenarioCount: number;
  scenarios: RagTraceabilityScenarioResult[];
};

export type ModelConnectivityAcceptanceCase = {
  caseId: string;
  label: string;
  provider: ProviderId;
  model: string;
  capability: "planning" | "understanding" | "retrieval" | "review" | "expression" | "memory" | "conversation";
  available: boolean;
  status: "passed" | "failed" | "unavailable";
  latencyMs: number;
  responsePreview?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  error?: string;
};

export type ModelConnectivityAcceptanceReport = {
  overallPassed: boolean;
  passedCaseCount: number;
  totalCaseCount: number;
  cases: ModelConnectivityAcceptanceCase[];
  notes: string[];
};

export type AcceptanceEvidenceMode = "automated_mock" | "configured_runtime";

export type PerformanceBaseline = {
  scenarioCount: number;
  averageWorkflowDurationMs: number;
  maxWorkflowDurationMs: number;
  averageAgentDurationMs: number;
  averageBudgetUsedTokens: number;
  averageCitationCount: number;
  averageExternalRecordCount: number;
  averageSearchHits: number;
  averageChunkCount: number;
  reproducibilityKey: string;
  evidenceMode: AcceptanceEvidenceMode;
};

export type BusinessQualityBaseline = {
  overallScore: number;
  overallPassed: boolean;
  minimumScenarioScore: number;
  scenarioScores: Array<{
    scenarioId: string;
    score: number;
    passed: boolean;
  }>;
  metrics: CompetitiveMetricResult[];
  evidenceMode: AcceptanceEvidenceMode;
};

export type AcceptanceReproductionInfo = {
  command: string;
  evaluationVersion: string;
  scenarioIds: string[];
  environmentMode: AcceptanceEvidenceMode;
};

export type CompetitiveAcceptanceReport = {
  generatedAt: string;
  evidenceMode: AcceptanceEvidenceMode;
  baselines: Array<{
    metricId: CompetitiveMetricId;
    label: string;
    threshold: number;
  }>;
  aggregate: {
    overallScore: number;
    overallPassed: boolean;
    passedScenarioCount: number;
    totalScenarioCount: number;
    metrics: CompetitiveMetricResult[];
  };
  scenarios: CompetitiveAcceptanceScenarioResult[];
  ragTraceability: RagTraceabilityReport;
  modelConnectivity: ModelConnectivityAcceptanceReport;
  performanceBaseline: PerformanceBaseline;
  businessQualityBaseline: BusinessQualityBaseline;
  reproduction: AcceptanceReproductionInfo;
};

export type MinimumDeploymentAuditCheck = {
  checkId:
    | "server_only_config"
    | "minimum_api_inputs"
    | "persistence_ready"
    | "workflow_smoke_test"
    | "personalization_memory_recall";
  label: string;
  passed: boolean;
  evidence: string[];
};

export type MinimumDeploymentSmokeWorkflow = {
  firstWorkflowId: string;
  secondWorkflowId: string;
  finalAnswerReady: boolean;
  degradedDataSource: boolean;
  recalledMemoryCount: number;
  savedMemoryCount: number;
  passed: boolean;
};

export type MinimumDeploymentAuditReport = {
  generatedAt: string;
  evidenceMode: AcceptanceEvidenceMode;
  overallPassed: boolean;
  deploymentReadiness: DeploymentReadiness;
  runtimeReadiness: RuntimeReadiness;
  checks: MinimumDeploymentAuditCheck[];
  smokeWorkflow: MinimumDeploymentSmokeWorkflow;
  recommendations: string[];
};

export type DualPortalAuditAudience = DiagnosticRole | "shared";

export type DualPortalAuditLayer =
  | "frontendInput"
  | "frontendApi"
  | "serverRoute"
  | "service"
  | "storage"
  | "chart"
  | "externalSource";

export type DualPortalIntegrationStatus = "real" | "simulated" | "degraded" | "placeholder";

export type DualPortalDataChannel = {
  channelId: string;
  label: string;
  audience: DualPortalAuditAudience;
  layer: DualPortalAuditLayer;
  source: string;
  target: string;
  purpose: string;
  integrationStatus: DualPortalIntegrationStatus;
  affectsPersonalization: boolean;
  personalizationDrivers: string[];
  notes: string[];
};

export type DualPortalPageMatrixEntry = {
  pageId: string;
  audience: DiagnosticRole;
  pageName: string;
  primaryGoal: string;
  keyModules: string[];
  chartFamilies: string[];
  primaryActions: string[];
  copySignals: string[];
  personalizationDrivers: string[];
  isolationExpectations: string[];
};

export type DualPortalDriverStatus = "active" | "partial" | "stored_only";

export type DualPortalPersonalizationDriver = {
  driverId: string;
  label: string;
  audience: DualPortalAuditAudience;
  sourceFields: string[];
  upstreamChannels: string[];
  downstreamSurfaces: string[];
  effectSummary: string;
  status: DualPortalDriverStatus;
};

export type DualPortalAuditFindingSeverity = "high" | "medium" | "low";

export type DualPortalAuditFinding = {
  findingId: string;
  severity: DualPortalAuditFindingSeverity;
  title: string;
  summary: string;
  relatedChannelIds: string[];
  relatedDriverIds: string[];
  recommendedAction: string;
};

export type DualPortalPersonalizationAuditReport = {
  generatedAt: string;
  summary: {
    channelCount: number;
    pageCount: number;
    driverCount: number;
    integrationStatusBreakdown: Record<DualPortalIntegrationStatus, number>;
  };
  dataChannels: DualPortalDataChannel[];
  pageMatrix: DualPortalPageMatrixEntry[];
  personalizationDrivers: DualPortalPersonalizationDriver[];
  findings: DualPortalAuditFinding[];
  releaseGates: string[];
};

export type AgentExecutionResult = {
  agentId: AgentId;
  status: "completed" | "degraded" | "skipped";
  provider: ProviderId | "local";
  summary: string;
  attempts: ProviderAttempt[];
  startedAt: string;
  completedAt: string;
  governance?: {
    durationMs: number;
    retryCount: number;
    budgetUsedTokens: number;
    manualInterventionAvailable: boolean;
  };
  output:
    | Record<string, unknown>
    | DataUnderstandingOutput
    | DataGatheringOutput
    | MathAnalysisOutput
    | IndustryRetrievalOutput
    | EvidenceReviewOutput
    | MemoryManagementOutput
    | ExpressionGenerationOutput;
};

export type DiagnosticWorkflowResponse = {
  workflowId: string;
  role: DiagnosticRole;
  providerStatus: ProviderStatus;
  plan: TaskPlanStep[];
  agents: AgentExecutionResult[];
  degradationTrace: DegradationEvent[];
  degradedAgents?: Array<{
    agentId: string;
    reason: string;
    fallbackUsed: string;
  }>;
  finalAnswer: string;
  summary: string;
  memorySnapshot: MemoryEntry[];
  acceptance: WorkflowAcceptanceResult;
  governance?: {
    workflowState: "completed" | "degraded";
    totalDurationMs: number;
    retryLimit: number;
    manualTakeoverAvailable: boolean;
    budget: {
      maxTokens: number;
      usedTokens: number;
      withinBudget: boolean;
    };
  };
  complexity?: TaskComplexity;
};