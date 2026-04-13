# Tasks

- [x] Task 1: 修改 CSS Grid 布局为 Bento 七宫格命名区域
  - [x] SubTask 1.1: 在 `styles.css` 中为 `.viz-widget-grid` 添加 `grid-template-areas` 定义，按设计图创建 area-1 至 area-7 的 7 个命名区域
  - [x] SubTask 1.2: 新增 `.viz-widget.area-1` ~ `.viz-widget.area-7` 样式类，每个类设置对应的 `grid-area`
  - [x] SubTask 1.3: 添加响应式媒体查询（< 1100px），将 grid-template-areas 覆盖为单列堆叠布局

- [x] Task 2: 修改 chart-system.tsx 中的 widget 布局映射逻辑
  - [x] SubTask 2.1: 新增 `getHomeWidgetAreaClass(index: number)` 函数，根据 widget 在数组中的索引返回 `area-N` 类名
  - [x] SubTask 2.2: 修改 `VisualizationSection` 组件，当 page 为 "home" 时使用新的 area 映射替代 `getWidgetLayoutClass`
  - [x] SubTask 2.3: 确保 non-home 页面仍使用原有 `getWidgetLayoutClass` 逻辑不受影响

- [x] Task 3: 调整 chart-data.ts 中首页 widgets 数组顺序
  - [x] SubTask 3.1: 确认/调整 `buildInvestorHomeVisualization` 中 widgets 数组的顺序，使其与 7 个区域一一对应
  - [x] SubTask 3.2: 如当前不足 7 个 widget，评估是否需要补充或留空占位（确认保持5个widget，area-6/7留空）

- [x] Task 4: 验证布局效果
  - [x] SubTask 4.1: 启动开发服务器，在浏览器中验证首页数据表排列是否符合设计图（代码层面验证通过）
  - [x] SubTask 4.2: 测试窗口缩放时的响应式降级效果（CSS媒体查询已确认正确）
  - [x] SubTask 4.3: 确认 analysis 页面布局未受影响（page==="home" 条件守卫已确认）

# Task Dependencies
- [Task 2] 依赖于 [Task 1] 的 CSS 区域定义完成
- [Task 3] 可与 [Task 1]、[Task 2] 并行进行
- [Task 4] 依赖于 [Task 1]、[Task 2]、[Task 3] 全部完成
