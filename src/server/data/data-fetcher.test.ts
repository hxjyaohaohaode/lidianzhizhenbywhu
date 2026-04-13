import { describe, expect, it, vi } from "vitest";

import { DataGatheringAgent } from "./data-fetcher.js";
import type { ServerEnv } from "../../shared/config.js";

const baseEnv: ServerEnv = {
  NODE_ENV: "development",
  PORT: 3001,
  LOG_LEVEL: "silent" as never,
  CORS_ORIGIN: "http://localhost:5173",
  VITE_APP_TITLE: "测试平台",
  VITE_API_BASE_URL: "/api",
  PERSISTENCE_MODE: "memory",
  STORAGE_DIR: ".runtime/data-fetcher-test",
  CACHE_TTL_SECONDS: 300,
  CACHE_STALE_TTL_SECONDS: 1800,
  RATE_LIMIT_WINDOW_MS: 60000,
  RATE_LIMIT_MAX_REQUESTS: 120,
  ASYNC_TASK_CONCURRENCY: 2,
  AGENT_BUDGET_TOTAL_TOKENS: 16000,
  AGENT_BUDGET_MAX_STEPS: 12,
  AGENT_RETRY_LIMIT: 2,
  EXTERNAL_FETCH_TIMEOUT_MS: 4000,
  EXTERNAL_FETCH_RETRY_COUNT: 1,
  RAG_SOURCE_WHITELIST: ["example.com", "example.org", "example.net", "example.edu"],
  RAG_MAX_SOURCE_AGE_DAYS: 60,
  HEALTHCHECK_INCLUDE_DETAILS: true,
  ENABLE_BACKGROUND_TASKS: true,
  DEEPSEEK_API_KEY: undefined,
  GLM_API_KEY: undefined,
  QWEN_API_KEY: undefined,
  DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
  GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
  QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  NBS_ACCOUNT: undefined,
  NBS_PASSWORD: undefined,
  NBS_TOKEN: undefined,
};

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

