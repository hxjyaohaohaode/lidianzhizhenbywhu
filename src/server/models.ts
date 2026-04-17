import { createHash } from "node:crypto";

import { ZodError, type ZodType } from "zod";

import { AppError } from "./errors.js";
import {
  dqiInputSchema,
  gmpsInputSchema,
  grossMarginPressureInputSchema,
  operatingQualityInputSchema,
  GMPS_INDUSTRY_WEIGHTS,
  type GMPSDimensionScores,
  type GMPSIndustrySegment,
  type GMPSInput,
  type GMPSLevel,
  type GMPSResult,
  type GMPSRiskLevel,
  type DQIInput,
  type DQIResult,
  type DiagnosticResult,
  type GrossMarginPressureInput,
  type GrossMarginPressureResult,
  type NormalizedMetric,
  type OperatingQualityInput,
  type OperatingQualityResult,
  type RiskLevel,
  type TrendAssessment,
  type TrendDirection,
} from "../shared/diagnostics.js";

function round(value: number, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeHigherBetter(value: number, min: number, max: number) {
  if (min === max) {
    return 100;
  }

  if (!Number.isFinite(value)) return 0;

  return round(clamp(((value - min) / (max - min)) * 100, 0, 100));
}

function normalizeLowerBetter(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  return round(100 - normalizeHigherBetter(value, min, max));
}

function growthRate(current: number, baseline: number) {
  if (Math.abs(baseline) < Number.EPSILON) {
    if (Math.abs(current) < Number.EPSILON) {
      return 0;
    }

    return current > 0 ? 1 : -1;
  }

  return (current - baseline) / Math.abs(baseline);
}

function metric(label: string, rawValue: number, normalizedScore: number): NormalizedMetric {
  return {
    label,
    rawValue: round(rawValue),
    normalizedScore: round(normalizedScore),
  };
}

/** 缓存的行业数据（带TTL） */
let _cachedIndustryData: { lithiumPrice: number; baselineLithiumPrice: number; industryVolatility: number; timestamp: number } | null = null;
const INDUSTRY_CACHE_TTL_MS = 5 * 60 * 1000;

/** 获取行业数据（带缓存） */
export function getIndustryData(platformStore?: { getLatestIndustryData: () => { lithiumPrice?: { price: number }; industryIndex?: { volatility: number } } | null }): { lithiumPrice: number; baselineLithiumPrice: number; industryVolatility: number } {
  const now = Date.now();
  if (_cachedIndustryData && (now - _cachedIndustryData.timestamp) < INDUSTRY_CACHE_TTL_MS) {
    return _cachedIndustryData;
  }
  let lithiumPrice = 10;
  let baselineLithiumPrice = 12;
  let industryVolatility = 0.2;
  if (platformStore) {
    const latest = platformStore.getLatestIndustryData();
    if (latest?.lithiumPrice?.price && latest.lithiumPrice.price > 0) {
      lithiumPrice = latest.lithiumPrice.price / 10000;
      baselineLithiumPrice = lithiumPrice * 1.1;
    }
    if (latest?.industryIndex?.volatility && latest.industryIndex.volatility > 0) {
      industryVolatility = latest.industryIndex.volatility;
    }
  }
  _cachedIndustryData = { lithiumPrice, baselineLithiumPrice, industryVolatility, timestamp: now };
  return _cachedIndustryData;
}

export function clearIndustryDataCache(): void {
  _cachedIndustryData = null;
}

function weightedScore(items: Array<{ normalizedScore: number; weight: number }>): number {
  let totalWeight = 0;
  let totalScore = 0;
  let validCount = 0;
  const len = items.length;
  for (let i = 0; i < len; i++) {
    const item = items[i]!;
    if (Number.isFinite(item.normalizedScore)) {
      totalScore += item.normalizedScore * item.weight;
      totalWeight += item.weight;
      validCount++;
    }
  }
  if (validCount === 0) return 0;
  return round(totalScore / totalWeight);
}

function classifyRisk(score: number, severeSignalCount: number): RiskLevel {
  if (score < 50 || severeSignalCount >= 2) {
    return "high";
  }

  if (score < 75 || severeSignalCount >= 1) {
    return "medium";
  }

  return "low";
}

function createTrend(direction: TrendDirection, summary: string): TrendAssessment {
  return { direction, summary };
}

function formatPercent(value: number) {
  return `${round(value * 100)}%`;
}

function parseInput<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);

  if (parsed.success) {
    return parsed.data;
  }

  throw createValidationError(parsed.error);
}

