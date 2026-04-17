import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { AgentExecutionResult, DiagnosticRole, FocusMode, MemoryEntry } from "../shared/agents.js";
import type { EditableBusinessInfo } from "../shared/business.js";
import type {
  DQIResult,
  GMPSResult,
  DQIDecomposition,
  DQIMetrics,
  GMPSDimensionScores,
} from "../shared/diagnostics.js";

// ==================== 新增：企业财务数据类型 ====================

export interface EnterpriseFinancialData {
  /** 企业唯一标识 */
  enterpriseId: string;
  /** 报告期（如 "2026-Q1", "2025-12"） */
  periodDate: string;

  // === 利润表数据 ===
  /** 营业收入（万元） */
  revenue: number;
  /** 营业成本（万元） */
  operatingCost: number;
  /** 毛利润（万元） */
  grossProfit: number;
  /** 毛利率（百分比，如 25.5 表示 25.5%） */
  grossMargin: number;
  /** 净利润（万元） */
  netProfit: number;

  // === 资产负债表数据 ===
  /** 总资产（万元） */
  totalAssets: number;
  /** 总负债（万元） */
  totalLiabilities: number;
  /** 期初净资产（万元） */
  beginningEquity: number;
  /** 期末净资产（万元） */
  endingEquity: number;
  /** 存货余额（万元） */
  inventory: number;

  // === 现金流量表数据 ===
  /** 经营活动现金流净额（万元） */
  operatingCashFlow: number;

  // === 经营数据 ===
  /** 销售量（万单位） */
  salesVolume: number;
  /** 生产量（万单位） */
  productionVolume: number;
  /** 制造费用（万元） */
  manufacturingExpense: number;

  // === 元数据 ===
  /** 数据来源（手动录入/系统导入/API自动获取） */
  dataSource: "manual" | "import" | "api";
  /** 创建时间 */
  createdAt: string;
  /** 最后更新时间 */
  updatedAt: string;
}

// ==================== 新增：行业外部数据类型 ====================

export interface IndustryExternalData {
  /** 数据记录ID */
  recordId: string;
  /** 数据日期 */
  dataDate: string;

  // === 碳酸锂价格数据 ===
  lithiumPrice: {
    priceDate: string;
    price: number; // 元/吨
    source: string; // 数据来源（如"上海有色网"、"亚洲金属网"）
  };

  // === 行业指数数据 ===
  industryIndex?: {
    indexDate: string;
    indexType: "GEM" | "CSI_POWER_BATTERY"; // 创业板指 / 中证新能源电池指数
    indexValue: number;
    volatility: number; // 波动率（0-1）
  };

  // === 元数据 ===
  createdAt: string;
}

// ==================== 新增：DQI计算结果类型 ====================

export interface PersistedDQIResult {
  /** 结果记录ID */
  resultId: string;
  /** 关联的企业ID */
  enterpriseId: string;
  /** 报告期 */
  periodDate: string;

  // === DQI核心指标 ===
  dqi: number;
  status: "改善" | "稳定" | "恶化";
  driver: "盈利能力" | "成长能力" | "现金流质量" | "资产周转效率" | "研发投入强度" | "库存周转效率" | "无明显驱动";

  // === 分解结果 ===
  decomposition: DQIDecomposition;

  // === 详细指标 ===
  metrics: DQIMetrics;

  // === 趋势描述 ===
  trend: string;
  confidence: number;

  // === 元数据 ===
  calculatedAt: string;
  /** 输入数据的快照ID（可关联到EnterpriseFinancialData） */
  inputSnapshotId?: string;
}

// ==================== 新增：GMPS计算结果类型 ====================

export interface PersistedGMPSResult {
  /** 结果记录ID */
  resultId: string;
  /** 关联的企业ID */
  enterpriseId: string;
  /** 报告期 */
  periodDate: string;

  // === GMPS核心指标 ===
  gmps: number;
  level: "低压" | "中压" | "高压";
  probabilityNextQuarter: number;
  riskLevel: "低风险" | "中风险" | "高风险";

  // === 维度得分 ===
  dimensionScores: GMPSDimensionScores;

  // === 特征得分 ===
  featureScores: Record<string, number>;

