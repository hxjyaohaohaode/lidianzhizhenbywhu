# 首页图表全面美化与高级图表类型升级 Spec

## Why
当前首页图表体系虽然已具备柱状图、折线图、瀑布图和多种表格类型，但缺少箱型图、散点图、气泡图、热力图、雷达图等高级可视化形式，数据丰富度不足、动态交互能力有限、浅色/暗色模式适配不够完善，且首页图表布局不够美观。需要全面升级图表系统，使其具备更强的数据洞察力、更丰富的交互体验和更精致的视觉表现。

## What Changes
- 新增箱型图（BoxPlot）组件，用于展示毛利率、库存周转等关键指标的分布特征与离群值
- 新增散点图（ScatterChart）组件，用于展示多企业/多产品线的毛利率与营收关联关系
- 新增气泡图（BubbleChart）组件，用于展示三维数据关系（如毛利率 × 产销率 × 营收规模）
- 新增真正的热力图（HeatmapChart）组件，用于展示多维度多指标的连续色阶分布（区别于现有的 heatmapTable 表格形式）
- 新增雷达图（RadarChart）组件到 chart-system.tsx 体系，用于展示经营质量多维度对比
- 升级瀑布图组件，增强动态交互与视觉效果
- 所有新图表组件必须响应时间窗与对标口径筛选变化，数据自动更新
- 所有新图表组件必须同时支持浅色和暗色模式，确保可读性
- 所有新图表组件必须具备强交互能力：悬浮详情、点击聚焦、联动高亮、动画过渡
- 重新设计首页图表布局，使其更加美观、层次分明、视觉节奏合理
- 丰富首页图表数据，确保每个图表都有充足的数据点支撑

## Impact
- Affected specs: 角色感知图表系统升级、双角色分析工作台、主题模式适配
- Affected code: `src/web/chart-system.tsx`、`src/web/chart-data.ts`、`src/web/chart-renderer.tsx`、`src/web/styles.css`、`src/shared/business.ts`

## ADDED Requirements

### Requirement: 箱型图组件
系统 SHALL 在首页提供箱型图组件，展示关键财务指标的分布特征。

#### Scenario: 企业端查看毛利率分布
- **WHEN** 企业端用户在首页查看经营总览
- **THEN** 系统展示箱型图，显示行业毛利率的四分位分布、中位数、离群值
- **AND** 箱型图包含至少 4 组对比数据（如动力电池、储能电池、消费电池、上游材料）
- **AND** 悬浮时显示 Q1、Q3、中位数、最大值、最小值和离群值详情
- **AND** 切换时间窗或对标口径时，箱型图数据自动更新并带动画过渡

#### Scenario: 普通用户端查看风险分布
- **WHEN** 普通用户端在首页查看投资总览
- **THEN** 系统展示箱型图，显示关注标的的风险得分分布
- **AND** 箱型图清晰标注当前关注标的在分布中的位置

### Requirement: 散点图组件
系统 SHALL 在首页提供散点图组件，展示两个连续变量之间的关联关系。

#### Scenario: 企业端查看毛利率与营收关系
- **WHEN** 企业端用户在首页查看经营总览
- **THEN** 系统展示散点图，X 轴为营收规模、Y 轴为毛利率
- **AND** 散点图包含至少 12 个数据点，代表不同产品线或不同季度
- **AND** 每个散点悬浮时显示具体企业/产品名称、X 值、Y 值和状态标签
- **AND** 散点按状态（good/watch/risk）着色，支持点击聚焦联动

#### Scenario: 普通用户端查看收益与风险关系
- **WHEN** 普通用户端在首页查看投资总览
- **THEN** 系统展示散点图，X 轴为风险暴露、Y 轴为收益弹性
- **AND** 散点标注关注标的名称，悬浮显示详细指标

### Requirement: 气泡图组件
系统 SHALL 在首页提供气泡图组件，展示三维数据关系。

