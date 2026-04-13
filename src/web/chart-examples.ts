/**
 * DQI & GMPS 图表系统 - 完整使用示例
 *
 * 本文件展示了如何在前端组件中使用 DQI 和 GMPS 数学模型的图表可视化系统
 */

import {
  // 类型定义
  type ChartConfig,
  type DQITrendData,
  type DQIResult,
  type GMPSResult,
  type DiagnosticChartSuite,

  // 核心图表构建函数
  buildDQITrendChart,
  buildDriverRadarChart,
  buildGMPSGaugeChart,
  buildGMPSDimensionRadarChart,
  buildFeatureWaterfallChart,

  // 统一包装函数
  buildDiagnosticCharts,

  // 辅助函数
  extractDQIResult,
  extractGMPSResult,
  generateDiagnosticChartsFromMath,
} from './chart-data.js';

import {
  type MathAnalysisOutput,
} from '../shared/agents.js';

// ==================== 示例 1: 基础用法 ====================

/**
 * 示例 1.1: 构建 DQI 趋势折线图
 */
function exampleDQITrendChart() {
  const dqiHistory: DQITrendData[] = [
    { periodDate: "2025-Q2", dqi: 0.95, status: "恶化" },
    { periodDate: "2025-Q3", dqi: 1.02, status: "稳定" },
    { periodDate: "2025-Q4", dqi: 1.08, status: "改善" },
    { periodDate: "2026-Q1", dqi: 1.15, status: "改善" },
  ];

  const chartConfig: ChartConfig = buildDQITrendChart(dqiHistory);

  console.log('DQI 趋势图配置:', chartConfig);
  /*
   * 输出结构:
   * {
   *   type: 'line',
   *   data: [...],
   *   options: {
   *     title: 'DQI 经营质量趋势',
   *     xAxis: {...},
   *     yAxis: {...},
   *     series: [{ dataKey: 'dqi', stroke: '#3B82F6', ... }],
   *     referenceLines: [{ value: 1.0, ... }],
   *     ...
   *   }
   * }
   */

  // 在 React 组件中使用 (配合 Recharts)
  // return <LineChart data={chartConfig.data} {...chartConfig.options} />;
}

/**
 * 示例 1.2: 构建 DQI 驱动因素雷达图
 */
function exampleDriverRadarChart() {
  const currentData = {
    profitabilityContribution: 0.45,  // 盈利能力贡献 45%
    growthContribution: 0.35,         // 成长能力贡献 35%
    cashflowContribution: 0.20,       // 现金流质量贡献 20%
  };

  const baselineData = {
    profitabilityContribution: 0.38,
    growthContribution: 0.42,
    cashflowContribution: 0.20,
  };

  // 带基期对比的雷达图
  const chartConfigWithBaseline: ChartConfig = buildDriverRadarChart(
    currentData,
    baselineData  // 可选参数，提供后将显示当期 vs 基期对比
  );

  console.log('驱动因素雷达图:', chartConfigWithBaseline);
}

/**
 * 示例 1.3: 构建 GMPS 仪表盘
 */
function exampleGMPSGaugeChart() {
  const gmpsData = {
    gmps: 65.3,           // GMPS 数值
    level: '中压' as const, // 压力等级
  };

  const chartConfig: ChartConfig = buildGMPSGaugeChart(gmpsData);

  console.log('GMPS 仪表盘:', chartConfig);
  /*
   * 特性:
   * - 半圆形仪表盘 (180度)
   * - 颜色根据数值自动选择:
   *   - < 40: 绿色 (低压)
   *   - 40-70: 黄色 (中压)
   *   - >= 70: 红色 (高压)
   * - 中心显示 GMPS 数值和等级文字
   */
}

/**
 * 示例 1.4: 构建 GMPS 五维度雷达图
 */
