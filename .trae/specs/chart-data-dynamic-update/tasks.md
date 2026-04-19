# 图表动态数据更新任务列表

## Task 1: 企业端成本结构图表数据动态化
替换 `buildEnterpriseVisualization` 中所有硬编码的成本相关数据为基于用户输入数据的动态计算。

- [x] SubTask 1.1: 修复 `zebraRows`（成本结构斑马表）
  - 将固定比例（62%/14%/16%/8%）替换为基于 `currentCost` 和 `currentManufacturingExpense` 的实际计算
  - 成本构成应根据用户输入的制造费用、营业成本等字段推导
  - 更新 `detail` 和 `note` 字段说明计算逻辑

- [x] SubTask 1.2: 修复 `treeRows`（成本分解树状表）
  - 将固定值替换为基于实际成本数据的动态计算
  - 各节点 metric 应反映真实的成本占比
  - 更新 `note` 字段说明数据来源

- [x] SubTask 1.3: 修复 `pivotRows`（多维交叉透视表）
  - 将固定的 "18.2%", "79%", "62天" 等值替换为基于实际数据的计算
  - 各产品线的毛利率、产销匹配度应从输入数据派生
  - 综合判断应基于实际指标而非固定字符串

## Task 2: 企业端箱线图数据动态化
替换 `boxPlotChart` 的完全硬编码数据为基于输入数据的统计分布。

- [x] SubTask 2.1: 建立箱线图数据计算函数
  - 根据用户输入的毛利率和营收数据，结合行业基准，计算各产品线的 min/q1/median/q3/max
  - 引入合理的统计分布模型（如正态分布或经验分布）
  - 确保分布范围与用户输入的毛利率数值相关联

- [x] SubTask 2.2: 更新箱线图 `detail` 说明
  - 每个产品线的 detail 应反映真实的计算过程
  - 说明该分布是基于行业经验模型推导，而非实际统计值

## Task 3: 企业端散点图数据动态化
替换 `scatterChart` 的硬编码坐标为基于季度趋势的动态数据。

- [x] SubTask 3.1: 散点图数据与季度系列关联
  - x轴（营收）应从 `quarterSeries` 的营收数据派生
  - y轴（毛利率）应使用 `quarterSeries` 的毛利率数据
  - 各产品线的散点应基于用户输入的不同产品线数据（如有）或合理推算

- [x] SubTask 3.2: 更新散点图 detail 说明
  - 每个点的 detail 应反映其计算来源
  - 说明散点图展示的是营收与毛利率的相关性

## Task 4: 企业端桑基图数据动态化
替换 `sankeyChart` 的硬编码流量值为基于成本结构的真实流向。

- [x] SubTask 4.1: 桑基图流量与成本数据关联
  - 各成本项到产品线的流量应根据成本占比计算
  - 总流量应与 `currentCost` 和 `currentRevenue` 相关联
  - 确保源节点总和 = 目标节点总和（流量守恒）

- [x] SubTask 4.2: 更新桑基图节点和链接说明
  - 节点颜色应与数据状态（good/watch/risk）关联
  - 链接的 value 应有明确的计算来源说明

## Task 5: 企业端热力图硬编码数据动态化
替换 `heatmapChart` 中的硬编码固定值为基于模型的动态计算。

- [x] SubTask 5.1: 修复完全硬编码的单元格
  - "成长能力"、"现金流质量"、"材料成本冲击"等维度的基准期固定值（88/92/78/90/72/92）应替换为基于输入数据的计算
  - 所有单元格值应从用户输入或行业基准动态推导
  - 确保热力图数据与 radarChart 数据保持一致

- [x] SubTask 5.2: 更新热力图 note 说明
  - 每个单元格的 note 应反映该数据点的计算逻辑
  - 区分"用户输入数据"、"行业基准数据"和"模型计算数据"

## Task 6: 企业端日历视图数据动态化
替换 `calendarEntries` 的固定描述为基于当前数据的动态建议。

- [x] SubTask 6.1: 日历视图与经营数据关联
  - 每天的 label 和 value 应根据当前经营状况动态生成
  - detail 应反映具体的经营建议和关注点
  - status 应根据相关指标的实际状态确定

## Task 7: 投资端箱线图数据动态化
替换 `buildInvestorHomeVisualization` 中 `boxPlotChart` 的硬编码数据。

