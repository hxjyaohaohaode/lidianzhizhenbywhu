# 图表动态数据更新规范 Spec

## Why

当前系统中大量图表使用硬编码的虚假数据，无法根据用户输入和企业真实数据进行动态更新。这导致：
1. 图表显示的数据与企业实际经营情况无关，失去诊断价值
2. 数据说明（sourceMeta、detail、note等）无法反映真实数据来源和计算逻辑
3. 用户无法信任系统输出的分析结果
4. 违背了"智能诊断系统"的核心设计目标

## What Changes

- **替换所有硬编码虚假数据为动态计算数据**：包括箱线图、散点图、桑基图、热力图、数据透视表等
- **建立数据派生规则**：所有图表数据必须从用户输入的原始数据（毛利率、营收、成本、产销等）通过数学模型或计算公式派生
- **完善数据说明文档**：每个图表必须包含详细的 `detail`、`note`、`sourceMeta` 说明，解释数据来源和计算逻辑
- **支持 LLM 辅助生成**：为复杂图表提供 DeepSeek LLM 接口，根据用户数据生成智能化的图表数据和分析说明
- **建立数据一致性验证**：确保同一数据集在不同图表中的表现逻辑一致

## Impact

- Affected specs: 图表渲染模块、数据可视化系统、数学模型集成
- Affected code:
  - `src/web/chart-data.ts` - 核心图表数据构建函数（大量硬编码需替换）
  - `src/web/chart-renderer.tsx` - 图表渲染组件
  - `src/web/components/ChartWithInsightPanel.tsx` - 图表洞察面板
  - `src/web/utils/chart-insights.ts` - 图表洞察生成逻辑
  - `src/web/dqi-gmps-panels.tsx` - DQI/GMPS 面板组件
  - `src/server/llm.ts` - LLM 服务（新增图表数据生成功能）
  - `src/shared/business.ts` - 可视化数据类型定义

## ADDED Requirements

### Requirement: 图表数据动态计算
所有图表数据SHALL根据用户输入的原始数据进行动态计算，不得使用硬编码的固定值。

#### Scenario: 企业端首页图表生成
- **WHEN** 用户提交企业数据表单（毛利率、营收、成本、产销、资产负债等）
- **THEN** 系统应根据这些数据动态计算所有图表的数据点
- **AND** 图表数据必须与输入数据保持数学上的一致性
- **AND** 图表数据说明（detail/note）必须反映计算逻辑

#### Scenario: 投资端图表生成
- **WHEN** 用户查看投资分析页面
- **THEN** 图表数据应基于目标企业的实际经营数据和行业基准动态计算
- **AND** 不得使用与用户关注企业无关的硬编码公司数据

### Requirement: 数据说明详细可追溯
每个图表SHALL提供详细的数据说明，包括数据来源、计算方法和参考基准。

#### Scenario: 用户查看图表数据来源
- **WHEN** 用户悬停或点击图表元素
- **THEN** 应显示该数据点的详细计算过程
- **AND** 应标明该数据来自用户输入、行业基准还是模型计算

### Requirement: LLM 辅助图表生成
对于需要复杂分析的图表（如洞察面板、分析摘要），系统SHALL支持调用 DeepSeek LLM 生成智能化的数据说明和分析建议。

#### Scenario: 生成图表洞察分析
- **WHEN** 图表数据更新完成
- **THEN** 系统可调用 LLM 根据实际数据生成分析洞察
- **AND** LLM 输出必须基于真实的图表数据，不得编造虚假数据

## MODIFIED Requirements

### Requirement: 企业端首页图表数据
`buildEnterpriseVisualization` 函数中所有硬编码数据必须替换为动态计算：

**需修复的硬编码数据块：**
1. `zebraRows` (成本结构树表) - 当前使用固定比例 62%/14%/16%/8%
2. `treeRows` (成本分解树) - 当前使用固定值
3. `pivotRows` (多维透视表) - 当前使用固定值 "18.2%", "79%", "62天"
4. `calendarEntries` (日历视图) - 当前使用固定描述
5. `boxPlotChart` (箱线图) - 当前使用完全硬编码的 min/q1/median/q3/max
6. `scatterChart` (散点图) - 当前使用硬编码的 x/y 坐标
7. `sankeyChart` (桑基图) - 当前使用硬编码的流量值
8. `heatmapChart` (热力图) - 部分单元格使用硬编码固定值

### Requirement: 投资端图表数据
`buildInvestorHomeVisualization` 函数中的硬编码数据必须替换：

**需修复的硬编码数据块：**
1. `boxPlotChart` - 硬编码的行业风险分布
2. `scatterChart` - 硬编码的12家公司风险收益坐标
3. `sankeyChart` - 硬编码的资金流向
4. `bubbleChart` - 硬编码的8家公司三维数据
5. `heatmapChart` - 使用固定偏移量而非真实派生

### Requirement: 投资分析页图表数据
`buildInvestorAnalysisVisualization` 函数中的硬编码数据必须替换：

**需修复的硬编码数据块：**
1. `heatmapRows` - 完全硬编码的 [76,81,68,72] 等值
2. `pivotRows` - 硬编码的三情景描述
3. 部分 `sparkRows` 趋势数据使用固定数组

## REMOVED Requirements
无移除的需求。