#### Scenario: 企业端查看经营三维视图
- **WHEN** 企业端用户在首页查看经营总览
- **THEN** 系统展示气泡图，X 轴为毛利率、Y 轴为产销匹配度、气泡大小为营收规模
- **AND** 气泡图包含至少 8 个数据点
- **AND** 气泡按状态着色，悬浮时显示三个维度的具体数值
- **AND** 切换时间窗时气泡位置和大小平滑过渡

#### Scenario: 普通用户端查看投资三维视图
- **WHEN** 普通用户端在首页查看投资总览
- **THEN** 系统展示气泡图，X 轴为行业景气、Y 轴为盈利弹性、气泡大小为市值规模

### Requirement: 热力图组件
系统 SHALL 在首页提供真正的热力图可视化组件（非表格形式），展示多维度多指标的连续色阶分布。

#### Scenario: 企业端查看经营质量热力图
- **WHEN** 企业端用户在首页查看经营总览
- **THEN** 系统展示热力图，行维度为经营指标（毛利率、库存周转、现金流、产销匹配），列维度为季度
- **AND** 热力图使用连续色阶（从深蓝到深红），悬浮时显示具体数值和指标说明
- **AND** 热力图包含至少 4 行 × 4 列的数据矩阵
- **AND** 切换对标口径时色阶基准自动调整

#### Scenario: 普通用户端查看风险收益热力图
- **WHEN** 普通用户端在首页查看投资总览
- **THEN** 系统展示热力图，行维度为关注标的，列维度为风险/收益指标

### Requirement: 雷达图组件（chart-system.tsx 体系）
系统 SHALL 在 chart-system.tsx 可视化体系中新增雷达图组件，与现有图表组件保持统一的交互协议和视觉风格。

#### Scenario: 企业端查看经营质量雷达图
- **WHEN** 企业端用户在首页查看经营总览
- **THEN** 系统展示雷达图，维度包括盈利能力、周转效率、现金流质量、产销匹配、杠杆安全
- **AND** 雷达图同时展示当前值和行业基准值两条曲线
- **AND** 悬浮时显示维度名称、当前值和基准差距
- **AND** 切换对标口径时基准曲线自动更新

#### Scenario: 普通用户端查看投资画像雷达图
- **WHEN** 普通用户端在首页查看投资总览
- **THEN** 系统展示雷达图，维度包括景气弹性、盈利修复、现金流安全、估值吸引力、政策支撑

### Requirement: 首页图表布局美化
系统 SHALL 重新设计首页图表布局，使其更加美观、层次分明、视觉节奏合理。

#### Scenario: 企业端首页布局
- **WHEN** 企业端用户进入首页
- **THEN** 首页图表按以下布局排列：
  - 第一行：核心指标卡（metricCards）+ 经营质量雷达图（radarChart）
  - 第二行：近4季度毛利率走势（lineChart）+ 利润演变瀑布图（waterfallChart）
  - 第三行：毛利率分布箱型图（boxPlotChart）+ 经营三维气泡图（bubbleChart）
  - 第四行：经营质量热力图（heatmapChart，全宽）
  - 第五行：对标对照表（benchmarkTable）+ 斑马纹成本结构表（zebraTable）
- **AND** 每行图表之间间距合理，视觉节奏清晰
- **AND** 图表卡片统一使用玻璃态风格，悬浮时有光晕效果

#### Scenario: 普通用户端首页布局
- **WHEN** 普通用户端用户进入首页
- **THEN** 首页图表按以下布局排列：
  - 第一行：投资指标卡（metricCards）+ 投资画像雷达图（radarChart）
  - 第二行：重点赛道热度柱状图（barChart）+ 风险收益散点图（scatterChart）
  - 第三行：投资三维气泡图（bubbleChart）+ 行业景气箱型图（boxPlotChart）
  - 第四行：风险收益热力图（heatmapChart，全宽）
  - 第五行：可比公司对标表（benchmarkTable）+ 斑马纹行业数据表（zebraTable）

