export interface ChartInsight {
  title: string;
  summary: string;
  analysis: string;
  model: string;
  recommendation: string;
  riskLevel: 'low' | 'medium' | 'high';
  metrics?: {
    label: string;
    value: string | number;
    trend?: 'up' | 'down' | 'stable';
    status?: 'good' | 'watch' | 'risk';
  }[];
}

export interface DQIResult {
  value: number;
  status: 'improve' | 'stable' | 'decline';
  driver: string;
  components: {
    roe: { ratio: number; contribution: number };
    growth: { ratio: number; contribution: number };
    ocf: { ratio: number; contribution: number };
  };
}

export interface GMPSResult {
  value: number;
  level: 'low' | 'medium' | 'high';
  dimensions: {
    gpm: { score: number; weight: number };
    material: { score: number; weight: number };
    production: { score: number; weight: number };
    external: { score: number; weight: number };
    cashflow: { score: number; weight: number };
  };
}

export function calculateDQI(data: {
  currentROE: number;
  previousROE: number;
  currentGrowth: number;
  previousGrowth: number;
  currentOCF: number;
  previousOCF: number;
}): DQIResult {
  const roeRatio = data.currentROE / (data.previousROE || 1);
  const growthRatio = data.currentGrowth / (data.previousGrowth || 1);
  const ocfRatio = data.currentOCF / (data.previousOCF || 1);

  const wROE = 0.4;
  const wGrowth = 0.3;
  const wOCF = 0.3;

  const dqi = wROE * roeRatio + wGrowth * growthRatio + wOCF * ocfRatio;

  let status: 'improve' | 'stable' | 'decline';
  if (dqi > 1.02) status = 'improve';
  else if (dqi < 0.98) status = 'decline';
  else status = 'stable';

  const ratios = [
    { name: '盈利能力', ratio: roeRatio },
    { name: '成长能力', ratio: growthRatio },
    { name: '现金流质量', ratio: ocfRatio },
  ];
  const driver = ratios.reduce((max, curr) => curr.ratio > max.ratio ? curr : max).name;

  return {
    value: dqi,
    status,
    driver,
    components: {
      roe: { ratio: roeRatio, contribution: wROE * roeRatio },
      growth: { ratio: growthRatio, contribution: wGrowth * growthRatio },
      ocf: { ratio: ocfRatio, contribution: wOCF * ocfRatio },
    },
  };
}

export function calculateGMPS(scores: {
  gpmYoy: number;
  unitCostYoy: number;
  mfgCostRatio: number;
  revCostGap: number;
  saleProdRatio: number;
  liPriceYoy: number;
  invYoy: number;
  cfoRatio: number;
  lev: number;
  indVol: number;
}): GMPSResult {
  const weights = {
    gpmYoy: 0.14,
    unitCostYoy: 0.12,
    mfgCostRatio: 0.12,
    revCostGap: 0.11,
    saleProdRatio: 0.10,
    liPriceYoy: 0.10,
    invYoy: 0.09,
    cfoRatio: 0.08,
    lev: 0.07,
    indVol: 0.07,
  };

  const gmps =
    weights.gpmYoy * scores.gpmYoy +
    weights.unitCostYoy * scores.unitCostYoy +
    weights.mfgCostRatio * scores.mfgCostRatio +
    weights.revCostGap * scores.revCostGap +
    weights.saleProdRatio * scores.saleProdRatio +
    weights.liPriceYoy * scores.liPriceYoy +
    weights.invYoy * scores.invYoy +
    weights.cfoRatio * scores.cfoRatio +
    weights.lev * scores.lev +
    weights.indVol * scores.indVol;

  let level: 'low' | 'medium' | 'high';
  if (gmps < 40) level = 'low';
  else if (gmps < 70) level = 'medium';
  else level = 'high';

  const gpmScore = (scores.gpmYoy + scores.revCostGap) / 2;
  const materialScore = (scores.liPriceYoy + scores.unitCostYoy) / 2;
  const productionScore = (scores.invYoy + scores.saleProdRatio + scores.mfgCostRatio) / 3;
  const externalScore = scores.indVol;
  const cashflowScore = (scores.cfoRatio + scores.lev) / 2;

  return {
    value: gmps,
    level,
    dimensions: {
      gpm: { score: gpmScore, weight: 0.25 },
      material: { score: materialScore, weight: 0.22 },
      production: { score: productionScore, weight: 0.31 },
      external: { score: externalScore, weight: 0.07 },
      cashflow: { score: cashflowScore, weight: 0.15 },
    },
  };
}

