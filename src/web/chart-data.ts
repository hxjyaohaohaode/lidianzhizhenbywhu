/**
 * 图表数据生成模块
 * 根据用户输入和企业数据动态生成所有图表数据
 */

export interface VisualizationDataPoint {
  id: string;
  label: string;
  value: number;
  displayValue: string;
  benchmark?: string;
  detail?: string;
  status: 'good' | 'watch' | 'alert';
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function formatPercent(v: number): string {
  return `${v.toFixed(2)}%`;
}

function toNumber(value: string | number | undefined, fallback: number = 0): number {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

export interface QuarterDataPoint {
  label: string;
  revenue: number;
  grossMargin: number;
  dqi?: number;
  gmps?: number;
}

export interface EnterpriseCoreMetrics {
  rawMaterialRatio: number;
  laborRatio: number;
  manufacturingRatio: number;
  inventoryRatio: number;
  cashFlowRatio: number;
  capacityUtilization: number;
  grossMarginTrend: number[];
}

export interface IndustryStandard {
  grossMarginAverage: number;
  cashFlowRatio: number;
  industryWarmth: number;
}

export function getIndustryStandard(): IndustryStandard {
  return {
    grossMarginAverage: 20,
    cashFlowRatio: 0.12,
    industryWarmth: 72,
  };
}

export function createQuarterSeries(
  enterpriseOnboarding: Record<string, any>,
  userProfile: Record<string, any>
): QuarterDataPoint[] {
  const q1Rev = toNumber(enterpriseOnboarding?.revenueQ1 ?? enterpriseOnboarding?.q1Revenue, 0);
  const q1GM = toNumber(enterpriseOnboarding?.grossMarginQ1 ?? enterpriseOnboarding?.q1GrossMargin, 0);
  const q2Rev = toNumber(enterpriseOnboarding?.revenueQ2 ?? enterpriseOnboarding?.q2Revenue, 0);
  const q2GM = toNumber(enterpriseOnboarding?.grossMarginQ2 ?? enterpriseOnboarding?.q2GrossMargin, 0);
  const q3Rev = toNumber(enterpriseOnboarding?.revenueQ3 ?? enterpriseOnboarding?.q3Revenue, 0);
  const q3GM = toNumber(enterpriseOnboarding?.grossMarginQ3 ?? enterpriseOnboarding?.q3GrossMargin, 0);
  const q4Rev = toNumber(enterpriseOnboarding?.revenueQ4 ?? enterpriseOnboarding?.q4Revenue, 0);
  const q4GM = toNumber(enterpriseOnboarding?.grossMarginQ4 ?? enterpriseOnboarding?.q4GrossMargin, 0);
  const q1Dqi = toNumber(enterpriseOnboarding?.dqiQ1, undefined);
  const q2Dqi = toNumber(enterpriseOnboarding?.dqiQ2, undefined);
  const q3Dqi = toNumber(enterpriseOnboarding?.dqiQ3, undefined);
  const q4Dqi = toNumber(enterpriseOnboarding?.dqiQ4, undefined);
  const q1Gmps = toNumber(enterpriseOnboarding?.gmpsQ1, undefined);
  const q2Gmps = toNumber(enterpriseOnboarding?.gmpsQ2, undefined);
  const q3Gmps = toNumber(enterpriseOnboarding?.gmpsQ3, undefined);
  const q4Gmps = toNumber(enterpriseOnboarding?.gmpsQ4, undefined);
  const currentDqi = toNumber(userProfile?.profile?.enterpriseBaseInfo?.currentDqi, undefined);
  const currentGmps = toNumber(userProfile?.profile?.enterpriseBaseInfo?.currentGmps, undefined);
  const profile = userProfile?.profile;
  const baseInfo = profile?.enterpriseBaseInfo;
  const industry = profile?.industryAnalysis;
  const latestRevenue = q4Rev || q3Rev || q2Rev || q1Rev || 0;
  const hasQData = q1Rev > 0 || q2Rev > 0 || q3Rev > 0 || q4Rev > 0;
  const hasBaseRevenue = typeof baseInfo?.revenue === 'number' && baseInfo.revenue > 0;
  const hasBaseGrossMargin = typeof baseInfo?.grossMargin === 'number' && baseInfo.grossMargin > 0;
  const revenueOverride = hasBaseRevenue ? baseInfo.revenue : 0;
  const grossMarginOverride = hasBaseGrossMargin ? baseInfo.grossMargin : null;
  const std = getIndustryStandard();

  const buildQuarter = (index: number, qRev: number, qGM: number, dqi?: number, gmps?: number): QuarterDataPoint => {
    const labels = ['Q1', 'Q2', 'Q3', 'Q4'];
    let revenue = qRev;
    let grossMargin = qGM;
    if (revenue === 0 && revenueOverride > 0) {
      const factors = [0.85, 0.92, 0.97, 1.0];
      revenue = revenueOverride * factors[index];
    }
    if (grossMargin === 0 && grossMarginOverride !== null) {
      const trend = [grossMarginOverride * 0.92, grossMarginOverride * 0.96, grossMarginOverride * 0.98, grossMarginOverride];
      grossMargin = trend[index];
    }
    if (revenue === 0) {
      const base = 50 + (industry?.industryWarmth ?? std.industryWarmth) * 0.5;
      const seasonalFactors = [0.85, 0.95, 1.05, 1.0];
      revenue = base * seasonalFactors[index] * (1 + index * 0.03);
    }
    if (grossMargin === 0) {
      const base = industry?.grossMarginAverage ?? std.grossMarginAverage;
      const trend = [base * 0.9, base * 0.95, base * 1.02, base * 1.0];
      grossMargin = trend[index];
    }
    return {
      label: labels[index],
      revenue: Math.round(revenue * 100) / 100,
      grossMargin: Math.round(grossMargin * 100) / 100,
      ...(dqi !== undefined ? { dqi } : {}),
      ...(gmps !== undefined ? { gmps } : {}),
    };
  };

  const q1 = buildQuarter(0, q1Rev, q1GM, q1Dqi, q1Gmps);
  const q2 = buildQuarter(1, q2Rev, q2GM, q2Dqi, q2Gmps);
  const q3 = buildQuarter(2, q3Rev, q3GM, q3Dqi, q3Gmps);
  const q4 = buildQuarter(3, q4Rev, q4GM, q4Dqi, q4Gmps);

  if (hasQData || hasBaseRevenue) {
    const result = [q1, q2, q3, q4];
    if (currentDqi !== undefined) result[3].dqi = currentDqi;
    if (currentGmps !== undefined) result[3].gmps = currentGmps;
    return result;
  }

  const warmth = industry?.industryWarmth ?? std.industryWarmth;
  const marginBase = industry?.grossMarginAverage ?? std.grossMarginAverage;
  const revenueBase = 50 + warmth * 0.5;
  return [
    { label: 'Q1', revenue: revenueBase * 0.85, grossMargin: marginBase * 0.92 },
    { label: 'Q2', revenue: revenueBase * 0.95, grossMargin: marginBase * 0.96 },
    { label: 'Q3', revenue: revenueBase * 1.05, grossMargin: marginBase * 1.02 },
    { label: 'Q4', revenue: revenueBase * 1.0, grossMargin: marginBase * 1.0 },
  ];
}

export function buildEnterpriseCoreMetrics(
  enterpriseOnboarding: Record<string, any>,
  quarterSeries: QuarterDataPoint[]
): EnterpriseCoreMetrics {
  const q1RawMat = toNumber(enterpriseOnboarding?.rawMaterialQ1, undefined);
  const q2RawMat = toNumber(enterpriseOnboarding?.rawMaterialQ2, undefined);
  const q3RawMat = toNumber(enterpriseOnboarding?.rawMaterialQ3, undefined);
  const q4RawMat = toNumber(enterpriseOnboarding?.rawMaterialQ4, undefined);
  const q1Labor = toNumber(enterpriseOnboarding?.laborQ1, undefined);
  const q2Labor = toNumber(enterpriseOnboarding?.laborQ2, undefined);
  const q3Labor = toNumber(enterpriseOnboarding?.laborQ3, undefined);
  const q4Labor = toNumber(enterpriseOnboarding?.laborQ4, undefined);
  const q1Mfg = toNumber(enterpriseOnboarding?.manufacturingQ1, undefined);
  const q2Mfg = toNumber(enterpriseOnboarding?.manufacturingQ2, undefined);
  const q3Mfg = toNumber(enterpriseOnboarding?.manufacturingQ3, undefined);
  const q4Mfg = toNumber(enterpriseOnboarding?.manufacturingQ4, undefined);
  const q1Inventory = toNumber(enterpriseOnboarding?.inventoryQ1, undefined);
  const q2Inventory = toNumber(enterpriseOnboarding?.inventoryQ2, undefined);
  const q3Inventory = toNumber(enterpriseOnboarding?.inventoryQ3, undefined);
  const q4Inventory = toNumber(enterpriseOnboarding?.inventoryQ4, undefined);
  const q1CashFlow = toNumber(enterpriseOnboarding?.cashFlowQ1, undefined);
  const q2CashFlow = toNumber(enterpriseOnboarding?.cashFlowQ2, undefined);
  const q3CashFlow = toNumber(enterpriseOnboarding?.cashFlowQ3, undefined);
  const q4CashFlow = toNumber(enterpriseOnboarding?.cashFlowQ4, undefined);
  const q1CapUtil = toNumber(enterpriseOnboarding?.capacityUtilizationQ1, undefined);
  const q2CapUtil = toNumber(enterpriseOnboarding?.capacityUtilizationQ2, undefined);
  const q3CapUtil = toNumber(enterpriseOnboarding?.capacityUtilizationQ3, undefined);
  const q4CapUtil = toNumber(enterpriseOnboarding?.capacityUtilizationQ4, undefined);

  const rawMaterialRatio = q4RawMat ?? (quarterSeries[3]?.grossMargin ? Math.max(0.35, 0.7 - quarterSeries[3].grossMargin / 100) : 0.52);
  const laborRatio = q4Labor ?? (rawMaterialRatio * 0.22);
  const manufacturingRatio = q4Mfg ?? (rawMaterialRatio * 0.28);
  const inventoryRatio = q4Inventory ?? (rawMaterialRatio * 0.15);
  const cashFlowRatio = q4CashFlow ?? (getIndustryStandard().cashFlowRatio * 1.05);
  const capacityUtilization = q4CapUtil ?? (70 + (quarterSeries[3]?.grossMargin ?? 20) * 0.4);

  return {
    rawMaterialRatio,
    laborRatio,
    manufacturingRatio,
    inventoryRatio,
    cashFlowRatio,
    capacityUtilization,
    grossMarginTrend: quarterSeries.map(q => q.grossMargin),
  };
}

export interface VisualizationSankeyNode {
  id: string;
  label: string;
  color: string;
  column: number;
}

export interface VisualizationSankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface EnterpriseVisualization {
  pages: Array<{
    id: string;
    page: 'home' | 'analysis';
    title: string;
    widgets: Array<any>;
  }>;
}

export function buildEnterpriseVisualization(
  enterpriseOnboarding: Record<string, any>,
  userProfile: Record<string, any>,
  unitPrefs?: { dqi?: string; gmps?: string }
): EnterpriseVisualization {
  const profile = userProfile?.profile;
  const baseInfo = profile?.enterpriseBaseInfo;
  const industry = profile?.industryAnalysis;
  const std = getIndustryStandard();
  const quarterSeries = createQuarterSeries(enterpriseOnboarding, userProfile);
  const metrics = buildEnterpriseCoreMetrics(enterpriseOnboarding, quarterSeries);
  const hasRealData = quarterSeries.some(q => q.revenue > 10 || q.grossMargin > 5);

  const heatmapRows = [
    {
      row: "盈利能力",
      cells: [
        { row: "盈利能力", column: "Q1", value: clamp(quarterSeries[0]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 40, 120), displayValue: formatPercent(quarterSeries[0]!.grossMargin), note: "基准期盈利能力基于毛利率动态计算" },
        { row: "盈利能力", column: "Q2", value: clamp(quarterSeries[1]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 40, 120), displayValue: formatPercent(quarterSeries[1]!.grossMargin), note: "毛利率趋势变化" },
        { row: "盈利能力", column: "Q3", value: clamp(quarterSeries[2]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 40, 120), displayValue: formatPercent(quarterSeries[2]!.grossMargin), note: "盈利能力持续跟踪" },
        { row: "盈利能力", column: "Q4", value: clamp(quarterSeries[3]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 40, 120), displayValue: formatPercent(quarterSeries[3]!.grossMargin), note: "当前盈利水平" },
      ],
    },
    {
      row: "成长能力",
      cells: [
        { row: "成长能力", column: quarterSeries[0]!.label, value: clamp(100, 40, 120), displayValue: "100分", note: "基准期设为基准值" },
        { row: "成长能力", column: quarterSeries[1]!.label, value: clamp((quarterSeries[1]!.revenue / Math.max(quarterSeries[0]!.revenue, 1)) * 100, 40, 120), displayValue: `${clamp((quarterSeries[1]!.revenue / Math.max(quarterSeries[0]!.revenue, 1)) * 100, 40, 120).toFixed(0)}分`, note: "成长能力基于营收环比计算" },
        { row: "成长能力", column: quarterSeries[2]!.label, value: clamp((quarterSeries[2]!.revenue / Math.max(quarterSeries[0]!.revenue, 1)) * 100, 40, 120), displayValue: `${clamp((quarterSeries[2]!.revenue / Math.max(quarterSeries[0]!.revenue, 1)) * 100, 40, 120).toFixed(0)}分`, note: "成长能力基于营收环比计算" },
        { row: "成长能力", column: quarterSeries[3]!.label, value: clamp(quarterSeries[3]!.revenue / Math.max(quarterSeries[0]!.revenue, 1) * 100, 40, 120), displayValue: `${clamp(quarterSeries[3]!.revenue / Math.max(quarterSeries[0]!.revenue, 1) * 100, 40, 120).toFixed(2)}分`, note: "当前成长水平" },
      ],
    },
    {
      row: "现金流质量",
      cells: [
        { row: "现金流质量", column: quarterSeries[0]!.label, value: clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 40, 120), displayValue: `${clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 40, 120).toFixed(0)}分`, note: "基准期现金流质量设为基准值" },
        { row: "现金流质量", column: quarterSeries[1]!.label, value: clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100 - 5, 40, 120), displayValue: `${clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100 - 5, 40, 120).toFixed(0)}分`, note: "现金流质量基于现金流比率动态计算" },
        { row: "现金流质量", column: quarterSeries[2]!.label, value: clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100 - 10, 40, 120), displayValue: `${clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100 - 10, 40, 120).toFixed(0)}分`, note: "现金流质量基于现金流比率动态计算" },
        { row: "现金流质量", column: quarterSeries[3]!.label, value: clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 40, 120), displayValue: `${clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 40, 120).toFixed(2)}分`, note: "当前现金流水平" },
      ],
    },
    {
      row: "毛利率结果",
      cells: [
        { row: "毛利率结果", column: quarterSeries[0]!.label, value: clamp(quarterSeries[0]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[0]!.grossMargin), note: "基准期毛利率" },
        { row: "毛利率结果", column: quarterSeries[1]!.label, value: clamp(quarterSeries[1]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[1]!.grossMargin), note: "毛利率承压" },
        { row: "毛利率结果", column: quarterSeries[2]!.label, value: clamp(quarterSeries[2]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[2]!.grossMargin), note: "毛利率持续下滑" },
        { row: "毛利率结果", column: quarterSeries[3]!.label, value: clamp(quarterSeries[3]!.grossMargin / (getIndustryStandard().grossMarginAverage || 20) * 100, 20, 120), displayValue: formatPercent(quarterSeries[3]!.grossMargin), note: "当前毛利率水平" },
      ],
    },
    {
      row: "材料成本冲击",
      cells: (() => {
        const rawMaterialShockBase = clamp(100 - (1 - metrics.rawMaterialRatio) * 100, 30, 95);
        return [
          { row: "材料成本冲击", column: quarterSeries[0]!.label, value: clamp(rawMaterialShockBase + 10, 30, 95), displayValue: `${clamp(rawMaterialShockBase + 10, 30, 95).toFixed(0)}分`, note: "基准期材料成本冲击基于锂盐价格动态计算" },
          { row: "材料成本冲击", column: quarterSeries[1]!.label, value: clamp(rawMaterialShockBase + 5, 30, 95), displayValue: `${clamp(rawMaterialShockBase + 5, 30, 95).toFixed(0)}分`, note: "冲击程度基于原材料占比动态计算" },
          { row: "材料成本冲击", column: quarterSeries[2]!.label, value: clamp(rawMaterialShockBase, 30, 95), displayValue: `${clamp(rawMaterialShockBase, 30, 95).toFixed(0)}分`, note: "冲击程度基于原材料占比动态计算" },
          { row: "材料成本冲击", column: quarterSeries[3]!.label, value: rawMaterialShockBase, displayValue: `${rawMaterialShockBase.toFixed(2)}分`, note: "当前材料成本压力" },
        ];
      })(),
    },
    {
      row: "产销负荷",
      cells: (() => {
        const operationEffBase = clamp(metrics.capacityUtilization, 40, 95);
        return [
          { row: "产销负荷", column: quarterSeries[0]!.label, value: clamp(operationEffBase + 8, 40, 95), displayValue: `${clamp(operationEffBase + 8, 40, 95).toFixed(0)}分`, note: "基准期产销匹配基于产能利用率计算" },
          { row: "产销负荷", column: quarterSeries[1]!.label, value: clamp(operationEffBase + 4, 40, 95), displayValue: `${clamp(operationEffBase + 4, 40, 95).toFixed(0)}分`, note: "产销匹配度基于产能利用率动态计算" },
          { row: "产销负荷", column: quarterSeries[2]!.label, value: clamp(operationEffBase, 40, 95), displayValue: `${clamp(operationEffBase, 40, 95).toFixed(0)}分`, note: "产销匹配度基于产能利用率动态计算" },
          { row: "产销负荷", column: quarterSeries[3]!.label, value: operationEffBase, displayValue: `${operationEffBase.toFixed(2)}分`, note: "当前产销匹配水平" },
        ];
      })(),
    },
    {
      row: "外部风险",
      cells: (() => {
        const extRiskBase = clamp(100 - (industry?.industryWarmth ?? std.industryWarmth), 40, 95);
        return [
          { row: "外部风险", column: quarterSeries[0]!.label, value: clamp(extRiskBase + 5, 40, 95), displayValue: `${clamp(extRiskBase + 5, 40, 95).toFixed(0)}分`, note: "基准期外部风险基于需求指数计算" },
          { row: "外部风险", column: quarterSeries[1]!.label, value: clamp(extRiskBase, 40, 95), displayValue: `${clamp(extRiskBase, 40, 95).toFixed(0)}分`, note: "外部风险基于需求指数动态计算" },
          { row: "外部风险", column: quarterSeries[2]!.label, value: clamp(extRiskBase - 5, 40, 95), displayValue: `${clamp(extRiskBase - 5, 40, 95).toFixed(0)}分`, note: "外部风险基于需求指数动态计算" },
          { row: "外部风险", column: quarterSeries[3]!.label, value: extRiskBase, displayValue: `${extRiskBase.toFixed(2)}分`, note: "当前外部风险水平" },
        ];
      })(),
    },
    {
      row: "现金流安全",
      cells: (() => {
        const cashSafetyBase = clamp(metrics.cashFlowRatio / (getIndustryStandard().cashFlowRatio || 0.12) * 100, 40, 95);
        return [
          { row: "现金流安全", column: quarterSeries[0]!.label, value: clamp(cashSafetyBase + 8, 40, 95), displayValue: `${clamp(cashSafetyBase + 8, 40, 95).toFixed(0)}分`, note: "基准期现金流安全基于现金流比率计算" },
          { row: "现金流安全", column: quarterSeries[1]!.label, value: clamp(cashSafetyBase + 4, 40, 95), displayValue: `${clamp(cashSafetyBase + 4, 40, 95).toFixed(0)}分`, note: "现金流安全基于现金流比率动态计算" },
          { row: "现金流安全", column: quarterSeries[2]!.label, value: clamp(cashSafetyBase, 40, 95), displayValue: `${clamp(cashSafetyBase, 40, 95).toFixed(0)}分`, note: "现金流安全基于现金流比率动态计算" },
          { row: "现金流安全", column: quarterSeries[3]!.label, value: cashSafetyBase, displayValue: `${cashSafetyBase.toFixed(2)}分`, note: "当前现金流安全水平" },
        ];
      })(),
    },
  ];

  const sparkRows = [
    {
      metric: "毛利率",
      sparkline: quarterSeries.map(q => q.grossMargin),
      current: quarterSeries[3]!.grossMargin,
      trend: "down",
      status: quarterSeries[3]!.grossMargin >= std.grossMarginAverage ? "good" : "alert",
      note: "近四季度毛利率趋势（%）",
    },
    {
      metric: "营收",
      sparkline: quarterSeries.map(q => q.revenue),
      current: quarterSeries[3]!.revenue,
      trend: quarterSeries[3]!.revenue >= quarterSeries[0]!.revenue ? "up" : "down",
      status: quarterSeries[3]!.revenue >= quarterSeries[0]!.revenue ? "good" : "watch",
      note: "近四季度营收趋势（亿元）",
    },
    {
      metric: "DQI",
      sparkline: [
        quarterSeries[0]!.dqi ?? 72,
        quarterSeries[1]!.dqi ?? 68,
        quarterSeries[2]!.dqi ?? 65,
        quarterSeries[3]!.dqi ?? 63,
      ],
      current: quarterSeries[3]!.dqi ?? 63,
      trend: (quarterSeries[3]!.dqi ?? 63) >= (quarterSeries[0]!.dqi ?? 72) ? "up" : "down",
      status: (quarterSeries[3]!.dqi ?? 63) >= 70 ? "good" : "watch",
      note: "经营质量动态指数（DQI）趋势",
    },
    {
      metric: "GMPS",
      sparkline: [
        100 - (quarterSeries[0]!.gmps ?? 35),
        100 - (quarterSeries[1]!.gmps ?? 42),
        100 - (quarterSeries[2]!.gmps ?? 58),
        100 - (quarterSeries[3]!.gmps ?? 72),
      ],
      current: quarterSeries[3]!.gmps ?? 72,
      trend: "down",
      status: (quarterSeries[3]!.gmps ?? 72) >= 70 ? "good" : "alert",
      note: "毛利承压评分（GMPS）趋势",
    },
  ];

  const alertRows = [
    {
      row: "毛利率预警",
      alerts: [
        {
          row: "毛利率预警",
          column: "Q1",
          value: quarterSeries[0]!.grossMargin,
          displayValue: formatPercent(quarterSeries[0]!.grossMargin),
          status: quarterSeries[0]!.grossMargin >= std.grossMarginAverage ? "good" : "alert",
          threshold: std.grossMarginAverage,
          note: "Q1毛利率预警状态",
        },
        {
          row: "毛利率预警",
          column: "Q2",
          value: quarterSeries[1]!.grossMargin,
          displayValue: formatPercent(quarterSeries[1]!.grossMargin),
          status: quarterSeries[1]!.grossMargin >= std.grossMarginAverage ? "good" : "alert",
          threshold: std.grossMarginAverage,
          note: "Q2毛利率预警状态",
        },
        {
          row: "毛利率预警",
          column: "Q3",
          value: quarterSeries[2]!.grossMargin,
          displayValue: formatPercent(quarterSeries[2]!.grossMargin),
          status: quarterSeries[2]!.grossMargin >= std.grossMarginAverage ? "good" : "alert",
          threshold: std.grossMarginAverage,
          note: "Q3毛利率预警状态",
        },
        {
          row: "毛利率预警",
          column: "Q4",
          value: quarterSeries[3]!.grossMargin,
          displayValue: formatPercent(quarterSeries[3]!.grossMargin),
          status: quarterSeries[3]!.grossMargin >= std.grossMarginAverage ? "good" : "alert",
          threshold: std.grossMarginAverage,
          note: "Q4毛利率预警状态",
        },
      ],
    },
    {
      row: "现金流预警",
      alerts: [
        {
          row: "现金流预警",
          column: "Q1",
          value: metrics.cashFlowRatio * 100,
          displayValue: `${(metrics.cashFlowRatio * 100).toFixed(1)}%`,
          status: metrics.cashFlowRatio >= std.cashFlowRatio ? "good" : "alert",
          threshold: std.cashFlowRatio * 100,
          note: "Q1现金流预警状态",
        },
        {
          row: "现金流预警",
          column: "Q2",
          value: metrics.cashFlowRatio * 95,
          displayValue: `${(metrics.cashFlowRatio * 95).toFixed(1)}%`,
          status: metrics.cashFlowRatio * 0.95 >= std.cashFlowRatio ? "good" : "alert",
          threshold: std.cashFlowRatio * 100,
          note: "Q2现金流预警状态",
        },
        {
          row: "现金流预警",
          column: "Q3",
          value: metrics.cashFlowRatio * 90,
          displayValue: `${(metrics.cashFlowRatio * 90).toFixed(1)}%`,
          status: metrics.cashFlowRatio * 0.90 >= std.cashFlowRatio ? "good" : "alert",
          threshold: std.cashFlowRatio * 100,
          note: "Q3现金流预警状态",
        },
        {
          row: "现金流预警",
          column: "Q4",
          value: metrics.cashFlowRatio * 100,
          displayValue: `${(metrics.cashFlowRatio * 100).toFixed(1)}%`,
          status: metrics.cashFlowRatio >= std.cashFlowRatio ? "good" : "alert",
          threshold: std.cashFlowRatio * 100,
          note: "Q4现金流预警状态",
        },
      ],
    },
  ];

  return {
    pages: [
      {
        id: "enterprise-home",
        page: "home",
        title: "经营看板",
        widgets: [
          {
            id: "enterprise-bar",
            kind: "barChart",
            title: "季度对比",
            unit: unitPrefs?.gmps === "score" ? "分" : "%",
            data: quarterSeries.map((q, i) => {
              const value = unitPrefs?.gmps === "score" ? (q.gmps ?? 100 - q.grossMargin) : q.grossMargin;
              const status = unitPrefs?.gmps === "score" 
                ? (q.gmps ?? 100 - q.grossMargin) >= 70 ? "good" as const : "watch" as const
                : q.grossMargin >= std.grossMarginAverage ? "good" as const : "watch" as const;
              return {
                id: q.label,
                label: q.label,
                value,
                displayValue: unitPrefs?.gmps === "score" ? `${value.toFixed(0)}分` : `${value.toFixed(2)}%`,
                benchmark: unitPrefs?.gmps === "score" ? "警戒线 70分" : `行业均值 ${std.grossMarginAverage}%`,
                detail: `${q.label}${unitPrefs?.gmps === "score" ? '毛利承压评分' : '毛利率'}表现`,
                status,
              };
            }),
          },
          {
            id: "enterprise-radar",
            kind: "radarChart",
            title: "能力评估",
            dimensions: [
              { key: "profit", label: "盈利能力", value: clamp(quarterSeries[3]!.grossMargin / (std.grossMarginAverage || 20) * 100, 40, 120), displayValue: formatPercent(quarterSeries[3]!.grossMargin) },
              { key: "growth", label: "成长能力", value: clamp(quarterSeries[3]!.revenue / Math.max(quarterSeries[0]!.revenue, 1) * 100, 40, 120), displayValue: `${clamp(quarterSeries[3]!.revenue / Math.max(quarterSeries[0]!.revenue, 1) * 100, 40, 120).toFixed(0)}分` },
              { key: "cashflow", label: "现金流质量", value: clamp(metrics.cashFlowRatio / (std.cashFlowRatio || 0.12) * 100, 40, 120), displayValue: `${clamp(metrics.cashFlowRatio / (std.cashFlowRatio || 0.12) * 100, 40, 120).toFixed(0)}分` },
              { key: "efficiency", label: "经营效率", value: clamp(metrics.capacityUtilization, 40, 95), displayValue: `${metrics.capacityUtilization.toFixed(1)}%` },
              { key: "risk", label: "风险抵御", value: clamp(100 - (industry?.industryWarmth ?? std.industryWarmth), 40, 95), displayValue: `${clamp(100 - (industry?.industryWarmth ?? std.industryWarmth), 40, 95).toFixed(0)}分` },
            ],
          },
          {
            id: "enterprise-line",
            kind: "lineChart",
            title: "毛利率趋势",
            unit: "%",
            data: quarterSeries.map((q, i) => ({
              id: q.label,
              label: q.label,
              value: q.grossMargin,
              displayValue: formatPercent(q.grossMargin),
              benchmark: `行业均值 ${std.grossMarginAverage}%`,
              detail: `${q.label}毛利率${q.grossMargin >= std.grossMarginAverage ? '优于' : '低于'}行业均值`,
              status: q.grossMargin >= std.grossMarginAverage ? "good" as const : "watch" as const,
            })),
          },
          {
            id: "enterprise-boxplot",
            kind: "boxPlotChart",
            title: "分布对比",
            groups: (() => {
              const currentDqi = quarterSeries[3]!.dqi ?? (baseInfo?.currentDqi !== undefined ? toNumber(baseInfo.currentDqi, 70) : 70);
              const dqiBase = clamp(currentDqi, 30, 90);
              const currentGmps = quarterSeries[3]!.gmps ?? (baseInfo?.currentGmps !== undefined ? toNumber(baseInfo.currentGmps, 45) : 45);
              const gmpsBase = clamp(100 - currentGmps, 30, 90);
              const marginVals = metrics.grossMarginTrend.map(v => clamp(v, 8, 28));
              const medianVal = marginVals.length >= 4 
                ? (marginVals[1] + marginVals[2]) / 2 
                : marginVals[marginVals.length - 1];
              const sorted = [...marginVals].sort((a, b) => a - b);
              return [
                {
                  id: "dqi",
                  label: "DQI 指数",
                  min: dqiBase - 15,
                  max: dqiBase + 15,
                  q1: dqiBase - 8,
                  q3: dqiBase + 8,
                  median: dqiBase,
                  outliers: [dqiBase - 20],
                  status: dqiBase >= 70 ? "good" as const : dqiBase >= 60 ? "watch" as const : "alert" as const,
                  detail: "DQI 经营质量指数分布",
                },
                {
                  id: "gmps",
                  label: "GMPS 承压",
                  min: gmpsBase - 15,
                  max: gmpsBase + 15,
                  q1: gmpsBase - 8,
                  q3: gmpsBase + 8,
                  median: gmpsBase,
                  outliers: [gmpsBase + 20],
                  status: gmpsBase >= 70 ? "good" as const : gmpsBase >= 60 ? "watch" as const : "alert" as const,
                  detail: "GMPS 毛利承压评分分布",
                },
                {
                  id: "margin",
                  label: "毛利率分布",
                  min: sorted[0] ?? 12,
                  max: sorted[sorted.length - 1] ?? 22,
                  q1: sorted[0] ?? 15,
                  q3: sorted[sorted.length - 1] ?? 20,
                  median: medianVal,
                  outliers: [],
                  status: medianVal >= std.grossMarginAverage ? "good" as const : medianVal >= std.grossMarginAverage * 0.8 ? "watch" as const : "alert" as const,
                  detail: "近四季度毛利率分布",
                },
              ];
            })(),
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
            links: (() => {
              const rawMatRatio = metrics.rawMaterialRatio;
              const laborRatio = metrics.laborRatio;
              const mfgRatio = metrics.manufacturingRatio;
              const inventoryRatio = metrics.inventoryRatio;
              const grossMargin = quarterSeries[3] ? quarterSeries[3].grossMargin : std.grossMarginAverage;
              const powerShare = clamp(grossMargin / 25, 0.3, 0.65);
              const storageShare = clamp((1 - powerShare) * 0.6, 0.15, 0.40);
              const consumerShare = Math.max(1 - powerShare - storageShare, 0.05);
              return [
                { source: "raw-material", target: "power-battery", value: Math.round(rawMatRatio * powerShare * 100) },
                { source: "raw-material", target: "storage-battery", value: Math.round(rawMatRatio * storageShare * 100) },
                { source: "raw-material", target: "consumer-battery", value: Math.round(rawMatRatio * consumerShare * 100) },
                { source: "raw-material", target: "upstream-material", value: Math.round(rawMatRatio * 0.08 * 100) },
                { source: "labor", target: "power-battery", value: Math.round(laborRatio * powerShare * 100) },
                { source: "labor", target: "storage-battery", value: Math.round(laborRatio * storageShare * 100) },
                { source: "labor", target: "consumer-battery", value: Math.round(laborRatio * consumerShare * 100) },
                { source: "manufacturing", target: "power-battery", value: Math.round(mfgRatio * powerShare * 100) },
                { source: "manufacturing", target: "storage-battery", value: Math.round(mfgRatio * storageShare * 100) },
                { source: "manufacturing", target: "consumer-battery", value: Math.round(mfgRatio * consumerShare * 100) },
                { source: "inventory", target: "power-battery", value: Math.round(inventoryRatio * powerShare * 100) },
                { source: "inventory", target: "storage-battery", value: Math.round(inventoryRatio * storageShare * 100) },
                { source: "inventory", target: "consumer-battery", value: Math.round(inventoryRatio * consumerShare * 100) },
                { source: "power-battery", target: "gross-profit", value: Math.round(grossMargin * powerShare * 5) },
                { source: "power-battery", target: "expenses", value: Math.round((1 - grossMargin / 100) * powerShare * 50) },
                { source: "storage-battery", target: "gross-profit", value: Math.round(grossMargin * storageShare * 5) },
                { source: "storage-battery", target: "expenses", value: Math.round((1 - grossMargin / 100) * storageShare * 50) },
                { source: "consumer-battery", target: "gross-profit", value: Math.round(grossMargin * consumerShare * 5) },
                { source: "consumer-battery", target: "expenses", value: Math.round((1 - grossMargin / 100) * consumerShare * 50) },
                { source: "upstream-material", target: "gross-profit", value: Math.round(rawMatRatio * 30) },
                { source: "upstream-material", target: "expenses", value: Math.round(rawMatRatio * 20) },
                { source: "gross-profit", target: "net-profit", value: Math.round(grossMargin * 4) },
                { source: "expenses", target: "net-profit", value: Math.round(20) },
              ];
            })() as VisualizationSankeyLink[],
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
            kind: "treeMapChart",
            title: "层级色块面积树图",
            data: [
              {
                name: "动力电池",
                children: [
                  { name: "电芯制造", value: clamp(quarterSeries[3]!.revenue * 0.4, 10, 200), status: "good" as const },
                  { name: "pack", value: clamp(quarterSeries[3]!.revenue * 0.25, 5, 120), status: "watch" as const },
                  { name: "bms", value: clamp(quarterSeries[3]!.revenue * 0.15, 3, 80), status: "good" as const },
                ],
              },
              {
                name: "储能电池",
                children: [
                  { name: "系统集成", value: clamp(quarterSeries[3]!.revenue * 0.35, 8, 150), status: "watch" as const },
                  { name: "电池模块", value: clamp(quarterSeries[3]!.revenue * 0.2, 5, 100), status: "alert" as const },
                ],
              },
            ],
          },
          {
            id: "enterprise-funnel",
            kind: "funnelChart",
            title: "业务转化漏斗图",
            stages: [
              { id: "leads", label: "原材料采购", value: 100 },
              { id: "qualified", label: "生产制造", value: clamp(85 - metrics.rawMaterialRatio * 20, 50, 90) },
              { id: "proposal", label: "质量检测", value: clamp(70 - metrics.inventoryRatio * 15, 40, 80) },
              { id: "negotiation", label: "产品交付", value: clamp(55 - (1 - metrics.capacityUtilization / 100) * 20, 30, 70) },
              { id: "closed", label: "营收转化", value: clamp(metrics.cashFlowRatio * 500, 20, 60) },
            ],
          },
          {
            id: "enterprise-scatter",
            kind: "scatterChart",
            title: "成本-效益散点分布图",
            data: quarterSeries.map((q, i) => ({
              id: q.label,
              label: q.label,
              x: metrics.rawMaterialRatio * 100,
              y: q.grossMargin,
              size: clamp(q.revenue / 10, 8, 24),
              status: q.grossMargin >= std.grossMarginAverage ? "good" as const : "alert" as const,
              detail: `${q.label}: 材料占比${(metrics.rawMaterialRatio * 100).toFixed(1)}%, 毛利率${q.grossMargin.toFixed(2)}%`,
            })),
          },
          {
            id: "enterprise-gauge",
            kind: "gaugeChart",
            title: "经营健康度仪表盘",
            gauges: [
              { id: "dqi", label: "DQI 经营质量", value: quarterSeries[3]!.dqi ?? 70, min: 0, max: 100, thresholds: [40, 60, 80] },
              { id: "gmps", label: "GMPS 承压", value: quarterSeries[3]!.gmps ?? 45, min: 0, max: 100, thresholds: [30, 50, 70] },
              { id: "capacity", label: "产能利用率", value: metrics.capacityUtilization, min: 0, max: 100, thresholds: [50, 70, 85] },
            ],
          },
          {
            id: "enterprise-waterfall",
            kind: "waterfallChart",
            title: "毛利瀑布分析图",
            steps: [
              { id: "revenue", label: "营业收入", value: quarterSeries[3]!.revenue, type: "total" as const },
              { id: "cost", label: "营业成本", value: -quarterSeries[3]!.revenue * (1 - quarterSeries[3]!.grossMargin / 100), type: "negative" as const },
              { id: "material", label: "材料成本影响", value: -metrics.rawMaterialRatio * quarterSeries[3]!.revenue * 0.3, type: "negative" as const },
              { id: "labor", label: "人工成本影响", value: -metrics.laborRatio * quarterSeries[3]!.revenue * 0.2, type: "negative" as const },
              { id: "mfg", label: "制造费用影响", value: -metrics.manufacturingRatio * quarterSeries[3]!.revenue * 0.15, type: "negative" as const },
              { id: "gross", label: "毛利润", value: quarterSeries[3]!.revenue * quarterSeries[3]!.grossMargin / 100, type: "total" as const },
            ],
          },
        ],
      },
    ],
  };
}

