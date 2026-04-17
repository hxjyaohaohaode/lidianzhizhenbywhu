import { getClientEnv } from "../shared/config.js";
import type {
  CompetitiveAcceptanceReport,
  DiagnosticWorkflowResponse,
  DualPortalAuditFinding,
  DualPortalDataChannel,
  DualPortalIntegrationStatus,
  DualPortalPageMatrixEntry,
  DualPortalPersonalizationAuditReport,
  DualPortalPersonalizationDriver,
  FocusMode,
  MemoryEntry,
} from "../shared/agents.js";
import type {
  AnalysisTimelineEntry,
  DebateRound,
  EnterpriseAnalysisRequest,
  EnterpriseAnalysisStreamEvent,
  EnterpriseCollectionRequest,
  EnterpriseAttachmentUploadRequest,
  InvestorAnalysisStreamEvent,
  InvestorAnalysisRequest,
  InvestorAttachmentUploadRequest,
  InvestorModeSwitchRequest,
  InvestorProfileRequest,
  InvestorSessionBatchDeleteRequest,
  InvestorSessionCreateRequest,
  InvestorSessionDeleteRequest,
  PrivateMemoryUpdateRequest,
  PrivateMemoryWriteRequest,
  ProfileUpdateReceipt,
  SessionContext,
  SessionHistorySummary,
  SessionAttachment,
  UserIdentityBootstrapRequest,
  UserPreferencesUpdateRequest,
  UserProfileResponse,
} from "../shared/business.js";
import type { HealthResponse, MetaResponse } from "../shared/types.js";

const clientEnv = getClientEnv(import.meta.env);

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

export type ConfidenceLabel = "high" | "medium" | "low";
export type RecommendationStance = "推荐关注" | "谨慎跟踪" | "暂缓配置";

export type CollectionSummary = {
  confidentialityNotice: string;
  historyCoverage: "fullHistory" | "baselineComparison";
  capturedModules: string[];
  quarterScope: {
    currentQuarter: string;
    baselineQuarter: string;
    recentQuarterLabels: string[];
  };
  confidenceLabel: ConfidenceLabel;
  limitations: string[];
};

export type EnterpriseCollectionResponse = {
  sessionContext: SessionContext;
  collectionSummary: CollectionSummary;
};

export type EnterpriseAnalysisResponse = {
  sessionContext: SessionContext;
  collectionSummary: CollectionSummary;
  diagnostic: DiagnosticWorkflowResponse;
  highlights: {
    combinedRiskLevel: "low" | "medium" | "high";
    combinedInsights: string[];
  };
};

export type InvestorProfileResponse = {
  profileId: string;
  portraitSummary: string;
  recommendedMode: FocusMode;
  sessionContext: SessionContext;
};

export type InvestorModeResponse = {
  activeMode: FocusMode;
  modeSummary: string;
  sessionContext: SessionContext;
};