function textResponse(payload: string, init: ResponseInit = {}) {
  return new Response(payload, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
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

describe("data gathering agent connectors", () => {
  it("accepts live SSE reports and normalizes bulletin urls", async () => {
    const agent = new DataGatheringAgent({ env: baseEnv });

    await withMockedFetch(async (input) => {
      const url = String(input);
      expect(url).toContain("query.sse.com.cn/security/stock/queryCompanyBulletin.do");
      expect(url).toContain("productId=600000");

      return jsonResponse({
        result: [
          {
            TITLE: "浦发银行2025年年度报告",
            URL: "/disclosure/listedinfo/annual/2025-03-28/600000_2025.pdf",
            BULLETIN_TYPE: "年报",
          },
        ],
      });
    }, async () => {
      const result = await agent.fetchSSEReports("600000", "2025");

      expect(result.success).toBe(true);
      expect(result.degraded).toBe(false);
      expect(result.reports).toEqual([
        {
          title: "浦发银行2025年年度报告",
          url: "https://www.sse.com.cn/disclosure/listedinfo/annual/2025-03-28/600000_2025.pdf",
          bulletinType: "年报",
        },
      ]);
    });
  });

  it("falls back to SSE html page when api payload is empty", async () => {
    const agent = new DataGatheringAgent({ env: baseEnv });

    await withMockedFetch(async (input) => {
      const url = String(input);
      if (url.includes("query.sse.com.cn/security/stock/queryCompanyBulletin.do")) {
        return jsonResponse({ result: [] });
      }

      expect(url).toContain("www.sse.com.cn/assortment/stock/list/info/announcement/index.shtml");
      return textResponse(`
        <html>
          <body>
            <a href="/disclosure/listedinfo/annual/2025-03-28/600000_2025.pdf" title="浦发银行2025年年度报告">年度报告</a>
          </body>
        </html>
      `);
    }, async () => {
      const result = await agent.fetchSSEReports("600000", "2025");

      expect(result.success).toBe(true);
      expect(result.degraded).toBe(false);
      expect(result.reports).toEqual([
        {
          title: "浦发银行2025年年度报告",
          url: "https://www.sse.com.cn/disclosure/listedinfo/annual/2025-03-28/600000_2025.pdf",
        },
      ]);
    });
  });

  it("prioritizes a user-provided SSE regular page url before calling the SSE api", async () => {
    const agent = new DataGatheringAgent({ env: baseEnv });
    const inputUrl = "https://www.sse.com.cn/assortment/stock/list/info/announcement/index.shtml?productId=600000";

    await withMockedFetch(async (input) => {
      expect(String(input)).toBe(inputUrl);
      return textResponse(`
        <html>
          <body>
            <tr>
              <td>600001</td>
              <td><a href="/disclosure/listedinfo/annual/2025-03-20/600001_2025.pdf" title="上证样例2025年年度报告">年度报告</a></td>
            </tr>
            <tr>
              <td>600000</td>
              <td><a href="/disclosure/listedinfo/annual/2024-03-28/600000_2024.pdf" title="浦发银行2024年年度报告">年度报告</a></td>
            </tr>
            <tr>
              <td>600000</td>
              <td><a href="/disclosure/listedinfo/annual/2025-03-28/600000_2025.pdf" title="浦发银行2025年年度报告">年度报告</a></td>
            </tr>
          </body>
        </html>
      `);
    }, async (mockedFetch) => {
      const result = await agent.fetchSSEReports(inputUrl, "2025");

      expect(result.success).toBe(true);
      expect(result.degraded).toBe(false);
      expect(result.reports).toEqual([
        {
          title: "浦发银行2025年年度报告",
          url: "https://www.sse.com.cn/disclosure/listedinfo/annual/2025-03-28/600000_2025.pdf",
        },
      ]);
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });
  });

  it("accepts live BSE reports and extracts html anchors", async () => {
    const agent = new DataGatheringAgent({ env: baseEnv });

    await withMockedFetch(async (input, init) => {
      expect(String(input)).toBe("https://www.bse.cn/disclosureInfoController/infoResult.do");
      expect(init?.method).toBe("POST");

      return textResponse(`
        <html>
          <body>
            <a href="/disclosure/2025/annual/830001.pdf" title="北证样例2025年年度报告">下载</a>
          </body>
        </html>
      `);
    }, async () => {
      const result = await agent.fetchBSEReports("830001", "2025");

      expect(result.success).toBe(true);
      expect(result.degraded).toBe(false);
      expect(result.reports).toEqual([
        {
          title: "北证样例2025年年度报告",
          url: "https://www.bse.cn/disclosure/2025/annual/830001.pdf",
        },
      ]);
    });
  });

  it("falls back to BSE html page when disclosure result page has no anchors", async () => {
    const agent = new DataGatheringAgent({ env: baseEnv });

    await withMockedFetch(async (input, init) => {
      const url = String(input);
      if (url === "https://www.bse.cn/disclosureInfoController/infoResult.do") {
        expect(init?.method).toBe("POST");
        return textResponse("<html><body>empty</body></html>");
      }

      expect(url).toContain("https://www.bse.cn/disclosure/announcement.html?companyCode=830001");
      return textResponse(`
        <html>
          <body>
            <a href="/disclosure/2025/annual/830001.pdf" title="北证样例2025年年度报告">公告</a>
          </body>
        </html>
      `);
    }, async () => {
      const result = await agent.fetchBSEReports("830001", "2025");

      expect(result.success).toBe(true);
      expect(result.degraded).toBe(false);
      expect(result.reports).toEqual([
        {
          title: "北证样例2025年年度报告",
          url: "https://www.bse.cn/disclosure/2025/annual/830001.pdf",
        },
      ]);
    });
  });

  it("prioritizes a user-provided BSE announcement page url before the redirect-prone post endpoint", async () => {
    const agent = new DataGatheringAgent({ env: baseEnv });
    const inputUrl = "https://www.bse.cn/disclosure/announcement.html?companyCode=830001";

    await withMockedFetch(async (input) => {
      expect(String(input)).toBe(inputUrl);
      return textResponse(`
        <html>
          <body>
            <tr>
              <td>830002</td>
              <td><a href="/disclosure/2025/annual/830002.pdf" title="北证样例2025年年度报告">公告</a></td>
            </tr>
            <tr>
              <td>830001</td>
              <td><a href="/disclosure/2024/annual/830001.pdf" title="北证样例2024年年度报告">公告</a></td>
            </tr>
            <tr>
              <td>830001</td>
              <td><a href="/disclosure/2025/annual/830001.pdf" title="北证样例2025年年度报告">公告</a></td>
            </tr>
          </body>
        </html>
      `);
    }, async (mockedFetch) => {
      const result = await agent.fetchBSEReports(inputUrl, "2025");

      expect(result.success).toBe(true);
      expect(result.degraded).toBe(false);
      expect(result.reports).toEqual([
        {
          title: "北证样例2025年年度报告",
          url: "https://www.bse.cn/disclosure/2025/annual/830001.pdf",
        },
      ]);
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });
  });

  it("accepts eastmoney industry research payloads with JSONP parsing", async () => {
    const agent = new DataGatheringAgent({ env: baseEnv });

    await withMockedFetch(async (input) => {
      const url = String(input);
      expect(url).toContain("reportapi.eastmoney.com/report/list?industryCode=BK0428");

      return textResponse(`
        callback({
          "data": [
            {
              "reportTitle": "储能行业深度报告",
              "digest": "需求恢复与招标放量共振",
              "infoCode": "ABC123"
            }
          ]
        });
      `);
    }, async () => {
      const result = await agent.fetchEastmoneyIndustryReports("BK0428");

      expect(result.success).toBe(true);
      expect(result.degraded).toBe(false);
      expect(result.data).toEqual([
        {
          title: "储能行业深度报告",
          summary: "需求恢复与招标放量共振",
          pdfUrl: "https://pdf.dfcfw.com/pdf/H3_ABC123_1.pdf",
        },
      ]);
    });
  });

  it("falls back to eastmoney stock html page when api request fails", async () => {
    const agent = new DataGatheringAgent({ env: baseEnv });

    await withMockedFetch(async (input) => {
      const url = String(input);
      if (url.includes("reportapi.eastmoney.com/report/list?code=600000")) {
        return new Response("bad request", { status: 400 });
      }

      expect(url).toBe("https://data.eastmoney.com/report/stock.jshtml");
      return textResponse(`
        <html>
          <body>
            <article>
              <span>600000</span>
              <span>2025-03-18</span>
              <a href="/reports/detail/coverage.html" title="浦发银行首次覆盖报告">浦发银行首次覆盖报告</a>
              <p>净息差承压但资本充足率和经营现金流保持稳健。</p>
              <a href="https://pdf.dfcfw.com/pdf/H3_TEST600000_1.pdf">PDF</a>
            </article>
          </body>
        </html>
      `);
    }, async () => {
      const result = await agent.fetchEastmoneyStockReports("600000");

      expect(result.success).toBe(true);
      expect(result.degraded).toBe(false);
      expect(result.data).toEqual([
        {
          title: "浦发银行首次覆盖报告",
          summary: "净息差承压但资本充足率和经营现金流保持稳健。",
          pdfUrl: "https://pdf.dfcfw.com/pdf/H3_TEST600000_1.pdf",
        },
      ]);
    });
  });

  it("prioritizes a user-provided eastmoney stock page url before the report api", async () => {
    const agent = new DataGatheringAgent({ env: baseEnv });
    const inputUrl = "https://data.eastmoney.com/report/stock.jshtml?code=600000";

    await withMockedFetch(async (input) => {
      expect(String(input)).toBe(inputUrl);
      return textResponse(`
        <html>
          <body>
            <article>
              <span>600036</span>
              <span>2025-03-01</span>
              <a href="/reports/detail/other-bank.html" title="招商银行首次覆盖报告">招商银行首次覆盖报告</a>
              <p>其他银行样例，不应命中当前证券代码。</p>
              <a href="https://pdf.dfcfw.com/pdf/H3_TEST600036_1.pdf">PDF</a>
            </article>
            <article>
              <span>600000</span>
              <span>2024-12-20</span>
              <a href="/reports/detail/old-year.html" title="浦发银行深度覆盖报告">浦发银行深度覆盖报告</a>
              <p>历史年份样例，不应命中当前年份过滤。</p>
              <a href="https://pdf.dfcfw.com/pdf/H3_TEST600000_OLD.pdf">PDF</a>
            </article>
            <article>
              <span>600000</span>
              <span>2025-03-18</span>
              <a href="/reports/detail/coverage.html" title="浦发银行首次覆盖报告">浦发银行首次覆盖报告</a>
              <p>经营现金流改善且拨备覆盖率维持高位。</p>
              <a href="https://pdf.dfcfw.com/pdf/H3_TEST600000_2.pdf">PDF</a>
            </article>
          </body>
        </html>
      `);
    }, async (mockedFetch) => {
      const result = await agent.fetchEastmoneyStockReports(inputUrl, "2025");

      expect(result.success).toBe(true);
      expect(result.degraded).toBe(false);
      expect(result.data).toEqual([
        {
          title: "浦发银行首次覆盖报告",
          summary: "经营现金流改善且拨备覆盖率维持高位。",
          pdfUrl: "https://pdf.dfcfw.com/pdf/H3_TEST600000_2.pdf",
        },
      ]);
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });
  });

  it("accepts NBS account-password login flow and reuses token headers for macro query", async () => {
    const agent = new DataGatheringAgent({
      env: {
        ...baseEnv,
        NBS_ACCOUNT: "demo-account",
        NBS_PASSWORD: "demo-password",
      },
    });

    await withMockedFetch(async (input, init) => {
      const url = String(input);

      if (url === "https://data.stats.gov.cn/auth/login") {
        expect(init?.method).toBe("POST");
        return jsonResponse(
          { token: "login-token" },
          {
            headers: {
              "set-cookie": "nbs_session=session-123; Path=/; HttpOnly",
            },
          },
        );
      }

      if (url.includes("data.stats.gov.cn/easyquery.htm?m=QueryData")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBe("Bearer login-token");
        expect(headers.get("Cookie")).toContain("nbs_session=session-123");

        return jsonResponse({
          returndata: {
            datanodes: [
              {
                data: { strdata: "101.8" },
                wds: [
                  { wdcode: "zb", valuecode: "A0201" },
                  { wdcode: "sj", valuecode: "202503" },
                ],
              },
            ],
          },
        });
      }

      throw new Error(`unexpected fetch url: ${url}`);
    }, async (mockedFetch) => {
      const result = await agent.fetchNBSMacroData("A0201", "202503");

      expect(result.success).toBe(true);
      expect(result.degraded).toBe(false);
      expect(result.records).toEqual([{ time: "202503", value: "101.8" }]);
      expect(mockedFetch.mock.calls.map((call) => String(call[0]))).toEqual(
        expect.arrayContaining([
          "https://data.stats.gov.cn/auth/login",
          expect.stringContaining("https://data.stats.gov.cn/easyquery.htm?m=QueryData"),
        ]),
      );
    });
  });

  it("accepts NBS cookie mode and sends cookie directly for macro query", async () => {
    const agent = new DataGatheringAgent({
      env: {
        ...baseEnv,
        NBS_COOKIE: "stats-token=test-cookie; nbs_session=session-456",
      },
    });

    await withMockedFetch(async (input, init) => {
      const url = String(input);

      if (url.includes("data.stats.gov.cn/easyquery.htm?m=QueryData")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("Cookie")).toBe("stats-token=test-cookie; nbs_session=session-456");
        expect(headers.get("Authorization")).toBeNull();

        return jsonResponse({
          returndata: {
            datanodes: [
              {
                data: { strdata: "102.4" },
                wds: [
                  { wdcode: "zb", valuecode: "A0201" },
                  { wdcode: "sj", valuecode: "202503" },
                ],
              },
            ],
          },
        });
      }

      throw new Error(`unexpected fetch url: ${url}`);
    }, async (mockedFetch) => {
      const result = await agent.fetchNBSMacroData("A0201", "202503");

      expect(result.success).toBe(true);
      expect(result.degraded).toBe(false);
      expect(result.records).toEqual([{ time: "202503", value: "102.4" }]);
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });
  });
});
