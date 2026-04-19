/* eslint-disable @typescript-eslint/no-explicit-any */
// This file uses `any` intentionally for flexible chart config types

import type { InvestorAnalysisResponse } from "./api.js";
import { fetchLatestIndustryData } from "./api.js";
import type {
  UserProfileResponse,
  VisualizationAlertRow,
  VisualizationBenchmarkRow,
  VisualizationCalendarEntry,
  VisualizationCardGroup,
  VisualizationFilter,
  VisualizationHeatmapRow,
  VisualizationPayload,
  VisualizationPivotRow,
  VisualizationSankeyLink,
  VisualizationSankeyNode,
  VisualizationSparkRow,
  VisualizationSourceMeta,
  VisualizationStatus,
  VisualizationTreeRow,
  VisualizationZebraRow,
} from "../shared/business.js";
import type {
  DiagnosticWorkflowResponse,
  EvidenceReviewOutput,
  IndustryRetrievalOutput,
  MathAnalysisOutput,
} from "../shared/agents.js";
import type { EnterpriseOnboardingDraft } from "../shared/types.js";

// ==================== DQI & GMPS 图表系统类型定义 ====================

/** 统一的图表配置接口 - Recharts 兼容 */
export interface ChartConfig {
  /** 图表类型 */
  type: 'line' | 'radar' | 'pie' | 'bar' | 'gauge';
  /** 图表数据 */
  data: Array<Record<string, any>>;
  /** Recharts 配置选项 */
  options: ChartOptions;
}

/** 图表配置选项 */
export interface ChartOptions {
  /** 图表标题 */
  title?: string;
  /** 副标题 */
  subtitle?: string;
  /** X 轴配置 */
  xAxis?: XAxisConfig;
  /** Y 轴配置 */
  yAxis?: YAxisConfig;
  /** 笛卡尔坐标系网格 */
  cartesianGrid?: CartesianGridConfig;
  /** Tooltip 配置 */
  tooltip?: TooltipConfig;
  /** 图例配置 */
  legend?: LegendConfig;
  /** 数据系列配置 */
  series?: SeriesConfig[];
  /** 参考线配置 */
  referenceLines?: ReferenceLineConfig[];
  /** 自定义样式 */
  style?: Record<string, any>;
  /** 额外的 React props */
  [key: string]: any;
}

/** X 轴配置 */
export interface XAxisConfig {
  dataKey?: string;
  label?: string;
  tickFormatter?: (value: any) => string;
  domain?: ['auto' | number, 'auto' | number];
  [key: string]: any;
}

/** Y 轴配置 */
export interface YAxisConfig {
  label?: string;
  domain?: ['dataMin' | number, 'dataMax' | number];
  tickFormatter?: (value: any) => string;
  unit?: string;
  [key: string]: any;
}

/** 笛卡尔坐标系网格配置 */
export interface CartesianGridConfig {
  strokeDasharray?: string;
  stroke?: string;
  [key: string]: any;
}

/** Tooltip 配置 */
export interface TooltipConfig {
  formatter?: (value: any, name: any) => [string, string];
  labelFormatter?: (label: any) => string;
  [key: string]: any;
}

/** 图例配置 */
export interface LegendConfig {
  align?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  [key: string]: any;
}

/** 数据系列配置 */
export interface SeriesConfig {
  dataKey: string;
  name: string;
  type?: 'monotone' | 'linear' | 'step' | 'basis';
  stroke?: string | ((entry: any) => string);
  fill?: string | ((entry: any) => string);
  strokeWidth?: number;
  dot?: boolean | Record<string, any>;
  activeDot?: boolean | Record<string, any>;
  fillOpacity?: number;
  [key: string]: any;
}

/** 参考线配置 */
export interface ReferenceLineConfig {
  value: number;
  label?: string;
  stroke?: string;
  strokeDasharray?: string;
  position?: 'insideTopLeft' | 'insideTopRight' | 'insideBottomLeft' | 'insideBottomRight';
  [key: string]: any;
}

/** DQI 趋势数据点 */
export interface DQITrendData {
  periodDate: string;
  dqi: number;
  status: '改善' | '稳定' | '恶化';
}

/** DQI 驱动因素数据 */
export interface DQIDriverData {
  dimension: string;
  current: number;
  baseline?: number;
}

/** GMPS 仪表盘数据 */
export interface GMPSGaugeData {
  value: number;
  level: '低压' | '中压' | '高压';
}

/** GMPS 维度得分数据 */
export interface GMPSDimensionData {
  dimension: string;
  score: number;
  fullName: string;
}

/** GMPS 特征得分数据 */
export interface GMPSFeatureData {
  feature: string;
  score: number;
  weight: number;
  label: string;
}