export type InvestorAnalysisResponse = {
  sessionContext: SessionContext;
  diagnostic: DiagnosticWorkflowResponse;
  recommendation: {
    stance: RecommendationStance;
    score: number;
    fitSignals: string[];
    rationale: string;
  };
  deepDive: {
    thesis: string;
    modules: Array<{
      name: string;
      summary: string;
    }>;
    challengedClaims: string[];
  };
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

export type InvestorSessionListResponse = {
  items: SessionHistorySummary[];
};

export type InvestorSessionCreateResponse = {
  sessionContext: SessionContext;
};

export type InvestorSessionDeleteResponse = {
  deletedSessionIds: string[];
  replacementSessionContext?: SessionContext;
  deletedCount?: number;
};

export type InvestorAttachmentUploadResponse = {
  attachment: SessionAttachment;
  warnings: string[];
  sessionContext: SessionContext;
};

export type EnterpriseAttachmentUploadResponse = {
  attachment: SessionAttachment;
  warnings: string[];
  sessionContext: SessionContext;
};

export type MemoryWriteResponse = {
  memory: MemoryEntry;
  sessionContext?: SessionContext;
};

export type MemoryListResponse = {
  items: MemoryEntry[];
};

export type MemoryDeleteResponse = {
  deletedMemoryId: string;
};

export type PortalAuditRole = "enterprise" | "investor";
export type PortalAuditChannelStatus = DualPortalIntegrationStatus;

export type PortalAuditChannel = Omit<DualPortalDataChannel, "channelId" | "audience" | "integrationStatus"> & {
  id: string;
  role: PortalAuditRole | "shared";
  status: PortalAuditChannelStatus;
};

export type PortalAuditPage = DualPortalPageMatrixEntry;
export type PortalAuditDriver = DualPortalPersonalizationDriver;
export type PortalAuditFinding = DualPortalAuditFinding;

export type PortalAuditReport = {
  generatedAt: string;
  role: PortalAuditRole;
  roleLabel: string;
  summary: string;
  channels: PortalAuditChannel[];
  pages: PortalAuditPage[];
  drivers: PortalAuditDriver[];
  findings: PortalAuditFinding[];
  releaseGates: string[];
  statusBreakdown: Record<PortalAuditChannelStatus, number>;
};

function createPortalAuditStatusBreakdown(): Record<PortalAuditChannelStatus, number> {
  return {
    real: 0,
    simulated: 0,
    degraded: 0,
    placeholder: 0,
  };
}

function isPortalAuditAudienceMatched(
  audience: DualPortalDataChannel["audience"] | DualPortalPersonalizationDriver["audience"],
  role: PortalAuditRole,
) {
  return audience === "shared" || audience === role;
}

function buildPortalAuditSummary(role: PortalAuditRole, channelCount: number, pageCount: number) {
  return role === "enterprise"
    ? `共纳入 ${channelCount} 条企业端相关个性化链路，覆盖 ${pageCount} 个企业页面，重点校验经营诊断链路是否与投资端内容隔离。`
    : `共纳入 ${channelCount} 条投资端相关个性化链路，覆盖 ${pageCount} 个投资页面，重点校验研究判断链路是否与企业端内容隔离。`;
}

export async function fetchPortalAuditReport(role: PortalAuditRole, userId: string): Promise<PortalAuditReport> {
  const report = await requestJson<DualPortalPersonalizationAuditReport>(
    `/acceptance/dual-portal-personalization-audit?userId=${encodeURIComponent(userId)}`,
  );
  const pages = report.pageMatrix.filter((page) => page.audience === role);
  const channels = report.dataChannels
    .filter((channel) => isPortalAuditAudienceMatched(channel.audience, role))
    .map<PortalAuditChannel>((channel) => ({
      ...channel,
      id: channel.channelId,
      role: channel.audience,
      status: channel.integrationStatus,
    }));
  const drivers = report.personalizationDrivers.filter((driver) =>
    isPortalAuditAudienceMatched(driver.audience, role)
  );
  const channelIdSet = new Set(channels.map((channel) => channel.id));
  const driverIdSet = new Set(drivers.map((driver) => driver.driverId));
  const findings = report.findings.filter((finding) =>
    finding.relatedChannelIds.length === 0 ||
    finding.relatedChannelIds.some((channelId) => channelIdSet.has(channelId)) ||
    finding.relatedDriverIds.some((driverId) => driverIdSet.has(driverId))
  );
  const roleLabel = role === "enterprise" ? "企业端" : "投资端";
  const statusBreakdown = channels.reduce((summary, channel) => {
    summary[channel.status] += 1;
    return summary;
  }, createPortalAuditStatusBreakdown());

  return {
    generatedAt: report.generatedAt,
    role,
    roleLabel,
    summary: buildPortalAuditSummary(role, channels.length, pages.length),
    channels,
    pages,
    drivers,
    findings,
    releaseGates: report.releaseGates,
    statusBreakdown,
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${clientEnv.VITE_API_BASE_URL}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    console.error(`[API 404/500] ${response.status} ${url}`);
    let message = `Request failed with status ${response.status}`;

    try {
      const errorPayload = (await response.json()) as { message?: string };
      if (errorPayload.message) {
        message = errorPayload.message;
      }
    } catch {
      // ignore JSON parsing errors and preserve default status message
    }

    throw new Error(message);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`服务端返回了非JSON格式的响应（HTTP ${response.status}）`);
  }
}

export function fetchHealth() {
  return requestJson<HealthResponse>("/health");
}

export function fetchMeta() {
  return requestJson<MetaResponse>("/meta");
}

export function fetchCompetitiveBaselineReport(userId: string) {
  return requestJson<CompetitiveAcceptanceReport>(`/acceptance/competitive-baseline?userId=${encodeURIComponent(userId)}`);
}

