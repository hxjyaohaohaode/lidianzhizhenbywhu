# Tasks

- [x] Task 1: 扩展 VisualizationWidget 类型定义，新增 boxPlotChart、scatterChart、bubbleChart、heatmapChart、radarChart 五种图表类型
  - [x] SubTask 1.1: 在 `src/shared/business.ts` 中为每种新图表类型定义数据结构接口
  - [x] SubTask 1.2: 将新类型加入 VisualizationWidget 联合类型
  - [x] SubTask 1.3: 验证 TypeScript 编译通过

- [x] Task 2: 在 chart-system.tsx 中实现箱型图（BoxPlotChart）组件
  - [x] SubTask 2.1: 实现 BoxPlotChartWidget 组件，使用 Recharts 自定义渲染或 SVG 绘制箱型图
  - [x] SubTask 2.2: 支持悬浮详情面板，显示 Q1/Q3/中位数/最大值/最小值/离群值
  - [x] SubTask 2.3: 支持点击聚焦联动和状态着色
  - [x] SubTask 2.4: 支持浅色/暗色模式自适应

- [x] Task 3: 在 chart-system.tsx 中实现散点图（ScatterChart）组件
  - [x] SubTask 3.1: 实现 ScatterChartWidget 组件，使用 Recharts ScatterChart
  - [x] SubTask 3.2: 支持按状态着色、悬浮详情、点击聚焦联动
  - [x] SubTask 3.3: 支持浅色/暗色模式自适应

- [x] Task 4: 在 chart-system.tsx 中实现气泡图（BubbleChart）组件
  - [x] SubTask 4.1: 实现 BubbleChartWidget 组件，使用 Recharts ScatterChart + ZAxis
  - [x] SubTask 4.2: 支持三维数据映射（X/Y/气泡大小）、悬浮详情、点击聚焦联动
  - [x] SubTask 4.3: 支持浅色/暗色模式自适应

- [x] Task 5: 在 chart-system.tsx 中实现热力图（HeatmapChart）组件
  - [x] SubTask 5.1: 实现 HeatmapChartWidget 组件，使用 SVG 矩阵绘制连续色阶热力图
  - [x] SubTask 5.2: 支持悬浮显示具体数值、行列标签和指标说明
  - [x] SubTask 5.3: 支持浅色/暗色模式下的色阶适配
  - [x] SubTask 5.4: 支持点击聚焦联动

- [x] Task 6: 在 chart-system.tsx 中实现雷达图（RadarChart）组件
  - [x] SubTask 6.1: 实现 RadarChartWidget 组件，使用 Recharts RadarChart
  - [x] SubTask 6.2: 支持当前值和基准值双曲线、悬浮详情、点击聚焦联动
  - [x] SubTask 6.3: 支持浅色/暗色模式自适应

- [x] Task 7: 在 chart-system.tsx 中注册新图表组件到 WidgetBody 和 getWidgetLayoutClass
  - [x] SubTask 7.1: 在 WidgetBody switch 中新增五种图表类型的渲染分支
  - [x] SubTask 7.2: 更新 getWidgetLayoutClass 为新图表类型分配合适的网格跨度
  - [x] SubTask 7.3: 更新 isTableLikeWidget 函数（如需要）

- [x] Task 8: 在 chart-data.ts 中为首页构建新图表的丰富数据
  - [x] SubTask 8.1: 为企业端首页构建箱型图数据（毛利率分布）
  - [x] SubTask 8.2: 为企业端首页构建散点图数据（毛利率 × 营收）
  - [x] SubTask 8.3: 为企业端首页构建气泡图数据（毛利率 × 产销率 × 营收规模）
  - [x] SubTask 8.4: 为企业端首页构建热力图数据（经营质量矩阵）
  - [x] SubTask 8.5: 为企业端首页构建雷达图数据（经营质量五维度）
  - [x] SubTask 8.6: 为普通用户端首页构建对应的五种图表数据
  - [x] SubTask 8.7: 在 buildFilteredPayload 中新增五种图表类型的筛选响应逻辑

- [x] Task 9: 重新设计首页图表布局
  - [x] SubTask 9.1: 更新 styles.css 中的 viz-widget-grid 网格布局，支持 5 行多区布局
  - [x] SubTask 9.2: 更新 getHomeWidgetAreaClass 函数，映射新的网格区域
  - [x] SubTask 9.3: 调整企业端首页 widget 数组和排列顺序
  - [x] SubTask 9.4: 调整普通用户端首页 widget 数组和排列顺序
  - [x] SubTask 9.5: 确保移动端响应式布局正常

- [x] Task 10: 美化所有图表的视觉效果
  - [x] SubTask 10.1: 为新图表组件添加玻璃态容器样式和霓虹光晕效果
  - [x] SubTask 10.2: 为新图表组件添加动画过渡效果（至少 800ms）
  - [x] SubTask 10.3: 确保浅色模式下图表样式与暗色模式对等美观
  - [x] SubTask 10.4: 优化现有柱状图、折线图、瀑布图的视觉细节

- [x] Task 11: 验证与测试
  - [x] SubTask 11.1: 验证 TypeScript 编译通过
  - [x] SubTask 11.2: 验证企业端首页所有图表正常渲染
  - [x] SubTask 11.3: 验证普通用户端首页所有图表正常渲染
  - [x] SubTask 11.4: 验证时间窗切换时所有图表数据自动更新
  - [x] SubTask 11.5: 验证对标口径切换时所有图表数据自动更新
  - [x] SubTask 11.6: 验证浅色/暗色模式下所有图表正常显示
  - [x] SubTask 11.7: 验证悬浮详情、点击聚焦联动交互正常

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 1]
- [Task 5] depends on [Task 1]
- [Task 6] depends on [Task 1]
- [Task 7] depends on [Task 2, Task 3, Task 4, Task 5, Task 6]
- [Task 8] depends on [Task 1]
- [Task 9] depends on [Task 7, Task 8]
- [Task 10] depends on [Task 7]
- [Task 11] depends on [Task 9, Task 10]
