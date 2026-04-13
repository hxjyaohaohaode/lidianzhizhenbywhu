import { describe, expect, it } from "vitest";

import {
  CuratedBatteryWebSearchProvider,
  InMemoryWebPageFetcher,
  RealtimeIndustryRagService,
  type WebPageFetcher,
  type WebSearchProvider,
  type WebSearchResult,
} from "./realtime-rag.js";

function createSearchProvider(
  items: WebSearchResult[],
  options: {
    providerName?: string;
    fallbackUsed?: boolean;
    fail?: boolean;
  } = {},
): WebSearchProvider {
  return {
    async search() {
      if (options.fail) {
        throw new Error("search failed");
      }

      return {
        items,
        providerName: options.providerName ?? "bing-rss",
        fallbackUsed: options.fallbackUsed ?? false,
      };
    },
  };
}

function createFailingPageFetcher(): WebPageFetcher {
  return {
    async fetch() {
      throw new Error("page fetch failed");
    },
  };
}

describe("realtime industry rag service", () => {
  it("retrieves ranked citations with summaries and confidence scores", async () => {
    const service = new RealtimeIndustryRagService({
      searchProvider: new CuratedBatteryWebSearchProvider(),
      pageFetcher: new InMemoryWebPageFetcher(),
      now: () => new Date("2026-03-31T08:00:00.000Z"),
    });

    const result = await service.retrieve({
      role: "enterprise",
      enterpriseName: "星海电池",
      query: "分析毛利承压、库存去化与订单节奏",
      focusMode: "operationalDiagnosis",
      limit: 3,
    });

    expect(result.query).toContain("星海电池");
    expect(result.citations).toHaveLength(3);
    expect(result.citations[0]?.confidenceScore ?? 0).toBeGreaterThan(0.5);
    expect(result.citations[0]?.summary ?? "").toMatch(/库存|订单/);
    expect(result.referenceAbstract).toContain("：");
    expect(result.indexStats.chunkCount).toBeGreaterThan(0);
    expect(result.indexStats.searchProvider).toBe("curated-battery-fallback");
    expect(result.indexStats.fallbackUsed).toBe(true);
    expect(result.citations[0]?.trace.documentId).toBeTruthy();
    expect(result.citations[0]?.trace.chunkId).toBeTruthy();
    expect(result.citations[0]?.trace.rankingSignals.confidenceScore ?? 0).toBeGreaterThan(0.5);
    expect(result.indexStats.traceableCitations).toBe(result.citations.length);
  });

  it("adapts retrieval framing for investor analysis", async () => {
    const service = new RealtimeIndustryRagService({
      searchProvider: new CuratedBatteryWebSearchProvider(),
      pageFetcher: new InMemoryWebPageFetcher(),
      now: () => new Date("2026-03-31T08:00:00.000Z"),
    });

    const result = await service.retrieve({
      role: "investor",
      query: "从投资角度判断行业景气与现金流风险",
      focusMode: "investmentRecommendation",
      limit: 2,
    });

    expect(result.query).toContain("投资");
    expect(result.retrievalSummary).toContain("投资侧");
    expect(result.citations).toHaveLength(2);
    expect(result.citations.some((item) => item.summary.includes("现金流"))).toBe(true);
  });

  it("falls back to curated search provider when realtime search fails", async () => {
    const service = new RealtimeIndustryRagService({
      searchProvider: createSearchProvider([], { fail: true }),
      fallbackSearchProvider: new CuratedBatteryWebSearchProvider(),
      pageFetcher: new InMemoryWebPageFetcher(),
      now: () => new Date("2026-03-31T08:00:00.000Z"),
    });

    const result = await service.retrieve({
      role: "enterprise",
      enterpriseName: "星海电池",
      query: "跟踪库存去化和需求恢复",
      focusMode: "operationalDiagnosis",
      limit: 2,
    });

    expect(result.citations).toHaveLength(2);
    expect(result.indexStats.searchProvider).toBe("curated-battery-fallback");
    expect(result.indexStats.fallbackUsed).toBe(true);
    expect(result.retrievalSummary).toContain("回退");
  });

  it("retains citation generation when realtime page fetch falls back to snippets", async () => {
    const service = new RealtimeIndustryRagService({
      searchProvider: createSearchProvider([
        {
          title: "Bing 实时结果",
          url: "https://news.example.com/live-battery-update",
          snippet: "库存去化加快，现金流质量改善，订单节奏回升。",
          source: "news.example.com",
          publishedAt: "2026-03-26",
          rankScore: 0.92,
        },
      ]),
      pageFetcher: createFailingPageFetcher(),
      fallbackPageFetcher: new InMemoryWebPageFetcher(),
      now: () => new Date("2026-03-31T08:00:00.000Z"),
    });

    const result = await service.retrieve({
      role: "investor",
      query: "判断现金流风险和订单节奏",
      focusMode: "investmentRecommendation",
      limit: 1,
    });

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.summary).toContain("现金流");
    expect(result.indexStats.searchProvider).toBe("bing-rss");
    expect(result.indexStats.fallbackUsed).toBe(true);
  });

  it("filters off-topic hits and prioritizes official financial sources", async () => {
    const service = new RealtimeIndustryRagService({
      searchProvider: createSearchProvider([
        {
          title: "Key West Hotels",
          url: "https://booking.com/key-west-hotels",
          snippet: "Top hotel deals and travel discounts.",
          source: "booking.com",
          publishedAt: "2026-03-26",
          rankScore: 0.98,
        },
        {
          title: "星海电池2025年年度报告摘要",
          url: "https://www.sse.com.cn/disclosure/listedinfo/annual/2026-03-28/600000_2025.pdf",
          snippet: "年报显示毛利率承压，但经营现金流改善。",
          source: "sse.com.cn",
          publishedAt: "2026-03-28",
          rankScore: 0.62,
        },
      ]),
      pageFetcher: new InMemoryWebPageFetcher(),
      now: () => new Date("2026-03-31T08:00:00.000Z"),
      sourceWhitelist: ["sse.com.cn", "eastmoney.com", "gov.cn"],
    });

    const result = await service.retrieve({
      role: "enterprise",
      enterpriseName: "星海电池",
      query: "分析毛利承压与现金流改善",
      focusMode: "deepDive",
      limit: 1,
    });

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.url).toContain("sse.com.cn");
    expect(result.indexStats.filteredSources).toBeGreaterThanOrEqual(1);
  });

  it("falls back to curated finance results when realtime search only returns off-topic pages", async () => {
    const service = new RealtimeIndustryRagService({
      searchProvider: createSearchProvider([
        {
          title: "Hotel booking guide",
          url: "https://travel.example.com/hotel-booking-guide",
          snippet: "Travel tips and hotel discounts for summer.",
          source: "travel.example.com",
          publishedAt: "2026-03-28",
          rankScore: 0.95,
        },
      ]),
      fallbackSearchProvider: new CuratedBatteryWebSearchProvider(),
      pageFetcher: new InMemoryWebPageFetcher(),
      fallbackPageFetcher: new InMemoryWebPageFetcher(),
      now: () => new Date("2026-03-31T08:00:00.000Z"),
    });

    const result = await service.retrieve({
      role: "enterprise",
      enterpriseName: "星海电池",
      query: "跟踪库存去化、订单节奏和经营质量",
      focusMode: "operationalDiagnosis",
      limit: 2,
    });

    expect(result.citations).toHaveLength(2);
    expect(result.indexStats.searchProvider).toBe("curated-battery-fallback");
    expect(result.indexStats.fallbackUsed).toBe(true);
    expect(result.citations.every((item) => !item.url.includes("hotel"))).toBe(true);
  });

  it("builds traceable provenance for financial report and industry report recall", async () => {
    const service = new RealtimeIndustryRagService({
      searchProvider: new CuratedBatteryWebSearchProvider(),
      pageFetcher: new InMemoryWebPageFetcher(),
      now: () => new Date("2026-03-31T08:00:00.000Z"),
    });

    const result = await service.retrieve({
      role: "enterprise",
      enterpriseName: "星海电池",
      query: "结合年度报告和行业研报，跟踪毛利率、现金流、库存去化与订单兑现",
      focusMode: "deepDive",
      limit: 4,
    });

    expect(result.citations).toHaveLength(4);
    expect(result.citations.every((item) => item.trace.matchedTerms.length > 0)).toBe(true);
    expect(result.citations.some((item) => item.trace.documentType === "financialReport")).toBe(true);
    expect(result.citations.some((item) => item.trace.documentType === "industryReport")).toBe(true);
    expect(result.indexStats.documentTypes).toEqual(
      expect.arrayContaining(["financialReport", "industryReport"]),
    );
    expect(result.citations[0]?.trace.searchProvider).toBe("curated-battery-fallback");
  });
});
