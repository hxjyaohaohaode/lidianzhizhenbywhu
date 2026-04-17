import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { createLogger } from "./logger.js";
import type { ServerEnv } from "../shared/config.js";

const testEnv: ServerEnv = {
  NODE_ENV: "test",
  PORT: 3001,
  LOG_LEVEL: "silent" as never,
  CORS_ORIGIN: "http://localhost:5173",
  VITE_APP_TITLE: "测试平台",
  VITE_API_BASE_URL: "/api",
  PERSISTENCE_MODE: "file",
  STORAGE_DIR: mkdtempSync(path.join(os.tmpdir(), "battery-app-test-")),
  CACHE_TTL_SECONDS: 300,
  CACHE_STALE_TTL_SECONDS: 1800,
  RATE_LIMIT_WINDOW_MS: 60000,
  RATE_LIMIT_MAX_REQUESTS: 120,
  ASYNC_TASK_CONCURRENCY: 2,
  AGENT_BUDGET_TOTAL_TOKENS: 16000,
  AGENT_BUDGET_MAX_STEPS: 12,
  AGENT_RETRY_LIMIT: 2,
  EXTERNAL_FETCH_TIMEOUT_MS: 4000,
  EXTERNAL_FETCH_RETRY_COUNT: 2,
  RAG_SOURCE_WHITELIST: ["example.com", "example.org", "example.net", "example.edu"],
  RAG_MAX_SOURCE_AGE_DAYS: 60,
  HEALTHCHECK_INCLUDE_DETAILS: true,
  ENABLE_BACKGROUND_TASKS: true,
  DEEPSEEK_API_KEY: "deepseek",
  GLM_API_KEY: undefined,
  QWEN_API_KEY: "qwen",
  DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
  GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
  QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  DATA_STALE_THRESHOLD_DAYS: 7,
};