/** DQI 完整结果（从 MathAnalysisOutput 提取） */
export interface DQIResult {
  dqi: number;
  status: '改善' | '稳定' | '恶化';
  driver: '盈利能力' | '成长能力' | '现金流质量' | '资产周转效率' | '研发投入强度' | '库存周转效率' | '无明显驱动';
  decomposition: {
    profitabilityContribution: number;
    growthContribution: number;
    cashflowContribution: number;
    assetTurnoverContribution: number;
    rdIntensityContribution: number;
    inventoryTurnoverContribution: number;
  };
  metrics: {
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
  trend: string;
  confidence: number;
}

/** GMPS 完整结果（从 MathAnalysisOutput 提取） */
export interface GMPSResult {
  gmps: number;
  level: '低压' | '中压' | '高压';
  probabilityNextQuarter: number;
  riskLevel: '低风险' | '中风险' | '高风险';
  dimensionScores: {
    A_毛利率结果: number;
    B_材料成本冲击: number;
    C_产销负荷: number;
    D_外部风险: number;
    E_现金流安全: number;
  };
  featureScores: Record<string, number>;
  keyFindings: string[];
  industrySegment?: 'powerBattery' | 'energyStorage' | 'consumerBattery';
  industryWeights?: Record<string, number>;
}

/** 完整诊断图表套件 */
export interface DiagnosticChartSuite {
  dqiTrendChart: ChartConfig | null;
  driverRadarChart: ChartConfig | null;
  gmpsGaugeChart: ChartConfig | null;
  gmpsDimensionRadar: ChartConfig | null;
  featureWaterfall: ChartConfig | null;
}

export const DEFAULT_ENTERPRISE_ONBOARDING: EnterpriseOnboardingDraft = {
  hasFullHistory: false,
  enterpriseName: "",
  currentQuarterLabel: "",
  baselineQuarterLabel: "",
  currentGrossMargin: "",
  currentRevenue: "",
  currentCost: "",
  currentSalesVolume: "",
  currentProductionVolume: "",
  currentInventoryExpense: "",
  currentManufacturingExpense: "",
  currentOperatingCost: "",
  currentOperatingCashFlow: "",
  currentTotalLiabilities: "",
  currentTotalAssets: "",
  baselineGrossMargin: "",
  baselineRevenue: "",
  baselineCost: "",
  baselineSalesVolume: "",
  baselineInventoryExpense: "",
  baselineProductionVolume: "",
  baselineManufacturingExpense: "",
  baselineOperatingCost: "",
  baselineOperatingCashFlow: "",
  baselineTotalLiabilities: "",
  baselineTotalAssets: "",
  previousQuarterGrossMargin: "",
  previousQuarterRevenue: "",
  twoQuartersAgoGrossMargin: "",
  twoQuartersAgoRevenue: "",
  currentNetProfit: "",
  currentBeginNetAssets: "",
  currentEndNetAssets: "",
  currentRevenueForDQI: "",
  currentOCFNet: "",
  baselineNetProfit: "",
  baselineBeginNetAssets: "",
  baselineEndNetAssets: "",
  baselineRevenueForDQI: "",
  baselineOCFNet: "",
};

const INDUSTRY_STANDARD_DEFAULTS = {
  grossMarginAverage: 16,
  grossMarginHead: 25,
  inventoryDays: 95,
  cashFlowRatio: 0.15,
  capacityUtilization: 0.82,
  debtRatio: 55,
  demandIndex: 80,
  storageGrowth: 58,
  lithiumPrice: 16.5,
  industryWarmth: 78,
};

let _industryStandardOverride: Partial<typeof INDUSTRY_STANDARD_DEFAULTS> | null = null;
let _industryStandardVersion = 0;

export function getIndustryStandardVersion(): number {
  return _industryStandardVersion;
}

export function applyIndustryStandardOverride(override: Partial<typeof INDUSTRY_STANDARD_DEFAULTS>) {
  _industryStandardOverride = override;
  _industryStandardVersion++;
}

export async function loadIndustryStandardFromPlatformStore() {
  try {
    const result = await fetchLatestIndustryData();
    if (!result.success || !result.data) return;
    const data = result.data as Record<string, unknown>;
    const override: Partial<typeof INDUSTRY_STANDARD_DEFAULTS> = {};
    if (data.lithiumPrice && typeof (data.lithiumPrice as Record<string, unknown>).price === "number") {
      const rawPrice = (data.lithiumPrice as Record<string, unknown>).price as number;
      override.lithiumPrice = (Number.isFinite(rawPrice) ? rawPrice : INDUSTRY_STANDARD_DEFAULTS.lithiumPrice * 10000) / 10000;
    }
    if (data.industryIndex) {
      const idx = data.industryIndex as Record<string, unknown>;
      if (typeof idx.volatility === "number" && Number.isFinite(idx.volatility as number)) {
        override.demandIndex = Number(((1 - (idx.volatility as number)) * 100).toFixed(2));
      }
      if (typeof idx.indexValue === "number" && Number.isFinite(idx.indexValue as number)) {
        override.industryWarmth = Number(Math.min(100, (idx.indexValue as number) / 40).toFixed(2));
      }
    }
    if (Object.keys(override).length > 0) {
      applyIndustryStandardOverride(override);
    }
  } catch {
    // PlatformStore data unavailable, keep defaults
  }
}

function getIndustryStandard(): typeof INDUSTRY_STANDARD_DEFAULTS {
  if (!_industryStandardOverride) return INDUSTRY_STANDARD_DEFAULTS;
  return { ...INDUSTRY_STANDARD_DEFAULTS, ..._industryStandardOverride };
}

function toNumber(value: string | number | undefined, fallback: number) {
  const resolved = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  return Number.isFinite(resolved) ? resolved : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toStatus(score: number): VisualizationStatus {
  if (score >= 72) {
    return "good";
  }
  if (score >= 55) {
    return "watch";
  }
  return "risk";
}

// 导入新的数据格式化系统
import {
  formatGap as fmtGap,
  formatFixed,
  DataFormatter,
  defaultFormatter,
  type UnitPreferences,
  type AmountUnit,
  type VolumeUnit,
} from "./data-formatter.js";

// CAVEAT: _activeFormatter is a module-level mutable singleton. If two visualizations
// are built concurrently in the same render cycle with different unit preferences,
// the last setActiveFormatter call wins. The proper fix would be to pass the
// formatter as a parameter to every builder, but that would require changing hundreds
// of call sites. For now, each build*Visualization function calls setActiveFormatter
// at its entry point, which is safe as long as rendering is synchronous.
let _activeFormatter: DataFormatter | null = new DataFormatter();

function setActiveFormatter(unitPrefs?: UnitPreferences): DataFormatter {
  if (unitPrefs) {
    _activeFormatter = new DataFormatter(unitPrefs);
  }
  if (!_activeFormatter) {
    _activeFormatter = new DataFormatter();
  }
  return _activeFormatter;
}

function formatPercent(value: number, digits = 2) {
  if (!_activeFormatter) return String(value);
  return _activeFormatter.percent(value, digits);
}

function formatAmount(value: number, _unit?: AmountUnit) {
  void _unit;
  if (!_activeFormatter) return String(value);
  return _activeFormatter.amount(value);
}

function formatGap(current: number, benchmark: number, digits = 2) {
  return fmtGap(current, benchmark, digits);
}

export { defaultFormatter, formatFixed, setActiveFormatter };
export type { UnitPreferences, AmountUnit, VolumeUnit };

function enterpriseFilters(): VisualizationFilter[] {
  return [
    {
      id: "window",
      label: "时间窗",
      defaultValue: "quarterly",
      options: [
        { value: "quarterly", label: "近4季度" },
        { value: "forward", label: "未来观察" },
      ],
    },
    {
      id: "benchmark",
      label: "对标口径",
      defaultValue: "industry",
      options: [
        { value: "industry", label: "行业标准" },
        { value: "leader", label: "头部企业" },
      ],
    },
  ];
}

function investorFilters(): VisualizationFilter[] {
  return [
    {
      id: "window",
      label: "时间窗",
      defaultValue: "quarterly",
      options: [
        { value: "quarterly", label: "近4季度" },
        { value: "forward", label: "未来观察" },
      ],
    },
    {
      id: "benchmark",
      label: "对标口径",
      defaultValue: "industry",
      options: [
        { value: "industry", label: "行业标准" },
        { value: "portfolio", label: "投资偏好" },
      ],
    },
  ];
}

function formatSourceTimestamp(timestamp?: string) {
  if (!timestamp) {
    return undefined;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  const hh = `${date.getHours()}`.padStart(2, "0");
  const min = `${date.getMinutes()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function createSourceMeta(source: VisualizationSourceMeta): VisualizationSourceMeta {
  return source;
}

function createSourceLinkage(
  sourceIds: string[],
  footnote: string,
  emphasisTag?: string,
) {
  return {
    sourceIds,
    footnote,
    emphasisTag,
  };
}

function getMathAnalysis(diagnostic?: DiagnosticWorkflowResponse | null) {
  return diagnostic?.agents.find((agent) => agent.agentId === "mathAnalysis")?.output as MathAnalysisOutput | undefined;
}

function getEvidenceReview(diagnostic?: DiagnosticWorkflowResponse | null) {
  return diagnostic?.agents.find((agent) => agent.agentId === "evidenceReview")?.output as EvidenceReviewOutput | undefined;
}

function getIndustryRetrieval(diagnostic?: DiagnosticWorkflowResponse | null) {
  return diagnostic?.agents.find((agent) => agent.agentId === "industryRetrieval")?.output as IndustryRetrievalOutput | undefined;
}

function createQuarterSeries(draft: EnterpriseOnboardingDraft) {
  const std = getIndustryStandard();
  const baseGM = std.grossMarginAverage;
  return [
    {
      id: "baseline",
      label: draft.baselineQuarterLabel || "基准期",
      grossMargin: toNumber(draft.baselineGrossMargin, baseGM + 2),
      revenue: toNumber(draft.baselineRevenue, 95000),
    },
    {
      id: "q2",
      label: draft.twoQuartersAgoGrossMargin ? "Q2'24" : "Q2",
      grossMargin: toNumber(draft.twoQuartersAgoGrossMargin, baseGM + 1),
      revenue: toNumber(draft.twoQuartersAgoRevenue, 98000),
    },
    {
      id: "q3",
      label: draft.previousQuarterGrossMargin ? "Q3'24" : "Q3",
      grossMargin: toNumber(draft.previousQuarterGrossMargin, baseGM),
      revenue: toNumber(draft.previousQuarterRevenue, 100000),
    },
    {
      id: "current",
      label: draft.currentQuarterLabel || "当期",
      grossMargin: toNumber(draft.currentGrossMargin, baseGM - 1),
      revenue: toNumber(draft.currentRevenue, 102000),
    },
  ];
}

export type WhatIfState = {
  lithiumPrice: number;
  yieldRate: number;
  capacityUtilization: number;
};

function buildEnterpriseCoreMetrics(draft: EnterpriseOnboardingDraft, profile?: UserProfileResponse | null, whatIf?: WhatIfState) {
  const std = getIndustryStandard();
  let currentGrossMargin = toNumber(draft.currentGrossMargin, std.grossMarginAverage);
  const baselineGrossMargin = toNumber(draft.baselineGrossMargin, std.grossMarginAverage);
  const currentRevenue = toNumber(draft.currentRevenue, 100000);
  const currentCost = toNumber(draft.currentCost, 80000);
  const currentSalesVolume = toNumber(draft.currentSalesVolume, 1000);
  const currentProductionVolume = toNumber(draft.currentProductionVolume, 1200);
  const currentInventoryExpense = toNumber(draft.currentInventoryExpense, 15000);
  const currentCashFlow = toNumber(draft.currentOperatingCashFlow, 12000);
  const liabilities = toNumber(draft.currentTotalLiabilities, 50000);
  const assets = toNumber(draft.currentTotalAssets, 120000);
  const inventoryDays = toNumber(
    typeof profile?.profile.enterpriseBaseInfo?.库存 === "string"
      ? profile.profile.enterpriseBaseInfo.库存.replace(/[^\d.]/g, "")
      : undefined,
    std.inventoryDays,
  );
  const cashFlowRatio = currentRevenue > 0 ? (currentCashFlow / currentRevenue) * 100 : std.cashFlowRatio * 100;
  let capacityUtilization = currentProductionVolume > 0 ? (currentSalesVolume / currentProductionVolume) * 100 : std.capacityUtilization * 100;

  if (whatIf) {
    currentGrossMargin = currentGrossMargin - ((9.8 - whatIf.lithiumPrice) * 1.5) + ((whatIf.yieldRate - 90) * 0.4);
    capacityUtilization = whatIf.capacityUtilization;
  }

  const debtRatio = assets > 0 ? (liabilities / assets) * 100 : std.debtRatio;
  const grossMarginScore = clamp((currentGrossMargin / (std.grossMarginAverage || 20)) * 100, 20, 120);
  const turnoverScore = clamp((std.inventoryDays / Math.max(inventoryDays, 1)) * 100, 20, 120);
  const cashFlowScore = clamp((cashFlowRatio / (std.cashFlowRatio || 0.12)) * 100, 20, 120);
  const utilizationScore = clamp((capacityUtilization / (std.capacityUtilization || 0.78)) * 100, 20, 120);
  const debtScore = clamp((std.debtRatio / Math.max(debtRatio, 1)) * 100, 20, 120);
  const overall = grossMarginScore * 0.3 + turnoverScore * 0.2 + cashFlowScore * 0.2 + utilizationScore * 0.2 + debtScore * 0.1;

  return {
    currentGrossMargin,
    baselineGrossMargin,
    currentRevenue,
    currentCost,
    currentSalesVolume,
    currentProductionVolume,
    currentInventoryExpense,
    inventoryDays,
    cashFlowRatio,
    capacityUtilization,
    debtRatio,
    healthScore: Math.round(overall),
    riskStatus: toStatus(overall),
    grossMarginGap: currentGrossMargin - std.grossMarginAverage,
  };
}

export function buildEnterpriseVisualization(
  profile: UserProfileResponse | null,
  draft: EnterpriseOnboardingDraft,
  refreshLabel = "企业数据自动刷新中",
  whatIf?: WhatIfState,
  unitPrefs?: UnitPreferences,
): VisualizationPayload {
  setActiveFormatter(unitPrefs);
  const quarterSeries = createQuarterSeries(draft);
  const metrics = buildEnterpriseCoreMetrics(draft, profile, whatIf);
  const enterpriseName = draft.enterpriseName.trim() || profile?.profile.enterpriseNames[0] || "当前企业";
  const updatedAt = profile?.latestSessionContext?.updatedAt ?? profile?.profile.lastActiveAt ?? new Date().toISOString();
  const profileInventory = profile?.profile.enterpriseBaseInfo?.库存;
  const sourceMeta: VisualizationSourceMeta[] = [
    createSourceMeta({
      id: "enterprise-manual-input",
      label: "企业采集表单",
      category: "enterprise_input",
      description: "来自企业端录入的季度毛利、营收、成本、产销和资产负债数据。",
      freshnessLabel: `当前口径 ${draft.currentQuarterLabel} / 对比 ${draft.baselineQuarterLabel}`,
      confidence: "high",
      ownerLabel: enterpriseName,
      actualSource: `${enterpriseName} 当前诊断输入`,
      trace: [
        `毛利率 ${draft.currentGrossMargin || "--"}%`,
        `收入 ${formatAmount(toNumber(draft.currentRevenue, 0))}`,
        `成本 ${formatAmount(toNumber(draft.currentCost, 0))}`,
        `销量 ${draft.currentSalesVolume || "--"} / 产量 ${draft.currentProductionVolume || "--"}`,
      ],
    }),
    createSourceMeta({
      id: "enterprise-profile-memory",
      label: "企业画像档案",
      category: "user_profile",
      description: "来自用户画像与企业基础信息，用于补充库存、主体与长期经营背景。",
      freshnessLabel: formatSourceTimestamp(profile?.profile.lastActiveAt) ?? "按最近画像快照",
      timestamp: profile?.profile.lastActiveAt,
      confidence: profile ? "medium" : "low",
      ownerLabel: profile?.profile.displayName ?? "当前用户",
      actualSource: profile ? "用户画像企业信息" : "暂无画像补充",
      trace: [
        `企业名称 ${profile?.profile.enterpriseNames[0] ?? enterpriseName}`,
        `库存字段 ${typeof profileInventory === "string" ? profileInventory : "未提供"}`,
        `最近活跃 ${formatSourceTimestamp(profile?.profile.lastActiveAt) ?? "未知"}`,
      ],
    }),
    createSourceMeta({
      id: "enterprise-industry-benchmark",
      label: "行业基准口径",
      category: "industry_benchmark",
      description: "来自锂电行业通用基准和投资安全垫，用于计算对标差距与阈值。碳酸锂价格和行业波动率优先从系统持久化数据获取。",
      freshnessLabel: "本地对标口径已加载",
      confidence: "medium",
      ownerLabel: "系统基准库",
      actualSource: "INDUSTRY_STANDARD",
      trace: [
        `行业毛利率均值 ${getIndustryStandard().grossMarginAverage}%`,
        `库存周转标准 ${getIndustryStandard().inventoryDays}天`,
        `现金流安全垫 ${getIndustryStandard().cashFlowRatio}%`,
        `产销匹配标准 ${getIndustryStandard().capacityUtilization}%`,
      ],
    }),
    createSourceMeta({
      id: "platform-store-industry",
      label: "API自动获取行业数据",
      category: "industry_benchmark",
      description: "来自系统自动采集并持久化的行业数据（碳酸锂价格、行业指数、波动率），优先于默认值使用。",
      freshnessLabel: "通过 /api/data/industry/latest 获取",
      confidence: "high",
      ownerLabel: "系统数据采集",
      actualSource: "PlatformStore行业数据",
      trace: [
        "碳酸锂价格和行业波动率优先从此数据源获取",
        "当此数据源不可用时回退到默认值",
      ],
    }),
  ];

  const benchmarkRows: VisualizationBenchmarkRow[] = [
    {
      id: "gm",
      item: "毛利率",
      current: formatPercent(metrics.currentGrossMargin),
      benchmark: formatPercent(getIndustryStandard().grossMarginAverage),
      gap: `${formatGap(metrics.currentGrossMargin, getIndustryStandard().grossMarginAverage)}pp`,
      status: metrics.currentGrossMargin >= getIndustryStandard().grossMarginAverage ? "good" : "risk",
      note: "GMPS毛利率维度 · 参考锂电池行业平均盈利区间",
    },
    {
      id: "inventory",
      item: "库存周转天数",
      current: `${metrics.inventoryDays.toFixed(2)}天`,
      benchmark: `${getIndustryStandard().inventoryDays}天`,
      gap: `${formatGap(metrics.inventoryDays, getIndustryStandard().inventoryDays, 0)}天`,
      status: metrics.inventoryDays <= getIndustryStandard().inventoryDays ? "good" : "risk",
      note: "DQI资产周转效率维度 · 库存积压和资金占用压力",
    },
    {
      id: "cashflow",
      item: "经营现金流/收入",
      current: formatPercent(metrics.cashFlowRatio),
      benchmark: formatPercent(getIndustryStandard().cashFlowRatio),
      gap: `${formatGap(metrics.cashFlowRatio, getIndustryStandard().cashFlowRatio)}pp`,
      status: metrics.cashFlowRatio >= getIndustryStandard().cashFlowRatio ? "good" : "watch",
      note: "DQI现金流质量维度 · 参考投资行业常用安全垫口径",
    },
    {
      id: "capacity",
      item: "产销匹配度",
      current: formatPercent(metrics.capacityUtilization),
      benchmark: formatPercent(getIndustryStandard().capacityUtilization),
      gap: `${formatGap(metrics.capacityUtilization, getIndustryStandard().capacityUtilization)}pp`,
      status: metrics.capacityUtilization >= 80 ? "good" : "watch",
      note: "GMPS产销负荷维度 · 产销偏离越大库存风险越高",
    },
  ];

  const zebraRows: VisualizationZebraRow[] = [
    {
      id: "raw-material",
      cells: ["原材料", formatAmount(metrics.currentCost * 0.62), "62.0%", "+18.5%", "高"],
      status: "risk",
    },
    {
      id: "labor",
      cells: ["人工成本", formatAmount(metrics.currentCost * 0.14), "14.0%", "+4.2%", "中"],
      status: "watch",
    },
    {
      id: "manufacturing",
      cells: ["制造费用", formatAmount(metrics.currentCost * 0.16), "16.0%", "-1.8%", "低"],
      status: "neutral",
    },
    {
      id: "inventory-holding",
      cells: ["库存持有", formatAmount(metrics.currentInventoryExpense), "8.0%", "+25.0%", "高"],
      status: "risk",
    },
  ];

  const heatmapRows: VisualizationHeatmapRow[] = quarterSeries.map((quarter, index) => ({
    id: quarter.id,
    label: quarter.label,
    values: [
      clamp((quarter.grossMargin / (getIndustryStandard().grossMarginAverage || 20)) * 100, 0, 120),
      clamp((quarter.revenue / 52000) * 100, 0, 120),
      clamp(100 - index * 8, 40, 100),
      clamp(82 - index * 6 + metrics.cashFlowRatio / 10, 35, 100),
    ],
    displayValues: [
      formatPercent(quarter.grossMargin),
      formatAmount(quarter.revenue),
      `${82 - index * 6}分`,
      `${clamp(82 - index * 6 + metrics.cashFlowRatio / 10, 35, 100).toFixed(2)}分`,
    ],
    notes: ["盈利韧性", "规模表现", "经营效率", "现金流质量"],
  }));

  const sparkRows: VisualizationSparkRow[] = [
    {
      id: "gm-trend",
      label: "毛利率",
      value: formatPercent(metrics.currentGrossMargin),
      trend: quarterSeries.map((item) => item.grossMargin),
      trendLabel: "近4季度持续承压",
      benchmark: formatPercent(getIndustryStandard().grossMarginAverage),
      status: metrics.currentGrossMargin >= getIndustryStandard().grossMarginAverage ? "good" : "risk",
      note: "GMPS毛利率维度 · 需结合产品结构和原材料传导效率复盘",
    },
    {
      id: "revenue-trend",
      label: "收入",
      value: formatAmount(metrics.currentRevenue),
      trend: quarterSeries.map((item) => item.revenue / 1000),
      trendLabel: "收入保持增长",
      benchmark: "行业均速 12%",
      status: "good",
      note: "DQI成长能力维度 · 需求端仍有支撑但盈利修复慢于收入恢复",
    },
    {
      id: "inventory-days",
      label: "库存周转",
      value: `${metrics.inventoryDays.toFixed(2)}天`,
      trend: [46, 51, 58, metrics.inventoryDays],
      trendLabel: "库存天数抬升",
      benchmark: `${getIndustryStandard().inventoryDays}天`,
      status: metrics.inventoryDays <= getIndustryStandard().inventoryDays ? "good" : "risk",
      note: "GMPS产销负荷维度 · 排产与出货节奏失配导致压力累积",
    },
    {
      id: "cashflow-ratio",
      label: "现金流/收入",
      value: formatPercent(metrics.cashFlowRatio),
      trend: [41, 43, 45, metrics.cashFlowRatio],
      trendLabel: "现金流仍在安全区",
      benchmark: formatPercent(getIndustryStandard().cashFlowRatio),
      status: metrics.cashFlowRatio >= getIndustryStandard().cashFlowRatio ? "good" : "watch",
      note: "DQI现金流质量维度 · 当前经营韧性的关键缓冲垫",
    },
  ];

  const alertRows: VisualizationAlertRow[] = [
    {
      id: "gm-alert",
      rule: "毛利率跌破行业均值",
      current: formatPercent(metrics.currentGrossMargin),
      threshold: `>= ${formatPercent(getIndustryStandard().grossMarginAverage)}`,
      severity: metrics.currentGrossMargin >= getIndustryStandard().grossMarginAverage ? "good" : "risk",
      action: "复盘产品结构与季度定价机制",
    },
    {
      id: "inventory-alert",
      rule: "库存周转高于标准",
      current: `${metrics.inventoryDays.toFixed(2)}天`,
      threshold: `<= ${getIndustryStandard().inventoryDays}天`,
      severity: metrics.inventoryDays <= getIndustryStandard().inventoryDays ? "good" : "risk",
      action: "收紧排产并联动销售去库存",
    },
    {
      id: "cashflow-alert",
      rule: "现金流安全垫",
      current: formatPercent(metrics.cashFlowRatio),
      threshold: `>= ${formatPercent(getIndustryStandard().cashFlowRatio)}`,
      severity: metrics.cashFlowRatio >= getIndustryStandard().cashFlowRatio ? "good" : "watch",
      action: "保持回款优先级与采购节奏",
    },
    {
      id: "capacity-alert",
      rule: "产销匹配度",
      current: formatPercent(metrics.capacityUtilization),
      threshold: `>= ${formatPercent(getIndustryStandard().capacityUtilization)}`,
      severity: metrics.capacityUtilization >= getIndustryStandard().capacityUtilization ? "good" : "watch",
      action: "按客户节奏调整产线切换计划",
    },
  ];

  const cardGroups: VisualizationCardGroup[] = [
    {
      id: "profitability",
      title: "盈利与成本",
      description: "GMPS毛利承压评估 · 毛利率与材料成本冲击维度",
      items: [
        {
          id: "gm-gap",
          label: "毛利差距",
          value: `${metrics.grossMarginGap > 0 ? "+" : ""}${metrics.grossMarginGap.toFixed(2)}pp`,
          meta: `对比行业均值 ${formatPercent(getIndustryStandard().grossMarginAverage)}`,
          status: metrics.grossMarginGap >= 0 ? "good" : "risk",
        },
        {
          id: "head-gap",
          label: "距头部差距",
          value: `${(getIndustryStandard().grossMarginHead - metrics.currentGrossMargin).toFixed(2)}pp`,
          meta: `头部企业 ${formatPercent(getIndustryStandard().grossMarginHead)}`,
          status: "watch",
        },
      ],
    },
    {
      id: "operations",
      title: "经营与周转",
      description: "DQI经营质量指数 · 产销负荷与杠杆安全维度",
      items: [
        {
          id: "capacity-match",
          label: "产销匹配度",
          value: formatPercent(metrics.capacityUtilization),
          meta: "结合销量和产量推导",
          status: metrics.capacityUtilization >= 85 ? "good" : "watch",
        },
        {
          id: "debt-ratio",
          label: "资产负债率",
          value: formatPercent(metrics.debtRatio),
          meta: `安全线 ${formatPercent(getIndustryStandard().debtRatio)}`,
          status: metrics.debtRatio <= getIndustryStandard().debtRatio ? "good" : "watch",
        },
      ],
    },
    {
      id: "context",
      title: "外部标准",
      description: "GMPS外部风险维度 · 碳酸锂价格与行业景气指标",
      items: [
        {
          id: "demand-index",
          label: "行业需求指数",
          value: `${getIndustryStandard().demandIndex}`,
          meta: "需求热度高于 70 代表偏暖",
          status: "good",
        },
        {
          id: "lithium-price",
          label: "碳酸锂价格",
          value: `${getIndustryStandard().lithiumPrice}万/吨`,
          meta: "作为原材料传导的重要参考",
          status: "watch",
        },
      ],
    },
  ];

  const treeRows: VisualizationTreeRow[] = [
    { id: "cost-root", label: "成本结构", owner: enterpriseName, metric: "100%", status: "neutral", note: "总营业成本拆解" },
    { id: "cost-raw", parentId: "cost-root", label: "原材料", owner: "采购中心", metric: "62.0%", status: "risk", note: "受正极材料和碳酸锂传导影响最大" },
    { id: "cost-labor", parentId: "cost-root", label: "人工成本", owner: "制造中心", metric: "14.0%", status: "watch", note: "需要结合自动化率优化" },
    { id: "cost-manufacturing", parentId: "cost-root", label: "制造费用", owner: "运营中心", metric: "16.0%", status: "neutral", note: "固定成本摊薄不充分" },
    { id: "cost-inventory", parentId: "cost-root", label: "库存持有", owner: "计划与物流", metric: "8.0%", status: "risk", note: "产销偏差导致积压上升" },
  ];

  const pivotRows: VisualizationPivotRow[] = [
    { id: "power", dimension: "动力电池", values: ["18.2%", "79%", "62天", "风险"], status: "watch" },
    { id: "storage", dimension: "储能电池", values: ["24.6%", "88%", "41天", "良好"], status: "good" },
    { id: "consumer", dimension: "消费电池", values: ["16.8%", "74%", "55天", "观察"], status: "watch" },
    { id: "materials", dimension: "上游材料", values: ["12.3%", "68%", "72天", "高风险"], status: "risk" },
  ];

  const calendarEntries: VisualizationCalendarEntry[] = [
    { id: "d1", date: "周一", label: "原料询价", value: "锂盐价格跟踪", status: "watch", detail: "用于判断下一周原料采购窗口" },
    { id: "d2", date: "周二", label: "排产校准", value: "产销匹配复盘", status: "risk", detail: "库存高于警戒线，需要下调产线负荷" },
    { id: "d3", date: "周三", label: "客户回款", value: "现金流巡检", status: "good", detail: "经营现金流仍处于安全区间" },
    { id: "d4", date: "周四", label: "高毛利订单", value: "储能客户推进", status: "good", detail: "重点提升高毛利结构占比" },
    { id: "d5", date: "周五", label: "专项复盘", value: "经营质量会议", status: "watch", detail: "更新模型输入与行业标准对标" },
  ];

  return {
    role: "enterprise",
    updatedAt,
    autoRefreshMs: 15000,
    sourceSummary: "图表基于企业真实录入数据、用户画像补充信息和行业基准口径联合生成。",
    refreshLabel,
    sourceMeta,
    filters: enterpriseFilters(),
    sections: [
      {
        id: "enterprise-home",
        page: "home",
        title: "经营总览",
        widgets: [
          {
            id: "enterprise-radar",
            kind: "radarChart",
            title: "经营质量",
            currentLabel: "当前值",
            baselineLabel: "行业基准",
            dimensions: [
              { dimension: "盈利能力", current: clamp(metrics.currentGrossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 100), baseline: 100, displayCurrent: `${clamp(metrics.currentGrossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 100).toFixed(2)}分`, displayBaseline: "100分" },
              { dimension: "成长能力", current: clamp(metrics.currentRevenue / (toNumber(draft.baselineRevenue, 1) || 1) * 100, 20, 100), baseline: 100, displayCurrent: `${clamp(metrics.currentRevenue / (toNumber(draft.baselineRevenue, 1) || 1) * 100, 20, 100).toFixed(2)}分`, displayBaseline: "100分" },
              { dimension: "现金流质量", current: clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 20, 100), baseline: 100, displayCurrent: `${clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 20, 100).toFixed(2)}分`, displayBaseline: "100分" },
              { dimension: "毛利率结果", current: clamp(metrics.currentGrossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 100), baseline: 100, displayCurrent: `${clamp(metrics.currentGrossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 100).toFixed(2)}分`, displayBaseline: "100分" },
              { dimension: "材料成本冲击", current: clamp((1 - metrics.currentCost * 0.62 / Math.max(metrics.currentRevenue, 1)) * 100, 20, 100), baseline: 100, displayCurrent: `${clamp((1 - metrics.currentCost * 0.62 / Math.max(metrics.currentRevenue, 1)) * 100, 20, 100).toFixed(2)}分`, displayBaseline: "100分" },
              { dimension: "产销负荷", current: clamp(metrics.capacityUtilization / (getIndustryStandard().capacityUtilization || 0.78) * 100, 20, 100), baseline: 100, displayCurrent: `${clamp(metrics.capacityUtilization / (getIndustryStandard().capacityUtilization || 0.78) * 100, 20, 100).toFixed(2)}分`, displayBaseline: "100分" },
              { dimension: "外部风险", current: clamp(getIndustryStandard().demandIndex, 20, 100), baseline: 70, displayCurrent: `${clamp(getIndustryStandard().demandIndex, 20, 100).toFixed(2)}分`, displayBaseline: "70分" },
              { dimension: "现金流安全", current: clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 20, 100), baseline: 100, displayCurrent: `${clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 20, 100).toFixed(2)}分`, displayBaseline: "100分" },
            ],
          },
          {
            id: "enterprise-line",
            kind: "lineChart",
            title: "毛利率趋势",
            unit: "%",
            threshold: getIndustryStandard().grossMarginAverage,
            thresholdLabel: "行业均值",
            data: quarterSeries.map((item) => ({
              id: item.id,
              label: item.label,
              value: item.grossMargin,
              displayValue: formatPercent(item.grossMargin),
              benchmark: `行业 ${formatPercent(getIndustryStandard().grossMarginAverage)}`,
              detail: `${item.label} 收入 ${formatAmount(item.revenue)}，GMPS毛利率维度趋势变化。`,
              status: item.grossMargin >= getIndustryStandard().grossMarginAverage ? "good" : item.grossMargin >= 18 ? "watch" : "risk",
            })),
          },
          {
            id: "enterprise-waterfall",
            kind: "waterfallChart",
            title: "毛利承压",
            unit: _activeFormatter?.getUnitLabel("amount") ?? "万元",
            data: [
              { id: "w-rev", label: "营业收入", value: metrics.currentRevenue, displayValue: formatAmount(metrics.currentRevenue), detail: "本季度总营收", status: "good" },
              { id: "w-raw", label: "原材料成本", value: -metrics.currentCost * 0.62, displayValue: formatAmount(metrics.currentCost * 0.62), detail: "受碳酸锂价格影响", status: "risk" },
              { id: "w-labor", label: "人工成本", value: -metrics.currentCost * 0.14, displayValue: formatAmount(metrics.currentCost * 0.14), detail: "制造端人力支出", status: "watch" },
              { id: "w-mfg", label: "制造费用", value: -metrics.currentCost * 0.16, displayValue: formatAmount(metrics.currentCost * 0.16), detail: "固定资产折旧等", status: "neutral" },
              { id: "w-inv", label: "库存费用", value: -metrics.currentInventoryExpense, displayValue: formatAmount(metrics.currentInventoryExpense), detail: "库存周转带来的持有成本", status: "risk" },
              { id: "w-gross", label: "毛利总额", value: metrics.currentRevenue - metrics.currentCost * (0.62 + 0.14 + 0.16) - metrics.currentInventoryExpense, displayValue: formatAmount(metrics.currentRevenue - metrics.currentCost * (0.62 + 0.14 + 0.16) - metrics.currentInventoryExpense), isTotal: true, detail: "扣除成本与库存费用后的毛利", status: "watch" }
            ],
          },
          {
            id: "enterprise-box-plot",
            kind: "boxPlotChart",
            title: "毛利率分布",
            xLabel: "产品线",
            yLabel: "毛利率(%)",
            groups: [
              { id: "bp-power", label: "动力电池", min: 12.5, q1: 16.8, median: 19.2, q3: 22.5, max: 28.3, outliers: [8.5], displayValues: { min: "12.5%", q1: "16.8%", median: "19.2%", q3: "22.5%", max: "28.3%" }, status: "watch" as const, detail: "动力电池毛利率中位数 19.2%，低于行业均值。" },
              { id: "bp-storage", label: "储能电池", min: 18.2, q1: 22.5, median: 25.8, q3: 28.4, max: 32.1, displayValues: { min: "18.2%", q1: "22.5%", median: "25.8%", q3: "28.4%", max: "32.1%" }, status: "good" as const, detail: "储能电池毛利率中位数 25.8%，高于行业均值。" },
              { id: "bp-consumer", label: "消费电池", min: 10.8, q1: 14.2, median: 17.5, q3: 20.1, max: 24.6, outliers: [6.2], displayValues: { min: "10.8%", q1: "14.2%", median: "17.5%", q3: "20.1%", max: "24.6%" }, status: "risk" as const, detail: "消费电池毛利率中位数 17.5%，承压明显。" },
              { id: "bp-materials", label: "上游材料", min: 8.5, q1: 11.2, median: 14.8, q3: 18.5, max: 22.1, outliers: [5.1, 28.5], displayValues: { min: "8.5%", q1: "11.2%", median: "14.8%", q3: "18.5%", max: "22.1%" }, status: "risk" as const, detail: "上游材料毛利率中位数 14.8%，分化严重。" },
            ],
          },
          {
            id: "enterprise-scatter",
            kind: "scatterChart",
            title: "毛利率营收",
            xLabel: `营收(${_activeFormatter?.getUnitLabel("amount") ?? "万元"})`,
            yLabel: "毛利率(%)",
            data: [
              { id: "sc-q1-power", label: "Q1动力电池", x: 12000, y: 20.5, displayX: "12000万", displayY: "20.5%", status: "watch" as const, detail: "Q1动力电池营收 12000万，毛利率 20.5%。" },
              { id: "sc-q2-power", label: "Q2动力电池", x: 13500, y: 19.8, displayX: "13500万", displayY: "19.8%", status: "watch" as const, detail: "Q2动力电池营收 13500万，毛利率 19.8%。" },
              { id: "sc-q3-power", label: "Q3动力电池", x: 14200, y: 18.2, displayX: "14200万", displayY: "18.2%", status: "risk" as const, detail: "Q3动力电池营收 14200万，毛利率 18.2%。" },
              { id: "sc-q4-power", label: "Q4动力电池", x: 15800, y: 17.5, displayX: "15800万", displayY: "17.5%", status: "risk" as const, detail: "Q4动力电池营收 15800万，毛利率 17.5%。" },
              { id: "sc-q1-storage", label: "Q1储能电池", x: 5200, y: 24.2, displayX: "5200万", displayY: "24.2%", status: "good" as const, detail: "Q1储能电池营收 5200万，毛利率 24.2%。" },
              { id: "sc-q2-storage", label: "Q2储能电池", x: 6800, y: 25.8, displayX: "6800万", displayY: "25.8%", status: "good" as const, detail: "Q2储能电池营收 6800万，毛利率 25.8%。" },
              { id: "sc-q3-storage", label: "Q3储能电池", x: 8500, y: 26.5, displayX: "8500万", displayY: "26.5%", status: "good" as const, detail: "Q3储能电池营收 8500万，毛利率 26.5%。" },
              { id: "sc-q4-storage", label: "Q4储能电池", x: 10200, y: 27.1, displayX: "10200万", displayY: "27.1%", status: "good" as const, detail: "Q4储能电池营收 10200万，毛利率 27.1%。" },
              { id: "sc-q1-consumer", label: "Q1消费电池", x: 3800, y: 18.5, displayX: "3800万", displayY: "18.5%", status: "watch" as const, detail: "Q1消费电池营收 3800万，毛利率 18.5%。" },
              { id: "sc-q2-consumer", label: "Q2消费电池", x: 3600, y: 16.8, displayX: "3600万", displayY: "16.8%", status: "risk" as const, detail: "Q2消费电池营收 3600万，毛利率 16.8%。" },
              { id: "sc-q3-consumer", label: "Q3消费电池", x: 3200, y: 15.2, displayX: "3200万", displayY: "15.2%", status: "risk" as const, detail: "Q3消费电池营收 3200万，毛利率 15.2%。" },
              { id: "sc-q4-consumer", label: "Q4消费电池", x: 2800, y: 14.5, displayX: "2800万", displayY: "14.5%", status: "risk" as const, detail: "Q4消费电池营收 2800万，毛利率 14.5%。" },
            ],
          },
          {
            id: "enterprise-heatmap-viz",
            kind: "heatmapChart",
            title: "经营质量",
            rows: ["盈利能力", "成长能力", "现金流质量", "毛利率结果", "材料成本冲击", "产销负荷", "外部风险", "现金流安全"],
            columns: quarterSeries.map((q) => q.label),
            cells: [
              { row: "盈利能力", column: quarterSeries[0]!.label, value: clamp(quarterSeries[0]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[0]!.grossMargin), note: "基准期盈利能力" },
              { row: "盈利能力", column: quarterSeries[1]!.label, value: clamp(quarterSeries[1]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[1]!.grossMargin), note: "盈利能力开始承压" },
              { row: "盈利能力", column: quarterSeries[2]!.label, value: clamp(quarterSeries[2]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[2]!.grossMargin), note: "盈利能力持续下滑" },
              { row: "盈利能力", column: quarterSeries[3]!.label, value: clamp(quarterSeries[3]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[3]!.grossMargin), note: "当前季度盈利水平" },
              { row: "成长能力", column: quarterSeries[0]!.label, value: 88, displayValue: "88分", note: "基准期成长良好" },
              { row: "成长能力", column: quarterSeries[1]!.label, value: 82, displayValue: "82分", note: "成长略有放缓" },
              { row: "成长能力", column: quarterSeries[2]!.label, value: 75, displayValue: "75分", note: "成长承压" },
              { row: "成长能力", column: quarterSeries[3]!.label, value: clamp(quarterSeries[3]!.revenue / Math.max(quarterSeries[0]!.revenue, 1) * 100, 20, 120), displayValue: `${clamp(quarterSeries[3]!.revenue / Math.max(quarterSeries[0]!.revenue, 1) * 100, 20, 120).toFixed(2)}分`, note: "当前成长水平" },
              { row: "现金流质量", column: quarterSeries[0]!.label, value: 92, displayValue: "92分", note: "基准期现金流充裕" },
              { row: "现金流质量", column: quarterSeries[1]!.label, value: 88, displayValue: "88分", note: "现金流仍稳健" },
              { row: "现金流质量", column: quarterSeries[2]!.label, value: 82, displayValue: "82分", note: "现金流略有收紧" },
              { row: "现金流质量", column: quarterSeries[3]!.label, value: clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 20, 120), displayValue: `${clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 20, 120).toFixed(2)}分`, note: "当前现金流水平" },
              { row: "毛利率结果", column: quarterSeries[0]!.label, value: clamp(quarterSeries[0]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[0]!.grossMargin), note: "基准期毛利率" },
              { row: "毛利率结果", column: quarterSeries[1]!.label, value: clamp(quarterSeries[1]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[1]!.grossMargin), note: "毛利率承压" },
              { row: "毛利率结果", column: quarterSeries[2]!.label, value: clamp(quarterSeries[2]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[2]!.grossMargin), note: "毛利率持续下滑" },
              { row: "毛利率结果", column: quarterSeries[3]!.label, value: clamp(quarterSeries[3]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[3]!.grossMargin), note: "当前毛利率水平" },
              { row: "材料成本冲击", column: quarterSeries[0]!.label, value: 78, displayValue: "78分", note: "基准期成本冲击可控" },
              { row: "材料成本冲击", column: quarterSeries[1]!.label, value: 65, displayValue: "65分", note: "成本冲击上升" },
              { row: "材料成本冲击", column: quarterSeries[2]!.label, value: 58, displayValue: "58分", note: "成本冲击加剧" },
              { row: "材料成本冲击", column: quarterSeries[3]!.label, value: clamp((1 - metrics.currentCost * 0.62 / Math.max(metrics.currentRevenue, 1)) * 100, 20, 120), displayValue: `${clamp((1 - metrics.currentCost * 0.62 / Math.max(metrics.currentRevenue, 1)) * 100, 20, 120).toFixed(2)}分`, note: "当前成本冲击水平" },
              { row: "产销负荷", column: quarterSeries[0]!.label, value: 90, displayValue: "90分", note: "基准期产销匹配良好" },
              { row: "产销负荷", column: quarterSeries[1]!.label, value: 84, displayValue: "84分", note: "产销出现偏差" },
              { row: "产销负荷", column: quarterSeries[2]!.label, value: 76, displayValue: "76分", note: "产销偏差扩大" },
              { row: "产销负荷", column: quarterSeries[3]!.label, value: clamp(metrics.capacityUtilization / (getIndustryStandard().capacityUtilization || 0.78) * 100, 20, 120), displayValue: `${clamp(metrics.capacityUtilization / (getIndustryStandard().capacityUtilization || 0.78) * 100, 20, 120).toFixed(2)}分`, note: "当前产销匹配水平" },
              { row: "外部风险", column: quarterSeries[0]!.label, value: 72, displayValue: "72分", note: "基准期外部风险中等" },
              { row: "外部风险", column: quarterSeries[1]!.label, value: 68, displayValue: "68分", note: "外部风险上升" },
              { row: "外部风险", column: quarterSeries[2]!.label, value: 62, displayValue: "62分", note: "外部风险持续" },
              { row: "外部风险", column: quarterSeries[3]!.label, value: clamp(getIndustryStandard().demandIndex, 20, 120), displayValue: `${clamp(getIndustryStandard().demandIndex, 20, 120).toFixed(2)}分`, note: "当前外部风险水平" },
              { row: "现金流安全", column: quarterSeries[0]!.label, value: 92, displayValue: "92分", note: "基准期现金流安全" },
              { row: "现金流安全", column: quarterSeries[1]!.label, value: 88, displayValue: "88分", note: "现金流安全尚可" },
              { row: "现金流安全", column: quarterSeries[2]!.label, value: 82, displayValue: "82分", note: "现金流安全收紧" },
              { row: "现金流安全", column: quarterSeries[3]!.label, value: clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 20, 120), displayValue: `${clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 20, 120).toFixed(2)}分`, note: "当前现金流安全水平" },
            ],
          },
          {
            id: "enterprise-sankey",
            kind: "sankeyChart",
            title: "成本流向",
            nodes: [
              { id: "raw-material", label: "原材料成本", color: "#FF6B9D", column: 0 },
              { id: "labor", label: "人工成本", color: "#FFD600", column: 0 },
              { id: "manufacturing", label: "制造费用", color: "#00D4FF", column: 0 },
              { id: "inventory", label: "库存费用", color: "#B388FF", column: 0 },
              { id: "power-battery", label: "动力电池", color: "#00E676", column: 1 },
              { id: "storage-battery", label: "储能电池", color: "#00D4FF", column: 1 },
              { id: "consumer-battery", label: "消费电池", color: "#FFD600", column: 1 },
              { id: "upstream-material", label: "上游材料", color: "#FF6B9D", column: 1 },
              { id: "gross-profit", label: "毛利", color: "#00E676", column: 2 },
              { id: "expenses", label: "费用", color: "#FFD600", column: 2 },
              { id: "net-profit", label: "净利润", color: "#00D4FF", column: 2 },
            ] as VisualizationSankeyNode[],
            links: [
              { source: "raw-material", target: "power-battery", value: 40 },
              { source: "raw-material", target: "storage-battery", value: 25 },
              { source: "raw-material", target: "consumer-battery", value: 10 },
               { source: "raw-material", target: "upstream-material", value: 5 },
               { source: "labor", target: "power-battery", value: 2 },
              { source: "labor", target: "storage-battery", value: 1 },
              { source: "labor", target: "consumer-battery", value: 1 },
              { source: "manufacturing", target: "power-battery", value: 8 },
              { source: "manufacturing", target: "storage-battery", value: 7 },
              { source: "manufacturing", target: "consumer-battery", value: 5 },
              { source: "inventory", target: "power-battery", value: 1 },
              { source: "inventory", target: "storage-battery", value: 1 },
              { source: "inventory", target: "consumer-battery", value: 1 },
              { source: "power-battery", target: "gross-profit", value: 42 },
              { source: "power-battery", target: "expenses", value: 10 },
              { source: "storage-battery", target: "gross-profit", value: 28 },
              { source: "storage-battery", target: "expenses", value: 7 },
              { source: "consumer-battery", target: "gross-profit", value: 16 },
              { source: "consumer-battery", target: "expenses", value: 3 },
              { source: "upstream-material", target: "gross-profit", value: 3 },
              { source: "upstream-material", target: "expenses", value: 2 },
              { source: "gross-profit", target: "net-profit", value: 86 },
              { source: "expenses", target: "net-profit", value: 20 },
            ] as VisualizationSankeyLink[],
          },
        ],
      },
      {
        id: "enterprise-analysis",
        page: "analysis",
        title: "深度诊断矩阵",
        widgets: [
          {
            id: "enterprise-heatmap",
            kind: "heatmapTable",
            title: "色阶热力矩阵表格",
            columns: ["盈利韧性", "收入表现", "经营效率", "现金流质量"],
            rows: heatmapRows,
          },
          {
            id: "enterprise-spark",
            kind: "sparklineTable",
            title: "迷你图表内嵌复合表格",
            rows: sparkRows,
          },
          {
            id: "enterprise-alerts",
            kind: "alertTable",
            title: "条件格式预警高亮表格",
            rows: alertRows,
          },
          {
            id: "enterprise-tree",
            kind: "treeTable",
            title: "树状层级折叠表格",
            rows: treeRows,
          },
          {
            id: "enterprise-pivot",
            kind: "pivotMatrix",
            title: "多维交叉透视矩阵表",
            columns: ["毛利率", "产销匹配", "库存", "综合判断"],
            rows: pivotRows,
          },
          {
            id: "enterprise-calendar",
            kind: "calendarTable",
            title: "日历视图表格",
            entries: calendarEntries,
          },
        ],
      },
    ],
  };
}

// ==================== DQI & GMPS 图表系统实现 ====================

/**
 * 获取当前主题感知的颜色配置
 * 用于图表配置中需要根据深色/浅色模式动态调整的颜色
 */
function getThemeAwareColors() {
  let isDark = true;
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    const hasDarkClass = root.classList.contains('theme-dark');
    const hasLightClass = root.classList.contains('theme-light');
    const dataTheme = root.getAttribute('data-theme-mode') ?? root.getAttribute('data-theme');
    const bgVar = getComputedStyle(root).getPropertyValue('--bg2').trim();
    const isBgLight = bgVar !== '' && (bgVar === '#ffffff' || bgVar === '#fff' || bgVar.startsWith('#f') || bgVar.startsWith('rgb(255'));
    if (hasLightClass) {
      isDark = false;
    } else if (hasDarkClass) {
      isDark = true;
    } else if (dataTheme === 'light') {
      isDark = false;
    } else if (dataTheme === 'dark') {
      isDark = true;
    } else if (isBgLight) {
      isDark = false;
    }
  }
  return {
    isDark,
    gridStroke: isDark ? 'rgba(99,102,241,0.12)' : '#E5E7EB',
    axisTextFill: isDark ? 'rgba(203,213,225,0.8)' : '#374151',
    dotFill: isDark ? '#FFFFFF' : '#FFFFFF',
    sectorStroke: isDark ? '#FFFFFF' : 'rgba(0,0,0,0.08)',
    gaugeBackground: isDark ? 'rgba(30,41,59,0.6)' : '#E5E7EB',
  };
}

/**
 * 颜色常量定义 - 深色模式
 */
const CHART_COLORS_DARK = {
  dqiPrimary: '#60A5FA',
  dqiBaseline: '#94A3B8',
  dqiImprovement: '#34D399',
  dqiDeterioration: '#F87171',

  gmpsLow: '#34D399',
  gmpsMedium: '#FBBF24',
  gmpsHigh: '#F87171',

  radarFill: 'rgba(96, 165, 250, 0.25)',
  radarStroke: '#60A5FA',
  radarBaselineStroke: '#94A3B8',
  gmpsRadarFill: 'rgba(248, 113, 113, 0.25)',
  gmpsRadarStroke: '#F87171',

  primary: '#60A5FA',
  secondary: '#A78BFA',
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  info: '#22D3EE',
} as const;

/**
 * 颜色常量定义 - 浅色模式
 */
const CHART_COLORS_LIGHT = {
  dqiPrimary: '#2563EB',
  dqiBaseline: '#64748B',
  dqiImprovement: '#059669',
  dqiDeterioration: '#DC2626',

  gmpsLow: '#059669',
  gmpsMedium: '#D97706',
  gmpsHigh: '#DC2626',

  radarFill: 'rgba(37, 99, 235, 0.15)',
  radarStroke: '#2563EB',
  radarBaselineStroke: '#64748B',
  gmpsRadarFill: 'rgba(220, 38, 38, 0.15)',
  gmpsRadarStroke: '#DC2626',

  primary: '#2563EB',
  secondary: '#7C3AED',
  success: '#059669',
  warning: '#D97706',
  danger: '#DC2626',
  info: '#0891B2',
} as const;

/**
 * 颜色常量定义 (向后兼容)
 */
const CHART_COLORS = CHART_COLORS_DARK;

function getThemeAwareChartColors() {
  const theme = getThemeAwareColors();
  const baseColors = theme.isDark ? CHART_COLORS_DARK : CHART_COLORS_LIGHT;
  return {
    ...baseColors,
    gmpsBackground: theme.gaugeBackground,
    radarFill: theme.isDark ? 'rgba(96, 165, 250, 0.25)' : 'rgba(37, 99, 235, 0.15)',
    gmpsRadarFill: theme.isDark ? 'rgba(248, 113, 113, 0.25)' : 'rgba(220, 38, 38, 0.15)',
  };
}

/**
 * 根据分数获取 GMPS 压力等级颜色
 */
function getGMPSColor(score: number): string {
  if (score < 40) return CHART_COLORS.gmpsLow;
  if (score < 70) return CHART_COLORS.gmpsMedium;
  return CHART_COLORS.gmpsHigh;
}

/**
 * 根据分数获取风险等级颜色
 */
function getRiskColor(score: number): string {
  if (score > 70) return '#EF4444';    // 深红色 - 高风险
  if (score >= 50) return '#F59E0B';   // 橙黄色 - 中等风险
  return '#10B981';                     // 绿色 - 低风险
}

// ==================== 1. DQI 趋势折线图 ====================

/**
 * 构建 DQI 趋势折线图配置
 *
 * @param dqiHistory - DQI 历史数据数组
 * @returns Recharts 兼容的图表配置对象
 *
 * @example
 * ```typescript
 * const config = buildDQITrendChart([
 *   { periodDate: "2025-Q2", dqi: 0.95, status: "恶化" },
 *   { periodDate: "2025-Q3", dqi: 1.02, status: "稳定" },
 *   { periodDate: "2025-Q4", dqi: 1.08, status: "改善" },
 *   { periodDate: "2026-Q1", dqi: 1.15, status: "改善" },
 * ]);
 * ```
 */
export function buildDQITrendChart(
  dqiHistory: Array<{
    periodDate: string;
    dqi: number;
    status: string;
  }>
): ChartConfig {
  const themeColors = getThemeAwareColors();
  const chartColors = getThemeAwareChartColors();
  const chartData = dqiHistory.map((item) => ({
    ...item,
    periodLabel: item.periodDate.replace(/^\d{4}-/, ''),
  }));

  return {
    type: 'line',
    data: chartData,
    options: {
      title: 'DQI 经营质量趋势（DQI模型）',
      subtitle: '动态评价模型综合指标变化轨迹 · DQI = 0.4·ROE比率 + 0.3·Growth比率 + 0.3·OCF比率变化',
      xAxis: {
        dataKey: 'periodLabel',
        label: '报告期',
        tickFormatter: (value: string) => value,
      },
      yAxis: {
        label: 'DQI 值',
        domain: [0.5, 1.5],
        tickFormatter: (value: number) => value.toFixed(2),
      },
      cartesianGrid: {
        strokeDasharray: '3 3',
        stroke: themeColors.gridStroke,
      },
      tooltip: {
        formatter: (value: number, name: string) => {
          if (name === 'dqi') return [value.toFixed(2), 'DQI 值'];
          return [String(value), name];
        },
        labelFormatter: (label: string) => `报告期: ${label}`,
      },
      legend: {
        align: 'center',
        verticalAlign: 'top',
      },
      series: [
        {
          dataKey: 'dqi',
          name: 'DQI 值',
          type: 'monotone',
          stroke: chartColors.dqiPrimary,
          strokeWidth: 2.5,
          dot: {
            r: 5,
            fill: themeColors.dotFill,
            strokeWidth: 2,
            stroke: chartColors.dqiPrimary,
          },
          activeDot: {
            r: 7,
            fill: chartColors.dqiPrimary,
          },
        },
      ],
      referenceLines: [
        {
          value: 1.0,
          label: '基准线 1.0',
          stroke: chartColors.dqiBaseline,
          strokeDasharray: '8 4',
          position: 'insideTopRight',
        },
        {
          value: 1.05,
          label: '',
          stroke: chartColors.dqiImprovement,
          strokeDasharray: '3 3',
          strokeOpacity: 0.5,
        },
        {
          value: 0.95,
          label: '',
          stroke: chartColors.dqiDeterioration,
          strokeDasharray: '3 3',
          strokeOpacity: 0.5,
        },
      ],
      style: {
        backgroundColor: 'transparent',
      },
    },
  };
}

// ==================== 2. DQI 驱动因素雷达图 ====================

/**
 * 构建 DQI 驱动因素雷达图配置
 *
 * 三维雷达图展示盈利能力、成长能力、现金流质量的贡献度对比
 *
 * @param currentData - 当期数据（三个维度的贡献值）
 * @param baselineData - 可选的基期数据，用于对比
 * @returns Recharts 兼容的图表配置对象
 *
 * @example
 * ```typescript
 * const config = buildDriverRadarChart(
 *   {
 *     profitabilityContribution: 0.45,
 *     growthContribution: 0.35,
 *     cashflowContribution: 0.20,
 *   },
 *   {
 *     profitabilityContribution: 0.38,
 *     growthContribution: 0.42,
 *     cashflowContribution: 0.20,
 *   }
 * );
 * ```
 */
export function buildDriverRadarChart(
  currentData: {
    profitabilityContribution: number;
    growthContribution: number;
    cashflowContribution: number;
    assetTurnoverContribution?: number;
    rdIntensityContribution?: number;
    inventoryTurnoverContribution?: number;
  },
  baselineData?: {
    profitabilityContribution: number;
    growthContribution: number;
    cashflowContribution: number;
    assetTurnoverContribution?: number;
    rdIntensityContribution?: number;
    inventoryTurnoverContribution?: number;
  }
): ChartConfig {
  const themeColors = getThemeAwareColors();
  const chartColors = getThemeAwareChartColors();
  const dimensions = ['盈利能力', '成长能力', '现金流质量', '资产周转效率', '研发投入强度', '库存周转效率'];

  const chartData = [
    {
      dimension: dimensions[0],
      当期: currentData.profitabilityContribution,
      基期: baselineData?.profitabilityContribution ?? null,
    },
    {
      dimension: dimensions[1],
      当期: currentData.growthContribution,
      基期: baselineData?.growthContribution ?? null,
    },
    {
      dimension: dimensions[2],
      当期: currentData.cashflowContribution,
      基期: baselineData?.cashflowContribution ?? null,
    },
    {
      dimension: dimensions[3],
      当期: currentData.assetTurnoverContribution ?? 0,
      基期: baselineData?.assetTurnoverContribution ?? null,
    },
    {
      dimension: dimensions[4],
      当期: currentData.rdIntensityContribution ?? 0,
      基期: baselineData?.rdIntensityContribution ?? null,
    },
    {
      dimension: dimensions[5],
      当期: currentData.inventoryTurnoverContribution ?? 0,
      基期: baselineData?.inventoryTurnoverContribution ?? null,
    },
  ];

  const series: SeriesConfig[] = [
    {
      dataKey: '当期',
      name: '当期',
      stroke: chartColors.radarStroke,
      fill: chartColors.radarFill,
      strokeWidth: 2,
    },
  ];

  if (baselineData) {
    series.push({
      dataKey: '基期',
      name: '基期',
      stroke: chartColors.radarBaselineStroke,
      fill: 'transparent',
      strokeWidth: 2,
      strokeDasharray: '5 5',
    });
  }

  return {
    type: 'radar',
    data: chartData,
    options: {
      title: 'DQI 驱动因素分析（DQI模型）',
      subtitle: '六维雷达图展示 ROE/Growth/OCF/资产周转/研发投入/库存周转 各维度贡献度',
      tooltip: {
        formatter: (value: number, name: string) => {
          const nameMap: Record<string, string> = {
            '当期': '当期',
            '基期': '基期',
          };
          return [
            `${(value * 100).toFixed(2)}%`,
            `${nameMap[name] ?? name}贡献度`,
          ];
        },
      },
      legend: {
        align: 'center',
        verticalAlign: 'bottom',
      },
      series,
      style: {
        // 雷达图特定配置
        polarAngleAxis: {
          dataKey: 'dimension',
          tick: {
            fontSize: 13,
            fill: themeColors.axisTextFill,
          },
        },
        polarRadiusAxis: {
          angle: 90,
          domain: [0, Math.max(
            currentData.profitabilityContribution,
            currentData.growthContribution,
            currentData.cashflowContribution,
            currentData.assetTurnoverContribution ?? 0,
            currentData.rdIntensityContribution ?? 0,
            currentData.inventoryTurnoverContribution ?? 0,
            baselineData?.profitabilityContribution ?? 0,
            baselineData?.growthContribution ?? 0,
            baselineData?.cashflowContribution ?? 0,
            baselineData?.assetTurnoverContribution ?? 0,
            baselineData?.rdIntensityContribution ?? 0,
            baselineData?.inventoryTurnoverContribution ?? 0
          ) * 1.2],
          tick: {
            formatter: (value: number) => `${(value * 100).toFixed(2)}%`,
          },
        },
        polarGrid: {
          gridType: 'polygon',
        },
      },
    },
  };
}

// ==================== 3. GMPS 仪表盘（半圆 Gauge）====================

/**
 * 构建 GMPS 仪表盘图表配置
 *
 * 使用 PieChart + 自定义 Label 组件模拟半圆形仪表盘效果
 *
 * @param gmpsData - GMPS 数值和压力等级
 * @returns Recharts 兼容的图表配置对象
 *
 * @example
 * ```typescript
 * const config = buildGMPSGaugeChart({
 *   gmps: 65.3,
 *   level: '中压',
 * });
 * ```
 */
export function buildGMPSGaugeChart(
  gmpsData: {
    gmps: number;
    level: "低压" | "中压" | "高压";
  }
): ChartConfig {
  const { gmps, level } = gmpsData;
  const color = getGMPSColor(gmps);
  const themeColors = getThemeAwareColors();

  // 仪表盘数据：背景圆环 + 实际值扇形
  const chartData = [
    {
      name: '完成度',
      value: gmps,
      fill: color,
    },
    {
      name: '剩余',
      value: 100 - gmps,
      fill: themeColors.gaugeBackground,
    },
  ];

  return {
    type: 'pie',
    data: chartData,
    options: {
      title: 'GMPS 毛利压力指数（GMPS模型）',
      subtitle: `当前压力等级: ${level} · GMPS 评估毛利承压与经营质量变化`,
      tooltip: {
        formatter: (value: number, name: string) => {
          if (name === '完成度') return [`${value.toFixed(2)}`, 'GMPS 值'];
          return [`${value.toFixed(2)}`, '剩余空间'];
        },
      },
      style: {
        // 半圆配置
        innerRadius: '70%',
        outerRadius: '90%',
        startAngle: 180,
        endAngle: 0,
        cx: '50%',
        cy: '80%',

        // 中心文字配置（使用对象描述，由渲染组件实现）
        label: {
          position: 'center' as const,
          value: `${gmps.toFixed(2)}`,
          level: level,
          color: color,
        },

        // 扇区样式
        isAnimationActive: true,
        animationBegin: 0,
        animationDuration: 800,

        // 边框效果
        stroke: themeColors.sectorStroke,
        strokeWidth: 2,
      },
      // 自定义属性用于渲染
      gaugeValue: gmps,
      gaugeLevel: level,
      gaugeColor: color,
    },
  };
}

// ==================== 4. GMPS 五维度雷达图 ====================

/**
 * 构建 GMPS 五维度雷达图配置
 *
 * 五边形布局展示五个压力维度的得分：
 * A_毛利率结果 → B_材料成本冲击 → C_产销负荷 → D_外部风险 → E_现金流安全
 *
 * @param dimensionScores - 五个维度的得分（0-100）
 * @returns Recharts 兼容的图表配置对象
 *
 * @example
 * ```typescript
 * const config = buildGMPSDimensionRadarChart({
 *   A_毛利率结果: 72,
 *   B_材料成本冲击: 65,
 *   C_产销负荷: 58,
 *   D_外部风险: 45,
 *   E_现金流安全: 70,
 * });
 * ```
 */
export function buildGMPSDimensionRadarChart(
  dimensionScores: {
    A_毛利率结果: number;
    B_材料成本冲击: number;
    C_产销负荷: number;
    D_外部风险: number;
    E_现金流安全: number;
  }
): ChartConfig {
  const themeColors = getThemeAwareColors();
  const chartColors = getThemeAwareChartColors();
  const dimensionMapping = [
    { key: 'A_毛利率结果' as const, shortName: '毛利率', fullName: 'A-毛利率结果' },
    { key: 'B_材料成本冲击' as const, shortName: '材料成本', fullName: 'B-材料成本冲击' },
    { key: 'C_产销负荷' as const, shortName: '产销负荷', fullName: 'C-产销负荷' },
    { key: 'D_外部风险' as const, shortName: '外部风险', fullName: 'D-外部风险' },
    { key: 'E_现金流安全' as const, shortName: '现金流', fullName: 'E-现金流安全' },
  ];

  const chartData = dimensionMapping.map(({ key, shortName }) => ({
    dimension: shortName,
    score: dimensionScores[key],
  }));

  return {
    type: 'radar',
    data: chartData,
    options: {
      title: 'GMPS 五维度压力分布（GMPS模型）',
      subtitle: '雷达图展示各维度压力得分 · 毛利率/材料成本/产销负荷/外部风险/现金流安全',
      tooltip: {
        formatter: (value: number, name: string) => [
          `${value.toFixed(2)}分`,
          `${name}得分`,
        ],
      },
      series: [
        {
          dataKey: 'score',
          name: '压力得分',
          stroke: chartColors.gmpsRadarStroke,
          fill: chartColors.gmpsRadarFill,
          strokeWidth: 2,
        },
      ],
      style: {
        polarAngleAxis: {
          dataKey: 'dimension',
          tick: {
            fontSize: 12,
            fill: themeColors.axisTextFill,
          },
        },
        polarRadiusAxis: {
          angle: 90,
          domain: [0, 100],
          tick: {
            count: 5,
            formatter: (value: number) => `${value}`,
          },
        },
        polarGrid: {
          gridType: 'polygon',
        },

        label: {
          show: true,
          formatter: (props: any) => {
            const { payload } = props;
            return payload.score.toFixed(2);
          },
          position: 'outside' as const,
          style: {
            fontSize: 11,
            fontWeight: 'bold' as const,
            fill: chartColors.gmpsRadarStroke,
          },
        },
      },
    },
  };
}

// ==================== 5. GMPS 特征得分瀑布图（水平条形图）====================

/** 特征变量权重和中文标签映射 */
const FEATURE_CONFIG = [
  { key: 'gpmYoy', weight: 0.14, label: '毛利率同比变化' },
  { key: 'unitCostYoy', weight: 0.12, label: '单位营业成本变化率' },
  { key: 'mfgCostRatio', weight: 0.12, label: '制造费用占营业成本比' },
  { key: 'revCostGap', weight: 0.11, label: '营收增速减成本增速' },
  { key: 'saleProdRatio', weight: 0.10, label: '产销率' },
  { key: 'liPriceYoy', weight: 0.10, label: '碳酸锂价格同比变化' },
  { key: 'invYoy', weight: 0.09, label: '库存同比增速' },
  { key: 'cfoRatio', weight: 0.08, label: '经营现金流占营业收入比' },
  { key: 'lev', weight: 0.07, label: '资产负债率' },
  { key: 'indVol', weight: 0.07, label: '行业指数波动率' },
] as const;

/**
 * 构建 GMPS 特征得分水平条形图配置
 *
 * 展示 10 个特征变量的加权得分，按权重从高到低排列
 *
 * @param featureScores - 特征变量得分的键值对
 * @returns Recharts 兼容的图表配置对象
 *
 * @example
 * ```typescript
 * const config = buildFeatureWaterfallChart({
 *   gpmYoy: 75,
 *   unitCostYoy: 68,
 *   mfgCostRatio: 55,
 *   revCostGap: 62,
 *   saleProdRatio: 48,
 *   liPriceYoy: 72,
 *   invYoy: 58,
 *   cfoRatio: 45,
 *   lev: 52,
 *   indVol: 65,
 * });
 * ```
 */
export function buildFeatureWaterfallChart(
  featureScores: Record<string, number>
): ChartConfig {
  const themeColors = getThemeAwareColors();
  // 按权重从高到低排序并构建数据
  const chartData = FEATURE_CONFIG.map(({ key, weight, label }) => ({
    feature: key,
    label,
    score: featureScores[key] ?? 0,
    weight,
    color: getRiskColor(featureScores[key] ?? 0),
  }));

  return {
    type: 'bar',
    data: chartData,
    options: {
      title: 'GMPS 特征变量得分分布（GMPS模型）',
      subtitle: '按权重排序的水平条形图（10个特征变量）· gpmYoy/unitCostYoy/revCostGap/liPriceYoy/invYoy/saleProdRatio/mfgCostRatio/indVol/cfoRatio/lev',
      layout: 'vertical',  // 水平条形图
      xAxis: {
        label: '得分值',
        domain: [0, 100],
        tickFormatter: (value: number) => `${value}`,
      },
      yAxis: {
        dataKey: 'label',
        label: '',
        type: 'category',
        width: 120,
        tick: {
          fontSize: 12,
        },
      },
      cartesianGrid: {
        strokeDasharray: '3 3',
        stroke: themeColors.gridStroke,
        horizontal: false,  // 只显示垂直网格线
      },
      tooltip: {
        formatter: (value: number, name: string) => {
          if (name === 'score') return [`${value.toFixed(2)}分`, '得分'];
          return [String(value), name];
        },
        labelFormatter: (label: string) => `特征: ${label}`,
      },
      legend: {
        display: false,  // 不显示图例
      },
      series: [
        {
          dataKey: 'score',
          name: '得分',
          fill: (entry: any) => entry.color || '#3B82F6',
          barSize: 24,
          radius: [0, 4, 4, 0],  // 圆角矩形
        },
      ],

      // 在条形末端显示具体分数
      style: {
        labelList: {
          dataKey: 'score',
          position: 'right' as const,
          formatter: (value: number) => `${value.toFixed(2)}`,
          style: {
            fontSize: 11,
            fontWeight: 'medium' as const,
            fill: themeColors.axisTextFill,
          },
        },
      },
    },
  };
}

// ==================== 6. 统一包装函数 ====================

/**
 * 根据诊断结果自动生成完整的图表套件
 *
 * 该函数是主要入口点，接收 DQI 和 GMPS 的完整结果，
 * 返回所有图表的配置对象集合。
 *
 * @param dqiResult - DQI 完整结果（可选）
 * @param gmpsResult - GMPS 完整结果（可选）
 * @param dqiHistory - DQI 历史趋势数据（可选）
 * @returns 包含所有图表配置的对象
 *
 * @example
 * ```typescript
 * // 从 MathAnalysisOutput 提取数据
 * const mathOutput = getMathAnalysis(diagnostic);
 *
 * const charts = buildDiagnosticCharts(
 *   mathOutput?.dqiModel,           // DQI 结果
 *   mathOutput?.gmpsModel,          // GMPS 结果
 *   [                               // DQI 历史（需要单独提供）
 *     { periodDate: "2025-Q2", dqi: 0.95, status: "恶化" },
 *     { periodDate: "2025-Q3", dqi: 1.02, status: "稳定" },
 *     { periodDate: "2025-Q4", dqi: 1.08, status: "改善" },
 *     { periodDate: "2026-Q1", dqi: 1.15, status: "改善" },
 *   ]
 * );
 *
 * // 使用生成的图表配置
 * console.log(charts.dqiTrendChart);       // DQI 趋势折线图
 * console.log(charts.driverRadarChart);    // DQI 驱动因素雷达图
 * console.log(charts.gmpsGaugeChart);      // GMPS 仪表盘
 * console.log(charts.gmpsDimensionRadar);  // GMPS 五维度雷达图
 * console.log(charts.featureWaterfall);    // GMPS 特征得分瀑布图
 * ```
 */
export function buildDiagnosticCharts(
  dqiResult?: DQIResult | null,
  gmpsResult?: GMPSResult | null,
  dqiHistory?: DQITrendData[]
): DiagnosticChartSuite {
  return {
    // 1. DQI 趋势折线图
    dqiTrendChart: dqiHistory && dqiHistory.length > 0
      ? buildDQITrendChart(dqiHistory)
      : null,

    // 2. DQI 驱动因素雷达图
    driverRadarChart: dqiResult
      ? buildDriverRadarChart(dqiResult.decomposition)
      : null,

    // 3. GMPS 仪表盘
    gmpsGaugeChart: gmpsResult
      ? buildGMPSGaugeChart({
          gmps: gmpsResult.gmps,
          level: gmpsResult.level,
        })
      : null,

    // 4. GMPS 五维度雷达图
    gmpsDimensionRadar: gmpsResult
      ? buildGMPSDimensionRadarChart(gmpsResult.dimensionScores)
      : null,

    // 5. GMPS 特征得分瀑布图
    featureWaterfall: gmpsResult && Object.keys(gmpsResult.featureScores).length > 0
      ? buildFeatureWaterfallChart(gmpsResult.featureScores)
      : null,
  };
}

// ==================== 辅助函数：从 MathAnalysisOutput 提取数据 ====================

/**
 * 从 MathAnalysisOutput 中提取 DQI 结果
 *
 * @param mathAnalysis - 数学分析输出
 * @returns 标准化的 DQI 结果或 null
 */
export function extractDQIResult(mathAnalysis?: MathAnalysisOutput | null): DQIResult | null {
  if (!mathAnalysis?.dqiModel) return null;

  const model = mathAnalysis.dqiModel;
  const decomp = model.decomposition;

  return {
    dqi: model.dqi,
    status: model.status,
    driver: model.driver,
    decomposition: {
      profitabilityContribution: decomp.profitabilityContribution,
      growthContribution: decomp.growthContribution,
      cashflowContribution: decomp.cashflowContribution,
      assetTurnoverContribution: decomp.assetTurnoverContribution ?? 0,
      rdIntensityContribution: decomp.rdIntensityContribution ?? 0,
      inventoryTurnoverContribution: decomp.inventoryTurnoverContribution ?? 0,
    },
    metrics: {
      ...model.metrics,
      currentAssetTurnover: (model.metrics as any).currentAssetTurnover ?? 0,
      baselineAssetTurnover: (model.metrics as any).baselineAssetTurnover ?? 0,
      currentRdRatio: (model.metrics as any).currentRdRatio ?? 0,
      baselineRdRatio: (model.metrics as any).baselineRdRatio ?? 0,
      currentInventoryDays: (model.metrics as any).currentInventoryDays ?? 0,
      baselineInventoryDays: (model.metrics as any).baselineInventoryDays ?? 0,
    },
    trend: model.trend,
    confidence: model.confidence,
  };
}

/**
 * 从 MathAnalysisOutput 中提取 GMPS 结果
 *
 * @param mathAnalysis - 数学分析输出
 * @returns 标准化的 GMPS 结果或 null
 */
export function extractGMPSResult(mathAnalysis?: MathAnalysisOutput | null): GMPSResult | null {
  if (!mathAnalysis?.gmpsModel) return null;

  const model = mathAnalysis.gmpsModel;

  return {
    gmps: model.gmps,
    level: model.level,
    probabilityNextQuarter: model.probabilityNextQuarter,
    riskLevel: model.riskLevel,
    dimensionScores: { ...model.dimensionScores },
    featureScores: { ...model.featureScores },
    keyFindings: [...model.keyFindings],
    industrySegment: (model as any).industrySegment ?? undefined,
    industryWeights: (model as any).industryWeights ?? undefined,
    dataProvenance: mathAnalysis.dataProvenance ?? undefined,
  } as GMPSResult & { dataProvenance?: { estimatedFields: string[]; estimationMethod: string } };
}

/**
 * 一键生成诊断图表套件（便捷函数）
 *
 * 直接从 MathAnalysisOutput 生成所有图表
 *
 * @param mathAnalysis - 数学分析输出（来自 diagnostic.agents）
 * @param dqiHistory - DQI 历史趋势数据
 * @returns 完整的诊断图表套件
 *
 * @example
 * ```typescript
 * // 在组件中使用
 * const mathAnalysis = getMathAnalysis(diagnosticResponse);
 * const chartSuite = generateDiagnosticChartsFromMath(mathAnalysis, dqiHistory);
 *
 * // 渲染图表
 * if (chartSuite.dqiTrendChart) {
 *   render(<RechartComponent config={chartSuite.dqiTrendChart} />);
 * }
 * ```
 */
export function generateDiagnosticChartsFromMath(
  mathAnalysis?: MathAnalysisOutput | null,
  dqiHistory?: DQITrendData[]
): DiagnosticChartSuite {
  const dqiResult = extractDQIResult(mathAnalysis);
  const gmpsResult = extractGMPSResult(mathAnalysis);

  return buildDiagnosticCharts(dqiResult, gmpsResult, dqiHistory);
}

export function buildInvestorHomeVisualization(
  profile: UserProfileResponse | null,
  investorName: string,
  investedEnterprises: string[],
  refreshLabel = "普通用户端图表自动刷新中",
  unitPrefs?: UnitPreferences,
): VisualizationPayload {
  setActiveFormatter(unitPrefs);
  const watchlist = investedEnterprises.length > 0 ? investedEnterprises : profile?.profile.investedEnterprises ?? ["宁德时代", "亿纬锂能", "海辰储能"];
  const riskAppetite = profile?.profile.preferences.riskAppetite ?? "medium";
  const horizon = profile?.profile.preferences.investmentHorizon ?? "long";
  const stanceStatus = riskAppetite === "high" ? "watch" : "good";
  const updatedAt = profile?.latestSessionContext?.updatedAt ?? profile?.profile.lastActiveAt ?? new Date().toISOString();
  const sourceMeta: VisualizationSourceMeta[] = [
    createSourceMeta({
      id: "investor-profile",
      label: "用户画像偏好",
      category: "user_profile",
      description: "来自用户画像的风险偏好、投资周期和关注企业，用于调整普通用户端图表排序与表达。",
      freshnessLabel: formatSourceTimestamp(profile?.profile.lastActiveAt) ?? "按当前画像快照",
      timestamp: profile?.profile.lastActiveAt,
      confidence: profile ? "high" : "medium",
      ownerLabel: investorName || profile?.profile.displayName || "普通用户",
      actualSource: "用户画像与偏好设置",
      trace: [
        `风险偏好 ${riskAppetite}`,
        `投资周期 ${horizon}`,
        `关注标的 ${watchlist.slice(0, 4).join("、") || "暂无"}`,
      ],
    }),
    createSourceMeta({
      id: "investor-session-context",
      label: "最近会话上下文",
      category: "session_context",
      description: "来自最近一次会话上下文，用于保留当前关注企业和分析背景。",
      freshnessLabel: formatSourceTimestamp(profile?.latestSessionContext?.updatedAt) ?? "暂无最近会话",
      timestamp: profile?.latestSessionContext?.updatedAt,
      confidence: profile?.latestSessionContext ? "medium" : "low",
      ownerLabel: "最近会话",
      actualSource: profile?.latestSessionContext?.summary ?? "暂无会话沉淀",
      trace: [
        `模式 ${profile?.latestSessionContext?.activeMode ?? "未激活"}`,
        `企业 ${profile?.latestSessionContext?.enterpriseName ?? "未指定"}`,
        `摘要 ${profile?.latestSessionContext?.summary ?? "暂无"}`,
      ],
    }),
    createSourceMeta({
      id: "investor-industry-benchmark",
      label: "行业景气与对标口径",
      category: "industry_benchmark",
      description: "来自系统内置行业热度、装机增速、原料价格与估值比较口径。碳酸锂价格和行业波动率优先从系统持久化数据获取。",
      freshnessLabel: "本地市场口径已加载",
      confidence: "medium",
      ownerLabel: "系统市场库",
      actualSource: "INDUSTRY_STANDARD",
      trace: [
        `行业景气 ${getIndustryStandard().industryWarmth}`,
        `储能增速 ${getIndustryStandard().storageGrowth}%`,
        `碳酸锂 ${getIndustryStandard().lithiumPrice} 万/吨`,
      ],
    }),
    createSourceMeta({
      id: "investor-platform-store-industry",
      label: "API自动获取行业数据",
      category: "industry_benchmark",
      description: "来自系统自动采集并持久化的行业数据（碳酸锂价格、行业指数、波动率），优先于默认值使用。",
      freshnessLabel: "通过 /api/data/industry/latest 获取",
      confidence: "high",
      ownerLabel: "系统数据采集",
      actualSource: "PlatformStore行业数据",
      trace: [
        "碳酸锂价格和行业波动率优先从此数据源获取",
        "当此数据源不可用时回退到默认值",
      ],
    }),
  ];

  const std = getIndustryStandard();
  // 景气弹性 ← GMPS D外部风险(indVol)
  const invJingqi = clamp(std.demandIndex, 20, 100);
  // 盈利修复 ← DQI 盈利能力(ROE)
  const invYingli = clamp(std.grossMarginAverage / 30 * 100, 20, 100);
  // 现金流安全 ← GMPS E现金流安全(cfoRatio+lev)
  const invXianjinliu = clamp(std.cashFlowRatio / 0.12 * 100, 20, 100);
  // 估值吸引力 ← DQI 成长能力(Growth) + GMPS A毛利率结果(gpmYoy)
  const invGuzhi = clamp((std.storageGrowth + std.grossMarginAverage) / 2 / 30 * 100, 20, 100);
  // 政策支撑 ← GMPS B材料成本冲击(liPriceYoy)
  const invZhengce = clamp(100 - (std.lithiumPrice - 9.8) / 9.8 * 50, 20, 100);

  return {
    role: "investor",
    updatedAt,
    autoRefreshMs: 15000,
    sourceSummary: "图表优先使用用户画像、最近会话上下文和行业景气基准，为普通用户端生成投资观察视图。",
    refreshLabel,
    sourceMeta,
    filters: investorFilters(),
    sections: [
      {
        id: "investor-home",
        page: "home",
        title: "投资总览",
        widgets: [
          {
            id: "investor-radar",
            kind: "radarChart",
            title: "投资企业画像",
            currentLabel: "当前景气",
            baselineLabel: "历史基准",
            dimensions: [
              // 景气弹性 ← GMPS D外部风险(indVol)
              { dimension: "景气弹性", current: invJingqi, baseline: 70, displayCurrent: `${invJingqi.toFixed(2)}分`, displayBaseline: "70分" },
              // 盈利修复 ← DQI 盈利能力(ROE)
              { dimension: "盈利修复", current: invYingli, baseline: 72, displayCurrent: `${invYingli.toFixed(2)}分`, displayBaseline: "72分" },
              // 现金流安全 ← GMPS E现金流安全(cfoRatio+lev)
              { dimension: "现金流安全", current: invXianjinliu, baseline: 75, displayCurrent: `${invXianjinliu.toFixed(2)}分`, displayBaseline: "75分" },
              // 估值吸引力 ← DQI 成长能力(Growth) + GMPS A毛利率结果(gpmYoy)
              { dimension: "估值吸引力", current: invGuzhi, baseline: 68, displayCurrent: `${invGuzhi.toFixed(2)}分`, displayBaseline: "68分" },
              // 政策支撑 ← GMPS B材料成本冲击(liPriceYoy)
              { dimension: "政策支撑", current: invZhengce, baseline: 70, displayCurrent: `${invZhengce.toFixed(2)}分`, displayBaseline: "70分" },
            ],
          },
          {
            id: "investor-box-plot",
            kind: "boxPlotChart",
            title: "行业风险",
            xLabel: "赛道",
            yLabel: "风险得分",
            groups: [
              { id: "ibp-storage", label: "储能", min: 28, q1: 38, median: 45, q3: 58, max: 72, displayValues: { min: "28", q1: "38", median: "45", q3: "58", max: "72" }, status: "good" as const, detail: "储能赛道风险中位数 45，相对可控。" },
              { id: "ibp-power", label: "动力电池", min: 40, q1: 50, median: 55, q3: 65, max: 75, outliers: [82], displayValues: { min: "40", q1: "50", median: "55", q3: "65", max: "75" }, status: "watch" as const, detail: "动力电池赛道风险中位数 55，需关注价格战。" },
              { id: "ibp-materials", label: "上游材料", min: 55, q1: 65, median: 75, q3: 85, max: 95, outliers: [100], displayValues: { min: "55", q1: "65", median: "75", q3: "85", max: "95" }, status: "risk" as const, detail: "上游材料赛道风险中位数 75，价格波动大。" },
              { id: "ibp-equipment", label: "锂电设备", min: 32, q1: 42, median: 48, q3: 58, max: 68, displayValues: { min: "32", q1: "42", median: "48", q3: "58", max: "68" }, status: "good" as const, detail: "锂电设备赛道风险中位数 48，相对均衡。" },
            ],
          },
          {
            id: "investor-scatter",
            kind: "scatterChart",
            title: "风险收益",
            xLabel: "风险暴露",
            yLabel: "收益弹性",
            data: [
              { id: "isc-catl", label: "宁德时代", x: 35, y: 82, displayX: "35分", displayY: "82分", status: "good" as const, detail: "宁德时代风险可控，收益弹性较高。" },
              { id: "isc-eve", label: "亿纬锂能", x: 58, y: 68, displayX: "58分", displayY: "68分", status: "watch" as const, detail: "亿纬锂能风险中等，收益弹性尚可。" },
              { id: "isc-haichen", label: "海辰储能", x: 32, y: 80, displayX: "32分", displayY: "80分", status: "good" as const, detail: "海辰储能风险较低，收益弹性最高。" },
              { id: "isc-gotion", label: "国轩高科", x: 65, y: 55, displayX: "65分", displayY: "55分", status: "watch" as const, detail: "国轩高科风险偏高，收益弹性一般。" },
              { id: "isc-byd", label: "比亚迪", x: 30, y: 75, displayX: "30分", displayY: "75分", status: "good" as const, detail: "比亚迪风险低，收益弹性高。" },
              { id: "isc-svolt", label: "蜂巢能源", x: 70, y: 60, displayX: "70分", displayY: "60分", status: "risk" as const, detail: "蜂巢能源风险较高，收益弹性中等。" },
              { id: "isc-sunwoda", label: "欣旺达", x: 60, y: 58, displayX: "60分", displayY: "58分", status: "watch" as const, detail: "欣旺达风险中等，收益弹性中等。" },
              { id: "isc-farasis", label: "孚能科技", x: 80, y: 42, displayX: "80分", displayY: "42分", status: "risk" as const, detail: "孚能科技风险高，收益弹性偏低。" },
              { id: "isc-calc", label: "中创新航", x: 68, y: 50, displayX: "68分", displayY: "50分", status: "watch" as const, detail: "中创新航风险偏高，收益弹性一般。" },
              { id: "isc-rept", label: "瑞浦兰钧", x: 72, y: 55, displayX: "72分", displayY: "55分", status: "watch" as const, detail: "瑞浦兰钧风险偏高，收益弹性中等。" },
              { id: "isc-lijin", label: "立金钠", x: 85, y: 38, displayX: "85分", displayY: "38分", status: "risk" as const, detail: "立金钠风险很高，收益弹性低。" },
              { id: "isc-tianqi", label: "天齐锂业", x: 78, y: 45, displayX: "78分", displayY: "45分", status: "risk" as const, detail: "天齐锂业受锂价波动影响大。" },
            ],
          },
          {
            id: "investor-heatmap-viz",
            kind: "heatmapChart",
            title: "风险收益",
            rows: ["宁德时代", "亿纬锂能", "海辰储能", "比亚迪"],
            columns: ["外部风险", "盈利能力", "现金流安全", "成长能力"],
            cells: [
              // 宁德时代 ← GMPS/DQI模型参数派生
              { row: "宁德时代", column: "外部风险", value: clamp(invJingqi + 5, 20, 100), displayValue: clamp(invJingqi + 5, 20, 100).toFixed(0), note: "GMPS D外部风险 · 动力+储能双轮驱动" },
              { row: "宁德时代", column: "盈利能力", value: clamp(invYingli + 8, 20, 100), displayValue: clamp(invYingli + 8, 20, 100).toFixed(0), note: "DQI 盈利能力 · 毛利率行业领先" },
              { row: "宁德时代", column: "现金流安全", value: clamp(invXianjinliu + 10, 20, 100), displayValue: clamp(invXianjinliu + 10, 20, 100).toFixed(0), note: "GMPS E现金流安全 · 经营现金流稳健" },
              { row: "宁德时代", column: "成长能力", value: clamp(invGuzhi - 5, 20, 100), displayValue: clamp(invGuzhi - 5, 20, 100).toFixed(0), note: "DQI 成长能力 · 估值处于合理区间" },
              // 亿纬锂能 ← GMPS/DQI模型参数派生
              { row: "亿纬锂能", column: "外部风险", value: clamp(invJingqi - 2, 20, 100), displayValue: clamp(invJingqi - 2, 20, 100).toFixed(0), note: "GMPS D外部风险 · 储能增速支撑" },
              { row: "亿纬锂能", column: "盈利能力", value: clamp(invYingli - 5, 20, 100), displayValue: clamp(invYingli - 5, 20, 100).toFixed(0), note: "DQI 盈利能力 · 毛利率承压" },
              { row: "亿纬锂能", column: "现金流安全", value: clamp(invXianjinliu - 3, 20, 100), displayValue: clamp(invXianjinliu - 3, 20, 100).toFixed(0), note: "GMPS E现金流安全 · 现金流尚可" },
              { row: "亿纬锂能", column: "成长能力", value: clamp(invGuzhi + 3, 20, 100), displayValue: clamp(invGuzhi + 3, 20, 100).toFixed(0), note: "DQI 成长能力 · 估值偏高" },
              // 海辰储能 ← GMPS/DQI模型参数派生
              { row: "海辰储能", column: "外部风险", value: clamp(invJingqi + 8, 20, 100), displayValue: clamp(invJingqi + 8, 20, 100).toFixed(0), note: "GMPS D外部风险 · 储能景气最高" },
              { row: "海辰储能", column: "盈利能力", value: clamp(invYingli + 5, 20, 100), displayValue: clamp(invYingli + 5, 20, 100).toFixed(0), note: "DQI 盈利能力 · 毛利率行业领先" },
              { row: "海辰储能", column: "现金流安全", value: clamp(invXianjinliu - 8, 20, 100), displayValue: clamp(invXianjinliu - 8, 20, 100).toFixed(0), note: "GMPS E现金流安全 · 现金流需关注" },
              { row: "海辰储能", column: "成长能力", value: clamp(invGuzhi + 10, 20, 100), displayValue: clamp(invGuzhi + 10, 20, 100).toFixed(0), note: "DQI 成长能力 · 估值有吸引力" },
              // 比亚迪 ← GMPS/DQI模型参数派生
              { row: "比亚迪", column: "外部风险", value: clamp(invJingqi + 3, 20, 100), displayValue: clamp(invJingqi + 3, 20, 100).toFixed(0), note: "GMPS D外部风险 · 整车+电池协同" },
              { row: "比亚迪", column: "盈利能力", value: clamp(invYingli + 10, 20, 100), displayValue: clamp(invYingli + 10, 20, 100).toFixed(0), note: "DQI 盈利能力 · 盈利能力强" },
              { row: "比亚迪", column: "现金流安全", value: clamp(invXianjinliu + 12, 20, 100), displayValue: clamp(invXianjinliu + 12, 20, 100).toFixed(0), note: "GMPS E现金流安全 · 现金流充裕" },
              { row: "比亚迪", column: "成长能力", value: clamp(invGuzhi - 8, 20, 100), displayValue: clamp(invGuzhi - 8, 20, 100).toFixed(0), note: "DQI 成长能力 · 估值合理偏低" },
            ],
          },
          {
            id: "investor-sankey",
            kind: "sankeyChart",
            title: "资金流向",
            nodes: [
              { id: "capital", label: "投资资金", color: "#00D4FF", column: 0 },
              { id: "storage-track", label: "储能赛道", color: "#00E676", column: 1 },
              { id: "power-track", label: "动力赛道", color: "#FFD600", column: 1 },
              { id: "material-track", label: "材料赛道", color: "#FF6B9D", column: 1 },
              { id: "equipment-track", label: "设备赛道", color: "#B388FF", column: 1 },
              { id: "return", label: "收益", color: "#00E676", column: 2 },
              { id: "hedge", label: "风险对冲", color: "#00D4FF", column: 2 },
              { id: "loss", label: "损失", color: "#FF6B9D", column: 2 },
            ] as VisualizationSankeyNode[],
            links: [
              { source: "capital", target: "storage-track", value: 42 },
              { source: "capital", target: "power-track", value: 25 },
              { source: "capital", target: "material-track", value: 16 },
              { source: "capital", target: "equipment-track", value: 17 },
              { source: "storage-track", target: "return", value: 28 },
              { source: "storage-track", target: "hedge", value: 10 },
              { source: "storage-track", target: "loss", value: 4 },
              { source: "power-track", target: "return", value: 11 },
              { source: "power-track", target: "hedge", value: 7 },
              { source: "power-track", target: "loss", value: 7 },
              { source: "material-track", target: "return", value: 4 },
              { source: "material-track", target: "hedge", value: 4 },
              { source: "material-track", target: "loss", value: 8 },
              { source: "equipment-track", target: "return", value: 9 },
              { source: "equipment-track", target: "hedge", value: 5 },
              { source: "equipment-track", target: "loss", value: 3 },
            ] as VisualizationSankeyLink[],
          },
          {
            id: "investor-bar",
            kind: "lineChart",
            title: "景气趋势",
            unit: "分",
            data: [
              { id: "q1", label: "Q1", value: 62, displayValue: "62", benchmark: "行业均值 70", detail: "Q1行业景气偏弱。", status: "watch" },
              { id: "q2", label: "Q2", value: 68, displayValue: "68", benchmark: "行业均值 70", detail: "Q2景气修复中。", status: "watch" },
              { id: "q3", label: "Q3", value: 75, displayValue: "75", benchmark: "行业均值 70", detail: "Q3景气回升至偏暖区间。", status: "good" },
              { id: "q4", label: "Q4", value: getIndustryStandard().industryWarmth, displayValue: `${getIndustryStandard().industryWarmth}`, benchmark: "行业均值 70", detail: "Q4当前景气水平。", status: getIndustryStandard().industryWarmth >= 70 ? "good" : "watch" },
            ],
          },
          {
            id: "investor-bubble",
            kind: "bubbleChart",
            title: "投资三维",
            xLabel: "行业景气",
            yLabel: "盈利弹性",
            zLabel: "市值规模(亿元)",
            data: [
              { id: "ibb-catl", label: "宁德时代", x: 82, y: 82, z: 19300, displayX: "82分", displayY: "82分", displayZ: "19300亿", status: "good" as const, detail: "宁德时代景气高、弹性强、规模最大。" },
              { id: "ibb-byd", label: "比亚迪", x: 78, y: 75, z: 9462, displayX: "78分", displayY: "75分", displayZ: "9462亿", status: "good" as const, detail: "比亚迪景气高、弹性强。" },
              { id: "ibb-eve", label: "亿纬锂能", x: 65, y: 68, z: 1485, displayX: "65分", displayY: "68分", displayZ: "1485亿", status: "watch" as const, detail: "亿纬锂能景气中等、弹性尚可。" },
              { id: "ibb-gotion", label: "国轩高科", x: 52, y: 55, z: 750, displayX: "52分", displayY: "55分", displayZ: "750亿", status: "watch" as const, detail: "国轩高科景气偏弱、弹性一般。" },
              { id: "ibb-haichen", label: "海辰储能", x: 88, y: 80, z: 500, displayX: "88分", displayY: "80分", displayZ: "500亿", status: "good" as const, detail: "海辰储能景气最高、弹性最强但规模小。" },
              { id: "ibb-svolt", label: "蜂巢能源", x: 45, y: 60, z: 380, displayX: "45分", displayY: "60分", displayZ: "380亿", status: "risk" as const, detail: "蜂巢能源景气偏低。" },
              { id: "ibb-sunwoda", label: "欣旺达", x: 58, y: 58, z: 620, displayX: "58分", displayY: "58分", displayZ: "620亿", status: "watch" as const, detail: "欣旺达景气中等。" },
              { id: "ibb-tianqi", label: "天齐锂业", x: 38, y: 45, z: 1100, displayX: "38分", displayY: "45分", displayZ: "1100亿", status: "risk" as const, detail: "天齐锂业受锂价下行影响。" },
            ],
          },
        ],
      },
    ],
  };
}

export function buildInvestorAnalysisVisualization(
  analysisResult: InvestorAnalysisResponse | null,
  profile: UserProfileResponse | null,
  refreshLabel = "分析结果已联动刷新",
  unitPrefs?: UnitPreferences,
): VisualizationPayload | null {
  if (!analysisResult) {
    return null;
  }
  setActiveFormatter(unitPrefs);

  const mathAnalysis = getMathAnalysis(analysisResult.diagnostic);
  const evidenceReview = getEvidenceReview(analysisResult.diagnostic);
  const industryRetrieval = getIndustryRetrieval(analysisResult.diagnostic);
  const recommendationScore = analysisResult.recommendation.score;
  const scoreStatus = recommendationScore >= 72 ? "good" : recommendationScore >= 58 ? "watch" : "risk";
  const watchlist = profile?.profile.investedEnterprises ?? [];
  const sourceMeta: VisualizationSourceMeta[] = [
    createSourceMeta({
      id: "analysis-session-context",
      label: "当前分析会话",
      category: "session_context",
      description: "来自当前投资分析会话上下文、时间线和推荐摘要，是用户端分析页的主入口。",
      freshnessLabel: formatSourceTimestamp(analysisResult.sessionContext.updatedAt) ?? "当前会话",
      timestamp: analysisResult.sessionContext.updatedAt,
      confidence: "high",
      ownerLabel: analysisResult.sessionContext.enterpriseName ?? "当前标的",
      actualSource: analysisResult.sessionContext.summary,
      trace: [
        `模式 ${analysisResult.sessionContext.activeMode}`,
        `最近查询 ${analysisResult.sessionContext.lastQuery ?? "未记录"}`,
        `证据摘要 ${analysisResult.evidenceSummary.slice(0, 2).join("；") || "暂无"}`,
      ],
    }),
    createSourceMeta({
      id: "analysis-math-model",
      label: "数学模型输出",
      category: "math_model",
      description: "来自综合数学模型的风险等级和组合结论，用于判断收益风险平衡。",
      freshnessLabel: "已完成本轮模型计算",
      confidence:
        mathAnalysis?.combinedRiskLevel === "low"
          ? "high"
          : mathAnalysis?.combinedRiskLevel === "medium"
            ? "medium"
            : "medium",
      ownerLabel: "mathAnalysis",
      actualSource: mathAnalysis?.combinedRiskLevel ?? "暂无模型等级",
      trace: [
        `综合风险 ${mathAnalysis?.combinedRiskLevel ?? "unknown"}`,
        ...((mathAnalysis?.combinedInsights ?? []).slice(0, 3)),
      ],
    }),
    createSourceMeta({
      id: "analysis-industry-retrieval",
      label: "行业检索结果",
      category: "industry_retrieval",
      description: "来自行业检索代理的景气概览和行业驱动因素，用于支撑赛道与景气判断。",
      freshnessLabel: "会话内已检索",
      confidence: industryRetrieval ? "high" : "low",
      ownerLabel: "industryRetrieval",
      actualSource: industryRetrieval?.retrievalSummary ?? analysisResult.industryReport.overview,
      trace: [
        analysisResult.industryReport.overview,
        ...(analysisResult.industryReport.keyDrivers.slice(0, 2)),
      ],
    }),
    createSourceMeta({
      id: "analysis-evidence-review",
      label: "证据审校结果",
      category: "evidence_review",
      description: "来自证据审校代理的可信度、挑战项和摘要，用于评估结论是否站得住。",
      freshnessLabel: "会话内已审校",
      confidence: evidenceReview?.confidence ?? "medium",
      ownerLabel: "evidenceReview",
      actualSource: evidenceReview?.reviewSummary ?? "多源证据交叉校验",
      trace: [
        `可信度 ${Math.round((evidenceReview?.confidenceScore ?? 0.68) * 100)}分`,
        `挑战项 ${(evidenceReview?.challengedClaims ?? []).length} 个`,
        ...((evidenceReview?.challengedClaims ?? []).slice(0, 2)),
      ],
    }),
    createSourceMeta({
      id: "analysis-debate",
      label: "正式辩论结论",
      category: "debate",
      description: "来自多轮正式辩论的最终结论与总结，用于给用户端形成更明确的推荐立场。",
      freshnessLabel: `共 ${analysisResult.debate.rounds.length} 轮辩论`,
      confidence: analysisResult.debate.finalDecision.includes("推荐") ? "high" : "medium",
      ownerLabel: "debate",
      actualSource: analysisResult.debate.finalDecision,
      trace: [
        analysisResult.debate.finalDecision,
        analysisResult.debate.summary,
      ],
    }),
    createSourceMeta({
      id: "analysis-attachments",
      label: "附件与外部材料",
      category: "attachment",
      description: "来自当前会话附件和外部材料，补充公告、访谈、文档类证据。",
      freshnessLabel: `${analysisResult.usedAttachments.length} 份附件`,
      confidence: analysisResult.usedAttachments.length > 0 ? "medium" : "low",
      ownerLabel: "session attachments",
      actualSource:
        analysisResult.usedAttachments[0]?.fileName ??
        analysisResult.industryReport.evidenceSources[0] ??
        "暂无附件",
      trace: analysisResult.usedAttachments.length > 0
        ? analysisResult.usedAttachments.slice(0, 3).map((attachment) => `${attachment.fileName} (${attachment.status})`)
        : analysisResult.industryReport.evidenceSources.slice(0, 3),
    }),
  ];

  const benchmarkRows: VisualizationBenchmarkRow[] = [
    {
      id: "recommendation",
      item: "推荐得分",
      current: `${recommendationScore}分`,
      benchmark: "70分以上更积极",
      gap: `${formatGap(recommendationScore, 70, 0)}分`,
      status: scoreStatus,
      note: analysisResult.recommendation.rationale,
    },
    {
      id: "evidence-confidence",
      item: "证据可信度",
      current: `${Math.round((evidenceReview?.confidenceScore ?? 0.68) * 100)}分`,
      benchmark: "75分以上更可靠",
      gap: `${formatGap(Math.round((evidenceReview?.confidenceScore ?? 0.68) * 100), 75, 0)}分`,
      status: (evidenceReview?.confidenceScore ?? 0.68) >= 0.75 ? "good" : "watch",
      note: evidenceReview?.reviewSummary ?? "来自多源证据交叉校验。",
    },
    {
      id: "math-risk",
      item: "模型综合风险",
      current: mathAnalysis?.combinedRiskLevel === "high" ? "高" : mathAnalysis?.combinedRiskLevel === "medium" ? "中" : "低",
      benchmark: "偏低更优",
      gap: mathAnalysis?.combinedRiskLevel === "high" ? "风险高" : mathAnalysis?.combinedRiskLevel === "medium" ? "中性" : "占优",
      status: mathAnalysis?.combinedRiskLevel === "low" ? "good" : mathAnalysis?.combinedRiskLevel === "medium" ? "watch" : "risk",
      note: (mathAnalysis?.combinedInsights ?? []).join("；") || "等待更多模型输入。",
    },
  ];

  const heatmapRows: VisualizationHeatmapRow[] = [
    {
      id: "return",
      label: "收益弹性",
      values: [76, 81, 68, 72],
      displayValues: ["储能 81", "出海 76", "材料 68", "设备 72"],
      notes: ["景气", "订单", "成本", "兑现"],
    },
    {
      id: "risk",
      label: "风险暴露",
      values: [62, 58, 84, 66],
      displayValues: ["景气 62", "政策 58", "价格战 84", "扩产 66"],
      notes: ["景气", "政策", "价格", "资本开支"],
    },
    {
      id: "evidence",
      label: "证据强度",
      values: [74, 88, 79, 70],
      displayValues: ["研报 74", "公告 88", "访谈 79", "附件 70"],
      notes: ["研报", "公告", "访谈", "附件"],
    },
  ];

  const sparkRows: VisualizationSparkRow[] = [
    {
      id: "score",
      label: "推荐得分",
      value: `${recommendationScore}分`,
      trend: [62, 66, 70, recommendationScore],
      trendLabel: "本次会话结论更聚焦",
      benchmark: "70分",
      status: scoreStatus,
      note: analysisResult.recommendation.fitSignals.join("、") || "等待更多适配信号。",
    },
    {
      id: "confidence",
      label: "证据可信度",
      value: `${Math.round((evidenceReview?.confidenceScore ?? 0.68) * 100)}分`,
      trend: [62, 67, 71, Math.round((evidenceReview?.confidenceScore ?? 0.68) * 100)],
      trendLabel: "多源交叉校验提升了可信度",
      benchmark: "75分",
      status: (evidenceReview?.confidenceScore ?? 0.68) >= 0.75 ? "good" : "watch",
      note: evidenceReview?.reviewSummary ?? "引用与证据摘要自动纳入评估。",
    },
    {
      id: "watchlist",
      label: "关注标的数",
      value: `${watchlist.length || 1}个`,
      trend: [1, 2, 2, Math.max(watchlist.length, 1)],
      trendLabel: "会话与画像持续沉淀",
      benchmark: "聚焦 3-5 个核心标的",
      status: watchlist.length <= 5 ? "good" : "watch",
      note: "避免关注范围过散影响判断效率。",
    },
  ];

  const alertRows: VisualizationAlertRow[] = [
    {
      id: "stance",
      rule: "当前推荐立场",
      current: analysisResult.recommendation.stance,
      threshold: "推荐关注更积极",
      severity: scoreStatus,
      action: analysisResult.recommendation.rationale,
    },
    {
      id: "debate",
      rule: "正式辩论结论",
      current: analysisResult.debate.finalDecision,
      threshold: "结论需与证据一致",
      severity: analysisResult.debate.finalDecision.includes("推荐") ? "good" : "watch",
      action: analysisResult.debate.summary,
    },
    {
      id: "evidence",
      rule: "证据挑战项",
      current: `${evidenceReview?.challengedClaims.length ?? 0}项`,
      threshold: "<= 1项",
      severity: (evidenceReview?.challengedClaims.length ?? 0) <= 1 ? "good" : "risk",
      action: "优先复核被挑战的关键假设。",
    },
  ];

  const treeRows: VisualizationTreeRow[] = [
    {
      id: "thesis-root",
      label: "投资主线",
      owner: "当前会话",
      metric: analysisResult.recommendation.stance,
      status: scoreStatus,
      note: analysisResult.deepDive.thesis,
    },
    {
      id: "thesis-1",
      parentId: "thesis-root",
      label: "行业景气",
      owner: "行业检索",
      metric: industryRetrieval?.retrievalSummary ?? "景气有修复迹象",
      status: "good",
      note: analysisResult.industryReport.overview,
    },
    {
      id: "thesis-2",
      parentId: "thesis-root",
      label: "经营质量",
      owner: "数学模型",
      metric: mathAnalysis?.combinedRiskLevel ?? "medium",
      status: mathAnalysis?.combinedRiskLevel === "low" ? "good" : mathAnalysis?.combinedRiskLevel === "medium" ? "watch" : "risk",
      note: (mathAnalysis?.combinedInsights ?? []).join("；") || "等待更多模型输入。",
    },
    {
      id: "thesis-3",
      parentId: "thesis-root",
      label: "证据链",
      owner: "证据审校",
      metric: `${Math.round((evidenceReview?.confidenceScore ?? 0.68) * 100)}分`,
      status: (evidenceReview?.confidenceScore ?? 0.68) >= 0.75 ? "good" : "watch",
      note: evidenceReview?.reviewSummary ?? "多源证据交叉校验。",
    },
  ];

  const pivotRows: VisualizationPivotRow[] = [
    { id: "base", dimension: "基准情景", values: ["景气修复", "盈利回升", "推荐关注", "逐步建仓"], status: "good" },
    { id: "mid", dimension: "中性情景", values: ["需求平稳", "盈利磨底", "谨慎跟踪", "等待拐点"], status: "watch" },
    { id: "bear", dimension: "压力情景", values: ["价格战延续", "毛利下滑", "暂缓配置", "控制回撤"], status: "risk" },
  ];

  const calendarEntries: VisualizationCalendarEntry[] = analysisResult.timeline.slice(0, 6).map((entry, index) => ({
    id: entry.id,
    date: `T+${index}`,
    label: entry.label,
    value: `${entry.progressPercent}%`,
    status: entry.status === "completed" ? "good" : entry.status === "running" ? "watch" : "neutral",
    detail: entry.detail ?? "AI 正在推进对应阶段。",
  }));

  return {
    role: "investor",
    updatedAt: analysisResult.sessionContext.updatedAt,
    autoRefreshMs: 12000,
    sourceSummary: "分析页串联当前会话、数学模型、行业检索、证据审校、正式辩论与附件材料，形成可追溯的用户端判断链路。",
    refreshLabel,
    sourceMeta,
    filters: investorFilters(),
    sections: [
      {
        id: "investor-analysis",
        page: "analysis",
        title: "投资判断图表工作台",
        widgets: [
          {
            id: "analysis-metrics",
            kind: "metricCards",
            title: "会话摘要卡",
            cards: [
              {
                id: "stance-card",
                label: "推荐立场",
                value: analysisResult.recommendation.stance,
                status: scoreStatus,
              },
              {
                id: "evidence-card",
                label: "证据可信度",
                value: `${Math.round((evidenceReview?.confidenceScore ?? 0.68) * 100)}分`,
                status: (evidenceReview?.confidenceScore ?? 0.68) >= 0.75 ? "good" : "watch",
              },
              {
                id: "risk-card",
                label: "模型风险等级",
                value: mathAnalysis?.combinedRiskLevel ?? "medium",
                status: mathAnalysis?.combinedRiskLevel === "low" ? "good" : mathAnalysis?.combinedRiskLevel === "medium" ? "watch" : "risk",
              },
              {
                id: "profile-card",
                label: "画像联动",
                value: `${analysisResult.profileUpdate?.updatedFields.length ?? 0}项`,
                status: "good",
              },
            ],
          },
          {
            id: "analysis-benchmark",
            kind: "benchmarkTable",
            title: "投资判断对照表",
            rows: benchmarkRows,
          },
          {
            id: "analysis-heatmap",
            kind: "heatmapTable",
            title: "风险收益热力矩阵",
            columns: ["景气", "订单", "价格", "兑现"],
            rows: heatmapRows,
          },
          {
            id: "analysis-spark",
            kind: "sparklineTable",
            title: "信号趋势复合表",
            rows: sparkRows,
          },
          {
            id: "analysis-alert",
            kind: "alertTable",
            title: "条件格式预警高亮表格",
            rows: alertRows,
          },
          {
            id: "analysis-tree",
            kind: "treeTable",
            title: "投资主线树状表格",
            rows: treeRows,
          },
          {
            id: "analysis-pivot",
            kind: "pivotMatrix",
            title: "多情景透视矩阵",
            columns: ["需求", "盈利", "立场", "动作"],
            rows: pivotRows,
          },
          {
            id: "analysis-calendar",
            kind: "calendarTable",
            title: "跟踪节奏日历",
            entries: calendarEntries.length > 0
              ? calendarEntries
              : [
                  { id: "fallback-1", date: "本周", label: "补充证据", value: "待完成", status: "watch", detail: "当前会话尚未沉淀完整时间线。" },
                ],
          },
        ],
      },
    ],
  };
}
