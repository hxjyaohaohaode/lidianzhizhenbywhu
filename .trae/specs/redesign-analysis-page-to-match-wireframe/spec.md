# Redesign Analysis Page Layout to Match Wireframe Spec

## Why
用户希望按照提供的设计原型（Wireframe）重新调整分析页面的样式，确保界面美观且能很好地完成对话。关键改动包括：合并顶部导航栏（标签、模式切换、历史与新建对话）、调整进度条显示位置与样式以贴合智能体工作进度、将审计数据（图表系统）移动至底部、以及优化侧边栏区块布局。

## What Changes
- **布局重构（Layout Restructuring）**：
  - 在 `App.tsx` 的 `InvAna` 组件中，将渲染图表系统的 `page-viz-stack` 容器移动到主工作区（`cly`）的下方，确保符合原型底部展示图表的设计。
  - 在 `styles.css` 中调整 `.pg.iwb-page` 及内部容器的样式，以支持上下垂直流式布局，保证上方对话区和右侧侧边栏占据合适高度，下方图表区正常显示。
- **顶部导航栏合并（Top Navigation Bar）**：
  - 在 `App.tsx` 中，将原有的标签导航、模式切换按钮（`.mts`）和各种操作按钮（`.iwb-actions`）合并到一个统一的顶部导航栏（如 `.iwb-unified-nav`）中。
  - 简化原有冗余的标题结构，保持界面清爽。
- **进度条位置与样式优化（Progress Bar Relocation & Styling）**：
  - 将主进度条或实时进度指示器（`iwb-progress-card` 或 `iwb-live-progress`）移动至对话流底部、输入框（`.cia`）的紧上方。
  - 重新设计进度条样式，采用水平进度条并带有文字提示（如“当前进度：[当前阶段]”），使其在视觉上更为轻量化且与对话流紧密结合。
- **侧边栏区块优化（Sidebar Refinement）**：
  - 在 `styles.css` 中优化侧边栏（`.csb`）内各区块（`.ss`）的样式，使其呈现为独立堆叠的卡片区块，与原型图中的多区块堆叠保持一致。

## Impact
- 受影响的功能：分析页面的整体视觉结构、会话历史与模式切换入口、智能体进度提示、图表展示区域。
- 受影响的代码：`src/web/App.tsx`，`src/web/styles.css`。

## ADDED Requirements
### Requirement: New Analysis Workspace Layout
系统应呈现全新的分析工作台布局，左侧为带有统一导航栏和底部进度条的对话面板，右侧为独立区块堆叠的侧边栏，整体界面底部为宽幅的审计数据图表仪表盘。

#### Scenario: Agent Progress Display
- **WHEN** 智能体正在处理请求时
- **THEN** 输入框上方会显示一条水平进度条，提示当前完成的步骤及真实数据处理进度。
