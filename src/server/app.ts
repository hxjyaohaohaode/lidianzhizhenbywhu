import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import cors from "cors";
import express from "express";
import type { Logger } from "pino";

import { DiagnosticWorkflowService } from "./agent-service.js";
import { BusinessPortalService } from "./business-service.js";
import { AppError, errorHandler } from "./errors.js";
import { analyzeGrossMarginPressure, analyzeOperatingQuality, calculateDQI, calculateGMPS } from "./models.js";
import { InMemoryMemoryStore } from "./memory.js";
import { createDefaultAdapters, ModelRouter } from "./llm.js";
import { PlatformStore } from "./platform-store.js";
import { RealtimeIndustryRagService } from "./realtime-rag.js";
import { InMemorySessionStore } from "./session-store.js";
import { AsyncTaskManager } from "./task-manager.js";
import {
  appMetadata,
  getDeploymentReadiness,
  getEnvironmentLayer,
  getConfiguredProviders,
  getRuntimeReadiness,
  type ServerEnv,
} from "../shared/config.js";
import { realtimeRagRequestSchema } from "../shared/rag.js";
import type { HealthResponse, MetaResponse } from "../shared/types.js";

type CreateAppOptions = {
  env: ServerEnv;
  logger: Logger;
};

function createRateLimitMiddleware(env: ServerEnv) {
  const requests = new Map<string, { startedAt: number; count: number }>();

  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const key = request.ip || request.headers["x-forwarded-for"]?.toString() || "local";
    const now = Date.now();
    const current = requests.get(key);

    if (!current || now - current.startedAt > env.RATE_LIMIT_WINDOW_MS) {
      requests.set(key, { startedAt: now, count: 1 });
      next();
      return;
    }

    if (current.count >= env.RATE_LIMIT_MAX_REQUESTS) {
      next(
        new AppError({
          code: "RATE_LIMITED",
          message: "请求过于频繁，请稍后重试。",
          statusCode: 429,
        }),
      );
      return;
    }

    current.count += 1;
    next();
  };
}

function writeSseEvent(response: express.Response, event: string, payload: unknown) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function canAccessInternalDebugRoute(request: express.Request, env: ServerEnv) {
  if (env.NODE_ENV === "test") {
    return true;
  }

  return request.header("x-platform-access") === "internal";
}

function authenticateRequest(request: express.Request, response: express.Response, next: express.NextFunction) {
  const userId = request.body?.userId || request.query?.userId;
  if (!userId || typeof userId !== "string") {
    return response.status(401).json({ error: { code: "UNAUTHORIZED", message: "需要提供有效的用户标识。" } });
  }
  (request as any).authenticatedUserId = userId;
  next();
}

function authorizeRole(requiredRole: string) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const role = request.body?.role || request.query?.role;
    if (role && role !== requiredRole) {
      return response.status(403).json({ error: { code: "FORBIDDEN", message: `无权访问${requiredRole === "enterprise" ? "企业端" : "投资端"}功能。` } });
    }
    next();
  };
}

function verifyOwnership(request: express.Request, response: express.Response, next: express.NextFunction) {
  const authenticatedUserId = (request as any).authenticatedUserId;
  const rawUserId = request.params?.userId || request.body?.userId || request.query?.userId;
  const requestUserId = typeof rawUserId === "string" ? rawUserId : undefined;
  if (requestUserId && requestUserId !== authenticatedUserId) {
    return response.status(403).json({ error: { code: "FORBIDDEN", message: "无权访问该资源。" } });
  }
  next();
}

function createSessionOwnershipVerifier(sessionStore: InMemorySessionStore) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const authenticatedUserId = (request as any).authenticatedUserId;
    const sessionId = request.params.sessionId;
    if (typeof sessionId !== "string") {
      return response.status(400).json({ error: { code: "INVALID_REQUEST", message: "无效的会话标识。" } });
    }
    const snapshot = sessionStore.get(sessionId);
    if (snapshot && snapshot.userId !== authenticatedUserId) {
      return response.status(403).json({ error: { code: "FORBIDDEN", message: "无权访问该资源。" } });
    }
    next();
  };
}

