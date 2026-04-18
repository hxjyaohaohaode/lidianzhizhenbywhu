# 首页布局与图表交互优化 Spec

## Why

当前首页图表容器宽高比失调（太长太窄），导致图表内容被压缩、重点不突出；每个图表嵌套了完整的 VisualizationBoard 组件（含标题栏、筛选行、刷新信息等冗余 DOM），7个图表同时渲染导致性能卡顿；ChartZoomWrapper 使用 CSS transform scale 缩放整个 DOM 子树，在嵌套 VisualizationBoard 场景下交互不稳定；数据刷新仅更新时间戳而不触发实际数据重获取。

## What Changes

- **修复图表宽高比**：调整 CSS 网格比例，使图表容器宽度充裕、高度合理（约 16:10 宽高比），底部辅助图表区高度从 35% 改为 30%
- **替换图表渲染方式**：从每个图表嵌套完整 VisualizationBoard 改为直接使用 chart-system.tsx 中的图表组件（RadarChartWidget、BarChartWidget 等），消除冗余 DOM 层级
- **优化 ChartZoomWrapper**：移除 CSS transform scale 方式，改为仅对图表内容区域（Recharts/Plotly canvas）进行缩放，避免缩放整个 DOM 子树导致的交互问题
- **修复数据刷新**：将首页刷新逻辑与 AppEnterpriseScreen/AppInvestorScreen 的 onRefreshData 回调连接，使刷新按钮和自动刷新真正触发数据更新
- **优化动画性能**：将 useChartAnimation 的 requestAnimationFrame 循环改为 CSS transition 驱动，减少 JS 动画帧开销

## Impact

- Affected code: `src/web/components/EnterpriseScreen.tsx`（EntHome 渲染方式重构）、`src/web/components/InvestorScreen.tsx`（InvHome 渲染方式重构）、`src/web/components/ChartZoomWrapper.tsx`（缩放机制优化）、`src/web/styles.css`（布局比例调整）、`src/web/chart-system.tsx`（动画性能优化）
- Affected systems: 首页渲染系统、图表交互系统、数据刷新系统

## ADDED Requirements

### Requirement: 图表容器宽高比优化

系统 SHALL 调整首页图表容器的宽高比，使图表内容清晰可读：

1. **中部主图表区**：`homepage-main-charts` 保持 2×2 网格，但行高比例从 `1fr 1fr` 改为 `55% 45%`，第一行略高以容纳雷达图和瀑布图
2. **底部辅助图表区**：`homepage-aux-charts` 高度从 `35%` 改为 `28%`，给中部图表更多空间
3. **指标卡行**：`homepage-metrics-row` 高度压缩，padding 从 `16px 20px` 改为 `12px 16px`
4. **整体间距**：gap 从 `16px` 改为 `12px`，减少空白浪费
5. **图表单元格**：`homepage-chart-cell` padding 从 `12px` 改为 `8px`，让图表内容区域更大

#### Scenario: 图表宽高比合理

- **WHEN** 用户查看首页
- **THEN** 每个图表容器宽度大于高度（约 16:10 宽高比），图表内容清晰可读，不被压缩

### Requirement: 图表直接渲染（消除 VisualizationBoard 嵌套）

系统 SHALL 将首页图表从嵌套 VisualizationBoard 改为直接使用 chart-system.tsx 中的图表组件：

1. 从 chart-system.tsx 导出 `renderWidgetByKind` 函数，根据 widget.kind 返回对应的图表组件
2. EntHome 和 InvHome 中每个 `homepage-chart-cell` 直接调用 `renderWidgetByKind(widget)` 渲染图表
3. 移除 `buildSingleWidgetPayload` 和 `buildSinglePayload` 辅助函数
4. 每个图表单元格仅包含：标题 + 图表组件，无额外 DOM 层级

#### Scenario: 图表直接渲染

- **WHEN** 首页加载
- **THEN** 每个图表单元格仅包含标题和图表组件，无 VisualizationBoard 的标题栏、筛选行、刷新信息等冗余元素

### Requirement: ChartZoomWrapper 缩放优化

系统 SHALL 优化 ChartZoomWrapper 的缩放机制：

1. **移除 CSS transform scale**：不再对整个子 DOM 树进行 scale 变换
2. **改为容器尺寸缩放**：通过调整图表容器的 width/height 来实现缩放效果，图表组件自动响应容器尺寸变化
3. **缩放控件简化**：仅保留 +/−/重置 三个按钮，移除 Shift+拖选区域放大（该功能在嵌套场景下不稳定）
4. **缩放范围调整**：从 30%~300% 改为 50%~200%（更实用的范围）
5. **移除 title prop 渲染**：ChartZoomWrapper 不再渲染标题（标题已在 homepage-chart-title 中）

#### Scenario: 图表缩放稳定

- **WHEN** 用户点击缩放按钮或滚动鼠标滚轮
- **THEN** 图表容器尺寸平滑变化，图表内容自动重绘，交互元素（悬浮弹窗、点击详情）位置正确

### Requirement: 数据刷新真正触发

系统 SHALL 确保首页刷新操作真正触发数据更新：

1. EntHome 和 InvHome 接收 `onRefreshData` 回调 prop
2. 手动刷新按钮点击时调用 `onRefreshData()`
3. 自动刷新定时器触发时调用 `onRefreshData()`
4. 刷新时间戳在 `onRefreshData` 完成后更新

#### Scenario: 手动刷新触发数据更新

- **WHEN** 用户点击刷新按钮
- **THEN** 系统调用 onRefreshData 回调触发数据重新获取，图表数据更新后刷新时间戳更新

#### Scenario: 自动刷新触发数据更新

- **WHEN** 60秒自动刷新间隔到达
- **THEN** 系统调用 onRefreshData 回调触发数据重新获取

### Requirement: 动画性能优化

系统 SHALL 优化图表动画性能：

1. **useChartAnimation**：将 requestAnimationFrame 循环改为一次性 setTimeout + CSS transition，避免持续 rAF 开销
2. **动画时长缩短**：从 800ms + stagger 改为 500ms + 50ms stagger，减少总动画时间
3. **减少重渲染**：useChartAnimation 的 animProgress 状态更新从每帧改为仅更新 3 次（0% → 50% → 100%）

#### Scenario: 首页加载流畅

- **WHEN** 首页首次加载
- **THEN** 7个图表在 1 秒内完成加载动画，无卡顿

## MODIFIED Requirements

### Requirement: 首页三段式布局

中部主图表区行高比例从等分改为 55%:45%，底部辅助图表区高度从 35% 改为 28%，间距从 16px 改为 12px。

### Requirement: ChartZoomWrapper 缩放

缩放方式从 CSS transform scale 改为容器尺寸缩放，缩放范围从 30%~300% 改为 50%~200%，移除 Shift+拖选。

## REMOVED Requirements

### Requirement: Shift+拖选区域放大

**Reason**: 在嵌套 VisualizationBoard 场景下不稳定，容易与图表内部交互冲突
**Migration**: 保留滚轮缩放和按钮缩放作为替代
