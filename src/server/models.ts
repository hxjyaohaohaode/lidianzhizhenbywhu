import { createHash } from "node:crypto";

import { ZodError, type ZodType } from "zod";

import { AppError } from "./errors.js";
import {
  dqiInputSchema,
  gmpsInputSchema,
  grossMarginPressureInputSchema,
  operatingQualityInputSchema,
  type GMPSDimensionScores,
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

function weightedScore(items: Array<{ normalizedScore: number; weight: number }>) {
  const validItems = items.filter((item) => Number.isFinite(item.normalizedScore));
  if (validItems.length === 0) return 0;
  const totalWeight = validItems.reduce((sum, item) => sum + item.weight, 0);
  const totalScore = validItems.reduce((sum, item) => sum + item.normalizedScore * item.weight, 0);
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

function createGovernance<TModelId extends string>(
  modelId: TModelId,
  payload: unknown,
  confidenceScore: number,
  auditTrail: string[],
) {
  return {
    modelVersion: `${modelId}-2026.04`,
    parameterVersion: `${modelId}-baseline-v2`,
    reproducibilityKey: createHash("sha1")
      .update(`${modelId}:${JSON.stringify(payload)}`)
      .digest("hex")
      .slice(0, 16),
    confidenceScore: round(confidenceScore),
    inputQuality: getInputQuality(auditTrail),
    normalizedAt: new Date().toISOString(),
    auditTrail,
  };
}

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
  // 1. 输入验证
  const input = parseInput(gmpsInputSchema, payload);

  // ========== 2. 计算五层10个特征变量 ==========

  // A层：毛利率结果
  const gpmYoy = growthRate(input.currentGrossMargin, input.baselineGrossMargin); // 毛利率同比
  const revenueGrowth = growthRate(input.currentRevenue, input.baselineRevenue);
  const costGrowth = growthRate(input.currentCost, input.baselineCost);
  const revCostGap = costGrowth - revenueGrowth; // 营收成本增速差

  // B层：材料成本冲击
  const liPriceYoy = growthRate(input.currentLithiumPrice, input.baselineLithiumPrice); // 碳酸锂价格同比
  const currentUnitCost = input.currentCost / input.currentSalesVolume;
  const baselineUnitCost = input.baselineCost / input.baselineSalesVolume;
  const unitCostYoy = growthRate(currentUnitCost, baselineUnitCost); // 单位成本同比

  // C层：产销负荷
  const invYoy = growthRate(input.currentInventory, input.baselineInventory); // 库存同比
  const saleProdRatio = input.currentSalesVolume / input.currentProductionVolume; // 产销率
  const mfgCostRatio = input.currentManufacturingExpense / input.currentOperatingCost; // 制造费用占比

  // D层：外部风险
  const indVol = input.industryVolatility; // 行业指数波动率

  // E层：现金流安全
  const cfoRatio = input.currentOperatingCashFlow / input.currentRevenue; // 现金流比率
  const lev = input.currentTotalLiabilities / input.currentTotalAssets; // 资产负债率

  // ========== 3. 标准化打分（0-100分）==========

  // 越大越危险的指标（使用 scoreIncreasingRisk）
  // gpmYoy: 负值表示下降，越负越危险 → 取绝对值后打分
  const score_gpmYoy = gpmYoy >= 0
  ? scoreDecreasingRisk(gpmYoy, 0, 0.15)
  : scoreIncreasingRisk(Math.abs(gpmYoy), 0.02, 0.15);
  // revCostGap: 正值表示成本增速快于收入
  const score_revCostGap = scoreIncreasingRisk(revCostGap, 0, 0.12);
  // liPriceYoy: 价格上涨危险
  const score_liPriceYoy = scoreIncreasingRisk(liPriceYoy, 0, 0.30);
  // unitCostYoy: 单位成本上升危险
  const score_unitCostYoy = scoreIncreasingRisk(unitCostYoy, 0, 0.15);
  // invYoy: 库存积压危险
  const score_invYoy = scoreIncreasingRisk(invYoy, 0, 0.25);

  // 越小越危险的指标（使用 scoreDecreasingRisk）
  // saleProdRatio: 产销率低危险
  const score_saleProdRatio = scoreDecreasingRisk(saleProdRatio, 0.75, 1.0);
  // mfgCostRatio: 制造费用占比高危险
  const score_mfgCostRatio = scoreIncreasingRisk(mfgCostRatio, 0.5, 0.85);
  // indVol: 高波动危险
  const score_indVol = scoreIncreasingRisk(indVol, 0.15, 0.5);
  // cfoRatio: 现金流比率低危险
  const score_cfoRatio = scoreDecreasingRisk(cfoRatio, -0.05, 0.15);
  // lev: 高杠杆危险（越大越危险）
  const score_lev = scoreIncreasingRisk(lev, 0.35, 0.75);

  // 特征得分汇总
  const featureScores: Record<string, number> = {
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
  };

  // ========== 4. 加权综合得分计算 ==========

  // 单个特征权重配置
  const weights: Record<string, number> = {
    gpmYoy: 0.14,
    revCostGap: 0.11,
    liPriceYoy: 0.10,
    unitCostYoy: 0.12,
    invYoy: 0.09,
    saleProdRatio: 0.10,
    mfgCostRatio: 0.12,
    indVol: 0.07,
    cfoRatio: 0.08,
    lev: 0.07,
  };

  // 计算 GMPS 综合得分
  let gmps = 0;
  for (const [key, score] of Object.entries(featureScores)) {
    gmps += score * weights[key]!;
  }
  gmps = round(gmps);

  // ========== 5. 维度得分汇总 ==========

  // 维度权重（用于计算维度得分）
  const dimensionWeights = {
    A: { features: ["gpmYoy", "revCostGap"], totalWeight: 0.25 },
    B: { features: ["liPriceYoy", "unitCostYoy"], totalWeight: 0.22 },
    C: { features: ["invYoy", "saleProdRatio", "mfgCostRatio"], totalWeight: 0.31 },
    D: { features: ["indVol"], totalWeight: 0.07 },
    E: { features: ["cfoRatio", "lev"], totalWeight: 0.15 },
  };

  // 计算各维度得分（维度内特征加权平均）
  const dimensionScores: GMPSDimensionScores = {
    A_毛利率结果: round(
      (featureScores.gpmYoy! * weights.gpmYoy! + featureScores.revCostGap! * weights.revCostGap!) /
        (weights.gpmYoy! + weights.revCostGap!),
    ),
    B_材料成本冲击: round(
      (featureScores.liPriceYoy! * weights.liPriceYoy! + featureScores.unitCostYoy! * weights.unitCostYoy!) /
        (weights.liPriceYoy! + weights.unitCostYoy!),
    ),
    C_产销负荷: round(
      (featureScores.invYoy! * weights.invYoy! +
        featureScores.saleProdRatio! * weights.saleProdRatio! +
        featureScores.mfgCostRatio! * weights.mfgCostRatio!) /
        (weights.invYoy! + weights.saleProdRatio! + weights.mfgCostRatio!),
    ),
    D_外部风险: round(featureScores.indVol!),
    E_现金流安全: round(
      (featureScores.cfoRatio! * weights.cfoRatio! + featureScores.lev! * weights.lev!) /
        (weights.cfoRatio! + weights.lev!),
    ),
  };

  // ========== 6. 等级划分 ==========
  const level = classifyGMPSLevel(gmps);

  // ========== 7. Logistic回归预测 ==========

  // 默认 beta 参数
  const beta = {
    beta0: -2.5,
    beta1: 0.05, // GMPS 系数
    beta2: 0.02, // A层系数
    beta3: 0.03, // B层系数
    beta4: 0.02, // C层系数
    beta5: 0.01, // D层系数
    beta6: 0.02, // E层系数
  };

  // 计算 logistic 回归的 z 值
  const z =
    beta.beta0 +
    beta.beta1 * gmps +
    beta.beta2 * dimensionScores.A_毛利率结果 +
    beta.beta3 * dimensionScores.B_材料成本冲击 +
    beta.beta4 * dimensionScores.C_产销负荷 +
    beta.beta5 * dimensionScores.D_外部风险 +
    beta.beta6 * dimensionScores.E_现金流安全;

  // 计算风险概率
  const probabilityNextQuarter = round(sigmoid(z), 2);
  const riskLevel = classifyGMPSRiskLevel(probabilityNextQuarter);

  // ========== 8. 构建标准化指标（用于展示）==========
  const normalizedMetrics: Record<string, NormalizedMetric> = {
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
  };

  // ========== 9. 生成关键发现 ==========
  const keyFindings: string[] = [];

  // A层发现
  if (gpmYoy < -0.05) {
    keyFindings.push(`毛利率同比下降 ${formatPercent(Math.abs(gpmYoy))}，毛利承压显著。`);
  } else if (gpmYoy < -0.02) {
    keyFindings.push(`毛利率同比下降 ${formatPercent(Math.abs(gpmYoy))}，存在一定压力。`);
  } else if (gpmYoy > 0.02) {
    keyFindings.push(`毛利率同比提升 ${formatPercent(gpmYoy)}，盈利能力改善。`);
  }

  if (revCostGap > 0.05) {
    keyFindings.push(`成本增速较收入快 ${formatPercent(revCostGap)}，利润挤压严重。`);
  } else if (revCostGap > 0) {
    keyFindings.push(`成本增速略超收入增速 ${formatPercent(revCostGap)}。`);
  }

  // B层发现
  if (liPriceYoy > 0.15) {
    keyFindings.push(`碳酸锂价格上涨 ${formatPercent(liPriceYoy)}，原材料成本压力巨大。`);
  } else if (liPriceYoy > 0.05) {
    keyFindings.push(`碳酸锂价格上涨 ${formatPercent(liPriceYoy)}，需关注成本传导。`);
  }

  if (unitCostYoy > 0.08) {
    keyFindings.push(`单位成本上升 ${formatPercent(unitCostYoy)}，生产效率需优化。`);
  }

  // C层发现
  if (invYoy > 0.15) {
    keyFindings.push(`库存同比增长 ${formatPercent(invYoy)}，存在积压风险。`);
  }

  if (saleProdRatio < 0.8) {
    keyFindings.push(`产销率仅为 ${round(saleProdRatio * 100)}%，产能利用不足。`);
  } else if (saleProdRatio > 1.02) {
    keyFindings.push(`产销率超过100%，可能存在透支库存销售的情况。`);
  }

  if (mfgCostRatio > 0.7) {
    keyFindings.push(`制造费用占营业成本比达 ${formatPercent(mfgCostRatio)}，费用管控空间较大。`);
  }

  // D层发现
  if (indVol > 0.3) {
    keyFindings.push(`行业波动率达 ${round(indVol * 100)}%，外部不确定性较高。`);
  }

  // E层发现
  if (cfoRatio < 0) {
    keyFindings.push(`经营现金流为负（${formatPercent(cfoRatio)}），现金流安全堪忧。`);
  } else if (cfoRatio < 0.05) {
    keyFindings.push(`现金流比率仅为 ${formatPercent(cfoRatio)}，现金回款能力偏弱。`);
  }

  if (lev > 0.65) {
    keyFindings.push(`资产负债率高达 ${formatPercent(lev)}，财务杠杆偏高。`);
  } else if (lev > 0.5) {
    keyFindings.push(`资产负债率为 ${formatPercent(lev)}，处于中等水平。`);
  }

  // 如果没有特别发现，补充总体评价
  if (keyFindings.length === 0) {
    keyFindings.push("各项指标整体表现平稳，未识别明显异常信号。");
  }

  // ========== 10. 构建治理信息 ==========
  const severeSignalCount = [
    Math.abs(gpmYoy) > 0.08,
    revCostGap > 0.1,
    liPriceYoy > 0.25,
    unitCostYoy > 0.12,
    invYoy > 0.2,
    saleProdRatio < 0.75,
    mfgCostRatio > 0.8,
    indVol > 0.35,
    cfoRatio < -0.03,
    lev > 0.72,
  ].filter(Boolean).length;

  const auditTrail: string[] = [
    "完成结构化输入校验。",
    "完成五层十维特征计算与归一化打分。",
    `完成加权综合评分（GMPS=${gmps}）。`,
    `完成Logistic回归预测（P=${probabilityNextQuarter}）。`,
    severeSignalCount > 0 ? `识别 ${severeSignalCount} 个高压预警信号。` : "未识别需要兜底的异常信号。",
  ];

  const governance = createGovernance("gmps", input, probabilityNextQuarter, auditTrail);

  // ========== 11. 返回完整结果 ==========
  return {
    gmps,
    level,
    probabilityNextQuarter,
    riskLevel,
    dimensionScores,
    featureScores,
    normalizedMetrics,
    keyFindings,
    governance,
  };
}

export function validateGMPSInput(payload: unknown): GMPSInput {
  return parseInput(gmpsInputSchema, payload);
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
): "盈利能力" | "成长能力" | "现金流质量" | "无明显驱动" {
  const contributions = [
    { name: "盈利能力" as const, value: Math.abs(roeRatio - 1) },
    { name: "成长能力" as const, value: Math.abs(growthRatio - 1) },
    { name: "现金流质量" as const, value: Math.abs(ocfRatio - 1) },
  ];
  const maxDeviation = Math.max(...contributions.map(c => c.value));
  if (maxDeviation < 0.05) {
    return "无明显驱动";
  }
  return contributions.reduce((max, current) => (current.value > max.value ? current : max)).name;
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
  metrics: {
    currentROE: number;
    baselineROE: number;
    currentGrowth: number;
    baselineGrowth: number;
    currentOCFRatio: number;
    baselineOCFRatio: number;
  },
): number {
  // 基础置信度
  let confidence = 0.85;

  // 如果各维度变化方向一致，提高置信度
  const roeImproving = metrics.currentROE >= metrics.baselineROE;
  const growthImproving = metrics.currentGrowth >= metrics.baselineGrowth;
  const ocfImproving = metrics.currentOCFRatio >= metrics.baselineOCFRatio;

  const consistentCount = [roeImproving, growthImproving, ocfImproving].filter(Boolean).length;

  if (consistentCount === 3 || consistentCount === 0) {
    confidence += 0.1; // 完全一致或完全相反，高置信度
  } else if (consistentCount === 2 || consistentCount === 1) {
    confidence += 0.05; // 部分一致，中等置信度
  }

  // 检查是否有极端值（可能影响可靠性）
  const hasExtremeValues =
    Math.abs(metrics.currentROE) > 100 ||
    Math.abs(metrics.baselineROE) > 100 ||
    Math.abs(metrics.currentGrowth) > 5 ||
    Math.abs(metrics.baselineGrowth) > 5 ||
    Math.abs(metrics.currentOCFRatio) > 2 ||
    Math.abs(metrics.baselineOCFRatio) > 2;

  if (hasExtremeValues) {
    confidence -= 0.15; // 极端值降低置信度
  }

  return clamp(confidence, 0.4, 1.0);
}

/**
 * 生成趋势描述文本
 */
function generateTrendDescription(
  dqi: number,
  status: "改善" | "稳定" | "恶化",
  driver: "盈利能力" | "成长能力" | "现金流质量" | "无明显驱动",
  decomposition: {
    profitabilityContribution: number;
    growthContribution: number;
    cashflowContribution: number;
  },
): string {
  const dqiPercent = round((dqi - 1) * 100, 2);

  switch (status) {
    case "改善":
      return driver === "无明显驱动"
        ? `DQI指数为${round(dqi, 2)}（较基期提升${dqiPercent > 0 ? dqiPercent : 0}%），经营质量呈改善态势，各维度贡献相对均衡。`
        : `DQI指数为${round(dqi, 2)}（较基期提升${dqiPercent > 0 ? dqiPercent : 0}%），经营质量呈改善态势。主要驱动力为${driver}，其中盈利能力贡献${round(decomposition.profitabilityContribution, 2)}，成长能力贡献${round(decomposition.growthContribution, 2)}，现金流质量贡献${round(decomposition.cashflowContribution, 2)}。`;

    case "恶化":
      return driver === "无明显驱动"
        ? `DQI指数为${round(dqi, 2)}（较基期下降${Math.abs(dqiPercent)}%），经营质量呈恶化趋势，各维度均有不同程度下降。`
        : `DQI指数为${round(dqi, 2)}（较基期下降${Math.abs(dqiPercent)}%），经营质量呈恶化趋势。主要拖累因素为${driver}，需重点关注该维度的改善措施。`;

    case "稳定":
      return `DQI指数为${round(dqi, 2)}（变动幅度在±5%以内），经营质量整体保持稳定。各维度贡献相对均衡：盈利能力${round(decomposition.profitabilityContribution, 2)}、成长能力${round(decomposition.growthContribution, 2)}、现金流质量${round(decomposition.cashflowContribution, 2)}。`;

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
  // 1. 输入验证
  const input = parseInput<DQIInput>(dqiInputSchema, payload);

  // 2. 计算基础指标
  // ROE计算
  const currentROE = calculateROE(
    input.currentNetProfit,
    input.currentBeginningEquity,
    input.currentEndingEquity,
  );
  const baselineROE = calculateROE(
    input.baselineNetProfit,
    input.baselineBeginningEquity,
    input.baselineEndingEquity,
  );

  // 营收增长率计算
  const currentGrowth = calculateRevenueGrowth(input.currentRevenue, input.baselineRevenue);
  const baselineGrowth = input.baselineGrowth ?? (input.baselineRevenue > 0
    ? (input.baselineRevenue - input.currentRevenue * 0.85) / (input.currentRevenue * 0.85)
    : 0);

  // OCF比率计算
  const currentOCFRatio = calculateOCFRatio(input.currentOperatingCashFlow, input.currentRevenue);
  const baselineOCFRatio = calculateOCFRatio(
    input.baselineOperatingCashFlow,
    input.baselineRevenue,
  );

  // 3. 计算比率变化（当期/基期）
  // 处理除以零的边界情况
  const roeRatio = Math.abs(baselineROE) < Number.EPSILON ? 1 : currentROE / baselineROE;
  const growthRatio =
    Math.abs(baselineGrowth) < Number.EPSILON
      ? 1 + currentGrowth
      : currentGrowth / baselineGrowth;
  // 对于增长率，如果基期为0，则直接用当前增长率作为比率（1+growth）

  // OCF比率的变化（注意：OCF可能是负数，需要特殊处理）
  const ocfRatioChange =
    Math.abs(baselineOCFRatio) < Number.EPSILON
      ? currentOCFRatio >= 0
        ? 1
        : 0.5
      : baselineOCFRatio < 0 && currentOCFRatio < 0
        ? Math.abs(baselineOCFRatio) / Math.abs(currentOCFRatio)
        : currentOCFRatio / baselineOCFRatio;

  // 4. DQI综合指数加权求和（保留4位小数）
  const WEIGHT_PROFITABILITY = 0.4; // w1 盈利能力权重
  const WEIGHT_GROWTH = 0.3; // w2 成长能力权重
  const WEIGHT_CASHFLOW = 0.3; // w3 现金流质量权重

  const profitabilityContribution = round(WEIGHT_PROFITABILITY * clamp(roeRatio, 0, 3), 2);
  const growthContribution = round(WEIGHT_GROWTH * clamp(growthRatio, 0, 3), 2);
  const cashflowContribution = round(WEIGHT_CASHFLOW * clamp(ocfRatioChange, 0, 3), 2);

  const dqi = round(profitabilityContribution + growthContribution + cashflowContribution, 2);

  // 5. 趋势判断
  const status = determineDQIStatus(dqi);

  // 6. 驱动因素识别（argmax）
  const driver = identifyDriver(roeRatio, growthRatio, ocfRatioChange);

  // 7. 构建完整的metrics对象
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
  };

  const confidence = round(calculateConfidence(metrics), 2);

  // 9. 生成趋势描述
  const trend = generateTrendDescription(dqi, status, driver, {
    profitabilityContribution,
    growthContribution,
    cashflowContribution,
  });

  // 10. 返回结构化结果
  return {
    dqi,
    status,
    driver,
    decomposition: {
      profitabilityContribution,
      growthContribution,
      cashflowContribution,
    },
    metrics,
    trend,
    confidence,
  };
}

export function validateDQIInput(payload: unknown): DQIInput {
  return parseInput(dqiInputSchema, payload);
}