  // === 元数据 ===
  calculatedAt: string;
  /** 输入数据的快照ID */
  inputSnapshotId?: string;
}

export type PersistedUserRecord = {
  userId: string;
  displayName?: string;
  identitySource: "generated" | "provided";
  createdAt: string;
  lastActiveAt: string;
  roles: DiagnosticRole[];
  enterpriseNames: string[];
  investedEnterprises: string[];
  enterpriseBaseInfo?: EditableBusinessInfo;
  investorBaseInfo?: EditableBusinessInfo;
  preferences: {
    themeMode?: "light" | "dark" | "system";
    themeColor?: string;
    preferredRole?: DiagnosticRole;
    focusModes: FocusMode[];
    riskAppetite?: string;
    investmentHorizon?: string;
    interests: string[];
    attentionTags: string[];
    goals: string[];
    constraints: string[];
    decisionStyleHints: string[];
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

function normalizeBusinessInfo(input: unknown): EditableBusinessInfo {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const normalized: EditableBusinessInfo = {};

  Object.entries(input).forEach(([key, value]) => {
    const normalizedKey = key.trim();

    if (!normalizedKey) {
      return;
    }

    if (typeof value === "string") {
      const normalizedValue = value.trim();
      if (normalizedValue) {
        normalized[normalizedKey] = normalizedValue;
      }
      return;
    }

    if (Array.isArray(value)) {
      const normalizedValue = Array.from(
        new Set(
          value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
        ),
      );

      if (normalizedValue.length > 0) {
        normalized[normalizedKey] = normalizedValue;
      }
    }
  });

  return normalized;
}

function normalizeUserRecord(record: PersistedUserRecord): PersistedUserRecord {
  return {
    ...record,
    enterpriseBaseInfo: normalizeBusinessInfo(record.enterpriseBaseInfo),
    investorBaseInfo: normalizeBusinessInfo(record.investorBaseInfo),
  };
}

export type PersistedTaskEvent = {
  at: string;
  label: string;
  status: string;
};

export type PersistedTaskRecord = {
  taskId: string;
  kind: "enterprise_analysis" | "investor_analysis";
  userId: string;
  role: DiagnosticRole;
  sessionId?: string;
  enterpriseName?: string;
  status: "queued" | "running" | "completed" | "failed" | "manual_takeover";
  progressPercent: number;
  currentStage: string;
  createdAt: string;
  updatedAt: string;
  resultSummary?: string;
  errorMessage?: string;
  manualTakeoverRequested: boolean;
  budget?: {
    maxTokens: number;
    usedTokens: number;
    withinBudget: boolean;
  };
  nodeStates: Array<{
    agentId: AgentExecutionResult["agentId"];
    status: AgentExecutionResult["status"];
    durationMs: number;
    retryCount: number;
    budgetUsedTokens: number;
    manualInterventionAvailable: boolean;
  }>;
  events: PersistedTaskEvent[];
  result?: unknown;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

export type PersistedAnalysisRecord = {
  analysisId: string;
  workflowId?: string;
  userId: string;
  role: DiagnosticRole;
  sessionId?: string;
  enterpriseName?: string;
  focusMode: FocusMode;
  query: string;
  summary: string;
  createdAt: string;
  personalizedSummary?: string;
  combinedRiskLevel?: "low" | "medium" | "high";
  evidenceConfidence?: "low" | "medium" | "high";
  taskId?: string;
  modelAudits: Array<{
    modelId: string;
    modelVersion: string;
    parameterVersion: string;
    reproducibilityKey: string;
  }>;
};

type PlatformState = {
  version: 1;
  users: Record<string, PersistedUserRecord>;
  sessions: Record<string, unknown>;
  memories: Record<string, MemoryEntry[]>;
  tasks: Record<string, PersistedTaskRecord>;
  analyses: PersistedAnalysisRecord[];
  workflowSnapshots: Record<
    string,
    {
      workflowId: string;
      userId: string;
      role: DiagnosticRole;
      createdAt: string;
      summary: string;
      finalAnswer: string;
      agents: AgentExecutionResult[];
      budget: PersistedTaskRecord["budget"];
      manualTakeoverAvailable: boolean;
    }
  >;

  // ==================== 新增：DQI/GMPS数据集合 ====================

  /** 企业财务数据（按 enterpriseId:periodDate 索引） */
  financialData: Record<string, EnterpriseFinancialData>;

  /** 行业外部数据（按 recordId 索引） */
  industryData: Record<string, IndustryExternalData>;

  /** DQI计算结果（按 resultId 索引） */
  dqiResults: Record<string, PersistedDQIResult>;

  /** GMPS计算结果（按 resultId 索引） */
  gmpsResults: Record<string, PersistedGMPSResult>;

  /** 聊天消息记录 */
  chatMessages: ChatMessage[];
};

function createEmptyState(): PlatformState {
  return {
    version: 1,
    users: {},
    sessions: {},
    memories: {},
    tasks: {},
    analyses: [],
    workflowSnapshots: {},

    // 初始化新增的数据集合
    financialData: {},
    industryData: {},
    dqiResults: {},
    gmpsResults: {},
    chatMessages: [],
  };
}

function sortByDateDesc<T extends { createdAt?: string; updatedAt?: string }>(items: T[]) {
  return [...items].sort((left, right) =>
    String(right.updatedAt ?? right.createdAt ?? "").localeCompare(
      String(left.updatedAt ?? left.createdAt ?? ""),
    ),
  );
}

export class PlatformStore {
  private readonly storageFilePath: string;
  private writeLock: Promise<void> = Promise.resolve();
  private writeBuffer: Array<(state: PlatformState) => unknown> = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private readonly exitHandler: () => void;
  private static readonly FLUSH_INTERVAL_MS = 100;
  private static readonly FLUSH_THRESHOLD = 10;

  private async acquireWriteLock(): Promise<() => void> {
    const previousLock = this.writeLock;
    let releaseLock: () => void;
    this.writeLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    await previousLock;
    return releaseLock!;
  }

  private queueWrite(updater: (state: PlatformState) => unknown): void {
    if (this.destroyed) return;
    this.writeBuffer.push(updater);
    if (this.writeBuffer.length >= PlatformStore.FLUSH_THRESHOLD) {
      this.flushWrites();
    }
  }

  flushWrites(): void {
    if (this.destroyed) return;
    if (this.writeBuffer.length === 0) return;
    const pending = this.writeBuffer.splice(0);
    const state = this.readState();
    for (const updater of pending) {
      updater(state);
    }
    this.writeState(state);
  }

  constructor(storageDir: string) {
    const resolvedDir = path.resolve(storageDir);
    mkdirSync(resolvedDir, { recursive: true });
    this.storageFilePath = path.join(resolvedDir, "platform-state.json");

    if (!existsSync(this.storageFilePath)) {
      this.writeState(createEmptyState());
    }

    this.exitHandler = () => this.flushWrites();
    this.flushTimer = setInterval(() => this.flushWrites(), PlatformStore.FLUSH_INTERVAL_MS);
    process.on("exit", this.exitHandler);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushWrites();
    process.removeListener("exit", this.exitHandler);
  }

  getStorageFilePath() {
    return this.storageFilePath;
  }

  getStats() {
    const state = this.readState();
    return {
      users: Object.keys(state.users).length,
      sessions: Object.keys(state.sessions).length,
      memories: Object.values(state.memories).reduce((sum, items) => sum + items.length, 0),
      tasks: Object.keys(state.tasks).length,
      analyses: state.analyses.length,
      workflows: Object.keys(state.workflowSnapshots).length,

      // 新增统计
      financialDataRecords: Object.keys(state.financialData).length,
      industryDataRecords: Object.keys(state.industryData).length,
      dqiResults: Object.keys(state.dqiResults).length,
      gmpsResults: Object.keys(state.gmpsResults).length,
      chatMessages: state.chatMessages.length,
    };
  }

  listMemories(userId: string) {
    const state = this.readState();
    return sortByDateDesc(state.memories[userId] ?? []);
  }

  async saveMemory(entry: MemoryEntry) {
    return await this.updateState((state) => {
      const nextEntries = [...(state.memories[entry.userId] ?? []), entry];
      state.memories[entry.userId] = sortByDateDesc(nextEntries);
      return entry;
    });
  }

  async updateMemory(userId: string, memoryId: string, updater: (current: MemoryEntry) => MemoryEntry) {
    return await this.updateState((state) => {
      const entries = [...(state.memories[userId] ?? [])];
      const index = entries.findIndex((entry) => entry.id === memoryId);
      if (index < 0) {
        return undefined;
      }
      entries[index] = updater(entries[index]!);
      state.memories[userId] = sortByDateDesc(entries);
      return entries[index];
    });
  }

  async deleteMemory(userId: string, memoryId: string) {
    return await this.updateState((state) => {
      const entries = state.memories[userId] ?? [];
      const nextEntries = entries.filter((entry) => entry.id !== memoryId);
      const deleted = entries.find((entry) => entry.id === memoryId);
      state.memories[userId] = sortByDateDesc(nextEntries);
      return deleted;
    });
  }

  getSession<T>(sessionId: string) {
    const state = this.readState();
    return state.sessions[sessionId] as T | undefined;
  }

  listSessions<T extends { createdAt?: string; updatedAt?: string }>() {
    const state = this.readState();
    return sortByDateDesc(Object.values(state.sessions) as T[]);
  }

  async upsertSession<T extends { sessionId: string }>(snapshot: T) {
    return await this.updateState((state) => {
      state.sessions[snapshot.sessionId] = snapshot;
      return snapshot;
    });
  }

  async deleteSessions(sessionIds: string[]) {
    return await this.updateState((state) => {
      sessionIds.forEach((sessionId) => {
        delete state.sessions[sessionId];
      });
      return sessionIds;
    });
  }

  async upsertUser(userId: string, updater: (current: PersistedUserRecord | undefined) => PersistedUserRecord) {
    return await this.updateState((state) => {
      const next = updater(state.users[userId]);
      state.users[userId] = next;
      return next;
    });
  }

  getUser(userId: string) {
    const state = this.readState();
    return state.users[userId];
  }

  listUsers() {
    const state = this.readState();
    return sortByDateDesc(Object.values(state.users));
  }

  async saveTask(task: PersistedTaskRecord) {
    return await this.updateState((state) => {
      state.tasks[task.taskId] = task;
      return task;
    });
  }

  async updateTask(taskId: string, updater: (current: PersistedTaskRecord | undefined) => PersistedTaskRecord) {
    return await this.updateState((state) => {
      const next = updater(state.tasks[taskId]);
      state.tasks[taskId] = next;
      return next;
    });
  }

  getTask(taskId: string) {
    const state = this.readState();
    return state.tasks[taskId];
  }

  listTasksByUser(userId: string) {
    const state = this.readState();
    return sortByDateDesc(Object.values(state.tasks).filter((item) => item.userId === userId));
  }

  listTasks() {
    const state = this.readState();
    return sortByDateDesc(Object.values(state.tasks));
  }

  async saveAnalysis(record: PersistedAnalysisRecord) {
    return await this.updateState((state) => {
      state.analyses = sortByDateDesc([record, ...state.analyses]).slice(0, 300);
      return record;
    });
  }

  listAnalysesByUser(userId: string) {
    const state = this.readState();
    return sortByDateDesc(state.analyses.filter((item) => item.userId === userId));
  }

  listAnalyses() {
    const state = this.readState();
    return sortByDateDesc(state.analyses);
  }

  async saveWorkflowSnapshot(snapshot: PlatformState["workflowSnapshots"][string]) {
    return await this.updateState((state) => {
      state.workflowSnapshots[snapshot.workflowId] = snapshot;
      return snapshot;
    });
  }

  getWorkflowSnapshot(workflowId: string) {
    const state = this.readState();
    return state.workflowSnapshots[workflowId];
  }

  // ==================== 新增：企业财务数据管理 ====================

  /**
   * 保存企业财务数据
   * @param data 企业财务数据对象
   * @returns 保存后的数据（含自动生成的元数据）
   */
  async saveFinancialData(data: Omit<EnterpriseFinancialData, "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    const key = `${data.enterpriseId}:${data.periodDate}`;
    const fullData: EnterpriseFinancialData = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    return await this.updateState((state) => {
      state.financialData[key] = fullData;
      return fullData;
    });
  }

  /**
   * 获取企业财务数据
   * @param enterpriseId 企业ID
   * @param periodDate 报告期（可选，不传则返回最新一期）
   */
  getFinancialData(enterpriseId: string, periodDate?: string) {
    const state = this.readState();

    if (periodDate) {
      // 返回指定报告期的数据
      return state.financialData[`${enterpriseId}:${periodDate}`];
    }

    // 返回该企业最新一期的数据
    const enterpriseRecords = Object.entries(state.financialData)
      .filter(([key]) => key.startsWith(`${enterpriseId}:`))
      .map(([, value]) => value)
      .sort((a, b) => b.periodDate.localeCompare(a.periodDate));

    return enterpriseRecords[0];
  }

  /**
   * 获取企业的所有历史财务数据（按时间倒序）
   * @param enterpriseId 企业ID
   */
  listFinancialHistory(enterpriseId: string): EnterpriseFinancialData[] {
    const state = this.readState();
    return Object.values(state.financialData)
      .filter((data) => data.enterpriseId === enterpriseId)
      .sort((a, b) => b.periodDate.localeCompare(a.periodDate));
  }

  /**
   * 删除企业财务数据
   */
  async deleteFinancialData(enterpriseId: string, periodDate: string) {
    const key = `${enterpriseId}:${periodDate}`;
    return await this.updateState((state) => {
      const deleted = state.financialData[key];
      delete state.financialData[key];
      return deleted;
    });
  }

  // ==================== 新增：行业外部数据管理 ====================

  /**
   * 保存行业外部数据
   */
  async saveIndustryData(data: Omit<IndustryExternalData, "createdAt">) {
    const now = new Date().toISOString();
    const fullData: IndustryExternalData = {
      ...data,
      createdAt: now,
    };

    return await this.updateState((state) => {
      state.industryData[data.recordId] = fullData;
      return fullData;
    });
  }

  /**
   * 获取行业外部数据
   */
  getIndustryData(recordId: string) {
    const state = this.readState();
    return state.industryData[recordId];
  }

  /**
   * 获取指定日期的行业数据（最新的）
   */
  getLatestIndustryData(date?: string): IndustryExternalData | undefined {
    const state = this.readState();
    const records = Object.values(state.industryData).filter(
      (r) => r && typeof r.dataDate === "string" && r.dataDate.length > 0
    );

    if (records.length === 0) {
      return undefined;
    }

    if (date) {
      const filtered = records
        .filter((r) => r.dataDate <= date)
        .sort((a, b) => b.dataDate.localeCompare(a.dataDate));
      return filtered[0];
    }

    return records.sort((a, b) => b.dataDate.localeCompare(a.dataDate))[0];
  }

  /**
   * 列出所有行业数据（按时间倒序）
   */
  listIndustryData(limit?: number): IndustryExternalData[] {
    const state = this.readState();
    const records = Object.values(state.industryData).sort(
      (a, b) => b.dataDate.localeCompare(a.dataDate),
    );
    return limit ? records.slice(0, limit) : records;
  }

  /**
   * 删除行业外部数据
   */
  async deleteIndustryData(recordId: string) {
    return await this.updateState((state) => {
      const deleted = state.industryData[recordId];
      delete state.industryData[recordId];
      return deleted;
    });
  }

  // ==================== 新增：DQI计算结果管理 ====================

  /**
   * 保存DQI计算结果
   */
  async saveDQIResult(result: Omit<PersistedDQIResult, "resultId" | "calculatedAt">) {
    const resultId = `dqi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const fullResult: PersistedDQIResult = {
      ...result,
      resultId,
      calculatedAt: now,
    };

    return await this.updateState((state) => {
      state.dqiResults[resultId] = fullResult;
      return fullResult;
    });
  }

  /**
   * 获取DQI结果
   */
  getDQIResult(resultId: string) {
    const state = this.readState();
    return state.dqiResults[resultId];
  }

  /**
   * 获取企业最新的DQI结果
   */
  getLatestDQIResult(enterpriseId: string): PersistedDQIResult | undefined {
    const state = this.readState();
    return Object.values(state.dqiResults)
      .filter((r) => r.enterpriseId === enterpriseId)
      .sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt))[0];
  }

  /**
   * 列出企业的所有DQI历史结果
   */
  listDQIHistory(enterpriseId: string, limit?: number): PersistedDQIResult[] {
    const state = this.readState();
    const results = Object.values(state.dqiResults)
      .filter((r) => r.enterpriseId === enterpriseId)
      .sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt));
    return limit ? results.slice(0, limit) : results;
  }

  /**
   * 删除DQI结果
   */
  async deleteDQIResult(resultId: string) {
    return await this.updateState((state) => {
      const deleted = state.dqiResults[resultId];
      delete state.dqiResults[resultId];
      return deleted;
    });
  }

  // ==================== 新增：GMPS计算结果管理 ====================

  /**
   * 保存GMPS计算结果
   */
  async saveGMPSResult(result: Omit<PersistedGMPSResult, "resultId" | "calculatedAt">) {
    const resultId = `gmps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const fullResult: PersistedGMPSResult = {
      ...result,
      resultId,
      calculatedAt: now,
    };

    return await this.updateState((state) => {
      state.gmpsResults[resultId] = fullResult;
      return fullResult;
    });
  }

  /**
   * 获取GMPS结果
   */
  getGMPSResult(resultId: string) {
    const state = this.readState();
    return state.gmpsResults[resultId];
  }

  /**
   * 获取企业最新的GMPS结果
   */
  getLatestGMPSResult(enterpriseId: string): PersistedGMPSResult | undefined {
    const state = this.readState();
    return Object.values(state.gmpsResults)
      .filter((r) => r.enterpriseId === enterpriseId)
      .sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt))[0];
  }

  /**
   * 列出企业的所有GMPS历史结果
   */
  listGMPSHistory(enterpriseId: string, limit?: number): PersistedGMPSResult[] {
    const state = this.readState();
    const results = Object.values(state.gmpsResults)
      .filter((r) => r.enterpriseId === enterpriseId)
      .sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt));
    return limit ? results.slice(0, limit) : results;
  }

  /**
   * 删除GMPS结果
   */
  async deleteGMPSResult(resultId: string) {
    return await this.updateState((state) => {
      const deleted = state.gmpsResults[resultId];
      delete state.gmpsResults[resultId];
      return deleted;
    });
  }

  // ==================== 新增：聊天消息管理 ====================

  async saveChatMessage(msg: ChatMessage) {
    this.queueWrite((state) => {
      state.chatMessages.push(msg);
    });
    return msg;
  }

  getChatMessages(sessionId: string): ChatMessage[] {
    const state = this.readState();
    return state.chatMessages
      .filter((msg) => msg.sessionId === sessionId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async deleteChatMessages(sessionId: string) {
    return await this.updateState((state) => {
      const deleted = state.chatMessages.filter((msg) => msg.sessionId === sessionId);
      state.chatMessages = state.chatMessages.filter((msg) => msg.sessionId !== sessionId);
      return deleted;
    });
  }

  // ==================== 新增：高级查询方法 ====================

  /**
   * 查询指定时间范围内的财务数据
   * @param enterpriseId 企业ID
   * @param startDate 开始日期（如"2025-01"）
   * @param endDate 结束日期（如"2026-04"）
   */
  queryFinancialDataByDateRange(
    enterpriseId: string,
    startDate: string,
    endDate: string,
  ): EnterpriseFinancialData[] {
    const state = this.readState();
    return Object.values(state.financialData)
      .filter(
        (data) =>
          data.enterpriseId === enterpriseId &&
          data.periodDate >= startDate &&
          data.periodDate <= endDate,
      )
      .sort((a, b) => a.periodDate.localeCompare(b.periodDate));
  }

  /**
   * 查询指定时间范围内的DQI结果
   */
  queryDQIByDateRange(
    enterpriseId: string,
    startDate: string,
    endDate: string,
  ): PersistedDQIResult[] {
    const state = this.readState();
    return Object.values(state.dqiResults)
      .filter(
        (r) =>
          r.enterpriseId === enterpriseId &&
          r.periodDate >= startDate &&
          r.periodDate <= endDate,
      )
      .sort((a, b) => a.periodDate.localeCompare(b.periodDate));
  }

  /**
   * 查询指定时间范围内的GMPS结果
   */
  queryGMPSByDateRange(
    enterpriseId: string,
    startDate: string,
    endDate: string,
  ): PersistedGMPSResult[] {
    const state = this.readState();
    return Object.values(state.gmpsResults)
      .filter(
        (r) =>
          r.enterpriseId === enterpriseId &&
          r.periodDate >= startDate &&
          r.periodDate <= endDate,
      )
      .sort((a, b) => a.periodDate.localeCompare(b.periodDate));
  }

  /**
   * 批量导出企业的完整诊断数据（用于备份或迁移）
   */
  exportEnterpriseDiagnosticData(enterpriseId: string) {
    const state = this.readState();
    return {
      financialData: this.listFinancialHistory(enterpriseId),
      dqiResults: this.listDQIHistory(enterpriseId),
      gmpsResults: this.listGMPSHistory(enterpriseId),
      exportedAt: new Date().toISOString(),
    };
  }

  isIndustryDataStale(maxAgeDays: number = 7): boolean {
    const state = this.readState();
    const records = Object.values(state.industryData);
    if (records.length === 0) {
      return true;
    }
    const latest = records.sort((a, b) => b.dataDate.localeCompare(a.dataDate))[0]!;
    const latestDate = new Date(latest.dataDate);
    const now = new Date();
    const diffMs = now.getTime() - latestDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays > maxAgeDays;
  }

  isFinancialDataStale(enterpriseId: string): boolean {
    const state = this.readState();
    const enterpriseRecords = Object.values(state.financialData)
      .filter((data) => data.enterpriseId === enterpriseId)
      .sort((a, b) => b.periodDate.localeCompare(a.periodDate));
    if (enterpriseRecords.length === 0) {
      return true;
    }
    const latest = enterpriseRecords[0]!;
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentQuarter = Math.ceil((now.getMonth() + 1) / 3);
    const currentPeriod = `${currentYear}-Q${currentQuarter}`;
    return latest.periodDate !== currentPeriod;
  }

  getLatestIndustryDataAge(): number | null {
    const state = this.readState();
    const records = Object.values(state.industryData);
    if (records.length === 0) {
      return null;
    }
    
    const latest = records.sort((a, b) => b.dataDate.localeCompare(a.dataDate))[0]!;
    const createdDate = new Date(latest.createdAt);
    const now = new Date();
    const diffMs = now.getTime() - createdDate.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  private async updateState<T>(updater: (state: PlatformState) => T): Promise<T> {
    const release = await this.acquireWriteLock();
    try {
      const state = this.readState();
      const result = updater(state);
      this.writeState(state);
      return result;
    } finally {
      release();
    }
  }

  private readState(): PlatformState {
    try {
      const raw = readFileSync(this.storageFilePath, "utf8");
      if (!raw.trim()) {
        return createEmptyState();
      }

      const parsed = { ...createEmptyState(), ...JSON.parse(raw) } as PlatformState;

      return {
        ...parsed,
        users: Object.fromEntries(
          Object.entries(parsed.users).map(([userId, user]) => [userId, normalizeUserRecord(user)]),
        ),
      } as PlatformState;
    } catch (error) {
      console.error(`[PlatformStore] Failed to read state file: ${this.storageFilePath}`, error);
      try {
        const backupPath = this.storageFilePath + ".bak";
        if (existsSync(backupPath)) {
          unlinkSync(backupPath);
        }
        renameSync(this.storageFilePath, backupPath);
        console.error(`[PlatformStore] Corrupted file backed up to: ${backupPath}`);
      } catch {}
      return createEmptyState();
    }
  }

  private writeState(state: PlatformState) {
    const tmpPath = this.storageFilePath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
    try {
      renameSync(tmpPath, this.storageFilePath);
    } catch {
      try {
        if (existsSync(this.storageFilePath)) {
          unlinkSync(this.storageFilePath);
        }
        renameSync(tmpPath, this.storageFilePath);
      } catch (retryError) {
        console.error("[PlatformStore] Failed to write state file after retry:", retryError);
        try {
          if (existsSync(tmpPath)) {
            unlinkSync(tmpPath);
          }
        } catch {}
      }
    }
  }
}