describe("api skeleton", () => {
  const logger = createLogger({
    LOG_LEVEL: "error",
    NODE_ENV: "test",
  });
  const app = createApp({ env: testEnv, logger });

  async function waitForTask(taskId: string) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const response = await request(app).get(`/api/tasks/${taskId}?userId=ops-user`);
      if (response.body.status === "completed" || response.body.status === "manual_takeover") {
        return response;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`task ${taskId} was not completed in time`);
  }

  function parseSsePayload(responseText: string) {
    return responseText
      .trim()
      .split("\n\n")
      .map((block) => {
        const event = block
          .split("\n")
          .find((line) => line.startsWith("event:"))
          ?.replace(/^event:\s*/, "");
        const data = block
          .split("\n")
          .find((line) => line.startsWith("data:"))
          ?.replace(/^data:\s*/, "");

        return event && data ? { event, data: JSON.parse(data) as Record<string, unknown> } : undefined;
      })
      .filter((item): item is { event: string; data: Record<string, unknown> } => Boolean(item));
  }

  function jsonResponse(payload: unknown, init: ResponseInit = {}) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      ...init,
    });
  }

  async function withMockedFetch<T>(
    handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    run: (mockedFetch: ReturnType<typeof vi.fn>) => Promise<T>,
  ) {
    const originalFetch = global.fetch;
    const mockedFetch = vi.fn(handler as typeof fetch);
    global.fetch = mockedFetch as typeof fetch;

    try {
      return await run(mockedFetch);
    } finally {
      global.fetch = originalFetch;
    }
  }

  it("returns health information", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.configuredProviders).toEqual({
      deepseekReasoner: true,
      glm5: false,
      qwen35Plus: true,
    });
    expect(response.body.storage.mode).toBe("file");
    expect(response.body.storage.persistenceReady).toBe(true);
    expect(response.body.governance.agentBudgetTotalTokens).toBe(16000);
    expect(response.body.configProfile.layer).toBe("testing");
    expect(response.body.dependencyChecks).toEqual({
      llm: "ready",
      rag: "ready",
      dataSources: "degraded",
      persistence: "ready",
      agent: "ready",
    });
    expect(response.body.runtimeReadiness).toBeTruthy();
    expect(response.body.runtimeReadiness.canRunWithApiOnly).toBe(true);
    expect(response.body.deploymentReadiness.privateConfigMode).toBe("server_only");
  });

  it("returns ready probe result for minimal deployment", async () => {
    const response = await request(app).get("/api/health/ready");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.deploymentReadiness.canRunWithApiOnly).toBe(true);
  });

  it("bootstraps user identity and persists preference updates", async () => {
    const bootstrapResponse = await request(app).post("/api/users/bootstrap").send({
      displayName: "测试用户",
      preferredRole: "investor",
      themeMode: "dark",
      themeColor: "#3b82f6",
      investedEnterprises: ["星海电池"],
      interests: ["行业景气"],
      enterpriseBaseInfo: {
        企业性质: "民营企业",
      },
      investorBaseInfo: {
        研究偏好: ["行业景气", "现金流"],
      },
    });

    expect(bootstrapResponse.status).toBe(201);
    expect(bootstrapResponse.body.profile.userId).toBeTypeOf("string");
    expect(bootstrapResponse.body.profile.identitySource).toBe("generated");
    expect(bootstrapResponse.body.profile.preferences.themeMode).toBe("dark");

    const userId = bootstrapResponse.body.profile.userId as string;

    const updateResponse = await request(app).put(`/api/users/${userId}/preferences`).send({
      themeMode: "light",
      interests: ["行业景气", "深度基本面"],
      constraints: ["回撤控制"],
      enterpriseBaseInfo: {
        主要区域: ["华东", "欧洲"],
      },
      investorBaseInfo: {
        决策机制: "投委会",
      },
    });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.profile.userId).toBe(userId);
    expect(updateResponse.body.profile.preferences.themeMode).toBe("light");
    expect(updateResponse.body.profile.preferences.constraints).toContain("回撤控制");
    expect(updateResponse.body.profile.enterpriseBaseInfo).toEqual({
      企业性质: "民营企业",
      主要区域: ["华东", "欧洲"],
    });
    expect(updateResponse.body.profile.investorBaseInfo).toEqual({
      研究偏好: ["行业景气", "现金流"],
      决策机制: "投委会",
    });

    const getResponse = await request(app).get(`/api/users/${userId}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.profile.preferences.themeMode).toBe("light");
    expect(getResponse.body.profile.enterpriseBaseInfo.主要区域).toEqual(["华东", "欧洲"]);
    expect(getResponse.body.profile.investorBaseInfo.决策机制).toBe("投委会");
  });

  it("returns consistent not found error payload", async () => {
    const response = await request(app).get("/api/unknown");

    expect(response.status).toBe(404);
    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.error.requestId).toBeTruthy();
  });

  it("returns gross margin pressure analysis result", async () => {
    const response = await request(app).post("/api/models/gross-margin-pressure").send({
      userId: "test-user",
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
    });

    expect(response.status).toBe(200);
    expect(response.body.modelId).toBe("grossMarginPressure");
    expect(response.body.data.riskLevel).toBeTypeOf("string");
    expect(response.body.data.trend.direction).toBe("deteriorating");
    expect(response.body.data.normalizedMetrics.marginChange).toBeTruthy();
  });

  it("returns operating quality validation failure details", async () => {
    const response = await request(app).post("/api/models/operating-quality").send({
      userId: "test-user",
      currentSalesVolume: 100,
      baselineSalesVolume: 100,
      currentProductionVolume: 100,
      baselineProductionVolume: 100,
      currentManufacturingExpense: 120,
      baselineManufacturingExpense: 80,
      currentOperatingCost: 110,
      baselineOperatingCost: 70,
      currentOperatingCashFlow: 10,
      baselineOperatingCashFlow: 10,
      currentRevenue: 500,
      baselineRevenue: 500,
      currentTotalLiabilities: 120,
      baselineTotalLiabilities: 90,
      currentTotalAssets: 100,
      baselineTotalAssets: 80,
    });

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe("INVALID_REQUEST");
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "currentManufacturingExpense",
        }),
        expect.objectContaining({
          path: "currentTotalLiabilities",
        }),
      ]),
    );
  });

  it("returns orchestrated multi-agent diagnostic result", async () => {
    const response = await request(app)
      .post("/api/agents/diagnose")
      .send({
        role: "enterprise",
        userId: "user-1",
        enterpriseName: "星海电池",
        query: "请进行企业诊断与经营分析，判断毛利率压力与经营质量变化，并给出行动建议",
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
        },
        memoryNotes: ["关注库存周转", "重点看现金流质量"],
        industryContext: {
          marketDemandIndex: 96,
          materialCostTrend: "up",
          policySignals: ["储能项目招标放量"],
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.workflowId).toBeTruthy();
    expect(response.body.plan).toHaveLength(8);
    expect(response.body.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: "taskOrchestrator" }),
        expect.objectContaining({ agentId: "memoryManagement" }),
        expect.objectContaining({ agentId: "dataGathering" }),
        expect.objectContaining({ agentId: "dataUnderstanding" }),
        expect.objectContaining({ agentId: "mathAnalysis" }),
        expect.objectContaining({ agentId: "industryRetrieval" }),
        expect.objectContaining({ agentId: "evidenceReview" }),
        expect.objectContaining({ agentId: "expressionGeneration" }),
      ]),
    );
    expect(response.body.finalAnswer).toContain("核心结论");
    expect(response.body.finalAnswer).toContain("引用摘要");
    expect(response.body.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "industryRetrieval",
          output: expect.objectContaining({
            citations: expect.any(Array),
            referenceAbstract: expect.any(String),
          }),
        }),
      ]),
    );
    expect(response.body.memorySnapshot).toHaveLength(1);
    expect(response.body.acceptance).toEqual(
      expect.objectContaining({
        overallScore: expect.any(Number),
        metrics: expect.arrayContaining([
          expect.objectContaining({
            metricId: "timeliness",
          }),
          expect.objectContaining({
            metricId: "credibility",
          }),
        ]),
      }),
    );
  });

  it("returns real connector aggregation in diagnose api when external fetch succeeds", async () => {
    const currentDate = new Date();
    const currentPeriod = `${currentDate.getFullYear()}${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
    const liveApp = createApp({
      env: {
        ...testEnv,
        NODE_ENV: "development",
        NBS_TOKEN: "nbs-live-token",
      },
      logger,
    });

    await withMockedFetch(async (input) => {
      const url = String(input);

      if (url.includes("searchapi.eastmoney.com/api/suggest/get")) {
        return jsonResponse({
          QuotationCodeTable: {
            Data: [{ Code: "300750", Name: "宁德时代" }],
          },
        });
      }

      if (url.includes("reportapi.eastmoney.com/report/list?code=300750")) {
        return jsonResponse({
          data: [
            {
              title: "宁德时代深度报告",
              summary: "盈利预测上修",
              pdfUrl: "/pdf/report-300750.pdf",
            },
          ],
        });
      }

      if (url.includes("www.szse.cn/api/disc/announcement/annList")) {
        return jsonResponse({
          data: [
            {
              title: "宁德时代2025年年度报告",
              attachPath: "/disclosure/2025-annual.pdf",
              secName: "宁德时代",
            },
          ],
        });
      }

      if (url.includes("data.stats.gov.cn/easyquery.htm?m=QueryData")) {
        return jsonResponse({
          returndata: {
            datanodes: [
              {
                data: { strdata: "102.3" },
                wds: [
                  { wdcode: "zb", valuecode: "A0201" },
                  { wdcode: "sj", valuecode: currentPeriod },
                ],
              },
            ],
          },
        });
      }

      throw new Error(`unexpected fetch url: ${url}`);
    }, async (mockedFetch) => {
      const response = await request(liveApp)
        .post("/api/agents/diagnose")
        .set("x-platform-access", "internal")
        .send({
          role: "enterprise",
          userId: "live-user",
          enterpriseName: "宁德时代",
          query: "请结合真实外部连接器判断财报和宏观环境",
          focusMode: "investmentRecommendation",
          memoryNotes: ["优先验证外部公告"],
        });

      expect(response.status).toBe(200);
      const calledUrls = mockedFetch.mock.calls.map((call) => String(call[0]));
      expect(calledUrls).toEqual(
        expect.arrayContaining([
          expect.stringContaining("searchapi.eastmoney.com/api/suggest/get"),
          expect.stringContaining("reportapi.eastmoney.com/report/list?code=300750"),
          expect.stringContaining("www.szse.cn/api/disc/announcement/annList"),
          expect.stringContaining("data.stats.gov.cn/easyquery.htm?m=QueryData"),
        ]),
      );
      expect(response.body.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            agentId: "dataGathering",
            status: "completed",
            output: expect.objectContaining({
              status: "success",
              source: "exchange+eastmoney+nbs",
              gatheredData: expect.objectContaining({
                enterpriseFinancials: expect.objectContaining({
                  degraded: false,
                  securityProfile: expect.objectContaining({
                    securityCode: "300750",
                    exchange: "SZSE",
                  }),
                }),
                macroData: expect.objectContaining({
                  degraded: false,
                  records: expect.arrayContaining([
                    expect.objectContaining({
                      time: currentPeriod,
                      value: "102.3",
                    }),
                  ]),
                }),
              }),
            }),
          }),
        ]),
      );
    });
  });

  it("outputs quantified competitive acceptance baseline report", { timeout: 60000 }, async () => {
    const response = await request(app).get("/api/acceptance/competitive-baseline?userId=test-user");

    expect(response.status).toBe(200);
    expect(response.body.baselines).toHaveLength(4);
    expect(response.body.aggregate).toEqual(
      expect.objectContaining({
        overallScore: expect.any(Number),
        totalScenarioCount: 3,
        metrics: expect.arrayContaining([
          expect.objectContaining({
            metricId: "timeliness",
            threshold: 70,
          }),
          expect.objectContaining({
            metricId: "collaborationEfficiency",
            score: expect.any(Number),
          }),
        ]),
      }),
    );
    expect(response.body.ragTraceability).toEqual(
      expect.objectContaining({
        totalScenarioCount: 3,
        scenarios: expect.arrayContaining([
          expect.objectContaining({
            traceCoverage: expect.any(Number),
            documentTypes: expect.any(Array),
          }),
        ]),
      }),
    );
    expect(response.body.modelConnectivity).toEqual(
      expect.objectContaining({
        totalCaseCount: 3,
        cases: expect.arrayContaining([
          expect.objectContaining({
            provider: "qwen35Plus",
          }),
        ]),
      }),
    );
    expect(response.body.performanceBaseline).toEqual(
      expect.objectContaining({
        scenarioCount: 3,
        averageWorkflowDurationMs: expect.any(Number),
      }),
    );
    expect(response.body.businessQualityBaseline).toEqual(
      expect.objectContaining({
        overallScore: expect.any(Number),
        scenarioScores: expect.any(Array),
      }),
    );
    expect(response.body.reproduction.command).toBe("npx tsx src/server/acceptance-report.ts");
    expect(response.body.scenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scenarioId: "enterprise-baseline",
          acceptance: expect.objectContaining({
            metrics: expect.any(Array),
          }),
        }),
      ]),
    );
  });

  it("outputs dual portal personalization audit report", async () => {
    const response = await request(app).get("/api/acceptance/dual-portal-personalization-audit?userId=test-user");

    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual(
      expect.objectContaining({
        channelCount: expect.any(Number),
        pageCount: expect.any(Number),
        driverCount: expect.any(Number),
        integrationStatusBreakdown: expect.objectContaining({
          real: expect.any(Number),
          simulated: expect.any(Number),
          degraded: expect.any(Number),
          placeholder: expect.any(Number),
        }),
      }),
    );
    expect(response.body.dataChannels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: "realtime-rag-source",
          integrationStatus: "real",
        }),
        expect.objectContaining({
          channelId: "eastmoney-stock-report-source",
          integrationStatus: "real",
        }),
      ]),
    );
    expect(response.body.pageMatrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pageId: "enterprise-home",
          personalizationDrivers: expect.arrayContaining(["enterpriseBaseInfo"]),
        }),
        expect.objectContaining({
          pageId: "investor-home",
          personalizationDrivers: expect.arrayContaining(["investorBaseInfo"]),
        }),
      ]),
    );
    expect(response.body.personalizationDrivers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          driverId: "focus-mode",
        }),
        expect.objectContaining({
          driverId: "memory-history",
        }),
      ]),
    );
  });

  it("outputs minimum deployment audit report", { timeout: 60000 }, async () => {
    const response = await request(app).get("/api/acceptance/minimum-deployment?userId=test-user");

    expect(response.status).toBe(200);
    expect(response.body.evidenceMode).toBe("automated_mock");
    expect(response.body.overallPassed).toBe(true);
    expect(response.body.deploymentReadiness.canRunWithApiOnly).toBe(true);
    expect(response.body.runtimeReadiness.subsystems.persistence.status).toBe("ready");
    expect(response.body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "workflow_smoke_test",
          passed: true,
        }),
        expect.objectContaining({
          checkId: "personalization_memory_recall",
          passed: true,
        }),
      ]),
    );
    expect(response.body.smokeWorkflow.recalledMemoryCount).toBeGreaterThan(0);
    expect(response.body.recommendations).toEqual(
      expect.arrayContaining([expect.stringContaining("最小模型 API")]),
    );
  });

  it("returns realtime rag retrieval result", async () => {
    const response = await request(app).post("/api/rag/realtime").send({
      userId: "test-user",
      role: "investor",
      query: "请跟踪行业景气、现金流风险和政策信号",
      focusMode: "investmentRecommendation",
      limit: 2,
    });

    expect(response.status).toBe(200);
    expect(response.body.citations).toHaveLength(2);
    expect(response.body.referenceAbstract).toContain("：");
    expect(response.body.indexStats.chunkCount).toBeGreaterThan(0);
    expect(response.body.citations[0].trace.chunkId).toBeTruthy();
    expect(response.body.citations[0].trace.rankingSignals.confidenceScore).toBeGreaterThan(0);
  });

  it("runs enterprise collection and analysis on unified session context", async () => {
    const collectionResponse = await request(app)
      .post("/api/enterprise/collect")
      .send({
        userId: "enterprise-user",
        role: "enterprise",
        enterpriseName: "星海电池",
        hasFullQuarterHistory: false,
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
        },
        industryContext: {
          marketDemandIndex: 96,
          materialCostTrend: "up",
          policySignals: ["储能项目招标放量"],
        },
        notes: ["优先关注库存与现金流"],
        enterpriseBaseInfo: {
          企业阶段: "扩产期",
          核心产品: ["314Ah电芯", "储能系统"],
        },
      });

    expect(collectionResponse.status).toBe(200);
    expect(collectionResponse.body.collectionSummary.historyCoverage).toBe("baselineComparison");
    expect(collectionResponse.body.collectionSummary.confidentialityNotice).toContain("保密");

    const analysisResponse = await request(app)
      .post("/api/enterprise/analyze")
      .send({
        userId: "enterprise-user",
        role: "enterprise",
        sessionId: collectionResponse.body.sessionContext.sessionId,
        query: "请输出企业经营诊断与关键动作",
        memoryNotes: ["管理层需要下周复盘"],
      });

    expect(analysisResponse.status).toBe(200);
    expect(analysisResponse.body.diagnostic.workflowId).toBeTruthy();
    expect(analysisResponse.body.highlights.combinedRiskLevel).toBeTypeOf("string");
    expect(analysisResponse.body.sessionContext.recentEvents).toHaveLength(2);

    const contextResponse = await request(app).get(
      `/api/context/${collectionResponse.body.sessionContext.sessionId}?userId=enterprise-user`,
    );

    expect(contextResponse.status).toBe(200);
    expect(contextResponse.body.summary).toContain("企业分析");
    expect(contextResponse.body.memoryPreview).toHaveLength(1);

    const profileResponse = await request(app).get("/api/users/enterprise-user");
    expect(profileResponse.status).toBe(200);
    expect(profileResponse.body.profile.enterpriseBaseInfo).toEqual({
      企业阶段: "扩产期",
      核心产品: ["314Ah电芯", "储能系统"],
    });
  });

  it("supports investor profile, mode switching, recommendation and deep dive", { timeout: 60000 }, async () => {
    const profileResponse = await request(app)
      .post("/api/investor/profile")
      .send({
        userId: "investor-user",
        role: "investor",
        investorName: "张敏",
        investedEnterprises: ["星海电池", "蓝峰材料"],
        capitalCostRate: 9.2,
        riskAppetite: "medium",
        investmentHorizon: "long",
        interests: ["行业景气", "深度基本面"],
        notes: ["偏好现金流稳健企业"],
        investorBaseInfo: {
          资金属性: "产业资本",
          关注市场: ["国内储能", "欧洲户储"],
        },
      });

    expect(profileResponse.status).toBe(200);
    expect(profileResponse.body.recommendedMode).toBe("deepDive");

    const userProfileResponse = await request(app).get("/api/users/investor-user");
    expect(userProfileResponse.status).toBe(200);
    expect(userProfileResponse.body.profile.investorBaseInfo).toEqual({
      资金属性: "产业资本",
      关注市场: ["国内储能", "欧洲户储"],
    });

    const modeResponse = await request(app)
      .post("/api/investor/mode")
      .send({
        userId: "investor-user",
        role: "investor",
        sessionId: profileResponse.body.sessionContext.sessionId,
        focusMode: "investmentRecommendation",
        enterpriseName: "星海电池",
        query: "切换到推荐模式",
      });

    expect(modeResponse.status).toBe(200);
    expect(modeResponse.body.activeMode).toBe("investmentRecommendation");

    const industryStatusResponse = await request(app)
      .post("/api/investor/industry-status")
      .send({
        userId: "investor-user",
        role: "investor",
        sessionId: profileResponse.body.sessionContext.sessionId,
        enterpriseName: "星海电池",
        query: "请先判断行业景气与供需结构",
        industryContext: {
          marketDemandIndex: 108,
          materialCostTrend: "down",
          policySignals: ["动力电池出口改善"],
        },
      });

    expect(industryStatusResponse.status).toBe(200);
    expect(industryStatusResponse.body.sessionContext.activeMode).toBe("industryStatus");
    expect(industryStatusResponse.body.diagnostic.workflowId).toBeTruthy();

    const recommendationResponse = await request(app)
      .post("/api/investor/recommend")
      .send({
        userId: "investor-user",
        role: "investor",
        sessionId: profileResponse.body.sessionContext.sessionId,
        enterpriseName: "星海电池",
        query: "请给出投资建议",
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
        },
        industryContext: {
          marketDemandIndex: 108,
          materialCostTrend: "down",
          policySignals: ["动力电池出口改善"],
        },
      });

    expect(recommendationResponse.status).toBe(200);
    expect(recommendationResponse.body.recommendation.stance).toMatch(/推荐关注|谨慎跟踪|暂缓配置/);
    expect(recommendationResponse.body.diagnostic.finalAnswer).toContain("核心结论");

    const deepDiveResponse = await request(app)
      .post("/api/investor/deep-dive")
      .send({
        userId: "investor-user",
        role: "investor",
        sessionId: profileResponse.body.sessionContext.sessionId,
        enterpriseName: "星海电池",
        query: "请展开盈利质量与外部证据",
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
        },
        industryContext: {
          marketDemandIndex: 108,
          materialCostTrend: "down",
          policySignals: ["动力电池出口改善"],
        },
      });

    expect(deepDiveResponse.status).toBe(200);
    expect(deepDiveResponse.body.deepDive.modules).toHaveLength(3);
    expect(deepDiveResponse.body.sessionContext.activeMode).toBe("deepDive");
  });

  it("supports investor multi-session lifecycle and attachment parsing", async () => {
    const profileResponse = await request(app)
      .post("/api/investor/profile")
      .send({
        userId: "investor-session-user",
        role: "investor",
        investedEnterprises: ["星海电池"],
        capitalCostRate: 8.5,
        riskAppetite: "medium",
        investmentHorizon: "long",
        interests: ["行业景气"],
        notes: ["关注储能订单"],
      });

    const createSessionResponse = await request(app).post("/api/investor/sessions").send({
      userId: "investor-session-user",
      role: "investor",
      focusMode: "industryStatus",
      enterpriseName: "海辰储能",
    });

    expect(createSessionResponse.status).toBe(201);

    const listSessionsResponse = await request(app).get("/api/investor/sessions/investor-session-user?userId=investor-session-user&role=investor");

    expect(listSessionsResponse.status).toBe(200);
    expect(listSessionsResponse.body.items.length).toBeGreaterThanOrEqual(2);

    const uploadResponse = await request(app).post("/api/investor/attachments").send({
      userId: "investor-session-user",
      role: "investor",
      sessionId: createSessionResponse.body.sessionContext.sessionId,
      fileName: "quarterly-notes.csv",
      content: "quarter,cashflow,shipment\n2026Q1,128,92\n2026Q2,146,101",
    });

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.attachment.summary).toContain("表格");
    expect(uploadResponse.body.sessionContext.attachments[0].fileName).toBe("quarterly-notes.csv");

    const deleteCurrentResponse = await request(app).post("/api/investor/sessions/delete-current").send({
      userId: "investor-session-user",
      role: "investor",
      sessionId: createSessionResponse.body.sessionContext.sessionId,
    });

    expect(deleteCurrentResponse.status).toBe(200);
    expect(deleteCurrentResponse.body.deletedSessionIds).toContain(createSessionResponse.body.sessionContext.sessionId);
    expect(deleteCurrentResponse.body.replacementSessionContext.sessionId).not.toBe(
      createSessionResponse.body.sessionContext.sessionId,
    );

    const deleteBatchResponse = await request(app).post("/api/investor/sessions/delete-batch").send({
      userId: "investor-session-user",
      role: "investor",
      sessionIds: [
        profileResponse.body.sessionContext.sessionId,
        deleteCurrentResponse.body.replacementSessionContext.sessionId,
      ],
    });

    expect(deleteBatchResponse.status).toBe(200);
    expect(deleteBatchResponse.body.deletedCount).toBe(2);
  });

  it("streams formal debate events and reuses auto-built profile", { timeout: 60000 }, async () => {
    const profileResponse = await request(app)
      .post("/api/investor/profile")
      .send({
        userId: "stream-user",
        role: "investor",
        investedEnterprises: ["星海电池"],
        capitalCostRate: 9.8,
        riskAppetite: "medium",
        investmentHorizon: "medium",
        interests: ["现金流质量"],
        notes: ["关注海外订单"],
      });

    await request(app).post("/api/investor/attachments").send({
      userId: "stream-user",
      role: "investor",
      sessionId: profileResponse.body.sessionContext.sessionId,
      fileName: "research.txt",
      content: "我们希望控制回撤，优先验证现金流和海外储能订单，采用分批建仓方式。",
    });

    const streamResponse = await request(app)
      .post("/api/investor/stream")
      .send({
        userId: "stream-user",
        role: "investor",
        sessionId: profileResponse.body.sessionContext.sessionId,
        enterpriseName: "星海电池",
        focusMode: "investmentRecommendation",
        query: "我希望控制回撤并分批建仓，请给出正式投资建议辩论。",
      });

    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers["content-type"]).toContain("text/event-stream");

    const streamEvents = parseSsePayload(streamResponse.text);
    const debateEvents = streamEvents.filter((item) => item.event === "debate_message");
    const resultEvent = streamEvents.find((item) => item.event === "result");

    expect(debateEvents).toHaveLength(15);
    expect(
      debateEvents.filter((item) => item.data.message && (item.data.message as { round: number }).round === 1),
    ).toHaveLength(5);
    expect(
      debateEvents.filter((item) => item.data.message && (item.data.message as { round: number }).round === 2),
    ).toHaveLength(5);
    expect(
      debateEvents.filter((item) => item.data.message && (item.data.message as { round: number }).round === 3),
    ).toHaveLength(5);
    expect(resultEvent?.data.result).toBeTruthy();

    const typedResult = resultEvent?.data.result as {
      profileUpdate?: { updatedFields: string[] };
      debate: { rounds: Array<{ messages: Array<{ speakerRole: string; speakerModel: string }> }> };
      personalization: { serviceHints: string[] };
    };
    expect(typedResult.profileUpdate?.updatedFields).toEqual(
      expect.arrayContaining(["constraints", "decisionStyleHints"]),
    );
    expect(
      typedResult.debate.rounds.every((round) => {
        const debaterMessages = round.messages.filter((item) => item.speakerRole === "debater");
        const counts = debaterMessages.reduce<Record<string, number>>((accumulator, item) => {
          accumulator[item.speakerModel] = (accumulator[item.speakerModel] ?? 0) + 1;
          return accumulator;
        }, {});
        return Object.values(counts).every((count) => count === 2);
      }),
    ).toBe(true);

    const followupIndustryResponse = await request(app)
      .post("/api/investor/industry-status")
      .send({
        userId: "stream-user",
        role: "investor",
        sessionId: profileResponse.body.sessionContext.sessionId,
        enterpriseName: "星海电池",
        query: "继续判断行业景气。",
      });

    expect(followupIndustryResponse.status).toBe(200);
    expect(followupIndustryResponse.body.personalization.serviceHints.join(" ")).toContain("尊重长期约束");
    expect(followupIndustryResponse.body.sessionContext.latestProfileUpdate.summary).toContain("自动沉淀画像");
  });

  it("returns clarification questions for deep dive stream when constraints are missing", async () => {
    const createSessionResponse = await request(app).post("/api/investor/sessions").send({
      userId: "clarify-user",
      role: "investor",
      focusMode: "deepDive",
      enterpriseName: "星海电池",
    });

    const streamResponse = await request(app)
      .post("/api/investor/stream")
      .send({
        userId: "clarify-user",
        role: "investor",
        sessionId: createSessionResponse.body.sessionContext.sessionId,
        enterpriseName: "星海电池",
        focusMode: "deepDive",
        query: "请做一次正式深度解析。",
      });

    expect(streamResponse.status).toBe(200);
    const events = parseSsePayload(streamResponse.text);
    const clarificationEvent = events.find((item) => item.event === "clarification_required");

    expect(clarificationEvent).toBeTruthy();
    expect((clarificationEvent?.data.questions as string[]).length).toBeGreaterThanOrEqual(2);
  });

  it("supports private memory write and read", async () => {
    const profileResponse = await request(app)
      .post("/api/investor/profile")
      .send({
        userId: "memory-user",
        role: "investor",
        investedEnterprises: ["星海电池"],
        capitalCostRate: 7.5,
        riskAppetite: "high",
        investmentHorizon: "medium",
        interests: ["投资推荐"],
      });

    const memoryWriteResponse = await request(app)
      .post("/api/memory")
      .send({
        userId: "memory-user",
        sessionId: profileResponse.body.sessionContext.sessionId,
        role: "investor",
        title: "关注海外订单兑现",
        content: "若二季度海外储能订单兑现率继续提升，可上调仓位假设。",
        tags: ["订单", "海外"],
      });

    expect(memoryWriteResponse.status).toBe(201);
    expect(memoryWriteResponse.body.memory.source).toBe("manual");
    expect(memoryWriteResponse.body.sessionContext.memoryPreview[0].summary).toBe("关注海外订单兑现");

    const memoryListResponse = await request(app).get("/api/memory/memory-user?limit=5&userId=memory-user");

    expect(memoryListResponse.status).toBe(200);
    expect(memoryListResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "关注海外订单兑现",
          details: expect.stringContaining("海外储能订单"),
        }),
      ]),
    );
  });

  it("supports async task feedback, history and operations dashboard", async () => {
    const taskCreateResponse = await request(app)
      .post("/api/tasks/enterprise-analysis")
      .send({
        userId: "ops-user",
        enterpriseName: "星海电池",
        query: "请输出企业经营诊断与关键动作",
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
        },
      });

    expect(taskCreateResponse.status).toBe(202);
    expect(taskCreateResponse.body.status).toBe("queued");

    const taskResponse = await waitForTask(taskCreateResponse.body.taskId);
    expect(taskResponse.body.status).toBe("completed");
    expect(taskResponse.body.nodeStates.length).toBeGreaterThan(0);

    const manualTakeoverResponse = await request(app).post(
      `/api/tasks/${taskCreateResponse.body.taskId}/manual-takeover`,
    ).send({ userId: "ops-user" });
    expect(manualTakeoverResponse.status).toBe(200);
    expect(manualTakeoverResponse.body.manualTakeoverRequested).toBe(true);

    const feedbackResponse = await request(app).post("/api/feedback").send({
      userId: "ops-user",
      role: "enterprise",
      rating: 4,
      comment: "建议增加人工复核入口提示。",
      signalTags: ["人工复核", "任务反馈"],
    });

    expect(feedbackResponse.status).toBe(200);
    expect(feedbackResponse.body.averageRating).toBe(4);

    const historyResponse = await request(app).get("/api/history/ops-user?viewer=owner&userId=ops-user");
    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body.analyses.length).toBeGreaterThan(0);
    expect(historyResponse.body.tasks.length).toBeGreaterThan(0);

    const dashboardResponse = await request(app).get("/api/ops/dashboard?viewer=admin&userId=ops-user");
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body.overview.userCount).toBeGreaterThan(0);
    expect(dashboardResponse.body.serviceOpportunities.length).toBeGreaterThan(0);
  });
});
