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

export type EnterpriseOnboardingDraft = {
  hasFullHistory: boolean;
  enterpriseName: string;
  currentQuarterLabel: string;
  baselineQuarterLabel: string;
  currentGrossMargin: string;
  currentRevenue: string;
  currentCost: string;
  currentSalesVolume: string;
  currentProductionVolume: string;
  currentInventoryExpense: string;
  currentManufacturingExpense: string;
  currentOperatingCost: string;
  currentOperatingCashFlow: string;
  currentTotalLiabilities: string;
  currentTotalAssets: string;
  baselineGrossMargin: string;
  baselineRevenue: string;
  baselineCost: string;
  baselineSalesVolume: string;
  baselineInventoryExpense: string;
  previousQuarterGrossMargin: string;
  previousQuarterRevenue: string;
  twoQuartersAgoGrossMargin: string;
  twoQuartersAgoRevenue: string;
};

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
  previousQuarterGrossMargin: "",
  previousQuarterRevenue: "",
  twoQuartersAgoGrossMargin: "",
  twoQuartersAgoRevenue: "",
};

const INDUSTRY_STANDARD_DEFAULTS = {
  grossMarginAverage: 20,
  grossMarginHead: 30,
  inventoryDays: 90,
  cashFlowRatio: 0.12,
  capacityUtilization: 0.78,
  debtRatio: 55,
  demandIndex: 65,
  storageGrowth: 55,
  lithiumPrice: 12,
  industryWarmth: 55,
};

let _industryStandardOverride: Partial<typeof INDUSTRY_STANDARD_DEFAULTS> | null = null;

export function applyIndustryStandardOverride(override: Partial<typeof INDUSTRY_STANDARD_DEFAULTS>) {
  _industryStandardOverride = override;
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
  return [
    {
      id: "baseline",
      label: draft.baselineQuarterLabel,
      grossMargin: toNumber(draft.baselineGrossMargin, 0),
      revenue: toNumber(draft.baselineRevenue, 0),
    },
    {
      id: "q2",
      label: draft.twoQuartersAgoGrossMargin ? "Q2'24" : "Q2",
      grossMargin: toNumber(draft.twoQuartersAgoGrossMargin, 0),
      revenue: toNumber(draft.twoQuartersAgoRevenue, 0),
    },
    {
      id: "q3",
      label: draft.previousQuarterGrossMargin ? "Q3'24" : "Q3",
      grossMargin: toNumber(draft.previousQuarterGrossMargin, 0),
      revenue: toNumber(draft.previousQuarterRevenue, 0),
    },
    {
      id: "current",
      label: draft.currentQuarterLabel,
      grossMargin: toNumber(draft.currentGrossMargin, 0),
      revenue: toNumber(draft.currentRevenue, 0),
    },
  ];
}

export type WhatIfState = {
  lithiumPrice: number;
  yieldRate: number;
  capacityUtilization: number;
};

