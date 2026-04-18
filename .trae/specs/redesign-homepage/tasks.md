# Tasks

* [x] Task 1: 重构首页三段式布局样式

  * [x] SubTask 1.1: 在 styles.css 中添加首页三段式布局 CSS（顶部指标卡行 + 中部2×2主图表 + 底部1×3辅助图表）

  * [x] SubTask 1.2: 添加核心指标卡样式（仅指标名+数值+状态色点，无描述文字）

  * [x] SubTask 1.3: 添加图表网格间距、毛玻璃效果、柔和阴影样式

  * [x] SubTask 1.4: 确保页面一屏展示无纵向滚动

* [x] Task 2: 重构企业端首页组件（EnterpriseScreen.tsx EntHome）

  * [x] SubTask 2.1: 重写 EntHome 组件，采用三段式布局替代当前 VisualizationBoard 线性堆叠

  * [x] SubTask 2.2: 顶部4个核心指标卡：GMPS指数/DQI指数/毛利率/现金流比率

  * [x] SubTask 2.3: 中部2×2主图表：经营质量雷达图/毛利承压瀑布图/毛利率分布箱型图/经营质量热力图

  * [x] SubTask 2.4: 底部1×3辅助图表：毛利率趋势折线图/毛利率营收散点图/成本流向桑基图

  * [x] SubTask 2.5: 移除所有冗余文字（subtitle/description/footnote/emphasisTag）

* [x] Task 3: 重构投资端首页组件（InvestorScreen.tsx InvHome）

  * [x] SubTask 3.1: 重写 InvHome 组件，采用三段式布局

  * [x] SubTask 3.2: 顶部4个核心指标卡：景气指数/承压概率/碳酸锂价格/配置立场

  * [x] SubTask 3.3: 中部2×2主图表：投资画像雷达图/行业风险箱型图/风险收益散点图/风险收益热力图

  * [x] SubTask 3.4: 底部1×3辅助图表：景气趋势折线图/投资三维气泡图/资金流向桑基图

  * [x] SubTask 3.5: 确保投资端图表与企业端完全不同

* [x] Task 4: 重构图表数据配置（chart-data.ts）

  * [x] SubTask 4.1: 重写 buildEnterpriseVisualization 函数，仅保留7个图表widget，所有参数严格来自 GMPS 五维度 + DQI 三维度

  * [x] SubTask 4.2: 重写 buildInvestorHomeVisualization 函数，仅保留7个图表widget，参数基于 GMPS/DQI 推导的投资端视角

  * [x] SubTask 4.3: 移除所有 widget 的 subtitle/description/footnote/emphasisTag/dataSources 字段

  * [x] SubTask 4.4: 确保企业端和投资端图表数据维度完全不同

* [x] Task 5: 增强图表动态交互（chart-system.tsx + ChartZoomWrapper.tsx）

  * [x] SubTask 5.1: 扩展缩放范围至 30%\~300%，添加触摸屏双指缩放支持

  * [x] SubTask 5.2: 实现毛玻璃浮动信息卡（替代传统 tooltip），包含指标名称+当前值+同比/环比+状态标签

  * [x] SubTask 5.3: 实现点击数据元素打开沉浸式详情面板（从点击位置缩放展开，300ms动画）

  * [x] SubTask 5.4: 详情面板内容：放大版图表 + 数据明细 + 关联指标 + 建议追问按钮

  * [x] SubTask 5.5: 添加图表加载动画（数据从0增长至目标值，800ms stagger）

  * [x] SubTask 5.6: 添加数据更新平滑过渡动画

  * [x] SubTask 5.7: 添加悬停数据点放大1.2倍+发光光晕效果

* [x] Task 6: 确保数据实时更新

  * [x] SubTask 6.1: 验证自动刷新间隔默认60秒

  * [x] SubTask 6.2: 刷新时图表数据平滑过渡

  * [x] SubTask 6.3: 页面右上角显示上次刷新时间

  * [x] SubTask 6.4: 手动刷新按钮可用

# Task Dependencies

* \[Task 2] depends on \[Task 1] (布局样式先完成)

* \[Task 3] depends on \[Task 1] (布局样式先完成)

* \[Task 4] depends on \[Task 2, Task 3] (数据配置需配合组件重构)

* \[Task 5] depends on \[Task 2, Task 3] (交互增强需配合组件重构)

* \[Task 6] depends on \[Task 4] (数据更新需配合数据配置)

