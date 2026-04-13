import { z } from "zod";

const finiteNumber = z.coerce.number().finite("请输入有效数值。");
const positiveNumber = z.coerce.number().positive("请输入大于 0 的数值。");
const monetaryAmount = z.coerce.number().min(0.01, "金额不能小于0.01").max(1e12, "金额超出合理范围，请确认单位为万元");
const salesVolumeAmount = z.coerce.number().min(0.01, "销量不能小于0.01").max(1e10, "销量超出合理范围，请确认单位为万件");
const percentageNumber = z.coerce
  .number()
  .min(-100, "百分比不能低于 -100。")
  .max(100, "百分比不能高于 100。")
  .finite("请输入有效百分比。");

export const riskLevelSchema = z.enum(["low", "medium", "high"]);
export const trendDirectionSchema = z.enum(["improving", "stable", "deteriorating"]);

export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type TrendDirection = z.infer<typeof trendDirectionSchema>;

export type NormalizedMetric = {
  label: string;
  rawValue: number;
  normalizedScore: number;
};

export type TrendAssessment = {
  direction: TrendDirection;
  summary: string;
};

export type ModelGovernance = {
  modelVersion: string;
  parameterVersion: string;
  reproducibilityKey: string;
  confidenceScore: number;
  inputQuality: "high" | "medium" | "low";
  normalizedAt: string;
  auditTrail: string[];
};

export type DiagnosticResult<TModelId extends string> = {
  modelId: TModelId;
  modelName: string;
  score: number;
  riskLevel: RiskLevel;
  trend: TrendAssessment;
  normalizedMetrics: Record<string, NormalizedMetric>;
  keyFindings: string[];
  governance: ModelGovernance;
};

export const grossMarginPressureInputSchema = z.object({
  currentGrossMargin: percentageNumber,
  baselineGrossMargin: percentageNumber,
  currentRevenue: monetaryAmount,
  baselineRevenue: monetaryAmount,
  currentCost: monetaryAmount,
  baselineCost: monetaryAmount,
  currentSalesVolume: salesVolumeAmount,
  baselineSalesVolume: salesVolumeAmount,
  currentInventoryExpense: monetaryAmount,
  baselineInventoryExpense: monetaryAmount,
});

export type GrossMarginPressureInput = z.infer<typeof grossMarginPressureInputSchema>;
export type GrossMarginPressureResult = DiagnosticResult<"grossMarginPressure">;

export const operatingQualityInputSchema = z
  .object({
    currentSalesVolume: salesVolumeAmount,
    baselineSalesVolume: salesVolumeAmount,
    currentProductionVolume: salesVolumeAmount,
    baselineProductionVolume: salesVolumeAmount,
    currentManufacturingExpense: monetaryAmount,
    baselineManufacturingExpense: monetaryAmount,
    currentOperatingCost: monetaryAmount,
    baselineOperatingCost: monetaryAmount,
    currentOperatingCashFlow: finiteNumber,
    baselineOperatingCashFlow: finiteNumber,
    currentRevenue: monetaryAmount,
    baselineRevenue: monetaryAmount,
    currentTotalLiabilities: monetaryAmount,
    baselineTotalLiabilities: monetaryAmount,
    currentTotalAssets: monetaryAmount,
    baselineTotalAssets: monetaryAmount,
  })
  .superRefine((input, context) => {
    if (input.currentManufacturingExpense > input.currentOperatingCost) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentManufacturingExpense"],
        message: "当前制造费用不应高于当前营业成本。",
      });
    }

    if (input.baselineManufacturingExpense > input.baselineOperatingCost) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baselineManufacturingExpense"],
        message: "基期制造费用不应高于基期营业成本。",
      });
    }

    if (input.currentTotalLiabilities > input.currentTotalAssets) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentTotalLiabilities"],
        message: "当前总负债不应高于当前总资产。",
      });
    }

    if (input.baselineTotalLiabilities > input.baselineTotalAssets) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baselineTotalLiabilities"],
        message: "基期总负债不应高于基期总资产。",
      });
    }
  });

export type OperatingQualityInput = z.infer<typeof operatingQualityInputSchema>;
export type OperatingQualityResult = DiagnosticResult<"operatingQuality">;

// ==================== GMPS 模型（毛利承压分析）====================

