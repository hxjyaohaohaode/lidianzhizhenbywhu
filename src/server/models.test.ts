import { describe, expect, it } from "vitest";

import {
  analyzeGrossMarginPressure,
  analyzeOperatingQuality,
  validateOperatingQualityInput,
} from "./models.js";

describe("diagnostic models", () => {
  it("evaluates gross margin pressure with normalized metrics and trend", () => {
    const result = analyzeGrossMarginPressure({
      currentGrossMargin: 15,
      baselineGrossMargin: 22,
      currentRevenue: 1200,
      baselineRevenue: 1000,
      currentCost: 1040,
      baselineCost: 780,
      currentSalesVolume: 95,
      baselineSalesVolume: 100,
      currentInventoryExpense: 92,
      baselineInventoryExpense: 70,
    });

    expect(result.modelId).toBe("grossMarginPressure");
    expect(result.score).toBeLessThan(50);
    expect(result.riskLevel).toBe("high");
    expect(result.trend.direction).toBe("deteriorating");
    expect(result.normalizedMetrics).toMatchObject({
      costRevenueSpread: expect.objectContaining({
        normalizedScore: expect.any(Number),
      }),
    });
    expect(result.normalizedMetrics.costRevenueSpread?.normalizedScore).toBeLessThan(40);
    expect(result.keyFindings).toHaveLength(4);
  });

  it("evaluates operating quality with improving trend", () => {
    const result = analyzeOperatingQuality({
      currentSalesVolume: 104,
      baselineSalesVolume: 96,
      currentProductionVolume: 106,
      baselineProductionVolume: 100,
      currentManufacturingExpense: 510,
      baselineManufacturingExpense: 520,
      currentOperatingCost: 760,
      baselineOperatingCost: 800,
      currentOperatingCashFlow: 160,
      baselineOperatingCashFlow: 120,
      currentRevenue: 1300,
      baselineRevenue: 1180,
      currentTotalLiabilities: 620,
      baselineTotalLiabilities: 650,
      currentTotalAssets: 1420,
      baselineTotalAssets: 1400,
    });

    expect(result.modelId).toBe("operatingQuality");
    expect(result.score).toBeGreaterThan(70);
    expect(result.riskLevel).toBe("low");
    expect(result.trend.direction).toBe("improving");
    expect(result.normalizedMetrics).toMatchObject({
      cashConversion: expect.objectContaining({
        normalizedScore: expect.any(Number),
      }),
    });
    expect(result.normalizedMetrics.cashConversion?.normalizedScore).toBeGreaterThan(60);
  });

  it("rejects invalid operating quality input", () => {
    expect(() =>
      validateOperatingQualityInput({
        currentSalesVolume: 100,
        baselineSalesVolume: 100,
        currentProductionVolume: 100,
        baselineProductionVolume: 100,
        currentManufacturingExpense: 120,
        baselineManufacturingExpense: 100,
        currentOperatingCost: 110,
        baselineOperatingCost: 90,
        currentOperatingCashFlow: 10,
        baselineOperatingCashFlow: 10,
        currentRevenue: 500,
        baselineRevenue: 500,
        currentTotalLiabilities: 120,
        baselineTotalLiabilities: 80,
        currentTotalAssets: 100,
        baselineTotalAssets: 70,
      }),
    ).toThrow("请求参数校验失败。");
  });
});