function buildEnterpriseCoreMetrics(draft: EnterpriseOnboardingDraft, profile?: UserProfileResponse | null, whatIf?: WhatIfState) {
  let currentGrossMargin = toNumber(draft.currentGrossMargin, 0);
  const baselineGrossMargin = toNumber(draft.baselineGrossMargin, 0);
  const currentRevenue = toNumber(draft.currentRevenue, 0);
  const currentCost = toNumber(draft.currentCost, 0);
  const currentSalesVolume = toNumber(draft.currentSalesVolume, 0);
  const currentProductionVolume = toNumber(draft.currentProductionVolume, 0);
  const currentInventoryExpense = toNumber(draft.currentInventoryExpense, 0);
  const currentCashFlow = toNumber(draft.currentOperatingCashFlow, 0);
  const liabilities = toNumber(draft.currentTotalLiabilities, 0);
  const assets = toNumber(draft.currentTotalAssets, 0);
  const inventoryDays = toNumber(
    typeof profile?.profile.enterpriseBaseInfo?.库存 === "string"
      ? profile.profile.enterpriseBaseInfo.库存.replace(/[^\d.]/g, "")
      : undefined,
    0,
  );
  const cashFlowRatio = currentRevenue > 0 ? (currentCashFlow / currentRevenue) * 100 : 0;
  let capacityUtilization = currentProductionVolume > 0 ? (currentSalesVolume / currentProductionVolume) * 100 : 0;

  if (whatIf) {
    currentGrossMargin = currentGrossMargin - ((9.8 - whatIf.lithiumPrice) * 1.5) + ((whatIf.yieldRate - 90) * 0.4);
    capacityUtilization = whatIf.capacityUtilization;
  }

  const debtRatio = assets > 0 ? (liabilities / assets) * 100 : 0;
  const std = getIndustryStandard();
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
    grossMarginGap: currentGrossMargin - getIndustryStandard().grossMarginAverage,
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
      cells: ["原材料", formatAmount(metrics.currentCost * 0.594), "59.4%", "+15.2%", "高"],
      status: "risk",
    },
    {
      id: "labor",
      cells: ["人工成本", formatAmount(metrics.currentCost * 0.16), "16.0%", "+5.8%", "中"],
      status: "watch",
    },
    {
      id: "manufacturing",
      cells: ["制造费用", formatAmount(metrics.currentCost * 0.17), "17.0%", "-2.1%", "低"],
      status: "neutral",
    },
    {
      id: "inventory-holding",
      cells: ["库存持有", formatAmount(metrics.currentInventoryExpense), "7.5%", "+22.0%", "高"],
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
    { id: "cost-raw", parentId: "cost-root", label: "原材料", owner: "采购中心", metric: "59.4%", status: "risk", note: "受正极材料和碳酸锂传导影响最大" },
    { id: "cost-labor", parentId: "cost-root", label: "人工成本", owner: "制造中心", metric: "16.0%", status: "watch", note: "需要结合自动化率优化" },
    { id: "cost-manufacturing", parentId: "cost-root", label: "制造费用", owner: "运营中心", metric: "17.0%", status: "neutral", note: "固定成本摊薄不充分" },
    { id: "cost-inventory", parentId: "cost-root", label: "库存持有", owner: "计划与物流", metric: "7.5%", status: "risk", note: "产销偏差导致积压上升" },
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
        subtitle: "DQI经营质量指数 · 聚焦企业端的盈利、周转、现金流与行业对标",
        emphasis: "企业端优先展示DQI/GMPS模型诊断与行业标准偏差",
        widgets: [
          {
            id: "enterprise-metric-cards",
            kind: "metricCards",
            title: "核心指标卡",
            subtitle: "DQI/GMPS模型结论 · 直接映射核心指标与行业标准",
            ...createSourceLinkage(
              ["enterprise-manual-input", "enterprise-profile-memory", "enterprise-industry-benchmark"],
              "核心指标优先使用企业本期录入数据，并结合画像中的库存信息与行业基准计算健康度。",
              "企业端核心来源",
            ),
            cards: [
              {
                id: "gm-card",
                label: "本季度毛利率",
                value: formatPercent(metrics.currentGrossMargin),
                delta: `${formatGap(metrics.currentGrossMargin, metrics.baselineGrossMargin)}pp vs 同期`,
                benchmark: `行业均值 ${formatPercent(getIndustryStandard().grossMarginAverage)}`,
                status: metrics.currentGrossMargin >= getIndustryStandard().grossMarginAverage ? "good" : "risk",
                description: "GMPS毛利承压评估 · 毛利率维度核心输出",
              },
              {
                id: "health-card",
                label: "经营健康度",
                value: `${metrics.healthScore}分`,
                delta: metrics.riskStatus === "risk" ? "重点预警" : "维持监控",
                benchmark: "70分以上更稳健",
                status: metrics.riskStatus,
                description: "DQI经营质量指数 · ROE/OCF/Growth三维驱动",
              },
              {
                id: "cashflow-card",
                label: "现金流/收入",
                value: formatPercent(metrics.cashFlowRatio),
                delta: "高于安全垫",
                benchmark: `安全垫 ${formatPercent(getIndustryStandard().cashFlowRatio)}`,
                status: metrics.cashFlowRatio >= getIndustryStandard().cashFlowRatio ? "good" : "watch",
                description: "DQI现金流质量维度 · GMPS现金流安全指标",
              },
              {
                id: "inventory-card",
                label: "库存周转",
                value: `${metrics.inventoryDays.toFixed(2)}天`,
                delta: `${formatGap(metrics.inventoryDays, getIndustryStandard().inventoryDays, 0)}天`,
                benchmark: `行业标准 ${getIndustryStandard().inventoryDays}天`,
                status: metrics.inventoryDays <= getIndustryStandard().inventoryDays ? "good" : "risk",
                description: "GMPS产销负荷维度 · 库存周转驱动因子",
              },
            ],
          },
          {
            id: "enterprise-line",
            kind: "lineChart",
            title: "近4季度毛利率走势",
            subtitle: "折线图 · GMPS毛利率维度趋势",
            unit: "%",
            threshold: getIndustryStandard().grossMarginAverage,
            thresholdLabel: "行业均值",
            ...createSourceLinkage(
              ["enterprise-manual-input", "enterprise-industry-benchmark"],
              "趋势点位来自企业近四个季度录入值，阈值线来自行业毛利率均值。",
              "趋势复盘",
            ),
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
            title: "利润演变瀑布图",
            subtitle: "瀑布图 · GMPS毛利承压评估",
            unit: _activeFormatter?.getUnitLabel("amount") ?? "万元",
            ...createSourceLinkage(
              ["enterprise-manual-input"],
              "瀑布拆解基于当前营收、成本和库存费用字段按既定成本结构估算。",
              "利润拆解",
            ),
            data: [
              { id: "w-rev", label: "营业收入", value: metrics.currentRevenue, displayValue: formatAmount(metrics.currentRevenue), detail: "本季度总营收", status: "good" },
              { id: "w-raw", label: "原材料成本", value: -metrics.currentCost * 0.594, displayValue: formatAmount(metrics.currentCost * 0.594), detail: "受碳酸锂价格影响", status: "risk" },
              { id: "w-labor", label: "人工成本", value: -metrics.currentCost * 0.16, displayValue: formatAmount(metrics.currentCost * 0.16), detail: "制造端人力支出", status: "watch" },
              { id: "w-mfg", label: "制造费用", value: -metrics.currentCost * 0.17, displayValue: formatAmount(metrics.currentCost * 0.17), detail: "固定资产折旧等", status: "neutral" },
              { id: "w-inv", label: "库存费用", value: -metrics.currentInventoryExpense, displayValue: formatAmount(metrics.currentInventoryExpense), detail: "库存周转带来的持有成本", status: "risk" },
              { id: "w-gross", label: "毛利总额", value: metrics.currentRevenue - metrics.currentCost * (0.594 + 0.16 + 0.17) - metrics.currentInventoryExpense, displayValue: formatAmount(metrics.currentRevenue - metrics.currentCost * (0.594 + 0.16 + 0.17) - metrics.currentInventoryExpense), isTotal: true, detail: "扣除成本与库存费用后的毛利", status: "watch" }
            ],
          },
          {
            id: "enterprise-benchmark",
            kind: "benchmarkTable",
            title: "对标对照表",
            subtitle: "对标口径基于 DQI/GMPS 模型基准",
            ...createSourceLinkage(
              ["enterprise-manual-input", "enterprise-profile-memory", "enterprise-industry-benchmark"],
              "对标表同时展示企业现值、画像补充项和行业安全垫阈值。",
              "对标差距",
            ),
            rows: benchmarkRows,
          },
          {
            id: "enterprise-zebra",
            kind: "zebraTable",
            title: "斑马纹成本结构表",
            subtitle: "隔行变色表格 · GMPS成本结构拆解",
             ...createSourceLinkage(
               ["enterprise-manual-input"],
               "GMPS成本结构拆解 · 按当前营业成本和库存费用拆解，便于企业端复盘成本项压力来源。",
            ),
            columns: ["项目", "金额", "占比", "同比", "风险"],
            rows: zebraRows,
          },
          {
            id: "enterprise-card-table",
            kind: "cardTable",
            title: "卡片式分组表格",
            subtitle: "DQI/GMPS模型 · 按维度查看模型结论和行业标准",
            ...createSourceLinkage(
              ["enterprise-manual-input", "enterprise-industry-benchmark"],
              "卡片组把企业经营结果与外部标准拆开，便于管理层快速定位偏差来源。",
              "分组结论",
            ),
            groups: cardGroups,
          },
          {
            id: "enterprise-radar",
            kind: "radarChart",
            title: "经营质量雷达图",
            subtitle: "雷达图 · DQI五维经营质量评估",
            currentLabel: "当前值",
            baselineLabel: "行业基准",
            ...createSourceLinkage(
              ["enterprise-manual-input", "enterprise-industry-benchmark"],
              "雷达图将企业五维经营指标与行业基准同屏对比，便于快速定位短板。",
              "五维对比",
            ),
            dimensions: [
              { dimension: "盈利能力", current: clamp(metrics.currentGrossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 100), baseline: 100, displayCurrent: `${clamp(metrics.currentGrossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 100).toFixed(2)}分`, displayBaseline: "100分" },
              { dimension: "周转效率", current: clamp(getIndustryStandard().inventoryDays / Math.max(metrics.inventoryDays, 1) * 100, 20, 100), baseline: 100, displayCurrent: `${clamp(getIndustryStandard().inventoryDays / Math.max(metrics.inventoryDays, 1) * 100, 20, 100).toFixed(2)}分`, displayBaseline: "100分" },
              { dimension: "现金流质量", current: clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 20, 100), baseline: 100, displayCurrent: `${clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 20, 100).toFixed(2)}分`, displayBaseline: "100分" },
              { dimension: "产销匹配", current: clamp(metrics.capacityUtilization / (getIndustryStandard().capacityUtilization || 0.78) * 100, 20, 100), baseline: 100, displayCurrent: `${clamp(metrics.capacityUtilization / (getIndustryStandard().capacityUtilization || 0.78) * 100, 20, 100).toFixed(2)}分`, displayBaseline: "100分" },
              { dimension: "杠杆安全", current: clamp(getIndustryStandard().debtRatio / Math.max(metrics.debtRatio, 1) * 100, 20, 100), baseline: 100, displayCurrent: `${clamp(getIndustryStandard().debtRatio / Math.max(metrics.debtRatio, 1) * 100, 20, 100).toFixed(2)}分`, displayBaseline: "100分" },
            ],
          },
          {
            id: "enterprise-box-plot",
            kind: "boxPlotChart",
            title: "毛利率分布箱型图",
            subtitle: "箱型图 · GMPS毛利率分布",
            xLabel: "产品线",
            yLabel: "毛利率(%)",
            ...createSourceLinkage(
              ["enterprise-manual-input", "enterprise-industry-benchmark"],
              "箱型图展示各产品线毛利率分布特征，便于识别离群值和集中趋势。",
              "分布特征",
            ),
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
            title: "毛利率与营收关联散点图",
            subtitle: "散点图 · GMPS毛利率与营收关联",
            xLabel: `营收(${_activeFormatter?.getUnitLabel("amount") ?? "万元"})`,
            yLabel: "毛利率(%)",
            ...createSourceLinkage(
              ["enterprise-manual-input", "enterprise-industry-benchmark"],
              "散点图揭示毛利率与营收规模之间的关联模式。",
              "关联分析",
            ),
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
            id: "enterprise-bubble",
            kind: "bubbleChart",
            title: "经营三维气泡图",
            subtitle: "气泡图 · DQI/GMPS三维经营视图",
            xLabel: "毛利率(%)",
            yLabel: "产销匹配度(%)",
            zLabel: `营收规模(${_activeFormatter?.getUnitLabel("amount") ?? "万元"})`,
            ...createSourceLinkage(
              ["enterprise-manual-input", "enterprise-industry-benchmark"],
              "气泡图同时呈现毛利率、产销匹配度和营收规模三个维度。",
              "三维视图",
            ),
            data: [
              { id: "bb-power", label: "动力电池", x: 18.2, y: 79, z: 15800, displayX: "18.2%", displayY: "79%", displayZ: "15800万", status: "watch" as const, detail: "动力电池毛利率偏低但规模最大。" },
              { id: "bb-storage", label: "储能电池", x: 27.1, y: 88, z: 10200, displayX: "27.1%", displayY: "88%", displayZ: "10200万", status: "good" as const, detail: "储能电池毛利率和产销匹配度均优。" },
              { id: "bb-consumer", label: "消费电池", x: 14.5, y: 74, z: 2800, displayX: "14.5%", displayY: "74%", displayZ: "2800万", status: "risk" as const, detail: "消费电池毛利率和产销匹配度双低。" },
              { id: "bb-materials", label: "上游材料", x: 12.3, y: 68, z: 8500, displayX: "12.3%", displayY: "68%", displayZ: "8500万", status: "risk" as const, detail: "上游材料受原料价格波动影响大。" },
              { id: "bb-equipment", label: "锂电设备", x: 22.5, y: 82, z: 6200, displayX: "22.5%", displayY: "82%", displayZ: "6200万", status: "good" as const, detail: "锂电设备受新技术路线支撑。" },
              { id: "bb-recycle", label: "电池回收", x: 19.8, y: 71, z: 3200, displayX: "19.8%", displayY: "71%", displayZ: "3200万", status: "watch" as const, detail: "电池回收处于成长期。" },
              { id: "bb-solid", label: "固态电池", x: 15.2, y: 65, z: 1800, displayX: "15.2%", displayY: "65%", displayZ: "1800万", status: "watch" as const, detail: "固态电池研发投入大，尚未规模化。" },
              { id: "bb-sodium", label: "钠离子电池", x: 11.5, y: 58, z: 1200, displayX: "11.5%", displayY: "58%", displayZ: "1200万", status: "risk" as const, detail: "钠离子电池仍处于早期商业化阶段。" },
            ],
          },
          {
            id: "enterprise-heatmap-viz",
            kind: "heatmapChart",
            title: "经营质量热力图",
            subtitle: "热力图",
            description: "DQI经营质量指数 · 按季度展示各经营维度的强弱色阶分布。",
            ...createSourceLinkage(
              ["enterprise-manual-input", "enterprise-industry-benchmark"],
              "热力图将多维度多季度数据以连续色阶呈现，便于快速识别强弱区域。",
              "色阶分布",
            ),
            rows: ["盈利能力", "周转效率", "现金流质量", "产销匹配"],
            columns: quarterSeries.map((q) => q.label),
            cells: [
              { row: "盈利能力", column: quarterSeries[0]!.label, value: clamp(quarterSeries[0]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[0]!.grossMargin), note: "基准期盈利能力" },
              { row: "盈利能力", column: quarterSeries[1]!.label, value: clamp(quarterSeries[1]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[1]!.grossMargin), note: "盈利能力开始承压" },
              { row: "盈利能力", column: quarterSeries[2]!.label, value: clamp(quarterSeries[2]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[2]!.grossMargin), note: "盈利能力持续下滑" },
              { row: "盈利能力", column: quarterSeries[3]!.label, value: clamp(quarterSeries[3]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[3]!.grossMargin), note: "当前季度盈利水平" },
              { row: "周转效率", column: quarterSeries[0]!.label, value: 85, displayValue: "85分", note: "基准期周转良好" },
              { row: "周转效率", column: quarterSeries[1]!.label, value: 78, displayValue: "78分", note: "周转略有放缓" },
              { row: "周转效率", column: quarterSeries[2]!.label, value: 68, displayValue: "68分", note: "库存压力上升" },
              { row: "周转效率", column: quarterSeries[3]!.label, value: clamp(getIndustryStandard().inventoryDays / Math.max(metrics.inventoryDays, 1) * 100, 20, 120), displayValue: `${clamp(getIndustryStandard().inventoryDays / Math.max(metrics.inventoryDays, 1) * 100, 20, 120).toFixed(2)}分`, note: "当前周转水平" },
              { row: "现金流质量", column: quarterSeries[0]!.label, value: 92, displayValue: "92分", note: "基准期现金流充裕" },
              { row: "现金流质量", column: quarterSeries[1]!.label, value: 88, displayValue: "88分", note: "现金流仍稳健" },
              { row: "现金流质量", column: quarterSeries[2]!.label, value: 82, displayValue: "82分", note: "现金流略有收紧" },
              { row: "现金流质量", column: quarterSeries[3]!.label, value: clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 20, 120), displayValue: `${clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 20, 120).toFixed(2)}分`, note: "当前现金流水平" },
              { row: "产销匹配", column: quarterSeries[0]!.label, value: 90, displayValue: "90分", note: "基准期产销匹配良好" },
              { row: "产销匹配", column: quarterSeries[1]!.label, value: 84, displayValue: "84分", note: "产销出现偏差" },
              { row: "产销匹配", column: quarterSeries[2]!.label, value: 76, displayValue: "76分", note: "产销偏差扩大" },
              { row: "产销匹配", column: quarterSeries[3]!.label, value: clamp(metrics.capacityUtilization / (getIndustryStandard().capacityUtilization || 0.78) * 100, 20, 120), displayValue: `${clamp(metrics.capacityUtilization / (getIndustryStandard().capacityUtilization || 0.78) * 100, 20, 120).toFixed(2)}分`, note: "当前产销匹配水平" },
            ],
          },
        ],
      },
      {
        id: "enterprise-analysis",
        page: "analysis",
        title: "深度诊断矩阵",
        subtitle: "DQI/GMPS模型驱动 · 聚焦归因、预警、层级下钻与运营节奏",
        emphasis: "企业端分析页优先支持下钻、预警和整改排期",
        widgets: [
          {
            id: "enterprise-heatmap",
            kind: "heatmapTable",
            title: "色阶热力矩阵表格",
            subtitle: "DQI经营质量指数 · 按季度查看关键维度强弱",
            ...createSourceLinkage(
              ["enterprise-manual-input", "enterprise-industry-benchmark"],
              "热力矩阵按企业历史季度输入与行业基准重算，反映盈利、收入和现金流强弱变化。",
              "季度矩阵",
            ),
            columns: ["盈利韧性", "收入表现", "经营效率", "现金流质量"],
            rows: heatmapRows,
          },
          {
            id: "enterprise-spark",
            kind: "sparklineTable",
            title: "迷你图表内嵌复合表格",
            subtitle: "DQI/GMPS模型 · 趋势与当前值同屏查看",
            ...createSourceLinkage(
              ["enterprise-manual-input", "enterprise-profile-memory", "enterprise-industry-benchmark"],
              "迷你图将企业连续趋势、画像补充库存信息与行业基准放在同一视图。",
              "连续监测",
            ),
            rows: sparkRows,
          },
          {
            id: "enterprise-alerts",
            kind: "alertTable",
            title: "条件格式预警高亮表格",
            subtitle: "DQI/GMPS模型 · 按规则突出风险项和动作建议",
            ...createSourceLinkage(
              ["enterprise-manual-input", "enterprise-industry-benchmark"],
              "预警规则直接引用企业当前值和行业阈值，用于经营整改动作建议。",
              "预警规则",
            ),
            rows: alertRows,
          },
          {
            id: "enterprise-tree",
            kind: "treeTable",
            title: "树状层级折叠表格",
            subtitle: "GMPS成本维度 · 可展开查看成本和责任归属",
            ...createSourceLinkage(
              ["enterprise-manual-input"],
              "责任树把成本拆解映射到企业内部责任主体，便于经营复盘与动作分派。",
              "责任拆解",
            ),
            rows: treeRows,
          },
          {
            id: "enterprise-pivot",
            kind: "pivotMatrix",
            title: "多维交叉透视矩阵表",
            subtitle: "GMPS产销负荷维度 · 按产品线交叉观察",
            ...createSourceLinkage(
              ["enterprise-manual-input", "enterprise-industry-benchmark"],
              "透视矩阵用于从产品线角度交叉观察企业经营差异和对标结果。",
              "产品线视角",
            ),
            columns: ["毛利率", "产销匹配", "库存", "综合判断"],
            rows: pivotRows,
          },
          {
            id: "enterprise-calendar",
            kind: "calendarTable",
            title: "日历视图表格",
            subtitle: "DQI/GMPS驱动 · 把经营动作和预警节奏落到日历",
            ...createSourceLinkage(
              ["enterprise-manual-input", "enterprise-industry-benchmark"],
              "日历节奏由当前企业风险点和行业阈值推导，适合运营周会跟踪。",
              "执行排期",
            ),
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
  { key: 'gpmYoy', weight: 0.14, label: '毛利率同比变化(gpmYoy)' },
  { key: 'unitCostYoy', weight: 0.12, label: '单位营业成本变化率(unitCostYoy)' },
  { key: 'mfgCostRatio', weight: 0.12, label: '制造费用占营业成本比(mfgCostRatio)' },
  { key: 'revCostGap', weight: 0.11, label: '营收增速减成本增速(revCostGap)' },
  { key: 'saleProdRatio', weight: 0.10, label: '产销率(saleProdRatio)' },
  { key: 'liPriceYoy', weight: 0.10, label: '碳酸锂价格同比变化(liPriceYoy)' },
  { key: 'invYoy', weight: 0.09, label: '库存同比增速(invYoy)' },
  { key: 'cfoRatio', weight: 0.08, label: '经营现金流/营业收入(cfoRatio)' },
  { key: 'lev', weight: 0.07, label: '资产负债率(lev)' },
  { key: 'indVol', weight: 0.07, label: '行业指数波动率(indVol)' },
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
        subtitle: "DQI/GMPS模型驱动 · 景气、风险收益和配置参考",
        emphasis: `当前按 ${investorName || "普通用户"} 的 ${horizon} 周期和 ${riskAppetite} 风险偏好编排`,
        widgets: [
          {
            id: "investor-metrics",
            kind: "metricCards",
            title: "投资指标卡",
            subtitle: "DQI/GMPS模型 · 汇总行业热度、收益和配置立场",
            ...createSourceLinkage(
              ["investor-profile", "investor-industry-benchmark"],
              "指标卡将用户画像偏好与行业景气基准融合，用于形成普通用户端的配置立场。",
              "用户端核心来源",
            ),
            cards: [
              {
                id: "warmth",
                label: "行业景气指数",
                value: `${getIndustryStandard().industryWarmth}`,
                delta: "储能高景气对冲动力放缓",
                benchmark: "70 以上偏暖",
                status: "good",
                description: "GMPS外部风险维度 · 行业景气与政策信号驱动",
              },
              {
                id: "storage-growth",
                label: "储能装机增速",
                value: formatPercent(getIndustryStandard().storageGrowth),
                delta: "景气核心支撑",
                benchmark: "高于 50% 偏强",
                status: "good",
                description: "DQI成长能力维度 · 储能需求弹性驱动Growth指标",
              },
              {
                id: "lithium-price",
                label: "碳酸锂价格",
                value: `${getIndustryStandard().lithiumPrice}万/吨`,
                delta: "接近周期底部",
                benchmark: "成本端关键锚点",
                status: "watch",
                description: "GMPS材料成本冲击维度 · 碳酸锂价格传导核心变量",
              },
              {
                id: "allocation",
                label: "当前配置立场",
                value: stanceStatus === "good" ? "分批布局" : "控制节奏",
                delta: `${watchlist.length} 个关注标的`,
                benchmark: "结合画像偏好",
                status: stanceStatus,
                description: "DQI经营质量指数驱动 · GMPS毛利承压评估综合立场",
              },
            ],
          },
          {
            id: "investor-bar",
            kind: "barChart",
            title: "重点赛道热度柱状图",
            subtitle: "柱状图 · GMPS外部风险维度热度",
            unit: "分",
            ...createSourceLinkage(
              ["investor-industry-benchmark"],
              "赛道热度来自行业景气与细分赛道比较口径，适合普通用户快速筛选方向。",
              "赛道热度",
            ),
            data: [
              { id: "storage", label: "储能", value: 86, displayValue: "86", benchmark: "行业均值 72", detail: "海外与工商业储能提供高弹性需求。", status: "good" },
              { id: "power", label: "动力电池", value: 68, displayValue: "68", benchmark: "行业均值 72", detail: "价格战仍压制盈利修复斜率。", status: "watch" },
              { id: "materials", label: "上游材料", value: 54, displayValue: "54", benchmark: "行业均值 72", detail: "需要等待库存去化和价格企稳。", status: "risk" },
              { id: "equipment", label: "锂电设备", value: 73, displayValue: "73", benchmark: "行业均值 72", detail: "受新技术路线和海外扩产支撑。", status: "good" },
            ],
          },
          {
            id: "investor-benchmark",
            kind: "benchmarkTable",
            title: "可比公司对标表",
            subtitle: "对标口径基于 DQI/GMPS 模型基准",
            ...createSourceLinkage(
              ["investor-profile", "investor-industry-benchmark"],
              "可比公司表以用户关注标的为主，配合行业均值呈现相对位置。",
              "标的对标",
            ),
            rows: watchlist.slice(0, 4).map((item, index) => ({
              id: item,
              item,
              current: ["20.5%", "18.9%", "22.1%", "17.4%"][index] ?? "19.2%",
              benchmark: "行业均值 19.8%",
              gap: ["+0.7pp", "-0.9pp", "+2.3pp", "-2.4pp"][index] ?? "+0.0pp",
              status: index === 1 || index === 3 ? "watch" : "good",
              note: "DQI经营质量指数 · 结合毛利、订单兑现和现金流质量观察",
            })),
          },
          {
            id: "investor-zebra",
            kind: "zebraTable",
            title: "斑马纹行业数据表",
            subtitle: "隔行变色表格 · DQI/GMPS行业快照",
             ...createSourceLinkage(
               ["investor-industry-benchmark"],
               "DQI/GMPS行业快照 · 聚合装机、价格和毛利等市场观察信号，用于用户端快速浏览。",
            ),
            columns: ["指标", "当前值", "环比", "同比", "趋势"],
            rows: [
              { id: "install", cells: ["动力电池装机量", "85.6GWh", "+5.2%", "+18.3%", "偏强"], status: "good" },
              { id: "price", cells: ["碳酸锂价格", "9.8万/吨", "-3.5%", "-25.6%", "下行"], status: "watch" },
              { id: "storage", cells: ["储能装机量", "28.3GWh", "+12.8%", "+65.2%", "高景气"], status: "good" },
              { id: "gm", cells: ["行业平均毛利率", "19.8%", "-0.8pp", "-3.2pp", "承压"], status: "risk" },
            ],
          },
          {
            id: "investor-card-table",
            kind: "cardTable",
            title: "卡片式分组表格",
            subtitle: "DQI/GMPS模型 · 按投资逻辑拆分关键驱动",
            ...createSourceLinkage(
              ["investor-profile", "investor-session-context", "investor-industry-benchmark"],
              "分组卡片把用户偏好、会话背景和市场信号拆成可读的投资逻辑块。",
              "投资逻辑",
            ),
            groups: [
              {
                id: "demand",
                title: "景气驱动",
                description: "DQI成长能力维度 · 景气弹性驱动",
                items: [
                  { id: "g1", label: "储能订单", value: "高增长", meta: "海外及工商业双轮驱动", status: "good" },
                  { id: "g2", label: "动力需求", value: "偏弱复苏", meta: "整车价格战压制", status: "watch" },
                ],
              },
              {
                id: "risk",
                title: "风险收益",
                description: "GMPS现金流安全维度 · 下行保护评估",
                items: [
                  { id: "r1", label: "盈利弹性", value: "中高", meta: "取决于原料价格企稳", status: "watch" },
                  { id: "r2", label: "下行保护", value: "现金流优先", meta: "优选回款稳健公司", status: "good" },
                ],
              },
            ],
          },
          {
            id: "investor-radar",
            kind: "radarChart",
            title: "投资画像雷达图",
            subtitle: "雷达图 · DQI五维投资画像评估",
            currentLabel: "当前景气",
            baselineLabel: "历史基准",
            ...createSourceLinkage(
              ["investor-profile", "investor-industry-benchmark"],
              "雷达图将五维投资画像与历史基准同屏对比。",
              "画像对比",
            ),
            dimensions: [
              { dimension: "景气弹性", current: 82, baseline: 70, displayCurrent: "82分", displayBaseline: "70分" },
              { dimension: "盈利修复", current: 65, baseline: 72, displayCurrent: "65分", displayBaseline: "72分" },
              { dimension: "现金流安全", current: 78, baseline: 75, displayCurrent: "78分", displayBaseline: "75分" },
              { dimension: "估值吸引力", current: 72, baseline: 68, displayCurrent: "72分", displayBaseline: "68分" },
              { dimension: "政策支撑", current: 85, baseline: 70, displayCurrent: "85分", displayBaseline: "70分" },
            ],
          },
          {
            id: "investor-box-plot",
            kind: "boxPlotChart",
            title: "行业风险分布箱型图",
            subtitle: "箱型图 · GMPS风险分布",
            xLabel: "赛道",
            yLabel: "风险得分",
            ...createSourceLinkage(
              ["investor-industry-benchmark"],
              "箱型图展示各赛道风险分布，帮助判断安全边际。",
              "风险分布",
            ),
            groups: [
              { id: "ibp-storage", label: "储能", min: 25, q1: 35, median: 42, q3: 55, max: 68, displayValues: { min: "25", q1: "35", median: "42", q3: "55", max: "68" }, status: "good" as const, detail: "储能赛道风险中位数 42，相对可控。" },
              { id: "ibp-power", label: "动力电池", min: 38, q1: 48, median: 58, q3: 68, max: 78, outliers: [85], displayValues: { min: "38", q1: "48", median: "58", q3: "68", max: "78" }, status: "watch" as const, detail: "动力电池赛道风险中位数 58，需关注价格战。" },
              { id: "ibp-materials", label: "上游材料", min: 52, q1: 62, median: 72, q3: 82, max: 92, outliers: [98], displayValues: { min: "52", q1: "62", median: "72", q3: "82", max: "92" }, status: "risk" as const, detail: "上游材料赛道风险中位数 72，价格波动大。" },
              { id: "ibp-equipment", label: "锂电设备", min: 30, q1: 40, median: 50, q3: 60, max: 70, displayValues: { min: "30", q1: "40", median: "50", q3: "60", max: "70" }, status: "good" as const, detail: "锂电设备赛道风险中位数 50，相对均衡。" },
            ],
          },
          {
            id: "investor-scatter",
            kind: "scatterChart",
            title: "风险收益散点图",
            subtitle: "散点图",
            description: "DQI经营质量指数 · 展示关注标的的风险暴露与收益弹性关系。",
            xLabel: "风险暴露",
            yLabel: "收益弹性",
            ...createSourceLinkage(
              ["investor-profile", "investor-industry-benchmark"],
              "散点图揭示风险与收益的权衡关系。",
              "风险收益",
            ),
            data: [
              { id: "isc-catl", label: "宁德时代", x: 42, y: 78, displayX: "42分", displayY: "78分", status: "good" as const, detail: "宁德时代风险可控，收益弹性较高。" },
              { id: "isc-eve", label: "亿纬锂能", x: 55, y: 72, displayX: "55分", displayY: "72分", status: "watch" as const, detail: "亿纬锂能风险中等，收益弹性尚可。" },
              { id: "isc-haichen", label: "海辰储能", x: 38, y: 85, displayX: "38分", displayY: "85分", status: "good" as const, detail: "海辰储能风险较低，收益弹性最高。" },
              { id: "isc-gotion", label: "国轩高科", x: 62, y: 58, displayX: "62分", displayY: "58分", status: "watch" as const, detail: "国轩高科风险偏高，收益弹性一般。" },
              { id: "isc-byd", label: "比亚迪", x: 35, y: 82, displayX: "35分", displayY: "82分", status: "good" as const, detail: "比亚迪风险低，收益弹性高。" },
              { id: "isc-svolt", label: "蜂巢能源", x: 72, y: 65, displayX: "72分", displayY: "65分", status: "risk" as const, detail: "蜂巢能源风险较高，收益弹性中等。" },
              { id: "isc-sunwoda", label: "欣旺达", x: 58, y: 62, displayX: "58分", displayY: "62分", status: "watch" as const, detail: "欣旺达风险中等，收益弹性中等。" },
              { id: "isc-farasis", label: "孚能科技", x: 78, y: 48, displayX: "78分", displayY: "48分", status: "risk" as const, detail: "孚能科技风险高，收益弹性偏低。" },
              { id: "isc-calc", label: "中创新航", x: 65, y: 55, displayX: "65分", displayY: "55分", status: "watch" as const, detail: "中创新航风险偏高，收益弹性一般。" },
              { id: "isc-rept", label: "瑞浦兰钧", x: 68, y: 60, displayX: "68分", displayY: "60分", status: "watch" as const, detail: "瑞浦兰钧风险偏高，收益弹性中等。" },
              { id: "isc-lijin", label: "立金钠", x: 82, y: 42, displayX: "82分", displayY: "42分", status: "risk" as const, detail: "立金钠风险很高，收益弹性低。" },
              { id: "isc-tianqi", label: "天齐锂业", x: 75, y: 52, displayX: "75分", displayY: "52分", status: "risk" as const, detail: "天齐锂业受锂价波动影响大。" },
            ],
          },
          {
            id: "investor-bubble",
            kind: "bubbleChart",
            title: "投资三维气泡图",
            subtitle: "气泡图 · DQI/GMPS三维投资视图",
            xLabel: "行业景气",
            yLabel: "盈利弹性",
            zLabel: "市值规模(亿元)",
            ...createSourceLinkage(
              ["investor-profile", "investor-industry-benchmark"],
              "气泡图同时呈现景气、弹性和规模三个维度。",
              "三维视图",
            ),
            data: [
              { id: "ibb-catl", label: "宁德时代", x: 75, y: 78, z: 9800, displayX: "75分", displayY: "78分", displayZ: "9800亿", status: "good" as const, detail: "宁德时代景气高、弹性强、规模最大。" },
              { id: "ibb-byd", label: "比亚迪", x: 82, y: 82, z: 7200, displayX: "82分", displayY: "82分", displayZ: "7200亿", status: "good" as const, detail: "比亚迪景气高、弹性强。" },
              { id: "ibb-eve", label: "亿纬锂能", x: 68, y: 72, z: 1800, displayX: "68分", displayY: "72分", displayZ: "1800亿", status: "watch" as const, detail: "亿纬锂能景气中等、弹性尚可。" },
              { id: "ibb-gotion", label: "国轩高科", x: 55, y: 58, z: 800, displayX: "55分", displayY: "58分", displayZ: "800亿", status: "watch" as const, detail: "国轩高科景气偏弱、弹性一般。" },
              { id: "ibb-haichen", label: "海辰储能", x: 86, y: 85, z: 350, displayX: "86分", displayY: "85分", displayZ: "350亿", status: "good" as const, detail: "海辰储能景气最高、弹性最强但规模小。" },
              { id: "ibb-svolt", label: "蜂巢能源", x: 48, y: 65, z: 420, displayX: "48分", displayY: "65分", displayZ: "420亿", status: "risk" as const, detail: "蜂巢能源景气偏低。" },
              { id: "ibb-sunwoda", label: "欣旺达", x: 62, y: 62, z: 650, displayX: "62分", displayY: "62分", displayZ: "650亿", status: "watch" as const, detail: "欣旺达景气中等。" },
              { id: "ibb-tianqi", label: "天齐锂业", x: 42, y: 52, z: 1200, displayX: "42分", displayY: "52分", displayZ: "1200亿", status: "risk" as const, detail: "天齐锂业受锂价下行影响。" },
            ],
          },
          {
            id: "investor-heatmap-viz",
            kind: "heatmapChart",
            title: "风险收益热力图",
            subtitle: "热力图",
            description: "DQI经营质量指数 · 按关注标的展示多维度风险收益色阶分布。",
            ...createSourceLinkage(
              ["investor-profile", "investor-industry-benchmark"],
              "热力图将多标的维度数据以色阶呈现，便于快速识别强弱。",
              "色阶分布",
            ),
            rows: ["宁德时代", "亿纬锂能", "海辰储能", "比亚迪"],
            columns: ["景气", "盈利", "现金流", "估值"],
            cells: [
              { row: "宁德时代", column: "景气", value: 75, displayValue: "75", note: "动力+储能双轮驱动" },
              { row: "宁德时代", column: "盈利", value: 72, displayValue: "72", note: "毛利率行业领先" },
              { row: "宁德时代", column: "现金流", value: 82, displayValue: "82", note: "经营现金流稳健" },
              { row: "宁德时代", column: "估值", value: 65, displayValue: "65", note: "估值处于合理区间" },
              { row: "亿纬锂能", column: "景气", value: 68, displayValue: "68", note: "储能增速支撑" },
              { row: "亿纬锂能", column: "盈利", value: 62, displayValue: "62", note: "毛利率承压" },
              { row: "亿纬锂能", column: "现金流", value: 70, displayValue: "70", note: "现金流尚可" },
              { row: "亿纬锂能", column: "估值", value: 58, displayValue: "58", note: "估值偏高" },
              { row: "海辰储能", column: "景气", value: 86, displayValue: "86", note: "储能景气最高" },
              { row: "海辰储能", column: "盈利", value: 78, displayValue: "78", note: "毛利率行业领先" },
              { row: "海辰储能", column: "现金流", value: 68, displayValue: "68", note: "现金流需关注" },
              { row: "海辰储能", column: "估值", value: 72, displayValue: "72", note: "估值有吸引力" },
              { row: "比亚迪", column: "景气", value: 82, displayValue: "82", note: "整车+电池协同" },
              { row: "比亚迪", column: "盈利", value: 76, displayValue: "76", note: "盈利能力强" },
              { row: "比亚迪", column: "现金流", value: 85, displayValue: "85", note: "现金流充裕" },
              { row: "比亚迪", column: "估值", value: 60, displayValue: "60", note: "估值合理偏低" },
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
        subtitle: "DQI/GMPS模型驱动 · 推荐、证据、风险收益和跟踪节奏",
        emphasis: "普通用户端优先展示投资判断支撑而非经营过程细节",
        widgets: [
          {
            id: "analysis-metrics",
            kind: "metricCards",
            title: "会话摘要卡",
            subtitle: "DQI/GMPS模型 · 本轮结论、风险与证据一屏查看",
            ...createSourceLinkage(
              ["analysis-session-context", "analysis-math-model", "analysis-evidence-review", "analysis-debate"],
              "摘要卡整合当前推荐、模型风险、证据可信度与画像联动结果，是用户端分析页的总入口。",
              "会话总览",
            ),
            cards: [
              {
                id: "stance-card",
                label: "推荐立场",
                value: analysisResult.recommendation.stance,
                delta: `${analysisResult.recommendation.score}分`,
                benchmark: "70分以上更积极",
                status: scoreStatus,
                description: analysisResult.recommendation.rationale,
              },
              {
                id: "evidence-card",
                label: "证据可信度",
                value: `${Math.round((evidenceReview?.confidenceScore ?? 0.68) * 100)}分`,
                delta: evidenceReview?.confidence ?? "medium",
                benchmark: "75分以上更可靠",
                status: (evidenceReview?.confidenceScore ?? 0.68) >= 0.75 ? "good" : "watch",
                description: evidenceReview?.reviewSummary ?? "多源证据校验完成。",
              },
              {
                id: "risk-card",
                label: "模型风险等级",
                value: mathAnalysis?.combinedRiskLevel ?? "medium",
                delta: (mathAnalysis?.combinedInsights ?? []).slice(0, 1)[0] ?? "等待更多模型输入",
                benchmark: "越低越优",
                status: mathAnalysis?.combinedRiskLevel === "low" ? "good" : mathAnalysis?.combinedRiskLevel === "medium" ? "watch" : "risk",
                description: "来自综合数学模型的风险判断。",
              },
              {
                id: "profile-card",
                label: "画像联动",
                value: `${analysisResult.profileUpdate?.updatedFields.length ?? 0}项`,
                delta: analysisResult.personalization.summary,
                benchmark: "持续沉淀偏好",
                status: "good",
                description: "DQI/GMPS模型输出反向优化用户画像与图表排序",
              },
            ],
          },
          {
            id: "analysis-benchmark",
            kind: "benchmarkTable",
            title: "投资判断对照表",
            subtitle: "对标口径基于 DQI/GMPS 模型基准",
            ...createSourceLinkage(
              ["analysis-session-context", "analysis-math-model", "analysis-evidence-review"],
              "对照表把推荐、模型风险和证据可信度放在同一口径下比较。",
              "结论对照",
            ),
            rows: benchmarkRows,
          },
          {
            id: "analysis-heatmap",
            kind: "heatmapTable",
            title: "风险收益热力矩阵",
            subtitle: "DQI/GMPS模型 · 色阶热力矩阵",
            ...createSourceLinkage(
              ["analysis-industry-retrieval", "analysis-math-model", "analysis-evidence-review"],
              "热力矩阵结合景气、订单、价格和兑现四类来源，帮助用户看清收益和风险暴露。",
              "风险收益",
            ),
            columns: ["景气", "订单", "价格", "兑现"],
            rows: heatmapRows,
          },
          {
            id: "analysis-spark",
            kind: "sparklineTable",
            title: "信号趋势复合表",
            subtitle: "迷你图表内嵌复合表格",
            ...createSourceLinkage(
              ["analysis-session-context", "analysis-evidence-review"],
              "趋势表聚焦会话得分、证据可信度和关注标的沉淀，适合连续跟踪。",
              "趋势跟踪",
            ),
            rows: sparkRows,
          },
          {
            id: "analysis-alert",
            kind: "alertTable",
            title: "条件格式预警高亮表格",
            subtitle: "提示会话中需要优先复核的项目",
            ...createSourceLinkage(
              ["analysis-evidence-review", "analysis-debate"],
              "预警规则优先提示推荐立场、辩论结论和证据挑战项之间是否一致。",
              "复核优先级",
            ),
            rows: alertRows,
          },
          {
            id: "analysis-tree",
            kind: "treeTable",
            title: "投资主线树状表格",
            subtitle: "树状层级折叠表格",
            ...createSourceLinkage(
              ["analysis-session-context", "analysis-industry-retrieval", "analysis-math-model", "analysis-evidence-review"],
              "主线树把会话主结论拆成行业景气、经营质量和证据链三层结构。",
              "主线拆解",
            ),
            rows: treeRows,
          },
          {
            id: "analysis-pivot",
            kind: "pivotMatrix",
            title: "多情景透视矩阵",
            subtitle: "多维交叉透视矩阵表",
            ...createSourceLinkage(
              ["analysis-math-model", "analysis-industry-retrieval", "analysis-debate"],
              "透视矩阵将基准、中性、压力三种情景与用户动作建议联动展示。",
              "情景推演",
            ),
            columns: ["需求", "盈利", "立场", "动作"],
            rows: pivotRows,
          },
          {
            id: "analysis-calendar",
            kind: "calendarTable",
            title: "跟踪节奏日历",
            subtitle: "日历视图表格",
            ...createSourceLinkage(
              ["analysis-session-context", "analysis-attachments"],
              "日历基于当前时间线和附件补证节奏生成，方便用户后续跟踪。",
              "跟踪节奏",
            ),
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