function buildHealthPayload(env: ServerEnv, platformStore: PlatformStore): HealthResponse {
  const runtimeReadiness = getRuntimeReadiness(env);
  const deploymentReadiness = getDeploymentReadiness(env);
  let storageStats: ReturnType<PlatformStore["getStats"]> | undefined;

  try {
    storageStats = env.HEALTHCHECK_INCLUDE_DETAILS ? platformStore.getStats() : undefined;
  } catch {
    storageStats = undefined;
  }

  const dependencyChecks = {
    llm: runtimeReadiness.subsystems.llm.status,
    rag: runtimeReadiness.subsystems.rag.status,
    dataSources: runtimeReadiness.subsystems.dataSources.status,
    persistence: runtimeReadiness.subsystems.persistence.status,
    agent: runtimeReadiness.subsystems.agent.status,
  } as const;

  return {
    status: runtimeReadiness.status === "ready" ? "ok" : "degraded",
    service: appMetadata.service,
    version: appMetadata.version,
    environment: env.NODE_ENV,
    uptimeInSeconds: Math.round(process.uptime()),
    configuredProviders: getConfiguredProviders(env),
    storage: {
      mode: env.PERSISTENCE_MODE,
      persistenceReady: env.PERSISTENCE_MODE === "file",
      stats: storageStats,
    },
    governance: {
      cacheTtlSeconds: env.CACHE_TTL_SECONDS,
      rateLimitMaxRequests: env.RATE_LIMIT_MAX_REQUESTS,
      asyncTaskConcurrency: env.ASYNC_TASK_CONCURRENCY,
      agentBudgetTotalTokens: env.AGENT_BUDGET_TOTAL_TOKENS,
      ragMaxSourceAgeDays: env.RAG_MAX_SOURCE_AGE_DAYS,
      backgroundTasksEnabled: env.ENABLE_BACKGROUND_TASKS,
    },
    configProfile: {
      layer: getEnvironmentLayer(env.NODE_ENV),
      healthcheckIncludesDetails: env.HEALTHCHECK_INCLUDE_DETAILS,
    },
    dependencyChecks,
    runtimeReadiness,
    deploymentReadiness,
    timestamp: new Date().toISOString(),
  };
}