export function bootstrapUserIdentity(payload: UserIdentityBootstrapRequest) {
  return requestJson<UserProfileResponse>("/users/bootstrap", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchUserProfile(userId: string) {
  return requestJson<UserProfileResponse>(`/users/${encodeURIComponent(userId)}`);
}

export function updateUserPreferences(userId: string, payload: Omit<UserPreferencesUpdateRequest, "userId">) {
  return requestJson<UserProfileResponse>(`/users/${encodeURIComponent(userId)}/preferences`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function collectEnterpriseData(payload: EnterpriseCollectionRequest) {
  return requestJson<EnterpriseCollectionResponse>("/enterprise/collect", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function analyzeEnterprise(payload: EnterpriseAnalysisRequest) {
  return requestJson<EnterpriseAnalysisResponse>("/enterprise/analyze", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function streamEnterpriseAnalysis(
  payload: EnterpriseAnalysisRequest,
  onEvent: (event: EnterpriseAnalysisStreamEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(`${clientEnv.VITE_API_BASE_URL}/enterprise/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        const dataLine = chunk
          .split("\n")
          .find((line) => line.startsWith("data:"))
          ?.replace(/^data:\s*/, "");

        if (!dataLine) {
          continue;
        }

        try {
          onEvent(JSON.parse(dataLine) as EnterpriseAnalysisStreamEvent);
        } catch {
          // skip malformed SSE data line
        }
      }
    }

    // Process remaining buffer after stream ends
    if (buffer.trim()) {
      const dataLine = buffer
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.replace(/^data:\s*/, "");

      if (dataLine) {
        try {
          onEvent(JSON.parse(dataLine) as EnterpriseAnalysisStreamEvent);
        } catch {
          // skip malformed SSE data line
        }
      }
    }
  } catch (streamError) {
    if (signal?.aborted) {
      return;
    }
    console.warn("SSE stream read error:", streamError);
  } finally {
    reader.releaseLock();
  }
}

export function createInvestorProfile(payload: InvestorProfileRequest) {
  return requestJson<InvestorProfileResponse>("/investor/profile", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchInvestorSessions(userId: string) {
  return requestJson<InvestorSessionListResponse>(`/investor/sessions/${encodeURIComponent(userId)}?userId=${encodeURIComponent(userId)}&role=investor`);
}

export function fetchEnterpriseSessions(userId: string) {
  return requestJson<InvestorSessionListResponse>(`/enterprise/sessions/${encodeURIComponent(userId)}?userId=${encodeURIComponent(userId)}`);
}

export function fetchInvestorSessionContext(sessionId: string, userId: string) {
  return requestJson<SessionContext>(`/context/${encodeURIComponent(sessionId)}?userId=${encodeURIComponent(userId)}`);
}

export function createInvestorSession(payload: InvestorSessionCreateRequest) {
  return requestJson<InvestorSessionCreateResponse>("/investor/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteCurrentInvestorSession(payload: InvestorSessionDeleteRequest) {
  return requestJson<InvestorSessionDeleteResponse>("/investor/sessions/delete-current", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteInvestorSessions(payload: InvestorSessionBatchDeleteRequest) {
  return requestJson<InvestorSessionDeleteResponse>("/investor/sessions/delete-batch", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function uploadInvestorAttachment(payload: InvestorAttachmentUploadRequest) {
  return requestJson<InvestorAttachmentUploadResponse>("/investor/attachments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function uploadEnterpriseAttachment(payload: EnterpriseAttachmentUploadRequest) {
  return requestJson<EnterpriseAttachmentUploadResponse>("/enterprise/attachments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function switchInvestorMode(payload: InvestorModeSwitchRequest) {
  return requestJson<InvestorModeResponse>("/investor/mode", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function analyzeInvestorRecommendation(payload: InvestorAnalysisRequest) {
  return requestJson<InvestorAnalysisResponse>("/investor/recommend", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function analyzeInvestorDeepDive(payload: InvestorAnalysisRequest) {
  return requestJson<InvestorAnalysisResponse>("/investor/deep-dive", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function analyzeInvestorIndustryStatus(payload: InvestorAnalysisRequest) {
  return requestJson<InvestorAnalysisResponse>("/investor/industry-status", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function streamInvestorAnalysis(
  payload: InvestorAnalysisRequest,
  onEvent: (event: InvestorAnalysisStreamEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(`${clientEnv.VITE_API_BASE_URL}/investor/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        const dataLine = chunk
          .split("\n")
          .find((line) => line.startsWith("data:"))
          ?.replace(/^data:\s*/, "");

        if (!dataLine) {
          continue;
        }

        try {
          onEvent(JSON.parse(dataLine) as InvestorAnalysisStreamEvent);
        } catch {
          // skip malformed SSE data line
        }
      }
    }

    // Process remaining buffer after stream ends
    if (buffer.trim()) {
      const dataLine = buffer
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.replace(/^data:\s*/, "");

      if (dataLine) {
        try {
          onEvent(JSON.parse(dataLine) as InvestorAnalysisStreamEvent);
        } catch {
          // skip malformed SSE data line
        }
      }
    }
  } catch (streamError) {
    if (signal?.aborted) {
      return;
    }
    console.warn("SSE stream read error:", streamError);
  } finally {
    reader.releaseLock();
  }
}

export function writePrivateMemory(payload: PrivateMemoryWriteRequest) {
  return requestJson<MemoryWriteResponse>("/memory", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchPrivateMemories(userId: string, limit = 8) {
  return requestJson<MemoryListResponse>(`/memory/${encodeURIComponent(userId)}?userId=${encodeURIComponent(userId)}&limit=${limit}`);
}

export function updatePrivateMemory(memoryId: string, payload: PrivateMemoryUpdateRequest) {
  return requestJson<MemoryWriteResponse>(`/memory/${encodeURIComponent(memoryId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deletePrivateMemory(memoryId: string, userId: string) {
  return requestJson<MemoryDeleteResponse>(
    `/memory/${encodeURIComponent(memoryId)}?userId=${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
    },
  );
}

export async function clearRagCache(userId: string): Promise<{ success: boolean; message: string }> {
  return requestJson("/rag/cache/clear?userId=" + encodeURIComponent(userId), { method: "POST" });
}

export async function fetchLatestIndustryData() {
  return requestJson<{ success: boolean; data: Record<string, unknown> | null; message?: string }>("/data/industry/latest");
}

export async function fetchEnterpriseFinancialData(enterpriseId: string) {
  return requestJson<{ success: boolean; data: Record<string, unknown> | null; message?: string }>(`/data/financial/${encodeURIComponent(enterpriseId)}`);
}

export async function refreshData(userId: string, enterpriseName?: string) {
  return requestJson<{ success: boolean; data: Record<string, unknown> }>("/data/refresh", {
    method: "POST",
    body: JSON.stringify({ userId, enterpriseName }),
  });
}

export async function fetchSessionMessages(sessionId: string, userId: string) {
  return requestJson<{ success: boolean; data: ChatMessage[] }>(`/sessions/${encodeURIComponent(sessionId)}/messages?userId=${encodeURIComponent(userId)}`);
}

export async function realtimeRagSearch(payload: {
  query: string;
  maxResults?: number;
  maxSourceAgeDays?: number;
  minConfidence?: number;
  userId: string;
}) {
  return requestJson("/rag/realtime", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchMinimumDeploymentAudit(userId: string) {
  return requestJson("/acceptance/minimum-deployment?userId=" + encodeURIComponent(userId));
}

export async function submitFeedback(payload: {
  userId: string;
  sessionId?: string;
  rating: number;
  comment?: string;
  category?: string;
}) {
  return requestJson("/feedback", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchUserHistory(userId: string, viewer = "owner") {
  return requestJson(`/history/${encodeURIComponent(userId)}?viewer=${encodeURIComponent(viewer)}`);
}

export async function submitEnterpriseAnalysisTask(payload: {
  userId: string;
  enterpriseName: string;
  query: string;
}) {
  return requestJson("/tasks/enterprise-analysis", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function submitInvestorAnalysisTask(payload: {
  userId: string;
  enterpriseName: string;
  query: string;
}) {
  return requestJson("/tasks/investor-analysis", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchTaskStatus(taskId: string, userId: string) {
  return requestJson(`/tasks/${encodeURIComponent(taskId)}?userId=${encodeURIComponent(userId)}`);
}

export async function requestTaskManualTakeover(taskId: string, userId: string) {
  return requestJson(`/tasks/${encodeURIComponent(taskId)}/manual-takeover?userId=${encodeURIComponent(userId)}`, {
    method: "POST",
  });
}

export async function calculateDQI(payload: {
  userId: string;
  currentRoe: number;
  baselineRoe: number;
  currentGrowth: number;
  baselineGrowth: number;
  currentOcfRatio: number;
  baselineOcfRatio: number;
}) {
  return requestJson("/models/dqi/calculate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function calculateGMPS(payload: {
  userId: string;
  gpmYoy: number;
  indVolYoy: number;
  mfgCostRatio: number;
  inventoryTurnover: number;
  ocfToRevenue: number;
  debtToAsset: number;
  rAndDIntensity: number;
}) {
  return requestJson("/models/gmps/calculate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function analyzeGrossMarginPressure(payload: {
  userId: string;
  currentGrossMargin: number;
  baselineGrossMargin: number;
  currentRevenue: number;
  baselineRevenue: number;
  currentCost: number;
  baselineCost: number;
  currentSalesVolume: number;
  baselineSalesVolume: number;
  currentInventoryExpense: number;
  baselineInventoryExpense: number;
}) {
  return requestJson("/models/gross-margin-pressure", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function analyzeOperatingQuality(payload: {
  userId: string;
  currentSalesVolume: number;
  baselineSalesVolume: number;
  currentProductionVolume: number;
  baselineProductionVolume: number;
  currentManufacturingExpense: number;
  baselineManufacturingExpense: number;
  currentOperatingCost: number;
  baselineOperatingCost: number;
  currentOperatingCashFlow: number;
  baselineOperatingCashFlow: number;
  currentRevenue: number;
  baselineRevenue: number;
  currentTotalLiabilities: number;
  baselineTotalLiabilities: number;
  currentTotalAssets: number;
  baselineTotalAssets: number;
}) {
  return requestJson("/models/operating-quality", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchOpsDashboard(userId: string, viewer = "operations") {
  return requestJson(`/ops/dashboard?viewer=${encodeURIComponent(viewer)}`);
}

export { clientEnv };