export function generateDQIInsight(dqi: DQIResult, enterpriseName: string): ChartInsight {
  const statusText = {
    improve: '经营质量改善',
    stable: '经营质量稳定',
    decline: '经营质量恶化',
  };

  const statusColor = {
    improve: 'good',
    stable: 'watch',
    decline: 'risk',
  } as const;

  const trendMap = {
    improve: 'up' as const,
    stable: 'stable' as const,
    decline: 'down' as const,
  };

  const analysis = `根据DQI动态经营质量指数模型分析，${enterpriseName}当前DQI值为${dqi.value.toFixed(2)}。
    
DQI模型基于Malmquist指数思想，通过比较相邻时期的经营效率变化来评价企业经营质量动态演变。模型将经营效率分解为三个维度：
- 盈利能力（ROE比率，权重40%）：当前贡献度${(dqi.components.roe.contribution * 100).toFixed(1)}%
- 成长能力（营收增长率比率，权重30%）：当前贡献度${(dqi.components.growth.contribution * 100).toFixed(1)}%
- 现金流质量（OCF比率，权重30%）：当前贡献度${(dqi.components.ocf.contribution * 100).toFixed(1)}%

主要驱动因素为${dqi.driver}，表明该维度对经营质量变化贡献最大。`;

  const recommendation = dqi.status === 'improve'
    ? '建议：继续保持当前经营策略，重点关注驱动因素的可持续性，同时关注其他维度的改善空间。'
    : dqi.status === 'decline'
    ? '建议：需要深入分析经营质量下降的根本原因，重点关注贡献度较低的维度，制定针对性改善措施。'
    : '建议：经营质量基本稳定，可考虑优化资源配置效率，寻找新的增长点。';

  return {
    title: `${enterpriseName} 经营质量动态分析`,
    summary: `DQI指数${dqi.value.toFixed(2)}，${statusText[dqi.status]}，${dqi.driver}驱动`,
    analysis,
    model: 'DQI动态经营质量指数模型',
    recommendation,
    riskLevel: dqi.status === 'improve' ? 'low' : dqi.status === 'decline' ? 'high' : 'medium',
    metrics: [
      { label: 'DQI指数', value: dqi.value.toFixed(2), trend: trendMap[dqi.status], status: statusColor[dqi.status] },
      { label: 'ROE贡献', value: `${(dqi.components.roe.ratio * 100).toFixed(1)}%`, trend: dqi.components.roe.ratio > 1 ? 'up' : dqi.components.roe.ratio < 1 ? 'down' : 'stable' },
      { label: '成长贡献', value: `${(dqi.components.growth.ratio * 100).toFixed(1)}%`, trend: dqi.components.growth.ratio > 1 ? 'up' : dqi.components.growth.ratio < 1 ? 'down' : 'stable' },
      { label: 'OCF贡献', value: `${(dqi.components.ocf.ratio * 100).toFixed(1)}%`, trend: dqi.components.ocf.ratio > 1 ? 'up' : dqi.components.ocf.ratio < 1 ? 'down' : 'stable' },
    ],
  };
}

