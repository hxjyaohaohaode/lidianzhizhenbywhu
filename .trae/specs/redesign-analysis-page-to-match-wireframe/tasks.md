# Tasks

- [x] Task 1: 调整分析页面整体布局与图表位置
  - [x] SubTask 1.1: 在 `src/web/App.tsx` 的 `InvAna` 组件中，将 `{analysisVisualization ? <div className="page-viz-stack iwb-viz-stack">...</div> : null}` 代码块从 `.cly` 容器上方移动到下方。
  - [x] SubTask 1.2: 在 `src/web/styles.css` 中调整 `.pg.iwb-page` 与 `.iwb-page .cly` 的样式，确保整体支持垂直滚动，且图表部分自然跟在主体对话区下方。

- [x] Task 2: 重构顶部导航栏与操作区
  - [x] SubTask 2.1: 在 `App.tsx` 中，将左侧面板顶部的 `.iwb-top`、`.iwb-meta`、`.mts` 和 `.iwb-actions` 合并精简为一个名为 `.iwb-unified-nav` 的顶部导航栏。
  - [x] SubTask 2.2: 在 `styles.css` 中为 `.iwb-unified-nav` 添加样式，确保左侧为模式标签/历史对话等，右侧为操作按钮，符合高颜值美观设计要求。

- [x] Task 3: 调整进度条位置与样式
  - [x] SubTask 3.1: 在 `App.tsx` 中，将进度指示器逻辑从对话消息列表的上方移动到紧挨着输入框容器（`.cia`）的上方（或将其融入输入框容器顶部）。
  - [x] SubTask 3.2: 在 `styles.css` 中调整该进度条的样式，将其设计为水平的“当前进度：[文本] [条状进度]”格式，与输入框融为一体，提升沉浸感。

- [x] Task 4: 优化侧边栏区块卡片样式
  - [x] SubTask 4.1: 在 `styles.css` 中调整侧边栏（`.csb`）内区块（`.ss`）的样式，通过背景色、圆角、间距等，让它们在视觉上表现为彼此独立的堆叠卡片。

# Task Dependencies
- [Task 1] 独立进行。
- [Task 2] 和 [Task 3] 依赖于 [Task 1] 的基础布局结构。
- [Task 4] 依赖于 [Task 1] 的基础布局结构。