function exampleGMPSDimensionRadarChart() {
  const dimensionScores = {
    A_毛利率结果: 72,
    B_材料成本冲击: 65,
    C_产销负荷: 58,
    D_外部风险: 45,
    E_现金流安全: 70,
  };

  const chartConfig: ChartConfig = buildGMPSDimensionRadarChart(dimensionScores);

  console.log('五维度雷达图:', chartConfig);
  /*
   * 五边形布局:
   * A(上) → B(右上) → C(右下) → D(左下) → E(左上)
   *
   * 每个顶点显示得分值
   * 红色填充表示压力程度
   */
}

/**
 * 示例 1.5: 构建特征得分瀑布图
 */
function exampleFeatureWaterfallChart() {
  const featureScores = {
    gpmYoy: 75,        // 毛利率同比 - 高风险
    unitCostYoy: 68,   // 单位成本同比 - 中等风险
    mfgCostRatio: 55,  // 制造费用占比 - 中等风险
    revCostGap: 62,    // 营收成本增速差 - 中等风险
    saleProdRatio: 48, // 产销率 - 低风险
    liPriceYoy: 72,    // 碳酸锂价格同比 - 高风险
    invYoy: 58,        // 库存同比 - 中等风险
    cfoRatio: 45,      // 现金流比率 - 低风险
    lev: 52,           // 资产负债率 - 中等风险
    indVol: 65,        // 行业波动率 - 中等风险
  };

  const chartConfig: ChartConfig = buildFeatureWaterfallChart(featureScores);

  console.log('特征得分瀑布图:', chartConfig);
  /*
   * 特性:
   * - 水平条形图 (indexAxis='y')
   * - 按权重从高到低排序
   * - 颜色编码:
   *   - > 70: 深红色 (高风险)
   *   - 50-70: 橙黄色 (中等风险)
   *   - < 50: 绿色 (低风险)
   * - 条形末端显示具体分数
   */
}

// ==================== 示例 2: 高级用法 ====================

/**
 * 示例 2.1: 使用统一包装函数生成完整图表套件
 */
function exampleBuildDiagnosticCharts() {
  // 准备数据
  const dqiResult: DQIResult = {
    dqi: 1.12,
    status: '改善',
    driver: '盈利能力',
    decomposition: {
      profitabilityContribution: 0.45,
      growthContribution: 0.35,
      cashflowContribution: 0.20,
    },
    metrics: {
      currentROE: 8.5,
      baselineROE: 7.2,
      roeRatio: 1.18,
      currentGrowth: 15.3,
      baselineGrowth: 12.1,
      growthRatio: 1.26,
      currentOCFRatio: 18.2,
      baselineOCFRatio: 15.6,
      ocfRatioChange: 2.6,
    },
    trend: '持续改善',
    confidence: 0.87,
  };

  const gmpsResult: GMPSResult = {
    gmps: 65.3,
    level: '中压',
    probabilityNextQuarter: 62,
    riskLevel: '中风险',
    dimensionScores: {
      A_毛利率结果: 72,
      B_材料成本冲击: 65,
      C_产销负荷: 58,
      D_外部风险: 45,
      E_现金流安全: 70,
    },
    featureScores: {
      gpmYoy: 75,
      unitCostYoy: 68,
      mfgCostRatio: 55,
      revCostGap: 62,
      saleProdRatio: 48,
      liPriceYoy: 72,
      invYoy: 58,
      cfoRatio: 45,
      lev: 52,
      indVol: 65,
    },
    keyFindings: [
      '毛利率承压明显，需关注原材料价格波动',
      '现金流质量相对稳健',
      '产销匹配度有待提升',
    ],
  };

  const dqiHistory: DQITrendData[] = [
    { periodDate: "2025-Q2", dqi: 0.95, status: "恶化" },
    { periodDate: "2025-Q3", dqi: 1.02, status: "稳定" },
    { periodDate: "2025-Q4", dqi: 1.08, status: "改善" },
    { periodDate: "2026-Q1", dqi: 1.15, status: "改善" },
  ];

  // 一键生成所有图表
  const chartSuite: DiagnosticChartSuite = buildDiagnosticCharts(
    dqiResult,
    gmpsResult,
    dqiHistory
  );

  console.log('完整诊断图表套件:', chartSuite);
  /*
   * 输出结构:
   * {
   *   dqiTrendChart: ChartConfig | null,      // DQI 趋势折线图
   *   driverRadarChart: ChartConfig | null,   // 驱动因素雷达图
   *   gmpsGaugeChart: ChartConfig | null,     // GMPS 仪表盘
   *   gmpsDimensionRadar: ChartConfig | null, // 五维度雷达图
   *   featureWaterfall: ChartConfig | null,   // 特征得分瀑布图
   * }
   *
   * 如果某个输入为空/undefined，对应的图表将为 null
   */
}