export function generateGMPSInsight(gmps: GMPSResult, enterpriseName: string): ChartInsight {
  const levelText = {
    low: '低压（风险较低）',
    medium: '中压（需关注）',
    high: '高压（风险较高）',
  };

  const levelColor = {
    low: 'good',
    medium: 'watch',
    high: 'risk',
  } as const;

  const dim = gmps.dimensions;
  const sortedDims = Object.entries(dim).sort((a, b) => b[1].score - a[1].score);
  const highestDim = sortedDims[0] ?? ['gpm', dim.gpm];
  const lowestDim = sortedDims[sortedDims.length - 1] ?? ['cashflow', dim.cashflow];

  const dimNames: Record<string, string> = {
    gpm: '毛利率结果',
    material: '材料成本冲击',
    production: '产销负荷分摊',
    external: '外部风险传导',
    cashflow: '现金流安全垫',
  };

  const analysis = `根据GMPS毛利承压指数模型分析，${enterpriseName}当前GMPS指数为${gmps.value.toFixed(1)}分，属于${levelText[gmps.level]}区间。

GMPS模型从五个维度综合评估毛利承压程度：
- 毛利率结果（权重25%）：得分${dim.gpm.score.toFixed(1)}分
- 材料成本冲击（权重22%）：得分${dim.material.score.toFixed(1)}分
- 产销负荷分摊（权重31%）：得分${dim.production.score.toFixed(1)}分
- 外部风险传导（权重7%）：得分${dim.external.score.toFixed(1)}分
- 现金流安全垫（权重15%）：得分${dim.cashflow.score.toFixed(1)}分

主要压力来源为${dimNames[highestDim[0]]}（${highestDim[1].score.toFixed(1)}分），相对优势维度为${dimNames[lowestDim[0]]}（${lowestDim[1].score.toFixed(1)}分）。`;

  const recommendation = gmps.level === 'low'
    ? '建议：当前毛利承压风险较低，建议保持现有成本控制策略，持续关注上游原材料价格波动。'
    : gmps.level === 'high'
    ? '建议：毛利承压风险较高，需立即采取措施：1）优化材料采购策略；2）提高产能利用率；3）加强库存管理；4）关注现金流安全。'
    : '建议：毛利承压处于中等水平，建议重点关注高分压力维度，制定针对性改善措施。';

  return {
    title: `${enterpriseName} 毛利承压分析`,
    summary: `GMPS指数${gmps.value.toFixed(1)}分，${levelText[gmps.level]}`,
    analysis,
    model: 'GMPS毛利承压指数模型',
    recommendation,
    riskLevel: gmps.level === 'low' ? 'low' : gmps.level === 'high' ? 'high' : 'medium',
    metrics: [
      { label: 'GMPS指数', value: `${gmps.value.toFixed(1)}分`, status: levelColor[gmps.level] },
      { label: '压力等级', value: levelText[gmps.level], status: levelColor[gmps.level] },
      { label: '主要压力', value: dimNames[highestDim[0]] ?? '未知', status: highestDim[1].score >= 70 ? 'risk' : 'watch' },
      { label: '相对优势', value: dimNames[lowestDim[0]] ?? '未知', status: lowestDim[1].score <= 40 ? 'good' : 'watch' },
    ],
  };
}

export function generateRadarInsight(data: {
  dimensions: { name: string; current: number; baseline: number }[];
  title: string;
}): ChartInsight {
  const gaps = data.dimensions.map(d => ({
    name: d.name,
    gap: d.current - d.baseline,
    ratio: d.current / d.baseline,
  }));

  const positiveGaps = gaps.filter(g => g.gap > 0);
  const negativeGaps = gaps.filter(g => g.gap < 0);
  const maxGap = gaps.reduce((max, g) => g.gap > max.gap ? g : max);
  const minGap = gaps.reduce((min, g) => g.gap < min.gap ? g : min);

  const analysis = `雷达图展示五维指标对比分析：

优势维度（高于基准）：
${positiveGaps.map(g => `- ${g.name}：超出基准${g.gap.toFixed(1)}分（+${((g.ratio - 1) * 100).toFixed(1)}%）`).join('\n')}

待改善维度（低于基准）：
${negativeGaps.map(g => `- ${g.name}：低于基准${Math.abs(g.gap).toFixed(1)}分（${((g.ratio - 1) * 100).toFixed(1)}%）`).join('\n')}

最强维度为${maxGap.name}，最弱维度为${minGap.name}。`;

  const avgGap = gaps.reduce((sum, g) => sum + g.gap, 0) / gaps.length;
  const riskLevel: 'low' | 'medium' | 'high' = avgGap > 5 ? 'low' : avgGap < -5 ? 'high' : 'medium';

  return {
    title: data.title,
    summary: `综合得分${avgGap >= 0 ? '优于' : '低于'}基准${Math.abs(avgGap).toFixed(1)}分`,
    analysis,
    model: '多维对比分析模型',
    recommendation: negativeGaps.length > 0
      ? `建议重点关注${negativeGaps.map(g => g.name).join('、')}等维度的改善。`
      : '各维度表现均衡，建议继续保持并寻找进一步提升空间。',
    riskLevel,
    metrics: gaps.map(g => ({
      label: g.name,
      value: g.gap >= 0 ? `+${g.gap.toFixed(1)}` : g.gap.toFixed(1),
      trend: g.gap > 0 ? 'up' : g.gap < 0 ? 'down' : 'stable',
      status: g.gap >= 0 ? 'good' : 'risk',
    })),
  };
}

