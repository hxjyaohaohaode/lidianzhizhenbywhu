import { z } from "zod";

const finiteNumber = z.coerce.number().finite("请输入有效数值。");
const positiveNumber = z.coerce.number().positive("请输入大于 0 的数值。");
const monetaryAmount = z.coerce.number().min(0.01, "金额不能小于0.01").max(1e12, "金额超出合理范围，请确认单位为万元");
const salesVolumeAmount = z.coerce.number().min(0.01, "销量不能小于0.01").max(1e10, "销量超出合理范围，请确认单位为万件");
const percentageNumber = z.coerce
  .number()
  .min(-100, "百分比不能低于 -100。")
  .max(200, "百分比不能高于 200。")
  .finite("请输入有效百分比。");
const leverageRatio = z.coerce
  .number()
  .min(0, "杠杆比率不能为负。")
  .max(2, "杠杆比率超出合理范围（0-2）。")
  .finite("请输入有效杠杆比率。");
const netProfitAmount = z.coerce
  .number()
  .min(-1e11, "净利润绝对值超出合理范围，请确认单位为万元。")
  .max(1e12, "净利润超出合理范围，请确认单位为万元。")
  .finite("请输入有效净利润值。");
const equityAmount = z.coerce
  .number()
  .min(0.01, "净资产不能小于0.01。")
  .max(1e12, "净资产超出合理范围，请确认单位为万元。")
  .finite("请输入有效净资产值。");

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

    // 行业细分
    industrySegment: z.enum(["powerBattery", "energyStorage", "consumerBattery"]).default("powerBattery"),
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

export type GMPSInput = z.output<typeof gmpsInputSchema>;

export type GMPSDimensionScores = {
  A_毛利率结果: number;
  B_材料成本冲击: number;
  C_产销负荷: number;
  D_外部风险: number;
  E_现金流安全: number;
};

export type GMPSLevel = "低压" | "中压" | "高压";
export type GMPSRiskLevel = "低风险" | "中风险" | "高风险";

export type GMPSIndustrySegment = "powerBattery" | "energyStorage" | "consumerBattery";

export const GMPS_INDUSTRY_WEIGHTS: Record<GMPSIndustrySegment, Record<string, number>> = {
  powerBattery: {
    A_毛利率结果: 0.25,
    B_材料成本冲击: 0.25,
    C_产销负荷: 0.20,
    D_外部风险: 0.15,
    E_现金流安全: 0.15,
  },
  energyStorage: {
    A_毛利率结果: 0.20,
    B_材料成本冲击: 0.15,
    C_产销负荷: 0.25,
    D_外部风险: 0.25,
    E_现金流安全: 0.15,
  },
  consumerBattery: {
    A_毛利率结果: 0.30,
    B_材料成本冲击: 0.15,
    C_产销负荷: 0.15,
    D_外部风险: 0.10,
    E_现金流安全: 0.30,
  },
};

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
  industrySegment: GMPSIndustrySegment;
  industryWeights: Record<string, number>;
};

// ==================== DQI 经营质量动态评价模型 ====================

export const dqiInputSchema = z
  .object({
    currentNetProfit: netProfitAmount,
    currentBeginningEquity: equityAmount,
    currentEndingEquity: equityAmount,
    currentRevenue: monetaryAmount,
    currentOperatingCashFlow: finiteNumber,
    currentTotalAssets: monetaryAmount,
    currentInventoryExpense: monetaryAmount,
    currentOperatingCost: monetaryAmount,

    baselineNetProfit: netProfitAmount,
    baselineBeginningEquity: equityAmount,
    baselineEndingEquity: equityAmount,
    baselineRevenue: monetaryAmount,
    baselineOperatingCashFlow: finiteNumber,
    baselineGrowth: z.coerce.number().optional(),
    baselineTotalAssets: monetaryAmount,
    baselineInventoryExpense: monetaryAmount,
    baselineOperatingCost: monetaryAmount,
  })
  .superRefine((input, context) => {
    if (input.currentBeginningEquity > input.currentEndingEquity && input.currentNetProfit > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentBeginningEquity"],
        message: "当期净利润为正时，期末净资产不应低于期初净资产。",
      });
    }

    if (input.baselineBeginningEquity > input.baselineEndingEquity && input.baselineNetProfit > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baselineBeginningEquity"],
        message: "基期净利润为正时，期末净资产不应低于期初净资产。",
      });
    }

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

export type DQIDriver = "盈利能力" | "成长能力" | "现金流质量" | "资产周转效率" | "研发投入强度" | "库存周转效率" | "无明显驱动";
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
  currentAssetTurnover: number;
  baselineAssetTurnover: number;
  currentRdRatio: number;
  baselineRdRatio: number;
  currentInventoryDays: number;
  baselineInventoryDays: number;
};

export type DQIDecomposition = {
  profitabilityContribution: number;
  growthContribution: number;
  cashflowContribution: number;
  assetTurnoverContribution: number;
  rdIntensityContribution: number;
  inventoryTurnoverContribution: number;
};

export type DQIResult = {
  dqi: number;
  status: DQIStatus;
  driver: DQIDriver;
  decomposition: DQIDecomposition;
  metrics: DQIMetrics;
  trend: string;
  confidence: number;
  governance: ModelGovernance;
};
