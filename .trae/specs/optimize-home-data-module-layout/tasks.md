# Tasks

- [x] Task 1: 移除 viz-section-shell 的两栏布局，改为单栏全宽布局
  - [x] SubTask 1.1: 修改 `styles.css` 中的 `.viz-section-shell` 样式，移除 `grid-template-columns: minmax(240px,300px) minmax(0,1fr)`，改为单栏布局
  - [x] SubTask 1.2: 移除 `.viz-section-rail` 的 `position: sticky` 和固定宽度样式
  - [x] SubTask 1.3: 将 `.viz-section-rail` 的内容整合到 `.viz-board-top` 中

- [x] Task 2: 优化 viz-board-top 布局，整合左侧信息栏内容
  - [x] SubTask 2.1: 修改 `chart-system.tsx` 中的 `VisualizationBoard` 组件，将 `viz-section-rail` 的内容移到 `viz-board-top`
  - [x] SubTask 2.2: 调整 `viz-board-top` 的样式，使其能够容纳更多信息
  - [x] SubTask 2.3: 优化 `viz-section-stats` 的显示方式，使其在顶部横向排列

- [x] Task 3: 优化 home-utility-grid 布局
  - [x] SubTask 3.1: 修改 `styles.css` 中的 `.home-utility-grid` 样式，调整为更合理的比例
  - [x] SubTask 3.2: 考虑在宽屏下使用更紧凑的布局，减少空白

- [x] Task 4: 优化 viz-widget-grid 的 widget span 分配
  - [x] SubTask 4.1: 修改 `chart-system.tsx` 中的 `getWidgetLayoutClass` 函数，调整 widget 的 span 分配
  - [x] SubTask 4.2: 使 metricCards 和 barChart 等组件能够更好地填充横向空间

- [x] Task 5: 响应式适配优化
  - [x] SubTask 5.1: 确保在小屏幕下布局仍然正常显示
  - [x] SubTask 5.2: 测试不同屏幕宽度下的布局效果

# Task Dependencies
- [Task 2] 依赖于 [Task 1] 的完成
- [Task 4] 可以与 [Task 1] 并行进行
- [Task 5] 应在所有布局修改完成后进行