- [x] SubTask 7.1: 行业风险箱线图与行业基准关联
  - 各赛道的 min/q1/median/q3/max 应从行业基准数据（`getIndustryStandard()`）派生
  - 风险分布应反映真实的行业风险水平
  - detail 应说明数据来源和计算方法

## Task 8: 投资端散点图数据动态化
替换投资端 `scatterChart` 的硬编码公司坐标数据。

- [x] SubTask 8.1: 建立投资散点图数据计算逻辑
  - 各公司的风险(x)和收益(y)评分应基于行业基准和公开数据派生
  - 不得使用完全任意的固定值
  - 如无法获取真实数据，应明确标注为"行业经验估算值"

- [x] SubTask 8.2: 更新散点图 detail 说明
  - 每个公司的 detail 应说明评分依据
  - 区分"真实数据"和"经验估算"

## Task 9: 投资端桑基图和气泡图数据动态化
替换投资端 `sankeyChart` 和 `bubbleChart` 的硬编码数据。

- [x] SubTask 9.1: 桑基图资金流向与投资偏好关联
  - 各赛道的资金分配应根据用户画像的 riskAppetite 和投资偏好动态调整
  - 收益/风险/对冲的比例应基于行业基准计算

- [x] SubTask 9.2: 气泡图三维数据动态化
  - 各公司的景气(x)、盈利(y)、市值(z)应从行业数据派生
  - 市值数据可保留近似值，但应标注数据来源
  - 景气度和盈利弹性应与行业基准关联计算

## Task 10: 投资分析页图表数据动态化
替换 `buildInvestorAnalysisVisualization` 中的硬编码数据。

- [x] SubTask 10.1: 修复 `heatmapRows` 的完全硬编码值
  - 将 [76,81,68,72] 等固定数组替换为基于数学模型输出的动态计算
  - 收益弹性、风险暴露、证据强度应从 `mathAnalysis`、`evidenceReview` 等实际数据派生

- [x] SubTask 10.2: 修复 `pivotRows` 的固定情景描述
  - 基准/中性/压力情景的值应基于数学模型的预测结果
  - 立场和动作建议应与 `recommendationScore` 和 `stance` 关联

- [x] SubTask 10.3: 修复 `sparkRows` 的固定趋势数组
  - 将 [62,66,70,score] 等固定数组替换为基于历史会话数据的动态趋势
  - 如无历史数据，应使用合理的计算逻辑而非固定值

## Task 11: 数据说明文档完善
为所有图表完善 `detail`、`note`、`sourceMeta` 等说明字段。

- [x] SubTask 11.1: 统一数据说明格式
  - 每个图表的数据点必须包含 `detail` 字段，说明计算来源
  - 每个图表必须包含 `note` 字段，说明业务含义
  - `sourceMeta` 必须区分"用户输入"、"行业基准"、"模型计算"、"经验估算"

- [x] SubTask 11.2: 为所有图表添加数据溯源信息
  - 企业端首页所有 widget 的 detail/note 必须完整
  - 投资端首页所有 widget 的 detail/note 必须完整
  - 投资分析页所有 widget 的 detail/note 必须完整

## Task 12: LLM 辅助图表生成功能
为复杂分析图表提供 DeepSeek LLM 接口生成智能洞察。

- [x] SubTask 12.1: 在 `src/server/llm.ts` 中添加图表洞察生成接口
  - 接收图表实际数据作为 prompt 上下文
  - 生成基于真实数据的分析洞察和业务建议
  - 确保 LLM 输出不包含编造的虚假数据

- [x] SubTask 12.2: 在 `ChartWithInsightPanel.tsx` 中集成 LLM 洞察
  - 当图表数据更新时，可选择调用 LLM 生成详细分析
  - 提供"AI 生成分析"的明确标识
  - 支持用户查看原始数据和 AI 分析的双视图

# Task Dependencies
- [Task 2] depends on [Task 1] (箱线图需要成本结构数据)
- [Task 3] depends on [Task 1] (散点图需要季度系列数据)
- [Task 4] depends on [Task 1] (桑基图需要成本结构数据)
- [Task 5] depends on [Task 1] (热力图需要各维度计算基础)
- [Task 8] depends on [Task 7] (散点图和箱线图使用相似的行业数据逻辑)
- [Task 9] depends on [Task 8] (气泡图和散点图使用相似的公司数据逻辑)
- [Task 11] depends on [Task 1-10] (数据说明需要在数据动态化完成后完善)
- [Task 12] depends on [Task 11] (LLM 洞察需要完整的数据说明作为上下文)
