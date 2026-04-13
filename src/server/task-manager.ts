import { randomUUID } from "node:crypto";

import { BusinessPortalService } from "./business-service.js";
import { PlatformStore, type PersistedTaskRecord } from "./platform-store.js";

type TaskManagerDependencies = {
  platformStore: PlatformStore;
  businessPortalService: BusinessPortalService;
  backgroundTasksEnabled: boolean;
};

function createTaskRecord(input: {
  taskId: string;
  kind: PersistedTaskRecord["kind"];
  userId: string;
  role: PersistedTaskRecord["role"];
  sessionId?: string;
  enterpriseName?: string;
}): PersistedTaskRecord {
  const now = new Date().toISOString();
  return {
    taskId: input.taskId,
    kind: input.kind,
    userId: input.userId,
    role: input.role,
    sessionId: input.sessionId,
    enterpriseName: input.enterpriseName,
    status: "queued",
    progressPercent: 0,
    currentStage: "任务已创建",
    createdAt: now,
    updatedAt: now,
    manualTakeoverRequested: false,
    nodeStates: [],
    events: [{ at: now, label: "任务已创建", status: "queued" }],
  };
}

export class AsyncTaskManager {
  private readonly platformStore: PlatformStore;

  private readonly businessPortalService: BusinessPortalService;

  private readonly backgroundTasksEnabled: boolean;

  constructor(dependencies: TaskManagerDependencies) {
    this.platformStore = dependencies.platformStore;
    this.businessPortalService = dependencies.businessPortalService;
    this.backgroundTasksEnabled = dependencies.backgroundTasksEnabled;
  }

  async submitEnterpriseAnalysis(payload: unknown) {
    const input = payload as { userId: string; sessionId?: string; enterpriseName?: string };
    const taskId = randomUUID();
    const task = createTaskRecord({
      taskId,
      kind: "enterprise_analysis",
      userId: input.userId,
      role: "enterprise",
      sessionId: input.sessionId,
      enterpriseName: input.enterpriseName,
    });
    await this.platformStore.saveTask(task);
    this.runTask(taskId, async () => this.businessPortalService.analyzeEnterprise(payload));
    return task;
  }

  async submitInvestorAnalysis(payload: unknown) {
    const input = payload as { userId: string; sessionId?: string; enterpriseName?: string };
    const taskId = randomUUID();
    const task = createTaskRecord({
      taskId,
      kind: "investor_analysis",
      userId: input.userId,
      role: "investor",
      sessionId: input.sessionId,
      enterpriseName: input.enterpriseName,
    });
    await this.platformStore.saveTask(task);
    this.runTask(taskId, async () => this.businessPortalService.analyzeInvestor(payload));
    return task;
  }

  getTask(taskId: string) {
    return this.platformStore.getTask(taskId);
  }

  async requestManualTakeover(taskId: string) {
    const task = await this.platformStore.updateTask(taskId, (current) => {
      if (!current) {
        throw new Error("task not found");
      }

      const updatedAt = new Date().toISOString();
      return {
        ...current,
        status: current.status === "completed" ? current.status : "manual_takeover",
        manualTakeoverRequested: true,
        currentStage: "等待人工接管",
        updatedAt,
        events: [
          ...current.events,
          { at: updatedAt, label: "已请求人工接管", status: "manual_takeover" },
        ],
      };
    });

    return task;
  }

  private runTask(taskId: string, executor: () => Promise<unknown>) {
    const execute = async () => {
      await this.updateProgress(taskId, "running", 15, "正在装载上下文");
      await Promise.resolve();
      await this.updateProgress(taskId, "running", 45, "正在执行智能体链路");

      try {
        const result = await executor();
        const workflowDiagnostic = (
          result as {
            diagnostic?: {
              summary?: string;
              agents?: Array<{
                agentId: PersistedTaskRecord["nodeStates"][number]["agentId"];
                status: PersistedTaskRecord["nodeStates"][number]["status"];
                governance?: {
                  durationMs?: number;
                  retryCount?: number;
                  budgetUsedTokens?: number;
                  manualInterventionAvailable?: boolean;
                };
              }>;
              governance?: { budget?: PersistedTaskRecord["budget"] };
            };
            recommendation?: { rationale?: string };
          }
        ).diagnostic;
        await this.platformStore.updateTask(taskId, (current) => {
          if (!current) {
            throw new Error("task not found");
          }

          const updatedAt = new Date().toISOString();
          return {
            ...current,
            status: current.manualTakeoverRequested ? "manual_takeover" : "completed",
            progressPercent: 100,
            currentStage: current.manualTakeoverRequested ? "等待人工接管" : "任务已完成",
            updatedAt,
            resultSummary:
              workflowDiagnostic?.summary ??
              (result as { recommendation?: { rationale?: string } }).recommendation?.rationale ??
              "任务已执行完成。",
            budget: workflowDiagnostic?.governance?.budget,
            nodeStates:
              workflowDiagnostic?.agents?.map((agent) => ({
                agentId: agent.agentId,
                status: agent.status,
                durationMs: agent.governance?.durationMs ?? 0,
                retryCount: agent.governance?.retryCount ?? 0,
                budgetUsedTokens: agent.governance?.budgetUsedTokens ?? 0,
                manualInterventionAvailable: agent.governance?.manualInterventionAvailable ?? false,
              })) ?? current.nodeStates,
            result,
            events: [
              ...current.events,
              { at: updatedAt, label: "任务已完成", status: current.manualTakeoverRequested ? "manual_takeover" : "completed" },
            ],
          };
        });
      } catch (error) {
        await this.platformStore.updateTask(taskId, (current) => {
          if (!current) {
            throw new Error("task not found");
          }

          const updatedAt = new Date().toISOString();
          return {
            ...current,
            status: "failed",
            progressPercent: current.progressPercent,
            currentStage: "任务执行失败",
            updatedAt,
            errorMessage: error instanceof Error ? error.message : String(error),
            events: [...current.events, { at: updatedAt, label: "任务执行失败", status: "failed" }],
          };
        });
      }
    };

    if (this.backgroundTasksEnabled) {
      void execute();
      return;
    }

    void execute();
  }

  private async updateProgress(
    taskId: string,
    status: PersistedTaskRecord["status"],
    progressPercent: number,
    currentStage: string,
  ) {
    await this.platformStore.updateTask(taskId, (current) => {
      if (!current) {
        throw new Error("task not found");
      }

      const updatedAt = new Date().toISOString();
      return {
        ...current,
        status,
        progressPercent,
        currentStage,
        updatedAt,
        events: [...current.events, { at: updatedAt, label: currentStage, status }],
      };
    });
  }
}
