# Tasks

- [x] Task 1: 恢复并升级基础网格系统
  - [x] SubTask 1.1: 将 `styles.css` 中的 `.viz-widget-grid` 从 `column-width` 改为 `display: grid`。
  - [x] SubTask 1.2: 引入 `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))` 与 `grid-auto-flow: row dense`，使得不同大小的网格可以紧密地填满空白。
  - [x] SubTask 1.3: 取消原来为多列布局设置的 `display: inline-block`、`break-inside: avoid` 等属性。

- [x] Task 2: 差异化不同数据块的尺寸跨度 (Bento Box 风格)
  - [x] SubTask 2.1: 为 `.viz-metricCards`（投资指标卡）、`.viz-cardTable`（卡片式分组表格）等较窄或单行内容较适合的模块设置 `grid-column: span 1` 或 `span 2`，让它们占据标准或宽的尺寸。
  - [x] SubTask 2.2: 为 `.viz-barChart`（柱状图）、`.viz-lineChart`（折线图）等大尺寸可视化图表设置 `grid-column: span 2`（或更宽的跨度），并适当调整 `grid-row` 的行跨度。
  - [x] SubTask 2.3: 为 `.viz-zebraTable`、`.viz-benchmarkTable` 等复杂数据表格赋予跨 2 列的能力。

- [x] Task 3: 优化图表展开状态 (Expanded)
  - [x] SubTask 3.1: 调整 `.viz-widget.expanded` 的样式，当被点击展开时，令其占据整行（`grid-column: 1 / -1`）并增加行跨度（如 `grid-row: span 2`），由于使用了 `dense`，其他小图表会自动环绕填满剩下的缝隙。
  - [x] SubTask 3.2: 确保在小屏幕下（`< 1100px` 或 `< 820px`），所有图表都优雅降级为占据单列 `1fr` 的普通流式列表，避免排版错误。

# Task Dependencies
- [Task 2] 与 [Task 3] 强依赖于 [Task 1] 的基础 `grid` 容器构建。