/**
 * 示例 2.2: 从 MathAnalysisOutput 直接生成图表
 */
function exampleGenerateFromMathAnalysis(mathAnalysis: MathAnalysisOutput) {
  // 假设有历史数据
  const dqiHistory: DQITrendData[] = [
    { periodDate: "2025-Q2", dqi: 0.95, status: "恶化" },
    { periodDate: "2025-Q3", dqi: 1.02, status: "稳定" },
    { periodDate: "2025-Q4", dqi: 1.08, status: "改善" },
    { periodDate: "2026-Q1", dqi: 1.15, status: "改善" },
  ];

  // 使用便捷函数一键生成
  const chartSuite: DiagnosticChartSuite = generateDiagnosticChartsFromMath(
    mathAnalysis,
    dqiHistory
  );

  return chartSuite;
}

/**
 * 示例 2.3: 单独提取并使用 DQI/GMPS 结果
 */
function exampleExtractAndUseResults(mathAnalysis?: MathAnalysisOutput) {
  // 提取标准化结果
  const dqiResult = extractDQIResult(mathAnalysis);
  const gmpsResult = extractGMPSResult(mathAnalysis);

  if (dqiResult) {
    console.log(`DQI 值: ${dqiResult.dqi}, 状态: ${dqiResult.status}`);
    console.log(`主要驱动因素: ${dqiResult.driver}`);
    console.log(`置信度: ${(dqiResult.confidence * 100).toFixed(2)}%`);

    // 可以单独生成某个图表
    const radarChart = buildDriverRadarChart(dqiResult.decomposition);
    // 渲染雷达图...
  }

  if (gmpsResult) {
    console.log(`GMPS 值: ${gmpsResult.gmps}, 等级: ${gmpsResult.level}`);
    console.log(`下季度恶化概率: ${gmpsResult.probabilityNextQuarter}%`);
    console.log(`关键发现:\n${gmpsResult.keyFindings.join('\n')}`);

    // 可以单独生成某个图表
    const gaugeChart = buildGMPSGaugeChart({
      gmps: gmpsResult.gmps,
      level: gmpsResult.level,
    });
    // 渲染仪表盘...
  }
}

// ==================== 示例 3: 在 React 组件中使用 ====================

/**
 * 示例 3.1: 在 React 组件中使用（简要说明）
 *
 * 使用步骤：
 * 1. 在 .tsx 文件中导入图表构建函数
 * 2. 调用 generateDiagnosticChartsFromMath() 或 buildDiagnosticCharts() 获取配置
 * 3. 将配置传递给 Recharts 组件进行渲染
 *
 * 推荐的组件结构：
 * - 第一行: DQI 趋势折线图 + GMPS 仪表盘
 * - 第二行: DQI 驱动因素雷达图 + GMPS 五维度雷达图
 * - 第三行: GMPS 特征得分瀑布图（全宽）
 *
 * 详细代码示例请参考项目文档或 .tsx 文件实现
 */

// ==================== 导出所有示例函数供测试 ====================
export {
  exampleDQITrendChart,
  exampleDriverRadarChart,
  exampleGMPSGaugeChart,
  exampleGMPSDimensionRadarChart,
  exampleFeatureWaterfallChart,
  exampleBuildDiagnosticCharts,
  exampleGenerateFromMathAnalysis,
  exampleExtractAndUseResults,
};