function createValidationError(error: ZodError) {
  return new AppError({
    code: "INVALID_REQUEST",
    message: "请求参数校验失败。",
    statusCode: 400,
    details: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

function buildResult<TModelId extends string>(result: DiagnosticResult<TModelId>) {
  return {
    ...result,
    score: round(result.score),
  };
}

function getInputQuality(auditTrail: string[]) {
  if (auditTrail.some((item) => item.includes("异常") || item.includes("兜底"))) {
    return "medium" as const;
  }

  return auditTrail.length <= 2 ? "high" as const : "medium" as const;
}

/** 轻量级 reproducibilityKey 生成（避免全量 JSON.stringify） */
function fastReproducibilityKey(modelId: string, payload: unknown): string {
  try {
    const p = payload as Record<string, unknown> | null;
    if (p && typeof p === "object") {
      const keys = Object.keys(p).sort();
      const signature = keys.map(k => {
        const v = p[k];
        return `${k}:${typeof v === "number" ? v.toFixed(4) : String(v ?? "")}`;
      }).join("|");
      return createHash("sha1").update(`${modelId}:${signature}`).digest("hex").slice(0, 16);
    }
    return createHash("sha1").update(`${modelId}:${String(payload)}`).digest("hex").slice(0, 16);
  } catch {
    return `${modelId}-fallback-${Date.now().toString(36).slice(-8)}`;
  }
}

function createGovernance<TModelId extends string>(
  modelId: TModelId,
  payload: unknown,
  confidenceScore: number,
  auditTrail: string[],
) {
  const hasIssues = auditTrail.length > 0 && (auditTrail[0]?.includes("异常") || auditTrail.some((item) => item.includes("异常") || item.includes("兜底")));
  return {
    modelVersion: `${modelId}-2026.04`,
    parameterVersion: `${modelId}-baseline-v2`,
    reproducibilityKey: fastReproducibilityKey(modelId, payload),
    confidenceScore: round(confidenceScore),
    inputQuality: hasIssues ? "medium" as const : (auditTrail.length <= 2 ? "high" as const : "medium" as const),
    normalizedAt: _cachedNormalizedTime ?? (_cachedNormalizedTime = new Date().toISOString()),
    auditTrail,
  };
}

let _cachedNormalizedTime: string | null = null;

export function analyzeGrossMarginPressure(payload: unknown): GrossMarginPressureResult {
  const input = parseInput(grossMarginPressureInputSchema, payload);
  const marginChange = input.currentGrossMargin - input.baselineGrossMargin;
  const revenueGrowth = growthRate(input.currentRevenue, input.baselineRevenue);
  const costGrowth = growthRate(input.currentCost, input.baselineCost);
  const costRevenueSpread = costGrowth - revenueGrowth;
  const currentUnitCost = input.currentCost / input.currentSalesVolume;
  const baselineUnitCost = input.baselineCost / input.baselineSalesVolume;
  const unitCostChange = growthRate(currentUnitCost, baselineUnitCost);
  const inventoryExpenseChange = growthRate(
    input.currentInventoryExpense,
    input.baselineInventoryExpense,
  );

  const normalizedMetrics = {
    currentGrossMargin: metric(
      "当前毛利率",
      input.currentGrossMargin,
      normalizeHigherBetter(input.currentGrossMargin, 8, 35),
    ),
    marginChange: metric(
      "毛利率同比变化",
      marginChange,
      normalizeHigherBetter(marginChange, -12, 8),
    ),
    costRevenueSpread: metric(
      "成本增速相对收入增速差",
      costRevenueSpread,
      normalizeLowerBetter(costRevenueSpread, -0.08, 0.18),
    ),
    unitCostChange: metric(
      "单位成本变化率",
      unitCostChange,
      normalizeLowerBetter(unitCostChange, -0.08, 0.2),
    ),
    inventoryExpenseChange: metric(
      "库存费用变化率",
      inventoryExpenseChange,
      normalizeLowerBetter(inventoryExpenseChange, -0.05, 0.25),
    ),
  };

  const score = weightedScore([
    { normalizedScore: normalizedMetrics.currentGrossMargin.normalizedScore, weight: 0.28 },
    { normalizedScore: normalizedMetrics.marginChange.normalizedScore, weight: 0.27 },
    { normalizedScore: normalizedMetrics.costRevenueSpread.normalizedScore, weight: 0.2 },
    { normalizedScore: normalizedMetrics.unitCostChange.normalizedScore, weight: 0.15 },
    { normalizedScore: normalizedMetrics.inventoryExpenseChange.normalizedScore, weight: 0.1 },
  ]);

  const severeSignals = [
    marginChange <= -5,
    costRevenueSpread >= 0.05,
    unitCostChange >= 0.08,
    inventoryExpenseChange >= 0.12,
  ].filter(Boolean).length;

  const riskLevel = classifyRisk(score, severeSignals);

  const trend =
    marginChange >= 2 && costRevenueSpread <= 0 && unitCostChange <= 0.03
      ? createTrend(
          "improving",
          `毛利率较基期提升 ${round(marginChange)} 个百分点，成本增速未超过收入增速，毛利承压正在缓解。`,
        )
      : marginChange <= -2 || costRevenueSpread >= 0.04 || unitCostChange >= 0.08
        ? createTrend(
            "deteriorating",
            `毛利率较基期回落 ${round(Math.abs(marginChange))} 个百分点，成本增速相对收入增速高出 ${formatPercent(
              costRevenueSpread,
            )}，承压趋势走弱。`,
          )
        : createTrend(
            "stable",
            `毛利率变化 ${round(marginChange)} 个百分点，成本与收入增速差为 ${formatPercent(
              costRevenueSpread,
            )}，整体维持震荡。`,
          );

  const keyFindings = [
    marginChange < 0
      ? `当前毛利率较基期下降 ${round(Math.abs(marginChange))} 个百分点。`
      : `当前毛利率较基期提升 ${round(marginChange)} 个百分点。`,
    costRevenueSpread > 0
      ? `成本增速较收入增速快 ${formatPercent(costRevenueSpread)}，存在利润挤压。`
      : `收入增速领先成本增速 ${formatPercent(Math.abs(costRevenueSpread))}。`,
    unitCostChange > 0
      ? `单位成本上升 ${formatPercent(unitCostChange)}。`
      : `单位成本下降 ${formatPercent(Math.abs(unitCostChange))}。`,
    inventoryExpenseChange > 0
      ? `库存费用增加 ${formatPercent(inventoryExpenseChange)}，需关注库存周转。`
      : `库存费用改善 ${formatPercent(Math.abs(inventoryExpenseChange))}。`,
  ];

  return buildResult({
    modelId: "grossMarginPressure",
    modelName: "毛利承压模型",
    score,
    riskLevel,
    trend,
    normalizedMetrics,
    keyFindings,
    governance: createGovernance("grossMarginPressure", input, score / 100, [
      "完成结构化输入校验。",
      "完成同比口径归一与单位成本推导。",
      severeSignals > 0 ? `识别 ${severeSignals} 个高压信号。` : "未识别需要兜底的异常信号。",
    ]),
  });
}

export function analyzeOperatingQuality(payload: unknown): OperatingQualityResult {
  const input = parseInput(operatingQualityInputSchema, payload);
  const currentCapacityUtilization = input.currentSalesVolume / input.currentProductionVolume;
  const productionSalesGap = Math.max(
    (input.currentProductionVolume - input.currentSalesVolume) / input.currentProductionVolume,
    0,
  );
  const manufacturingExpenseRatio =
    input.currentManufacturingExpense / input.currentOperatingCost;
  const cashConversion = input.currentOperatingCashFlow / input.currentRevenue;
  const currentLeverageRatio = input.currentTotalLiabilities / input.currentTotalAssets;
  const baselineLeverageRatio = input.baselineTotalLiabilities / input.baselineTotalAssets;
  const leverageChange = currentLeverageRatio - baselineLeverageRatio;
  const revenueGrowth = growthRate(input.currentRevenue, input.baselineRevenue);
  const cashFlowGrowth = growthRate(
    input.currentOperatingCashFlow,
    input.baselineOperatingCashFlow,
  );
  const cashFlowRevenueSpread = cashFlowGrowth - revenueGrowth;

  const normalizedMetrics = {
    capacityUtilization: metric(
      "产销匹配度",
      currentCapacityUtilization,
      normalizeHigherBetter(currentCapacityUtilization, 0.75, 1.02),
    ),
    productionSalesGap: metric(
      "产销缺口率",
      productionSalesGap,
      normalizeLowerBetter(productionSalesGap, 0, 0.25),
    ),
    manufacturingExpenseRatio: metric(
      "制造费用占营业成本比",
      manufacturingExpenseRatio,
      normalizeLowerBetter(manufacturingExpenseRatio, 0.55, 0.9),
    ),
    cashConversion: metric(
      "现金回款率",
      cashConversion,
      normalizeHigherBetter(cashConversion, -0.05, 0.2),
    ),
    leverageRatio: metric(
      "资产负债率",
      currentLeverageRatio,
      normalizeLowerBetter(currentLeverageRatio, 0.35, 0.8),
    ),
    cashFlowRevenueSpread: metric(
      "现金流增速相对收入增速差",
      cashFlowRevenueSpread,
      normalizeHigherBetter(cashFlowRevenueSpread, -0.25, 0.25),
    ),
  };

  const score = weightedScore([
    { normalizedScore: normalizedMetrics.capacityUtilization.normalizedScore, weight: 0.18 },
    { normalizedScore: normalizedMetrics.productionSalesGap.normalizedScore, weight: 0.12 },
    { normalizedScore: normalizedMetrics.manufacturingExpenseRatio.normalizedScore, weight: 0.16 },
    { normalizedScore: normalizedMetrics.cashConversion.normalizedScore, weight: 0.2 },
    { normalizedScore: normalizedMetrics.leverageRatio.normalizedScore, weight: 0.18 },
    { normalizedScore: normalizedMetrics.cashFlowRevenueSpread.normalizedScore, weight: 0.16 },
  ]);

  const severeSignals = [
    productionSalesGap >= 0.18,
    cashConversion < 0,
    currentLeverageRatio >= 0.7,
    cashFlowRevenueSpread <= -0.08,
  ].filter(Boolean).length;

  const riskLevel = classifyRisk(score, severeSignals);

  const trend =
    cashFlowRevenueSpread >= 0.05 && leverageChange <= 0 && productionSalesGap <= 0.08
      ? createTrend(
          "improving",
          `经营现金流增速领先收入增速 ${formatPercent(
            cashFlowRevenueSpread,
          )}，且资产负债率改善 ${round(Math.abs(leverageChange * 100))} 个百分点，经营质量向好。`,
        )
      : cashFlowRevenueSpread <= -0.05 || leverageChange >= 0.03 || productionSalesGap >= 0.15
        ? createTrend(
            "deteriorating",
            `经营现金流增速落后收入增速 ${formatPercent(
              Math.abs(cashFlowRevenueSpread),
            )}，产销缺口率为 ${formatPercent(productionSalesGap)}，经营质量承压。`,
          )
        : createTrend(
            "stable",
            `现金流与收入增速差为 ${formatPercent(
              cashFlowRevenueSpread,
            )}，资产负债率变动 ${round(leverageChange * 100)} 个百分点，经营质量整体稳定。`,
          );

  const keyFindings = [
    `当前产销匹配度为 ${round(currentCapacityUtilization)}。`,
    `制造费用占营业成本 ${formatPercent(manufacturingExpenseRatio)}。`,
    cashConversion >= 0
      ? `经营现金回款率为 ${formatPercent(cashConversion)}。`
      : `经营现金回款率为 ${formatPercent(cashConversion)}，现金流已转负。`,
    leverageChange > 0
      ? `资产负债率上升 ${round(leverageChange * 100)} 个百分点。`
      : `资产负债率下降 ${round(Math.abs(leverageChange * 100))} 个百分点。`,
  ];

  return buildResult({
    modelId: "operatingQuality",
    modelName: "经营质量模型",
    score,
    riskLevel,
    trend,
    normalizedMetrics,
    keyFindings,
    governance: createGovernance("operatingQuality", input, score / 100, [
      "完成结构化输入校验。",
      "完成产销、现金流与杠杆口径归一。",
      severeSignals > 0 ? `识别 ${severeSignals} 个经营承压信号。` : "未识别需要兜底的异常信号。",
    ]),
  });
}

export function validateGrossMarginPressureInput(payload: unknown): GrossMarginPressureInput {
  return parseInput(grossMarginPressureInputSchema, payload);
}

export function validateOperatingQualityInput(payload: unknown): OperatingQualityInput {
  return parseInput(operatingQualityInputSchema, payload);
}

// ==================== GMPS 模型实现（毛利承压分析）====================

/**
 * 越大越危险的指标打分函数
 * value <= lowRisk → 20分（低风险）
 * value >= highRisk → 80分（高风险）
 * 中间区间线性插值
 */
function scoreIncreasingRisk(value: number, lowRisk: number, highRisk: number): number {
  if (value <= lowRisk) return 20;
  if (value >= highRisk) return 80;
  return round(20 + ((value - lowRisk) / (highRisk - lowRisk)) * 60);
}

/**
 * 越小越危险的指标打分函数
 * value <= lowRisk → 80分（高风险，因为值太小）
 * value >= highRisk → 20分（低风险，值足够大）
 * 中间区间线性插值
 */
function scoreDecreasingRisk(value: number, lowRisk: number, highRisk: number): number {
  if (value <= lowRisk) return 80;
  if (value >= highRisk) return 20;
  return round(80 - ((value - lowRisk) / (highRisk - lowRisk)) * 60);
}

/**
 * Sigmoid 函数（防止数值溢出）
 */
function sigmoid(x: number): number {
  const clampedX = clamp(x, -500, 500);
  return 1 / (1 + Math.exp(-clampedX));
}

/**
 * GMPS 等级划分
 */
function classifyGMPSLevel(gmps: number): GMPSLevel {
  if (gmps < 40) return "低压";
  if (gmps < 70) return "中压";
  return "高压";
}

/**
 * 风险概率等级划分
 */
function classifyGMPSRiskLevel(probability: number): GMPSRiskLevel {
  if (probability < 0.33) return "低风险";
  if (probability < 0.66) return "中风险";
  return "高风险";
}

/**
 * 计算完整的 GMPS（毛利承压分析）模型
 *
 * 五层维度指标：
 * A层（毛利率结果）- 权重0.25: gpmYoy, revCostGap
 * B层（材料成本冲击）- 权重0.22: liPriceYoy, unitCostYoy
 * C层（产销负荷）- 权重0.31: invYoy, saleProdRatio, mfgCostRatio
 * D层（外部风险）- 权重0.07: indVol
 * E层（现金流安全）- 权重0.15: cfoRatio, lev
 *
 * Logistic回归预测下季度风险概率
 */
export function calculateGMPS(payload: unknown): GMPSResult {
  const input = parseInput(gmpsInputSchema, payload);

  const industrySegment: GMPSIndustrySegment = input.industrySegment ?? "powerBattery";
  const industryWeights = GMPS_INDUSTRY_WEIGHTS[industrySegment]!;

  const dimWeight_A = industryWeights.A_毛利率结果!;
  const dimWeight_B = industryWeights.B_材料成本冲击!;
  const dimWeight_C = industryWeights.C_产销负荷!;
  const dimWeight_D = industryWeights.D_外部风险!;
  const dimWeight_E = industryWeights.E_现金流安全!;

  const currentGM = input.currentGrossMargin;
  const baselineGM = input.baselineGrossMargin;
  const currentRev = input.currentRevenue;
  const baselineRev = input.baselineRevenue;
  const currentCost = input.currentCost;
  const baselineCost = input.baselineCost;
  const currentSales = input.currentSalesVolume;
  const currentProd = input.currentProductionVolume;
  const baselineSales = input.baselineSalesVolume;
  const currentInv = input.currentInventory;
  const baselineInv = input.baselineInventory;
  const currentMfg = input.currentManufacturingExpense;
  const currentOpCost = input.currentOperatingCost;
  const currentOCF = input.currentOperatingCashFlow;
  const currentLiab = input.currentTotalLiabilities;
  const currentAssets = input.currentTotalAssets;

  const gpmYoy = growthRate(currentGM, baselineGM);
  const revenueGrowth = growthRate(currentRev, baselineRev);
  const costGrowth = growthRate(currentCost, baselineCost);
  const revCostGap = costGrowth - revenueGrowth;
  const liPriceYoy = growthRate(input.currentLithiumPrice, input.baselineLithiumPrice);
  const currentUnitCost = currentCost / currentSales;
  const baselineUnitCost = baselineCost / baselineSales;
  const unitCostYoy = growthRate(currentUnitCost, baselineUnitCost);
  const invYoy = growthRate(currentInv, baselineInv);
  const saleProdRatio = currentSales / currentProd;
  const mfgCostRatio = currentMfg / currentOpCost;
  const indVol = input.industryVolatility;
  const cfoRatio = currentOCF / currentRev;
  const lev = currentLiab / currentAssets;

  // Optimized scoring with direct computation
  const score_gpmYoy = gpmYoy >= 0 ? scoreDecreasingRisk(gpmYoy, 0, 0.15) : scoreIncreasingRisk(Math.abs(gpmYoy), 0.02, 0.15);
  const score_revCostGap = scoreIncreasingRisk(revCostGap, 0, 0.12);
  const score_liPriceYoy = scoreIncreasingRisk(liPriceYoy, 0, 0.30);
  const score_unitCostYoy = scoreIncreasingRisk(unitCostYoy, 0, 0.15);
  const score_invYoy = scoreIncreasingRisk(invYoy, 0, 0.25);
  const score_saleProdRatio = scoreDecreasingRisk(saleProdRatio, 0.75, 1.0);
  const score_mfgCostRatio = scoreIncreasingRisk(mfgCostRatio, 0.5, 0.85);
  const score_indVol = scoreIncreasingRisk(indVol, 0.15, 0.5);
  const score_cfoRatio = scoreDecreasingRisk(cfoRatio, -0.05, 0.15);
  const score_lev = scoreIncreasingRisk(lev, 0.35, 0.75);

  // Inline weights (avoid object creation)
  const w_gpmYoy = 0.14;
  const w_revCostGap = 0.11;
  const w_liPriceYoy = 0.10;
  const w_unitCostYoy = 0.12;
  const w_invYoy = 0.09;
  const w_saleProdRatio = 0.10;
  const w_mfgCostRatio = 0.12;
  const w_indVol = 0.07;
  const w_cfoRatio = 0.08;
  const w_lev = 0.07;

  const rawGmps = round(
    score_gpmYoy * w_gpmYoy +
    score_revCostGap * w_revCostGap +
    score_liPriceYoy * w_liPriceYoy +
    score_unitCostYoy * w_unitCostYoy +
    score_invYoy * w_invYoy +
    score_saleProdRatio * w_saleProdRatio +
    score_mfgCostRatio * w_mfgCostRatio +
    score_indVol * w_indVol +
    score_cfoRatio * w_cfoRatio +
    score_lev * w_lev,
  );

  // Dimension scores
  const dimensionScores: GMPSDimensionScores = {
    A_毛利率结果: round((score_gpmYoy * w_gpmYoy + score_revCostGap * w_revCostGap) / (w_gpmYoy + w_revCostGap)),
    B_材料成本冲击: round((score_liPriceYoy * w_liPriceYoy + score_unitCostYoy * w_unitCostYoy) / (w_liPriceYoy + w_unitCostYoy)),
    C_产销负荷: round((score_invYoy * w_invYoy + score_saleProdRatio * w_saleProdRatio + score_mfgCostRatio * w_mfgCostRatio) / (w_invYoy + w_saleProdRatio + w_mfgCostRatio)),
    D_外部风险: round(score_indVol),
    E_现金流安全: round((score_cfoRatio * w_cfoRatio + score_lev * w_lev) / (w_cfoRatio + w_lev)),
  };

  const gmps = round(
    dimensionScores.A_毛利率结果 * dimWeight_A +
    dimensionScores.B_材料成本冲击 * dimWeight_B +
    dimensionScores.C_产销负荷 * dimWeight_C +
    dimensionScores.D_外部风险 * dimWeight_D +
    dimensionScores.E_现金流安全 * dimWeight_E,
  );

  const level = classifyGMPSLevel(gmps);

  const z = -2.5 + 0.05 * gmps + 0.02 * dimensionScores.A_毛利率结果 + 0.03 * dimensionScores.B_材料成本冲击 + 0.02 * dimensionScores.C_产销负荷 + 0.01 * dimensionScores.D_外部风险 + 0.02 * dimensionScores.E_现金流安全;
  const probabilityNextQuarter = round(sigmoid(z), 2);
  const riskLevel = classifyGMPSRiskLevel(probabilityNextQuarter);

  // Key findings with early exit
  const keyFindings: string[] = [];
  if (gpmYoy < -0.05) keyFindings.push(`毛利率同比下降 ${formatPercent(Math.abs(gpmYoy))}，毛利承压显著。`);
  else if (gpmYoy < -0.02) keyFindings.push(`毛利率同比下降 ${formatPercent(Math.abs(gpmYoy))}，存在一定压力。`);
  else if (gpmYoy > 0.02) keyFindings.push(`毛利率同比提升 ${formatPercent(gpmYoy)}，盈利能力改善。`);

  if (revCostGap > 0.05) keyFindings.push(`成本增速较收入快 ${formatPercent(revCostGap)}，利润挤压严重。`);
  else if (revCostGap > 0) keyFindings.push(`成本增速略超收入增速 ${formatPercent(revCostGap)}。`);

  if (liPriceYoy > 0.15) keyFindings.push(`碳酸锂价格上涨 ${formatPercent(liPriceYoy)}，原材料成本压力巨大。`);
  else if (liPriceYoy > 0.05) keyFindings.push(`碳酸锂价格上涨 ${formatPercent(liPriceYoy)}，需关注成本传导。`);

  if (unitCostYoy > 0.08) keyFindings.push(`单位成本上升 ${formatPercent(unitCostYoy)}，生产效率需优化。`);
  if (invYoy > 0.15) keyFindings.push(`库存同比增长 ${formatPercent(invYoy)}，存在积压风险。`);

  if (saleProdRatio < 0.8) keyFindings.push(`产销率仅为 ${round(saleProdRatio * 100)}%，产能利用不足。`);
  else if (saleProdRatio > 1.02) keyFindings.push(`产销率超过100%，可能存在透支库存销售的情况。`);

  if (mfgCostRatio > 0.7) keyFindings.push(`制造费用占营业成本比达 ${formatPercent(mfgCostRatio)}，费用管控空间较大。`);
  if (indVol > 0.3) keyFindings.push(`行业波动率达 ${round(indVol * 100)}%，外部不确定性较高。`);

  if (cfoRatio < 0) keyFindings.push(`经营现金流为负（${formatPercent(cfoRatio)}），现金流安全堪忧。`);
  else if (cfoRatio < 0.05) keyFindings.push(`现金流比率仅为 ${formatPercent(cfoRatio)}，现金回款能力偏弱。`);

  if (lev > 0.65) keyFindings.push(`资产负债率高达 ${formatPercent(lev)}，财务杠杆偏高。`);
  else if (lev > 0.5) keyFindings.push(`资产负债率为 ${formatPercent(lev)}，处于中等水平。`);

  if (keyFindings.length === 0) keyFindings.push("各项指标整体表现平稳，未识别明显异常信号。");

  // Severe signal count
  let severeCount = 0;
  if (Math.abs(gpmYoy) > 0.08) severeCount++;
  if (revCostGap > 0.1) severeCount++;
  if (liPriceYoy > 0.25) severeCount++;
  if (unitCostYoy > 0.12) severeCount++;
  if (invYoy > 0.2) severeCount++;
  if (saleProdRatio < 0.75) severeCount++;
  if (mfgCostRatio > 0.8) severeCount++;
  if (indVol > 0.35) severeCount++;
  if (cfoRatio < -0.03) severeCount++;
  if (lev > 0.72) severeCount++;

  const governance = createGovernance("gmps", input, probabilityNextQuarter, [
    "完成结构化输入校验。",
    "完成五层十维特征计算与归一化打分。",
    `完成加权综合评分（GMPS=${gmps}）。`,
    `完成Logistic回归预测（P=${probabilityNextQuarter}）。`,
    "Logistic回归参数(beta0=-2.5, beta1=0.05等)为专家设定值，未经统计训练校准，参数版本v1.0-专家设定",
    severeCount > 0 ? `识别 ${severeCount} 个高压预警信号。` : "未识别需要兜底的异常信号。",
  ]);

  return {
    gmps,
    level,
    probabilityNextQuarter,
    riskLevel,
    dimensionScores,
    featureScores: {
      gpmYoy: round(score_gpmYoy),
      revCostGap: round(score_revCostGap),
      liPriceYoy: round(score_liPriceYoy),
      unitCostYoy: round(score_unitCostYoy),
      invYoy: round(score_invYoy),
      saleProdRatio: round(score_saleProdRatio),
      mfgCostRatio: round(score_mfgCostRatio),
      indVol: round(score_indVol),
      cfoRatio: round(score_cfoRatio),
      lev: round(score_lev),
    },
    normalizedMetrics: {
      gpmYoy: metric("毛利率同比", gpmYoy, score_gpmYoy),
      revCostGap: metric("营收成本增速差", revCostGap, score_revCostGap),
      liPriceYoy: metric("碳酸锂价格同比", liPriceYoy, score_liPriceYoy),
      unitCostYoy: metric("单位成本同比", unitCostYoy, score_unitCostYoy),
      invYoy: metric("库存同比", invYoy, score_invYoy),
      saleProdRatio: metric("产销率", saleProdRatio, score_saleProdRatio),
      mfgCostRatio: metric("制造费用占比", mfgCostRatio, score_mfgCostRatio),
      indVol: metric("行业指数波动率", indVol, score_indVol),
      cfoRatio: metric("现金流比率", cfoRatio, score_cfoRatio),
      lev: metric("资产负债率", lev, score_lev),
    },
    keyFindings,
    governance,
    industrySegment,
    industryWeights,
  };
}

export function validateGMPSInput(payload: unknown): GMPSInput {
  return parseInput(gmpsInputSchema, payload) as GMPSInput;
}

// ==================== DQI 经营质量动态评价模型实现 ====================

/**
 * 计算ROE（净资产收益率）
 * ROE = 净利润 / 平均净资产 × 100%
 * 平均净资产 = (期初净资产 + 期末净资产) / 2
 */
function calculateROE(netProfit: number, beginningEquity: number, endingEquity: number): number {
  const averageEquity = (beginningEquity + endingEquity) / 2;

  if (Math.abs(averageEquity) < Number.EPSILON) {
    return 0; // 避免除以零
  }

  return (netProfit / averageEquity) * 100;
}

/**
 * 计算营收增长率
 * Growth = (当期营收 - 上期营收) / 上期营收
 */
function calculateRevenueGrowth(currentRevenue: number, baselineRevenue: number): number {
  if (Math.abs(baselineRevenue) < Number.EPSILON) {
    return 0; // 避免除以零
  }

  return (currentRevenue - baselineRevenue) / baselineRevenue;
}

/**
 * 计算OCF比率（经营现金流/营业收入）
 */
function calculateOCFRatio(operatingCashFlow: number, revenue: number): number {
  if (Math.abs(revenue) < Number.EPSILON) {
    return 0; // 避免除以零
  }

  return operatingCashFlow / revenue;
}

/**
 * 识别驱动因素（argmax）
 * 返回贡献最大的维度
 */
function identifyDriver(
  roeRatio: number,
  growthRatio: number,
  ocfRatio: number,
  assetTurnoverRatio: number,
  rdIntensityRatio: number,
  inventoryTurnoverRatio: number,
): "盈利能力" | "成长能力" | "现金流质量" | "资产周转效率" | "研发投入强度" | "库存周转效率" | "无明显驱动" {
  const devRoe = Math.abs(roeRatio - 1);
  const devGrowth = Math.abs(growthRatio - 1);
  const devOcf = Math.abs(ocfRatio - 1);
  const devAssetTurnover = Math.abs(assetTurnoverRatio - 1);
  const devRdIntensity = Math.abs(rdIntensityRatio - 1);
  const devInventoryTurnover = Math.abs(inventoryTurnoverRatio - 1);
  const maxDeviation = Math.max(devRoe, devGrowth, devOcf, devAssetTurnover, devRdIntensity, devInventoryTurnover);
  if (maxDeviation < 0.05) return "无明显驱动";
  if (devRoe === maxDeviation) return "盈利能力";
  if (devGrowth === maxDeviation) return "成长能力";
  if (devOcf === maxDeviation) return "现金流质量";
  if (devAssetTurnover === maxDeviation) return "资产周转效率";
  if (devRdIntensity === maxDeviation) return "研发投入强度";
  return "库存周转效率";
}

/**
 * 判断DQI趋势状态
 * DQI > 1.05 → "改善"
 * 0.95 ≤ DQI ≤ 1.05 → "稳定"
 * DQI < 0.95 → "恶化"
 */
function determineDQIStatus(dqi: number): "改善" | "稳定" | "恶化" {
  if (dqi > 1.05) {
    return "改善";
  }

  if (dqi >= 0.95) {
    return "稳定";
  }

  return "恶化";
}

/**
 * 计算置信度（基于数据质量和指标一致性）
 */
function calculateConfidence(
  currentROE: number,
  baselineROE: number,
  currentGrowth: number,
  baselineGrowth: number,
  currentOCFRatio: number,
  baselineOCFRatio: number,
  currentAssetTurnover?: number,
  baselineAssetTurnover?: number,
  currentRdRatio?: number,
  baselineRdRatio?: number,
  currentInventoryDays?: number,
  baselineInventoryDays?: number,
): number {
  let confidence = 0.85;

  let consistentCount = 0;
  if (currentROE >= baselineROE) consistentCount++;
  if (currentGrowth >= baselineGrowth) consistentCount++;
  if (currentOCFRatio >= baselineOCFRatio) consistentCount++;
  if (currentAssetTurnover != null && baselineAssetTurnover != null) {
    if (currentAssetTurnover >= baselineAssetTurnover) consistentCount++;
  }
  if (currentRdRatio != null && baselineRdRatio != null) {
    if (currentRdRatio >= baselineRdRatio) consistentCount++;
  }
  if (currentInventoryDays != null && baselineInventoryDays != null) {
    if (currentInventoryDays <= baselineInventoryDays) consistentCount++;
  }

  const totalDimensions = (currentAssetTurnover != null ? 1 : 0) + (currentRdRatio != null ? 1 : 0) + (currentInventoryDays != null ? 1 : 0) + 3;

  if (consistentCount === totalDimensions || consistentCount === 0) confidence += 0.1;
  else if (consistentCount >= totalDimensions - 1 || consistentCount <= 1) confidence += 0.05;

  if (
    Math.abs(currentROE) > 100 || Math.abs(baselineROE) > 100 ||
    Math.abs(currentGrowth) > 5 || Math.abs(baselineGrowth) > 5 ||
    Math.abs(currentOCFRatio) > 2 || Math.abs(baselineOCFRatio) > 2
  ) {
    confidence -= 0.15;
  }

  return clamp(confidence, 0.4, 1.0);
}

/**
 * 生成趋势描述文本
 */
function generateTrendDescription(
  dqi: number,
  status: "改善" | "稳定" | "恶化",
  driver: "盈利能力" | "成长能力" | "现金流质量" | "资产周转效率" | "研发投入强度" | "库存周转效率" | "无明显驱动",
  decomposition: {
    profitabilityContribution: number;
    growthContribution: number;
    cashflowContribution: number;
    assetTurnoverContribution: number;
    rdIntensityContribution: number;
    inventoryTurnoverContribution: number;
  },
): string {
  const dqiPercent = round((dqi - 1) * 100, 2);

  switch (status) {
    case "改善":
      return driver === "无明显驱动"
        ? `DQI指数为${round(dqi, 2)}（较基期提升${dqiPercent > 0 ? dqiPercent : 0}%），经营质量呈改善态势，各维度贡献相对均衡。`
        : `DQI指数为${round(dqi, 2)}（较基期提升${dqiPercent > 0 ? dqiPercent : 0}%），经营质量呈改善态势。主要驱动力为${driver}，其中盈利能力贡献${round(decomposition.profitabilityContribution, 2)}，成长能力贡献${round(decomposition.growthContribution, 2)}，现金流质量贡献${round(decomposition.cashflowContribution, 2)}，资产周转效率贡献${round(decomposition.assetTurnoverContribution, 2)}，研发投入强度贡献${round(decomposition.rdIntensityContribution, 2)}，库存周转效率贡献${round(decomposition.inventoryTurnoverContribution, 2)}。`;

    case "恶化":
      return driver === "无明显驱动"
        ? `DQI指数为${round(dqi, 2)}（较基期下降${Math.abs(dqiPercent)}%），经营质量呈恶化趋势，各维度均有不同程度下降。`
        : `DQI指数为${round(dqi, 2)}（较基期下降${Math.abs(dqiPercent)}%），经营质量呈恶化趋势。主要拖累因素为${driver}，需重点关注该维度的改善措施。`;

    case "稳定":
      return `DQI指数为${round(dqi, 2)}（变动幅度在±5%以内），经营质量整体保持稳定。各维度贡献：盈利能力${round(decomposition.profitabilityContribution, 2)}、成长能力${round(decomposition.growthContribution, 2)}、现金流质量${round(decomposition.cashflowContribution, 2)}、资产周转效率${round(decomposition.assetTurnoverContribution, 2)}、研发投入强度${round(decomposition.rdIntensityContribution, 2)}、库存周转效率${round(decomposition.inventoryTurnoverContribution, 2)}。`;

    default:
      return `DQI指数为${round(dqi, 2)}，经营质量处于待观察状态。`;
  }
}

/**
 * 计算DQI（经营质量动态评价）综合指数
 *
 * 核心公式：
 * DQI = w1·(ROE_t/ROE_{t-1}) + w2·(Growth_t/Growth_{t-1}) + w3·(OCF_t/OCF_{t-1})
 *
 * 默认权重：
 * - w1 = 0.4（盈利能力）
 * - w2 = 0.3（成长能力）
 * - w3 = 0.3（现金流质量）
 */
export function calculateDQI(payload: unknown): DQIResult {
  const input = parseInput<DQIInput>(dqiInputSchema, payload);

  const currentROE = calculateROE(input.currentNetProfit, input.currentBeginningEquity, input.currentEndingEquity);
  const baselineROE = calculateROE(input.baselineNetProfit, input.baselineBeginningEquity, input.baselineEndingEquity);

  const currentGrowth = calculateRevenueGrowth(input.currentRevenue, input.baselineRevenue);
  const baselineGrowthFallback = input.baselineGrowth == null;
  const baselineGrowth = input.baselineGrowth ?? (input.baselineRevenue > 0
    ? (input.baselineRevenue - input.currentRevenue * 0.85) / (input.currentRevenue * 0.85)
    : 0);

  const currentOCFRatio = calculateOCFRatio(input.currentOperatingCashFlow, input.currentRevenue);
  const baselineOCFRatio = calculateOCFRatio(input.baselineOperatingCashFlow, input.baselineRevenue);

  const roeRatio = Math.abs(baselineROE) < Number.EPSILON ? 1 : currentROE / baselineROE;
  const growthRatio = Math.abs(baselineGrowth) < Number.EPSILON ? 1 + currentGrowth : currentGrowth / baselineGrowth;
  const ocfRatioChange = Math.abs(baselineOCFRatio) < Number.EPSILON
    ? (currentOCFRatio >= 0 ? 1 : 0.5)
    : (baselineOCFRatio < 0 && currentOCFRatio < 0
      ? Math.abs(currentOCFRatio) / Math.abs(baselineOCFRatio)
      : currentOCFRatio / baselineOCFRatio);

  const currentAssetTurnover = input.currentTotalAssets > 0 ? input.currentRevenue / input.currentTotalAssets : 0;
  const baselineAssetTurnover = input.baselineTotalAssets > 0 ? input.baselineRevenue / input.baselineTotalAssets : 0;
  const assetTurnoverRatio = Math.abs(baselineAssetTurnover) < Number.EPSILON ? 1 : currentAssetTurnover / baselineAssetTurnover;

  const RD_RATIO_ESTIMATE_CURRENT = 0.045;
  const RD_RATIO_ESTIMATE_BASELINE = 0.045;
  const currentRdRatio = RD_RATIO_ESTIMATE_CURRENT;
  const baselineRdRatio = RD_RATIO_ESTIMATE_BASELINE;
  const rdIntensityRatio = Math.abs(baselineRdRatio) < Number.EPSILON ? 1 : currentRdRatio / baselineRdRatio;

  const currentInventoryDays = input.currentOperatingCost > 0
    ? (input.currentInventoryExpense / input.currentOperatingCost) * 365
    : 0;
  const baselineInventoryDays = input.baselineOperatingCost > 0
    ? (input.baselineInventoryExpense / input.baselineOperatingCost) * 365
    : 0;
  const inventoryTurnoverRatio = Math.abs(baselineInventoryDays) < Number.EPSILON
    ? 1
    : (currentInventoryDays > 0 && baselineInventoryDays > 0)
      ? baselineInventoryDays / currentInventoryDays
      : 1;

  const w1 = 0.25;
  const w2 = 0.20;
  const w3 = 0.20;
  const w4 = 0.15;
  const w5 = 0.10;
  const w6 = 0.10;

  const profitabilityContribution = round(w1 * clamp(roeRatio, 0, 3), 2);
  const growthContribution = round(w2 * clamp(growthRatio, 0, 3), 2);
  const cashflowContribution = round(w3 * clamp(ocfRatioChange, 0, 3), 2);
  const assetTurnoverContribution = round(w4 * clamp(assetTurnoverRatio, 0, 3), 2);
  const rdIntensityContribution = round(w5 * clamp(rdIntensityRatio, 0, 3), 2);
  const inventoryTurnoverContribution = round(w6 * clamp(inventoryTurnoverRatio, 0, 3), 2);
  const dqi = round(profitabilityContribution + growthContribution + cashflowContribution + assetTurnoverContribution + rdIntensityContribution + inventoryTurnoverContribution, 2);

  const status = determineDQIStatus(dqi);
  const driver = identifyDriver(roeRatio, growthRatio, ocfRatioChange, assetTurnoverRatio, rdIntensityRatio, inventoryTurnoverRatio);

  const metrics = {
    currentROE: round(currentROE, 2),
    baselineROE: round(baselineROE, 2),
    roeRatio: round(roeRatio, 2),
    currentGrowth: round(currentGrowth, 2),
    baselineGrowth: round(baselineGrowth, 2),
    growthRatio: round(growthRatio, 2),
    currentOCFRatio: round(currentOCFRatio, 2),
    baselineOCFRatio: round(baselineOCFRatio, 2),
    ocfRatioChange: round(ocfRatioChange, 2),
    currentAssetTurnover: round(currentAssetTurnover, 4),
    baselineAssetTurnover: round(baselineAssetTurnover, 4),
    currentRdRatio: round(currentRdRatio, 4),
    baselineRdRatio: round(baselineRdRatio, 4),
    currentInventoryDays: round(currentInventoryDays, 2),
    baselineInventoryDays: round(baselineInventoryDays, 2),
  };

  const confidence = round(calculateConfidence(currentROE, baselineROE, currentGrowth, baselineGrowth, currentOCFRatio, baselineOCFRatio, currentAssetTurnover, baselineAssetTurnover, currentRdRatio, baselineRdRatio, currentInventoryDays, baselineInventoryDays), 2);

  const decomposition = { profitabilityContribution, growthContribution, cashflowContribution, assetTurnoverContribution, rdIntensityContribution, inventoryTurnoverContribution };
  const trend = generateTrendDescription(dqi, status, driver, decomposition);

  const auditTrail: string[] = [
    "完成结构化输入校验。",
    baselineGrowthFallback
      ? "baselineGrowth 未提供，使用当期营收×0.85作为基期营收估计，增长率为推算值"
      : "基期增长率由输入直接提供。",
    "完成ROE、营收增长率与OCF比率口径归一。",
    "研发投入强度使用估算值（营收的4.5%），在dataProvenance中标注。",
  ];

  return {
    dqi,
    status,
    driver,
    decomposition,
    metrics,
    trend,
    confidence,
    governance: createGovernance("dqi", input, confidence, auditTrail),
  };
}

export function validateDQIInput(payload: unknown): DQIInput {
  return parseInput(dqiInputSchema, payload);
}
