# Tasks

- [x] Task 1: 修复分析页面自动滚动问题
  - [x] SubTask 1.1: 修复投资端InvAna组件的scrollIntoView逻辑
  - [x] SubTask 1.2: 修复企业端EntAna组件的scrollIntoView逻辑
  - [x] SubTask 1.3: 为两个组件添加`hasInitializedRef`，确保首次激活不触发滚动

- [x] Task 2: 修复分析页面默认视图和辩论显示
  - [x] SubTask 2.1: 确认投资端默认模式为`industryStatus`，添加preserveMode保护
  - [x] SubTask 2.2: 修改辩论消息的显示条件，仅在`mode === "investmentRecommendation"`时显示
  - [x] SubTask 2.3: 修改分析结果面板中"正式辩论"区块的显示条件

- [x] Task 3: 实现智能体任务分级 - 后端
  - [x] SubTask 3.1: 在`src/shared/agents.ts`中添加`TaskComplexity`类型
  - [x] SubTask 3.2: 在`diagnosticAgentRequestSchema`中添加可选的`complexity`字段
  - [x] SubTask 3.3: 在`agent-service.ts`中添加`classifyQueryComplexity`函数
  - [x] SubTask 3.4: 修改`diagnose`方法，根据complexity选择执行路径
  - [x] SubTask 3.5: 在`diagnose`返回结果中添加`complexity`字段

- [x] Task 4: 实现智能体任务分级 - 前端
  - [x] SubTask 4.1: 在投资端和企业端发送请求时自动设置`complexity`字段
  - [x] SubTask 4.2: 在进度卡片中显示当前任务分级
  - [x] SubTask 4.3: 简单问题模式下隐藏不必要的进度步骤

- [x] Task 5: 验证
  - [x] SubTask 5.1: 验证分析页面打开时不自动滚动到底部
  - [x] SubTask 5.2: 验证新消息到达时自动滚动
  - [x] SubTask 5.3: 验证辩论内容仅在投资推荐模式下显示
  - [x] SubTask 5.4: 验证简单问题响应时间 < 2秒
  - [x] SubTask 5.5: 验证TypeScript编译0错误