export const gmpsInputSchema = z
  .object({
    // 企业财务数据（当期）
    currentGrossMargin: percentageNumber,
    currentRevenue: monetaryAmount,
    currentCost: monetaryAmount,
    currentSalesVolume: salesVolumeAmount,
    currentProductionVolume: salesVolumeAmount,
    currentInventory: monetaryAmount,
    currentManufacturingExpense: monetaryAmount,
    currentOperatingCost: monetaryAmount,
    currentOperatingCashFlow: finiteNumber,
    currentTotalLiabilities: monetaryAmount,
    currentTotalAssets: monetaryAmount,

    // 企业财务数据（基期）
    baselineGrossMargin: percentageNumber,
    baselineRevenue: monetaryAmount,
    baselineCost: monetaryAmount,
    baselineSalesVolume: salesVolumeAmount,
    baselineProductionVolume: salesVolumeAmount,
    baselineInventory: monetaryAmount,
    baselineManufacturingExpense: monetaryAmount,
    baselineOperatingCost: monetaryAmount,
    baselineOperatingCashFlow: finiteNumber,
    baselineTotalLiabilities: monetaryAmount,
    baselineTotalAssets: monetaryAmount,

    // 行业外部数据
    currentLithiumPrice: positiveNumber,
    baselineLithiumPrice: positiveNumber,
    industryVolatility: z.coerce.number().min(0).max(1),
  })
  .superRefine((input, context) => {
    if (input.currentManufacturingExpense > input.currentOperatingCost) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentManufacturingExpense"],
        message: "当前制造费用不应高于当前营业成本。",
      });
    }

    if (input.baselineManufacturingExpense > input.baselineOperatingCost) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baselineManufacturingExpense"],
        message: "基期制造费用不应高于基期营业成本。",
      });
    }

    if (input.currentTotalLiabilities > input.currentTotalAssets) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentTotalLiabilities"],
        message: "当前总负债不应高于当前总资产。",
      });
    }

    if (input.baselineTotalLiabilities > input.baselineTotalAssets) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baselineTotalLiabilities"],
        message: "基期总负债不应高于基期总资产。",
      });
    }
  });

export type GMPSInput = z.infer<typeof gmpsInputSchema>;

export type GMPSDimensionScores = {
  A_毛利率结果: number;
  B_材料成本冲击: number;
  C_产销负荷: number;
  D_外部风险: number;
  E_现金流安全: number;
};

export type GMPSLevel = "低压" | "中压" | "高压";
export type GMPSRiskLevel = "低风险" | "中风险" | "高风险";

export type GMPSResult = {
  gmps: number;
  level: GMPSLevel;
  probabilityNextQuarter: number;
  riskLevel: GMPSRiskLevel;
  dimensionScores: GMPSDimensionScores;
  featureScores: Record<string, number>;
  normalizedMetrics: Record<string, NormalizedMetric>;
  keyFindings: string[];
  governance: ModelGovernance;
};

// ==================== DQI 经营质量动态评价模型 ====================

export const dqiInputSchema = z
  .object({
    // 当期数据
    currentNetProfit: finiteNumber,
    currentBeginningEquity: positiveNumber,
    currentEndingEquity: positiveNumber,
    currentRevenue: monetaryAmount,
    currentOperatingCashFlow: finiteNumber,

    // 基期数据
    baselineNetProfit: finiteNumber,
    baselineBeginningEquity: positiveNumber,
    baselineEndingEquity: positiveNumber,
    baselineRevenue: monetaryAmount,
    baselineOperatingCashFlow: finiteNumber,
    baselineGrowth: z.coerce.number().optional(),
  })
  .superRefine((input, context) => {
    // 验证当期净资产逻辑
    if (input.currentBeginningEquity > input.currentEndingEquity && input.currentNetProfit > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentBeginningEquity"],
        message: "当期净利润为正时，期末净资产不应低于期初净资产。",
      });
    }

    // 验证基期净资产逻辑
    if (input.baselineBeginningEquity > input.baselineEndingEquity && input.baselineNetProfit > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baselineBeginningEquity"],
        message: "基期净利润为正时，期末净资产不应低于期初净资产。",
      });
    }

    // 验证营收与现金流合理性（经营现金流不应超过营收的2倍）
    if (Math.abs(input.currentOperatingCashFlow) > input.currentRevenue * 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentOperatingCashFlow"],
        message: "当期经营现金流绝对值不应超过营业收入的2倍。",
      });
    }

    if (Math.abs(input.baselineOperatingCashFlow) > input.baselineRevenue * 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baselineOperatingCashFlow"],
        message: "基期经营现金流绝对值不应超过营业收入的2倍。",
      });
    }
  });

export type DQIInput = z.infer<typeof dqiInputSchema>;

export type DQIDriver = "盈利能力" | "成长能力" | "现金流质量" | "无明显驱动";
export type DQIStatus = "改善" | "稳定" | "恶化";

export type DQIMetrics = {
  currentROE: number;
  baselineROE: number;
  roeRatio: number;
  currentGrowth: number;
  baselineGrowth: number;
  growthRatio: number;
  currentOCFRatio: number;
  baselineOCFRatio: number;
  ocfRatioChange: number;
};

export type DQIDecomposition = {
  profitabilityContribution: number; // w1 * roeRatio
  growthContribution: number; // w2 * growthRatio
  cashflowContribution: number; // w3 * ocfRatio
};

export type DQIResult = {
  dqi: number;
  status: DQIStatus;
  driver: DQIDriver;
  decomposition: DQIDecomposition;
  metrics: DQIMetrics;
  trend: string;
  confidence: number;
};