### Requirement: 图表数据自动更新与筛选联动
系统 SHALL 确保所有新增图表组件在时间窗和对标口径切换时自动更新数据。

#### Scenario: 切换时间窗
- **WHEN** 用户切换时间窗（近4季度/滚动12月/未来观察）
- **THEN** 所有首页图表数据自动重新计算并更新
- **AND** 图表更新时带有平滑动画过渡效果
- **AND** 箱型图四分位数、散点图位置、气泡图大小和位置、热力图色阶、雷达图面积均相应变化

#### Scenario: 切换对标口径
- **WHEN** 用户切换对标口径（行业标准/头部企业/投资偏好）
- **THEN** 所有首页图表中的基准线和对标值自动更新
- **AND** 雷达图基准曲线更新、箱型图对标区间更新、散点图/气泡图对标参考线更新

### Requirement: 浅色与暗色模式图表适配
系统 SHALL 确保所有新增图表组件在浅色和暗色模式下都具备高可读性和一致的视觉表现。

#### Scenario: 暗色模式
- **WHEN** 系统处于暗色模式
- **THEN** 图表背景为深色半透明玻璃态，数据点使用霓虹色系，网格线低对比度
- **AND** 悬浮详情面板使用深色玻璃态，文字高对比度
- **AND** 热力图色阶在深色背景上清晰可辨

#### Scenario: 浅色模式
- **WHEN** 系统处于浅色模式
- **THEN** 图表背景为浅色半透明玻璃态，数据点使用饱和色系，网格线柔和
- **AND** 悬浮详情面板使用浅色玻璃态，文字深色高对比度
- **AND** 热力图色阶在浅色背景上清晰可辨

### Requirement: 图表强交互能力
系统 SHALL 为所有新增图表组件提供统一的强交互能力。

#### Scenario: 悬浮详情
- **WHEN** 用户悬浮在图表任意数据点上
- **THEN** 显示玻璃态详情面板，包含指标名称、具体数值、对标基准、状态标签和简要说明
- **AND** 详情面板带有对应状态色的光晕效果

#### Scenario: 点击聚焦联动
- **WHEN** 用户点击图表中的某个数据点
- **THEN** 该数据点高亮，其他数据点淡化
- **AND** 首页顶部显示聚焦分析横幅，包含该数据点的详细信息和追问建议
- **AND** 其他图表中相同维度的数据点同步高亮

#### Scenario: 动画过渡
- **WHEN** 图表数据因筛选变化或自动刷新而更新
- **THEN** 图表使用平滑动画过渡（至少 800ms），而非瞬间跳变
- **AND** 新数据点从零或旧位置平滑过渡到新位置

## MODIFIED Requirements

### Requirement: VisualizationWidget 类型扩展
现有 VisualizationWidget 联合类型 SHALL 新增以下 kind：`boxPlotChart`、`scatterChart`、`bubbleChart`、`heatmapChart`、`radarChart`。

### Requirement: buildFilteredPayload 函数扩展
现有 buildFilteredPayload 函数 SHALL 新增对 boxPlotChart、scatterChart、bubbleChart、heatmapChart、radarChart 类型 widget 的筛选响应逻辑。

### Requirement: WidgetBody 组件扩展
现有 WidgetBody 组件 SHALL 新增对 boxPlotChart、scatterChart、bubbleChart、heatmapChart、radarChart 类型 widget 的渲染分支。

### Requirement: getWidgetLayoutClass 函数扩展
现有 getWidgetLayoutClass 函数 SHALL 为新增图表类型分配合适的网格跨度。

### Requirement: 首页图表布局网格优化
现有首页图表布局网格 SHALL 从 3 行 5 区调整为 5 行多区布局，以容纳更多图表类型并保持美观。

## REMOVED Requirements
无移除需求。所有现有图表类型和功能保持不变，本次升级为纯增量。