export function createApp({ env, logger }: CreateAppOptions) {
  const app = express();
  const webDistPath = path.resolve(process.cwd(), "dist/web");
  const platformStore = new PlatformStore(env.STORAGE_DIR);
  const memoryStore = new InMemoryMemoryStore(platformStore);
  const sessionStore = new InMemorySessionStore(platformStore);
  const realtimeRagService = new RealtimeIndustryRagService({
    cacheTtlMs: env.CACHE_TTL_SECONDS * 1000,
    sourceWhitelist: env.RAG_SOURCE_WHITELIST,
    maxSourceAgeDays: env.RAG_MAX_SOURCE_AGE_DAYS,
  });
  const diagnosticWorkflowService = new DiagnosticWorkflowService(env, {
    memoryStore,
    ragService: realtimeRagService,
    platformStore,
  });
  const businessPortalService = new BusinessPortalService(env, {
    memoryStore,
    sessionStore,
    workflowService: diagnosticWorkflowService,
    platformStore,
    modelRouter: new ModelRouter(createDefaultAdapters(env)),
  });
  const taskManager = new AsyncTaskManager({
    platformStore,
    businessPortalService,
    backgroundTasksEnabled: env.ENABLE_BACKGROUND_TASKS,
  });
  const verifySessionOwnership = createSessionOwnershipVerifier(sessionStore);

  app.disable("x-powered-by");

  if (env.NODE_ENV === "production") {
    app.use((_request, response, next) => {
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("X-Frame-Options", "DENY");
      response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      response.setHeader("X-XSS-Protection", "1; mode=block");
      response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      next();
    });
  }

  const corsOrigin = env.CORS_ORIGIN;
  if (corsOrigin === "*") {
    app.use(cors({ origin: true, credentials: false }));
  } else if (corsOrigin.includes(",")) {
    const origins = corsOrigin.split(",").map((o) => o.trim()).filter(Boolean);
    app.use(cors({ origin: origins, credentials: true }));
  } else {
    app.use(cors({ origin: corsOrigin, credentials: true }));
  }
  app.use(express.json({ limit: "1mb" }));
  app.use(createRateLimitMiddleware(env));

  app.use((request, response, next) => {
    const requestId = randomUUID();
    const requestLogger = logger.child({
      requestId,
      method: request.method,
      path: request.path,
    });
    const startedAt = Date.now();

    response.locals.requestId = requestId;
    response.locals.logger = requestLogger;
    response.setHeader("x-request-id", requestId);

    response.on("finish", () => {
      requestLogger.info(
        {
          statusCode: response.statusCode,
          durationMs: Date.now() - startedAt,
        },
        "request completed",
      );
    });

    next();
  });

  app.get("/api/health", (_request, response) => {
    response.json(buildHealthPayload(env, platformStore));
  });

  app.get("/api/health/ready", (_request, response) => {
    const payload = buildHealthPayload(env, platformStore);
    response.status(payload.status === "ok" ? 200 : 503).json(payload);
  });

  app.get("/api/meta", (_request, response) => {
    const payload: MetaResponse = {
      title: env.VITE_APP_TITLE,
      subtitle: "面向企业运营分析与投资人员的统一智能诊断底座",
      roles: [
        {
          role: "企业运营分析",
          description: "聚焦毛利承压、经营质量变化、风险信号与任务编排。",
          focus: ["经营指标采集", "数学模型诊断", "智能体协作分析"],
        },
        {
          role: "投资人员",
          description: "聚焦行业状况、企业趋势、投资推荐与深度解析。",
          focus: ["投资画像采集", "趋势研判", "证据可追溯建议"],
        },
      ],
    };

    response.json(payload);
  });

  app.post("/api/users/bootstrap", async (request, response, next) => {
    try {
      response.status(201).json(await businessPortalService.bootstrapUserIdentity(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/users/:userId", (request, response, next) => {
    try {
      const viewerRole = typeof request.query.role === "string" ? request.query.role : undefined;
      response.json(businessPortalService.getUserProfile(request.params.userId, viewerRole));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/users/:userId/preferences", async (request, response, next) => {
    try {
      response.json(
        await businessPortalService.updateUserPreferences({
          ...request.body,
          userId: request.params.userId,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/models/gross-margin-pressure", (request, response, next) => {
    try {
      response.json(analyzeGrossMarginPressure(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/models/operating-quality", (request, response, next) => {
    try {
      response.json({ success: true, data: analyzeOperatingQuality(request.body) });
    } catch (error) {
      next(error);
    }
  });

  // DQI模型计算接口
  app.post("/api/models/dqi/calculate", (request, response, next) => {
    try {
      const result = calculateDQI(request.body);
      response.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GMPS模型计算接口
  app.post("/api/models/gmps/calculate", (request, response, next) => {
    try {
      const result = calculateGMPS(request.body);
      response.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/agents/diagnose", async (request, response, next) => {
    try {
      if (!canAccessInternalDebugRoute(request, env)) {
        throw new AppError({
          code: "FORBIDDEN",
          message: "该调试诊断入口仅供平台内部使用。",
          statusCode: 403,
        });
      }
      response.json(await diagnosticWorkflowService.diagnose(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/acceptance/competitive-baseline", async (_request, response, next) => {
    try {
      response.json(await diagnosticWorkflowService.generateCompetitiveAcceptanceReport());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/acceptance/dual-portal-personalization-audit", (_request, response, next) => {
    try {
      response.json(diagnosticWorkflowService.generateDualPortalPersonalizationAuditReport());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/acceptance/minimum-deployment", async (_request, response, next) => {
    try {
      response.json(await diagnosticWorkflowService.generateMinimumDeploymentAuditReport());
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rag/realtime", async (request, response, next) => {
    try {
      const parsed = realtimeRagRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        throw new AppError({
          code: "INVALID_REQUEST",
          message: "请求参数校验失败。",
          statusCode: 400,
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }

      response.json(await realtimeRagService.retrieve(parsed.data));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rag/cache/clear", (_request, response, next) => {
    try {
      realtimeRagService.clearCache();
      response.json({ success: true, message: "RAG缓存已清除" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/enterprise/collect", authenticateRequest, authorizeRole("enterprise"), async (request, response, next) => {
    try {
      response.json(await businessPortalService.collectEnterpriseData(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/enterprise/analyze", authenticateRequest, authorizeRole("enterprise"), async (request, response, next) => {
    try {
      response.json(await businessPortalService.analyzeEnterprise(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/tasks/enterprise-analysis", async (request, response, next) => {
    try {
      response.status(202).json(await taskManager.submitEnterpriseAnalysis(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/investor/profile", authenticateRequest, authorizeRole("investor"), async (request, response, next) => {
    try {
      response.json(await businessPortalService.createInvestorProfile(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/investor/sessions/:userId", authenticateRequest, authorizeRole("investor"), (request, response, next) => {
    try {
      response.json(businessPortalService.listInvestorSessions(request.params.userId as string));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/investor/sessions", authenticateRequest, authorizeRole("investor"), async (request, response, next) => {
    try {
      response.status(201).json(await businessPortalService.createInvestorSession(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/investor/sessions/delete-current", authenticateRequest, authorizeRole("investor"), async (request, response, next) => {
    try {
      response.json(await businessPortalService.deleteCurrentInvestorSession(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/investor/sessions/delete-batch", authenticateRequest, authorizeRole("investor"), async (request, response, next) => {
    try {
      response.json(await businessPortalService.deleteInvestorSessions(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/investor/attachments", authenticateRequest, authorizeRole("investor"), async (request, response, next) => {
    try {
      response.status(201).json(await businessPortalService.uploadInvestorAttachment(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/investor/mode", authenticateRequest, authorizeRole("investor"), async (request, response, next) => {
    try {
      response.json(await businessPortalService.switchInvestorMode(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/investor/recommend", authenticateRequest, authorizeRole("investor"), async (request, response, next) => {
    try {
      response.json(
        await businessPortalService.analyzeInvestor({
          ...request.body,
          focusMode: "investmentRecommendation",
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/investor/industry-status", authenticateRequest, authorizeRole("investor"), async (request, response, next) => {
    try {
      response.json(
        await businessPortalService.analyzeInvestor({
          ...request.body,
          focusMode: "industryStatus",
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/investor/deep-dive", authenticateRequest, authorizeRole("investor"), async (request, response, next) => {
    try {
      response.json(
        await businessPortalService.analyzeInvestor({
          ...request.body,
          focusMode: "deepDive",
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/investor/stream", authenticateRequest, authorizeRole("investor"), async (request, response) => {
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();

    const heartbeatInterval = setInterval(() => {
      if (!response.writableEnded) {
        response.write(': keepalive\n\n');
      }
    }, 30000);

    request.on("close", () => {
      clearInterval(heartbeatInterval);
    });

    response.on("close", () => {
      clearInterval(heartbeatInterval);
    });

    try {
      await businessPortalService.streamInvestorAnalysis(request.body, async (event) => {
        if (!response.writableEnded) {
          writeSseEvent(response, event.type, event);
        }
      }, { signal: { get aborted() { return response.destroyed; } } });
      if (!response.writableEnded) response.end();
    } catch (error) {
      if (response.writableEnded) return;
      writeSseEvent(response, "error", {
        type: "error",
        message: error instanceof Error ? error.message : "流式分析失败。",
      });
      response.end();
      response.locals.logger?.error({ err: error }, "investor stream failed");
    } finally {
      clearInterval(heartbeatInterval);
    }
  });

  app.post("/api/tasks/investor-analysis", async (request, response, next) => {
    try {
      response.status(202).json(await taskManager.submitInvestorAnalysis(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/tasks/:taskId", (request, response, next) => {
    try {
      const task = taskManager.getTask(request.params.taskId);

      if (!task) {
        throw new AppError({
          code: "NOT_FOUND",
          message: "任务不存在。",
          statusCode: 404,
        });
      }

      response.json(task);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/tasks/:taskId/manual-takeover", async (request, response, next) => {
    try {
      response.json(await taskManager.requestManualTakeover(request.params.taskId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/context/:sessionId", authenticateRequest, verifySessionOwnership, (request, response, next) => {
    try {
      response.json(businessPortalService.getSessionContext(request.params.sessionId as string));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/memory", authenticateRequest, verifyOwnership, async (request, response, next) => {
    try {
      response.status(201).json(await businessPortalService.writePrivateMemory(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/memory/:userId", authenticateRequest, verifyOwnership, (request, response, next) => {
    try {
      const limit = Number(request.query.limit ?? 10);
      const role = typeof request.query.role === "string" ? request.query.role : undefined;
      const tags = typeof request.query.tags === "string" ? request.query.tags.split(",").filter(Boolean) : undefined;
      response.json(
        businessPortalService.listPrivateMemories(
          request.params.userId as string,
          Number.isFinite(limit) && limit > 0 ? limit : 10,
          role,
          tags,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/memory/:memoryId", authenticateRequest, verifyOwnership, async (request, response, next) => {
    try {
      response.json(await businessPortalService.updatePrivateMemory(request.params.memoryId as string, request.body));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/memory/:memoryId", authenticateRequest, verifyOwnership, async (request, response, next) => {
    try {
      response.json(
        await businessPortalService.deletePrivateMemory(request.params.memoryId as string, {
          userId: request.query.userId,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/feedback", async (request, response, next) => {
    try {
      response.json(await businessPortalService.recordUserFeedback(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/history/:userId", authenticateRequest, verifyOwnership, (request, response, next) => {
    try {
      response.json(
        businessPortalService.getUserHistory(
          request.params.userId as string,
          typeof request.query.viewer === "string" ? request.query.viewer : "owner",
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/ops/dashboard", (request, response, next) => {
    try {
      const viewer = request.query.viewer === "admin" ? "admin" : "operations";
      response.json(businessPortalService.getOperationsDashboard(viewer));
    } catch (error) {
      next(error);
    }
  });

  if (existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    app.get("*", (request, response, next) => {
      if (request.path.startsWith("/api")) {
        next();
        return;
      }

      response.sendFile(path.join(webDistPath, "index.html"));
    });
  }

  app.use((_request, _response, next) => {
    next(
      new AppError({
        code: "NOT_FOUND",
        message: "请求的资源不存在。",
        statusCode: 404,
      }),
    );
  });

  app.use(errorHandler(logger));

  return app;
}
