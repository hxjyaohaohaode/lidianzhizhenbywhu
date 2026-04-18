# Tasks

- [x] Task 1: 修复图表容器宽高比（CSS 调整）
  - [x] SubTask 1.1: 调整 homepage-main-charts 行高比例为 55%:45%
  - [x] SubTask 1.2: 调整 homepage-aux-charts 高度从 35% 改为 28%
  - [x] SubTask 1.3: 压缩 homepage-metric-card padding 为 12px 16px
  - [x] SubTask 1.4: 整体间距 gap 从 16px 改为 12px
  - [x] SubTask 1.5: homepage-chart-cell padding 从 12px 改为 8px

- [x] Task 2: 替换图表渲染方式（消除 VisualizationBoard 嵌套）
  - [x] SubTask 2.1: 在 chart-system.tsx 中导出 renderWidgetByKind 函数
  - [x] SubTask 2.2: 重写 EntHome 使用 renderWidgetByKind 直接渲染图表
  - [x] SubTask 2.3: 重写 InvHome 使用 renderWidgetByKind 直接渲染图表
  - [x] SubTask 2.4: 移除 buildSingleWidgetPayload / buildSinglePayload 辅助函数

- [x] Task 3: 优化 ChartZoomWrapper 缩放机制
  - [x] SubTask 3.1: 移除 CSS transform scale，改为容器尺寸缩放
  - [x] SubTask 3.2: 缩放范围从 30%~300% 改为 50%~200%
  - [x] SubTask 3.3: 移除 Shift+拖选区域放大功能
  - [x] SubTask 3.4: 移除 title prop 渲染
  - [x] SubTask 3.5: 简化缩放控件为 +/−/重置 三个按钮

- [x] Task 4: 修复数据刷新真正触发
  - [x] SubTask 4.1: EntHome 接收 onRefreshData 回调 prop
  - [x] SubTask 4.2: InvHome 接收 onRefreshData 回调 prop
  - [x] SubTask 4.3: 手动刷新按钮调用 onRefreshData
  - [x] SubTask 4.4: 自动刷新定时器调用 onRefreshData

- [x] Task 5: 优化动画性能
  - [x] SubTask 5.1: useChartAnimation 改为 setTimeout + CSS transition
  - [x] SubTask 5.2: 动画时长从 800ms 改为 500ms，stagger 从 100ms 改为 50ms
  - [x] SubTask 5.3: animProgress 状态更新从每帧改为 3 次（0% → 50% → 100%）

# Task Dependencies
- [Task 2] depends on [Task 1] (布局调整先完成)
- [Task 3] depends on [Task 2] (缩放优化需配合新的渲染方式)
- [Task 4] depends on [Task 2] (刷新逻辑需配合新的组件 props)
- [Task 5] depends on [Task 2] (动画优化需配合新的渲染方式)
