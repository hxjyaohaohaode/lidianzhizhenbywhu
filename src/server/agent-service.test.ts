import { describe, expect, it, vi } from "vitest";

import { DiagnosticWorkflowService } from "./agent-service.js";
import type { LlmExecutionRequest, LlmExecutionResponse, LlmProviderAdapter } from "./llm.js";
import { ModelRouter } from "./llm.js";
import { InMemoryMemoryStore } from "./memory.js";
import type { ServerEnv } from "../shared/config.js";

const baseEnv: ServerEnv = {
  NODE_ENV: "test",
  PORT: 3001,
  LOG_LEVEL: "silent" as never,
  CORS_ORIGIN: "http://localhost:5173",
  VITE_APP_TITLE: "测试平台",
  VITE_API_BASE_URL: "/api",
  PERSISTENCE_MODE: "memory",
  STORAGE_DIR: ".runtime/test-agent-service",
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
  GLM_API_KEY: "glm",
  QWEN_API_KEY: "qwen",
  DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
  GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
  QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  DATA_STALE_THRESHOLD_DAYS: 7,
};

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createDelayedAdapter(
  provider: "deepseekReasoner" | "glm5" | "qwen35Plus",
  delays: Partial<Record<LlmExecutionRequest["capability"], number>>,
) {
  return {
    provider,
    model: `${provider}-model`,
    isAvailable() {
      return true;
    },
    async complete(request: LlmExecutionRequest): Promise<LlmExecutionResponse> {
      await wait(delays[request.capability] ?? 5);
      return {
        provider,
        model: `${provider}-model`,
        text: `${provider}:${request.capability}`,
        usage: {
          inputTokens: 10,
          outputTokens: 10,
        },
        latencyMs: delays[request.capability] ?? 5,
      };
    },
  } satisfies LlmProviderAdapter;
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

describe("diagnostic workflow service", () => {
  it("runs understanding and retrieval in parallel while persisting memory", async () => {
    const memoryStore = new InMemoryMemoryStore();
    const service = new DiagnosticWorkflowService(baseEnv, {
      memoryStore,
      modelRouter: new ModelRouter([
        createDelayedAdapter("deepseekReasoner", {
          planning: 5,
          understanding: 60,
          retrieval: 60,
          review: 5,
        }),
        createDelayedAdapter("glm5", {
          memory: 5,
        }),
        createDelayedAdapter("qwen35Plus", {
          expression: 5,
        }),
      ]),
    });

    const result = await service.diagnose({
      role: "enterprise",
      userId: "parallel-user",
      query: "进行企业诊断与经营分析，评估毛利率压力下的经营风险变化趋势",
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
      memoryNotes: ["关注经营风险"],
      industryContext: {
        marketDemandIndex: 102,
        materialCostTrend: "flat",
        policySignals: ["储能需求延续"],
      },
    });

    const dataUnderstanding = result.agents.find((item) => item.agentId === "dataUnderstanding");
    const industryRetrieval = result.agents.find((item) => item.agentId === "industryRetrieval");

    expect(dataUnderstanding).toBeTruthy();
    expect(industryRetrieval).toBeTruthy();
    expect(
      Math.abs(
        new Date(String(dataUnderstanding?.startedAt)).getTime() -
          new Date(String(industryRetrieval?.startedAt)).getTime(),
      ),
    ).toBeLessThan(40);
    expect(result.memorySnapshot).toHaveLength(1);

    const secondResult = await service.diagnose({
      role: "enterprise",
      userId: "parallel-user",
      query: "继续跟踪风险变化",
      focusMode: "deepDive",
      memoryNotes: ["关注订单节奏"],
    });

    const memoryAgent = secondResult.agents.find((item) => item.agentId === "memoryManagement");

    expect(memoryAgent).toBeTruthy();
    expect(secondResult.memorySnapshot).toHaveLength(2);
    expect(
      (memoryAgent?.output as { recalledMemories?: unknown[] }).recalledMemories?.length ?? 0,
    ).toBeGreaterThan(0);
    expect(
      (industryRetrieval?.output as { citations?: unknown[]; referenceAbstract?: string }).citations?.length ?? 0,
    ).toBeGreaterThan(0);
    expect(
      (industryRetrieval?.output as { retrievalSummary?: string }).retrievalSummary,
    ).toContain("检索");
    expect(result.governance?.budget.withinBudget).toBe(true);
    expect(result.agents.every((item) => item.governance?.durationMs !== undefined)).toBe(true);
    expect(result.acceptance.metrics).toHaveLength(4);
    expect(result.acceptance.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricId: "timeliness",
          score: expect.any(Number),
        }),
        expect.objectContaining({
          metricId: "credibility",
          passed: expect.any(Boolean),
        }),
        expect.objectContaining({
          metricId: "personalization",
          evidence: expect.any(Array),
        }),
        expect.objectContaining({
          metricId: "collaborationEfficiency",
          threshold: 65,
        }),
      ]),
    );
  });

  it("integrates exchange, eastmoney and nbs connectors into the main workflow", async () => {
    const currentDate = new Date();
    const currentPeriod = `${currentDate.getFullYear()}${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
    const service = new DiagnosticWorkflowService(
      {
        ...baseEnv,
        NODE_ENV: "development",
        NBS_TOKEN: "nbs-live-token",
      },
      {
        memoryStore: new InMemoryMemoryStore(),
        modelRouter: new ModelRouter([
          createDelayedAdapter("deepseekReasoner", {
            planning: 5,
            review: 5,
          }),
          createDelayedAdapter("glm5", {
            memory: 5,
            retrieval: 5,
          }),
          createDelayedAdapter("qwen35Plus", {
            understanding: 5,
            expression: 5,
          }),
        ]),
      },
    );

    await withMockedFetch(async (input, init) => {
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
        expect(init?.method).toBe("POST");
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
      const result = await service.diagnose({
        role: "enterprise",
        userId: "live-connector-user",
        enterpriseName: "宁德时代",
        query: "请结合外部财报和宏观数据判断当前经营与投资信号",
        focusMode: "investmentRecommendation",
        memoryNotes: ["优先看外部财报证据"],
      });

      const dataGathering = result.agents.find((item) => item.agentId === "dataGathering");
      expect(dataGathering?.status).toBe("completed");
      expect(dataGathering?.summary).toContain("exchange+eastmoney+nbs");

      const output = dataGathering?.output as {
        status: string;
        source: string;
        gatheredData: {
          enterpriseFinancials: {
            degraded: boolean;
            securityProfile: {
              securityCode: string;
              exchange: string;
            };
            exchangeReports: Array<{ title: string; url: string }>;
            eastmoneyReports: Array<{ title: string; pdfUrl: string }>;
          };
          macroData: {
            degraded: boolean;
            records: Array<{ time: string; value: string }>;
          };
        };
      };

      expect(output.status).toBe("success");
      expect(output.source).toBe("exchange+eastmoney+nbs");
      expect(output.gatheredData.enterpriseFinancials.degraded).toBe(false);
      expect(output.gatheredData.enterpriseFinancials.securityProfile.securityCode).toBe("300750");
      expect(output.gatheredData.enterpriseFinancials.securityProfile.exchange).toBe("SZSE");
      expect(output.gatheredData.enterpriseFinancials.exchangeReports[0]?.url).toBe(
        "https://disc.static.szse.cn/disclosure/2025-annual.pdf",
      );
      expect(output.gatheredData.enterpriseFinancials.eastmoneyReports[0]?.pdfUrl).toBe(
        "https://report.eastmoney.com/pdf/report-300750.pdf",
      );
      expect(output.gatheredData.macroData.degraded).toBe(false);
      expect(output.gatheredData.macroData.records[0]).toEqual({
        time: currentPeriod,
        value: "102.3",
      });
      const calledUrls = mockedFetch.mock.calls.map((call) => String(call[0]));
      expect(calledUrls).toEqual(
        expect.arrayContaining([
          expect.stringContaining("searchapi.eastmoney.com/api/suggest/get"),
          expect.stringContaining("reportapi.eastmoney.com/report/list?code=300750"),
          expect.stringContaining("www.szse.cn/api/disc/announcement/annList"),
          expect.stringContaining("data.stats.gov.cn/easyquery.htm?m=QueryData"),
        ]),
      );
      expect(result.finalAnswer).toContain("核心结论");
    });
  });

  it("falls back to heuristic output when no model provider is configured", async () => {
    const service = new DiagnosticWorkflowService({
      ...baseEnv,
      DEEPSEEK_API_KEY: undefined,
      GLM_API_KEY: undefined,
      QWEN_API_KEY: undefined,
    });

    const result = await service.diagnose({
      role: "investor",
      userId: "fallback-user",
      query: "给出投资视角的行业判断",
      focusMode: "investmentRecommendation",
    });

    expect(result.finalAnswer).toContain("建议动作");
    expect(result.degradationTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "heuristic_fallback",
        }),
      ]),
    );
    expect(result.agents.some((item) => item.status === "degraded")).toBe(true);
    expect(result.finalAnswer).toContain("引用摘要");
    expect(
      result.agents.find((item) => item.agentId === "evidenceReview")?.output,
    ).toEqual(
      expect.objectContaining({
        confidenceScore: expect.any(Number),
      }),
    );
    expect(result.governance?.manualTakeoverAvailable).toBe(true);
  });

  it("builds quantified competitive acceptance report from benchmark scenarios", { timeout: 60000 }, async () => {
    const service = new DiagnosticWorkflowService(baseEnv, {
      memoryStore: new InMemoryMemoryStore(),
      modelRouter: new ModelRouter([
        createDelayedAdapter("deepseekReasoner", {
          planning: 5,
          review: 5,
        }),
        createDelayedAdapter("glm5", {
          memory: 5,
          retrieval: 5,
        }),
        createDelayedAdapter("qwen35Plus", {
          understanding: 5,
          expression: 5,
        }),
      ]),
    });

    const report = await service.generateCompetitiveAcceptanceReport();

    expect(report.baselines).toHaveLength(4);
    expect(report.scenarios).toHaveLength(3);
    expect(report.aggregate.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricId: "timeliness",
          score: expect.any(Number),
        }),
        expect.objectContaining({
          metricId: "credibility",
          threshold: 75,
        }),
      ]),
    );
    expect(report.aggregate.totalScenarioCount).toBe(report.scenarios.length);
    expect(report.aggregate.passedScenarioCount).toBeLessThanOrEqual(report.scenarios.length);
    expect(report.aggregate.overallPassed).toBeTypeOf("boolean");
    expect(report.ragTraceability.totalScenarioCount).toBe(report.scenarios.length);
    expect(report.ragTraceability.scenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          citationCount: expect.any(Number),
          traceCoverage: expect.any(Number),
          documentTypes: expect.any(Array),
        }),
      ]),
    );
    expect(report.modelConnectivity).toEqual(
      expect.objectContaining({
        totalCaseCount: 3,
        passedCaseCount: 3,
        overallPassed: true,
        cases: expect.arrayContaining([
          expect.objectContaining({
            provider: "qwen35Plus",
            capability: "planning",
            status: "passed",
          }),
          expect.objectContaining({
            provider: "glm5",
            capability: "retrieval",
            status: "passed",
          }),
          expect.objectContaining({
            provider: "deepseekReasoner",
            capability: "review",
            status: "passed",
          }),
        ]),
      }),
    );
    expect(report.performanceBaseline).toEqual(
      expect.objectContaining({
        scenarioCount: 3,
        averageWorkflowDurationMs: expect.any(Number),
        averageCitationCount: expect.any(Number),
        reproducibilityKey: expect.stringContaining("task7-baseline"),
      }),
    );
    expect(report.businessQualityBaseline).toEqual(
      expect.objectContaining({
        overallScore: expect.any(Number),
        minimumScenarioScore: expect.any(Number),
        scenarioScores: expect.any(Array),
      }),
    );
    expect(report.reproduction.command).toBe("npx tsx src/server/acceptance-report.ts");
    expect(report.scenarios[1]?.acceptance.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricId: "personalization",
          score: expect.any(Number),
        }),
      ]),
    );
    expect(report.aggregate.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricId: "timeliness",
          score: expect.any(Number),
        }),
        expect.objectContaining({
          metricId: "credibility",
          score: expect.any(Number),
        }),
        expect.objectContaining({
          metricId: "collaborationEfficiency",
          passed: true,
        }),
      ]),
    );
  });

  it("builds dual portal personalization audit report with channel, matrix and integration markers", () => {
    const service = new DiagnosticWorkflowService(baseEnv, {
      memoryStore: new InMemoryMemoryStore(),
    });

    const report = service.generateDualPortalPersonalizationAuditReport();

    expect(report.summary.channelCount).toBe(report.dataChannels.length);
    expect(report.summary.pageCount).toBe(report.pageMatrix.length);
    expect(report.summary.driverCount).toBe(report.personalizationDrivers.length);
    expect(report.dataChannels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: "enterprise-collection-input",
          audience: "enterprise",
          integrationStatus: "real",
          affectsPersonalization: true,
        }),
        expect.objectContaining({
          channelId: "eastmoney-stock-report-source",
          integrationStatus: "real",
        }),
        expect.objectContaining({
          channelId: "nbs-macro-source",
          integrationStatus: "real",
        }),
      ]),
    );
    expect(report.pageMatrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pageId: "enterprise-home",
          audience: "enterprise",
        }),
        expect.objectContaining({
          pageId: "investor-analysis",
          audience: "investor",
        }),
      ]),
    );
    expect(report.personalizationDrivers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          driverId: "focus-mode",
          status: "active",
        }),
        expect.objectContaining({
          driverId: "chart-personalization",
          status: "partial",
        }),
      ]),
    );
    expect(report.summary.integrationStatusBreakdown).toEqual(
      expect.objectContaining({
        real: expect.any(Number),
        simulated: expect.any(Number),
        degraded: expect.any(Number),
        placeholder: expect.any(Number),
      }),
    );
  });

  it("builds minimum deployment audit report with workflow smoke test and memory recall", async () => {
    const service = new DiagnosticWorkflowService(
      {
        ...baseEnv,
        PERSISTENCE_MODE: "file",
      },
      {
      modelRouter: new ModelRouter([
        createDelayedAdapter("deepseekReasoner", {}),
        createDelayedAdapter("glm5", {}),
        createDelayedAdapter("qwen35Plus", {}),
      ]),
      },
    );

    const report = await service.generateMinimumDeploymentAuditReport();

    expect(report.evidenceMode).toBe("automated_mock");
    expect(report.overallPassed).toBe(true);
    expect(report.deploymentReadiness.canRunWithApiOnly).toBe(true);
    expect(report.runtimeReadiness.subsystems.persistence.status).toBe("ready");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "minimum_api_inputs",
          passed: true,
        }),
        expect.objectContaining({
          checkId: "personalization_memory_recall",
          passed: true,
        }),
      ]),
    );
    expect(report.smokeWorkflow.finalAnswerReady).toBe(true);
    expect(report.smokeWorkflow.recalledMemoryCount).toBeGreaterThan(0);
    expect(report.recommendations[0]).toContain("最小模型 API");
  });

  it("degrades gracefully when public macro retrieval has no usable evidence", async () => {
    // 缺少 NBS 凭证时，测试环境不会真实联网抓宏观网页数据，应保留可控降级
    const service = new DiagnosticWorkflowService(baseEnv, {
      modelRouter: new ModelRouter([
        createDelayedAdapter("deepseekReasoner", {}),
        createDelayedAdapter("glm5", {}),
        createDelayedAdapter("qwen35Plus", {}),
      ]),
    });

    const result = await service.diagnose({
      role: "investor",
      userId: "nbs-fallback-user",
      query: "宏观数据分析",
      focusMode: "investmentRecommendation",
      // 不传 enterpriseName 触发宏观数据（NBS）获取
    });

    const dataGathering = result.agents.find((item) => item.agentId === "dataGathering");
    
    expect(dataGathering).toBeTruthy();
    expect(dataGathering?.status).toBe("degraded");
    
    const output = dataGathering?.output as {
      status: string;
      source: string;
      gatheredData: {
        degraded?: boolean;
      };
    };
    expect(output.status).toBe("degraded");
    expect(output.source).toBe("public-rag");
    expect(output.gatheredData.degraded).toBe(true);
    
    expect(result.degradationTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "dataGathering",
          reason: "heuristic_fallback",
          message: expect.stringContaining("宏观公开网页证据不足"),
        }),
      ]),
    );
    expect(result.finalAnswer).toBeTruthy();
  });

  it("handles chitchat intent without running diagnostic workflow", async () => {
    const service = new DiagnosticWorkflowService(baseEnv, {
      modelRouter: new ModelRouter([
        createDelayedAdapter("deepseekReasoner", { conversation: 5 }),
        createDelayedAdapter("glm5", {}),
        createDelayedAdapter("qwen35Plus", {}),
      ]),
    });

    const result = await service.diagnose({
      role: "enterprise",
      userId: "chitchat-user",
      query: "你好",
      focusMode: "operationalDiagnosis",
    });

    expect(result.finalAnswer).toBeTruthy();
    expect(result.complexity).toBe("simple");
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]!.agentId).toBe("expressionGeneration");
    expect(result.agents[0]!.status).toBe("completed");
    expect(result.degradationTrace).toHaveLength(0);
  });

  it("handles meta intent with predefined answers", async () => {
    const service = new DiagnosticWorkflowService(baseEnv);

    const result = await service.diagnose({
      role: "investor",
      userId: "meta-user",
      query: "你能做什么？",
      focusMode: "industryStatus",
    });

    expect(result.finalAnswer).toContain("DQI");
    expect(result.finalAnswer).toContain("GMPS");
    expect(result.complexity).toBe("simple");
    expect(result.agents).toHaveLength(1);
  });

  it("handles DQI/GMPS meta questions with detailed answers", async () => {
    const service = new DiagnosticWorkflowService(baseEnv);

    const dqiResult = await service.diagnose({
      role: "enterprise",
      userId: "meta-dqi-user",
      query: "什么是DQI？",
      focusMode: "operationalDiagnosis",
    });
    expect(dqiResult.finalAnswer).toContain("Diagnostic Quality Index");
    expect(dqiResult.finalAnswer).toContain("0.4");

    const gmpsResult = await service.diagnose({
      role: "enterprise",
      userId: "meta-gmps-user",
      query: "什么是GMPS？",
      focusMode: "operationalDiagnosis",
    });
    expect(gmpsResult.finalAnswer).toContain("Gross Margin Pressure Score");
    expect(gmpsResult.finalAnswer).toContain("五");
  });

  it("routes diagnostic queries through full workflow, not conversation path", async () => {
    const service = new DiagnosticWorkflowService(baseEnv, {
      modelRouter: new ModelRouter([
        createDelayedAdapter("deepseekReasoner", {}),
        createDelayedAdapter("glm5", {}),
        createDelayedAdapter("qwen35Plus", {}),
      ]),
    });

    const result = await service.diagnose({
      role: "enterprise",
      userId: "diagnostic-user",
      query: "分析经营风险",
      focusMode: "operationalDiagnosis",
    });

    expect(result.agents.length).toBeGreaterThan(1);
    expect(result.complexity).not.toBe("simple");
  });

  it("handles short non-diagnostic input as chitchat", async () => {
    const service = new DiagnosticWorkflowService(baseEnv);

    const result = await service.diagnose({
      role: "enterprise",
      userId: "short-input-user",
      query: "好的",
      focusMode: "operationalDiagnosis",
    });

    expect(result.finalAnswer).toBeTruthy();
    expect(result.complexity).toBe("simple");
    expect(result.agents).toHaveLength(1);
  });
});
