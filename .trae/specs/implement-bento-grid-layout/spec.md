# Implement Bento Grid Layout Spec

## Why
目前数据看板的布局（CSS 多列布局 / column-width）虽然能避免高度不一导致的单行留白，但依然是按照从上到下的流式排列，缺乏设计感。用户希望实现一种类似于“便当盒（Bento Box）”或“砖块严密砌墙”的布局方式：让不同类型的数据块呈现不同的大小（有的占据大块面积，有的占据小块面积），并且总体上能够像拼图一样严密填满整个界面，不留突兀的空白；同时在点击“展开”时，被展开的图表能够变大，而周围的图表依然能自动重新排列、填满缝隙。

## What Changes
- **布局重构**：将 `.viz-widget-grid` 从 `column-width` 恢复为 `display: grid`，并引入 `grid-auto-flow: dense;` 来实现密集填补空白的网格机制。
- **差异化尺寸 (Bento Box)**：
  - 定义基础网格系统，例如 `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));`。
  - 根据图表类型（`.viz-metricCards`, `.viz-barChart`, `.viz-zebraTable` 等）赋予不同的 `grid-column` 和 `grid-row` 跨度，形成“大小错落”的视觉效果。
- **展开状态优化**：
  - 调整 `.expanded` 类的跨度属性，使其在展开时占据更大的面积（例如 `grid-column: 1 / -1` 跨满行，或跨多行），依赖 `dense` 特性让其他小块自动填补剩余空间。
- **响应式适配**：在移动端或小屏幕下，平滑回退到单列流式布局。

## Impact
- Affected specs: UI Layout, Dashboard Visualization.
- Affected code: `src/web/styles.css` (主要修改网格系统的 CSS)。

## ADDED Requirements
### Requirement: 动态高密度网格布局 (Dense Grid)
系统应使用高密度网格算法自动排列大小不一的仪表盘卡片。
#### Scenario: 自动填补空白
- **WHEN** 页面存在一个占据 2x2 空间的大图表和一个占据 1x1 空间的小卡片
- **THEN** 系统会自动将小卡片“塞入”大图表旁边或上方的剩余 1x1 空白中，保持整体拼图的紧凑。

## MODIFIED Requirements
### Requirement: 数据块展开功能
- **WHEN** 用户点击图表的“展开”按钮
- **THEN** 图表扩展为占据整行或多行多列的尺寸，同时网格系统重新计算，将其他数据块挤到下方或侧边的空白处，界面仍保持填满状态。