# Tasks

- [x] Task 1: 实现分步骤智能体进度指示器组件
  - [x] SubTask 1.1: 在 `styles.css` 中添加分步骤进度条的完整样式（`.iwb-step-progress`、步骤节点 `.iwb-step-node`、连接线 `.iwb-step-connector`、当前步骤脉冲动画等）
  - [x] SubTask 1.2: 在 `App.tsx` 中创建 `StepProgressIndicator` 组件，接收模式类型和当前进度状态，渲染对应模式的步骤定义与可视化
  - [x] SubTask 1.3: 定义三种分析模式的步骤数据结构（行业状况5步、深度解析5步、正式辩论5步），包含每步的名称、描述和图标
  - [x] SubTask 1.4: 将 `StepProgressIndicator` 集成到 `InvAna` 组件的消息流底部（替换或增强现有 `iwb-live-progress-wrap`）

- [x] Task 2: 增强主进度卡片为综合步骤概览
  - [x] SubTask 2.1: 升级 `iwb-progress-card` 样式，在百分比条上方增加横向步骤节点指示器
  - [x] SubTask 2.2: 在 App.tsx 中增强进度卡片渲染逻辑，将 `progressState` 映射到具体步骤节点高亮
  - [x] SubTask 2.3: 添加步骤节点的 tooltip 交互（hover 显示步骤名称和简要描述）

- [x] Task 3: 优化分析工作台头部区域视觉
  - [x] SubTask 3.1: 精修 tag 导航栏（`.mts` / `.mt2`）样式：更精致的胶囊选中态、平滑过渡动画
  - [x] SubTask 3.2: 优化操作按钮组（`.iwb-actions` / `.iwb-action-btn`）排列与视觉层次
  - [x] SubTask 3.3: 美化会话元信息标签（`.iwb-meta span`）样式

- [x] Task 4: 优化对话消息区域视觉效果
  - [x] SubTask 4.1: 增强用户消息气泡渐变与阴影效果（`.m.u .mb`）
  - [x] SubTask 4.2: 优化 AI 消息毛玻璃质感（`.m.a .mb`）
  - [x] SubTask 4.3: 美化辩论消息角色标识（`.iwb-debate-head` / `.iwb-debate-badge`）
  - [x] SubTask 4.4: 优化打字动画使用品牌色渐变（`.th i`）

- [x] Task 5: 优化输入区域交互反馈
  - [x] SubTask 5.1: 增强 `.ciw` 聚焦态光晕效果
  - [x] SubTask 5.2: 优化上传按钮（`.iwb-upload-entry`）和发送按钮（`.cse`）微交互动画

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] 可与 [Task 1] 并行
- [Task 4] 可与 [Task 1] 并行
- [Task 5] 可与 [Task 1] 并行