export function generateBoxPlotInsight(data: {
  groups: { label: string; median: number; q1: number; q3: number; status: string }[];
  title: string;
}): ChartInsight {
  const sorted = [...data.groups].sort((a, b) => b.median - a.median);
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;

  const analysis = `箱线图展示各产品线毛利率分布情况：

产品线排名（按中位数）：
${sorted.map((g, i) => `${i + 1}. ${g.label}：中位数${g.median.toFixed(1)}%，四分位距[${g.q1.toFixed(1)}%, ${g.q3.toFixed(1)}%]`).join('\n')}

表现最佳：${best.label}（中位数${best.median.toFixed(1)}%）
表现最弱：${worst.label}（中位数${worst.median.toFixed(1)}%）

毛利率分化程度：最高与最低相差${(best.median - worst.median).toFixed(1)}个百分点。`;

  return {
    title: data.title,
    summary: `最佳产品线${best.label}（${best.median.toFixed(1)}%），最弱${worst.label}（${worst.median.toFixed(1)}%）`,
    analysis,
    model: '统计分布分析模型',
    recommendation: `建议优化${worst.label}产品线的成本结构，同时总结${best.label}的成功经验进行推广。`,
    riskLevel: worst.median < 15 ? 'high' : worst.median < 20 ? 'medium' : 'low',
    metrics: data.groups.map(g => ({
      label: g.label,
      value: `${g.median.toFixed(1)}%`,
      status: g.status as 'good' | 'watch' | 'risk',
    })),
  };
}