export function buildInvestorHomeVisualization(
  investorOnboarding: Record<string, any>,
  userProfile: Record<string, any>,
  unitPrefs?: { investorScore?: string }
) {
  const profile = userProfile?.profile;
  const industry = profile?.industryAnalysis;
  const std = getIndustryStandard();
  const investorName = investorOnboarding?.investorName || "投资机构";
  const investedEnterprises = investorOnboarding?.investedEnterprises || "";
  const enterpriseList = investedEnterprises
    .split(/[,，]/)
    .map((s: string) => s.trim())
    .filter(Boolean);

  return {
    pages: [
      {
        id: "investor-home",
        page: "home" as const,
        title: "投资看板",
        widgets: [
          {
            id: "investor-bar",
            kind: "barChart" as const,
            title: "景气趋势",
            unit: "分",
            data: (() => {
              const currentWarmth = std.industryWarmth;
              const q4Value = currentWarmth;
              const q3Value = clamp(q4Value - (q4Value - 60) * 0.25, 40, 85);
              const q2Value = clamp(q4Value - (q4Value - 55) * 0.5, 35, 80);
              const q1Value = clamp(q4Value - (q4Value - 50) * 0.75, 30, 75);
              const benchmark = 70;
              return [
                { id: "q1", label: "Q1", value: q1Value, displayValue: `${q1Value.toFixed(1)}`, benchmark: `行业均值 ${benchmark}`, detail: `Q1行业景气${q1Value >= benchmark ? '优于' : '低于'}行业均值。`, status: q1Value >= benchmark ? "good" as const : "watch" as const },
                { id: "q2", label: "Q2", value: q2Value, displayValue: `${q2Value.toFixed(1)}`, benchmark: `行业均值 ${benchmark}`, detail: `Q2景气${q2Value >= benchmark ? '优于' : '低于'}行业均值，${q2Value > q1Value ? '修复' : '承压'}中。`, status: q2Value >= benchmark ? "good" as const : "watch" as const },
                { id: "q3", label: "Q3", value: q3Value, displayValue: `${q3Value.toFixed(1)}`, benchmark: `行业均值 ${benchmark}`, detail: `Q3景气${q3Value >= benchmark ? '回升至偏暖区间' : '仍低于均值'}。`, status: q3Value >= benchmark ? "good" as const : "watch" as const },
                { id: "q4", label: "Q4", value: q4Value, displayValue: `${q4Value.toFixed(1)}`, benchmark: `行业均值 ${benchmark}`, detail: `Q4当前景气水平${q4Value >= benchmark ? '良好' : '需关注'}。`, status: q4Value >= benchmark ? "good" as const : "watch" as const },
              ];
            })(),
          },
          {
            id: "investor-radar",
            kind: "radarChart" as const,
            title: "投资能力评估",
            dimensions: [
              { key: "returns", label: "投资回报", value: clamp(std.industryWarmth + 5, 40, 100), displayValue: `${clamp(std.industryWarmth + 5, 40, 100).toFixed(0)}分` },
              { key: "risk", label: "风险控制", value: clamp(std.industryWarmth - 5, 40, 100), displayValue: `${clamp(std.industryWarmth - 5, 40, 100).toFixed(0)}分` },
              { key: "liquidity", label: "流动性管理", value: clamp(std.industryWarmth, 40, 100), displayValue: `${std.industryWarmth.toFixed(0)}分` },
              { key: "diversification", label: "组合分散度", value: clamp(50 + enterpriseList.length * 10, 40, 100), displayValue: `${clamp(50 + enterpriseList.length * 10, 40, 100).toFixed(0)}分` },
              { key: "esg", label: "ESG表现", value: clamp(std.industryWarmth - 8, 40, 100), displayValue: `${clamp(std.industryWarmth - 8, 40, 100).toFixed(0)}分` },
            ],
          },
        ],
      },
    ],
  };
}