export function generateTrendInsight(data: {
  points: { label: string; value: number; displayValue: string }[];
  title: string;
  trend: 'up' | 'down' | 'stable';
}): ChartInsight {
  const values = data.points.map(p => p.value);
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const change = ((last - first) / (first || 1) * 100);
  const max = data.points.reduce((m, p) => p.value > m.value ? p : m, data.points[0]!);
  const min = data.points.reduce((m, p) => p.value < m.value ? p : m, data.points[0]!);

  const trendText = data.trend === 'up' ? '上升趋势' : data.trend === 'down' ? '下降趋势' : '平稳波动';

  const firstPoint = data.points[0];
  const lastPoint = data.points[data.points.length - 1];

  const analysis = `趋势分析显示：

整体走势：${trendText}
- 起始值：${firstPoint?.displayValue ?? '--'}
- 终止值：${lastPoint?.displayValue ?? '--'}
- 变化幅度：${change >= 0 ? '+' : ''}${change.toFixed(1)}%

峰值：${max.label}达到${max.displayValue}
谷值：${min.label}降至${min.displayValue}

波动范围：${(max.value - min.value).toFixed(1)}个单位`;

  return {
    title: data.title,
    summary: `${trendText}，累计变化${change >= 0 ? '+' : ''}${change.toFixed(1)}%`,
    analysis,
    model: '时间序列趋势分析模型',
    recommendation: data.trend === 'down'
      ? '指标呈下降趋势，建议分析下降原因并制定改善措施。'
      : data.trend === 'up'
      ? '指标呈上升趋势，建议保持当前策略并关注可持续性。'
      : '指标波动平稳，建议寻找突破点实现增长。',
    riskLevel: data.trend === 'down' ? 'high' : data.trend === 'up' ? 'low' : 'medium',
    metrics: [
      { label: '变化幅度', value: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`, trend: data.trend },
      { label: '峰值', value: max.displayValue },
      { label: '谷值', value: min.displayValue },
    ],
  };
}

export function generateHeatmapInsight(data: {
  rows: string[];
  cols: string[];
  cells: { row: string; col: string; value: number; status: string }[];
  title: string;
}): ChartInsight {
  const riskCells = data.cells.filter(c => c.status === 'risk');
  const goodCells = data.cells.filter(c => c.status === 'good');
  const avgValue = data.cells.reduce((sum, c) => sum + c.value, 0) / data.cells.length;

  const analysis = `热力矩阵分析：

风险区域（${riskCells.length}个）：
${riskCells.slice(0, 5).map(c => `- ${c.row} × ${c.col}：${c.value.toFixed(0)}分`).join('\n')}

优势区域（${goodCells.length}个）：
${goodCells.slice(0, 5).map(c => `- ${c.row} × ${c.col}：${c.value.toFixed(0)}分`).join('\n')}

整体平均得分：${avgValue.toFixed(1)}分`;

  return {
    title: data.title,
    summary: `发现${riskCells.length}个风险点，${goodCells.length}个优势点`,
    analysis,
    model: '多维交叉分析模型',
    recommendation: riskCells.length > 0
      ? `建议优先处理${riskCells.slice(0, 3).map(c => `${c.row}-${c.col}`).join('、')}等高风险区域。`
      : '各区域表现良好，建议保持并持续监控。',
    riskLevel: riskCells.length > data.cells.length * 0.3 ? 'high' : riskCells.length > data.cells.length * 0.1 ? 'medium' : 'low',
    metrics: [
      { label: '风险点数', value: riskCells.length, status: 'risk' },
      { label: '优势点数', value: goodCells.length, status: 'good' },
      { label: '平均得分', value: avgValue.toFixed(1) },
    ],
  };
}

export function generateSankeyInsight(data: {
  nodes: { id: string; label: string; column: number }[];
  links: { source: string; target: string; value: number }[];
  title: string;
}): ChartInsight {
  const totalValue = data.links.reduce((sum, l) => sum + l.value, 0);
  const topLinks = [...data.links].sort((a, b) => b.value - a.value).slice(0, 3);

  const analysis = `资金流向分析：

主要流向（按流量排序）：
${topLinks.map((l, i) => {
  const source = data.nodes.find(n => n.id === l.source)?.label || l.source;
  const target = data.nodes.find(n => n.id === l.target)?.label || l.target;
  const pct = (l.value / totalValue * 100).toFixed(1);
  return `${i + 1}. ${source} → ${target}：${l.value.toFixed(0)}（占${pct}%）`;
}).join('\n')}

总流量：${totalValue.toFixed(0)}
流量集中度：前三大流向占比${(topLinks.reduce((s, l) => s + l.value, 0) / totalValue * 100).toFixed(1)}%`;

  return {
    title: data.title,
    summary: `总流量${totalValue.toFixed(0)}，主要流向${topLinks[0] ? `${data.nodes.find(n => n.id === topLinks[0]!.source)?.label}→${data.nodes.find(n => n.id === topLinks[0]!.target)?.label}` : ''}`,
    analysis,
    model: '流向网络分析模型',
    recommendation: '建议关注主要流向的资金效率，优化资源配置结构。',
    riskLevel: 'medium',
    metrics: topLinks.slice(0, 3).map(l => ({
      label: `${data.nodes.find(n => n.id === l.source)?.label}→${data.nodes.find(n => n.id === l.target)?.label}`,
      value: l.value.toFixed(0),
    })),
  };
}
