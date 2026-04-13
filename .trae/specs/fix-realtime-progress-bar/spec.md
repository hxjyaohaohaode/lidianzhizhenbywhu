# 修复进度条实时性 Spec

## Why
当前进度条显示100%且智能体工作内容不真实，根本原因是后端 `streamInvestorAnalysis` 采用"先完成、后通知"模式——`analyzeInvestor` 全部执行完毕后才发送 progress 事件，导致进度条从0%快速跳到100%，而非在分析过程中逐步推进。需要改造为真正的实时流式进度通知。

## What Changes

### 一、后端：在 diagnose 执行过程中实时发送 progress 事件
- 修改 `streamInvestorAnalysis` 方法，不再等 `analyzeInvestor` 完成后发送 progress，而是在 `diagnose` 的各个阶段实时回调发送
- 为 `diagnose` 方法添加 `onProgress` 回调参数，在每个智能体开始/完成时触发
- 在 `streamInvestorAnalysis` 中，先发送 progress 事件，再执行对应的分析步骤

### 二、前端：优化进度条渐进显示
- 移除 `result` 事件中对 progressPercent 的重复设置（避免从 timeline 最后一条强制设为100%）
- 确保进度条只在收到 progress 事件时更新，而非在 result 事件时被覆盖

## Impact
- Affected code:
  - `src/server/business-service.ts` — streamInvestorAnalysis 方法重构
  - `src/server/agent-service.ts` — diagnose 方法添加 onProgress 回调
  - `src/web/App.tsx` — handleStreamEvent 中 result 事件的 progressState 更新逻辑

## ADDED Requirements

### Requirement: 实时流式进度通知
系统SHALL在智能体工作流执行过程中实时发送进度事件，而非在分析完成后批量发送。

#### Scenario: 行业状况分析模式
- **WHEN** 用户发送行业状况分析请求
- **THEN** 系统SHALL在以下时刻分别发送 progress 事件：
  - 开始加载会话上下文时（8%）
  - 开始理解行业问题时（24%）
  - 开始检索外部证据时（52%）
  - 开始判断可行性时（76%）
  - 开始生成报告时（92%）
  - 分析完成时（100%）
- **AND** 每个进度事件SHALL在该步骤开始时发送，而非完成后

#### Scenario: 进度条渐进显示
- **WHEN** 用户发送分析请求
- **THEN** 进度条SHALL从0%逐步推进到100%
- **AND** 每个步骤之间应有真实的等待时间（取决于实际分析耗时）
- **AND** 进度条下方的智能体工作内容SHALL与当前正在执行的步骤一致

## MODIFIED Requirements

### Requirement: streamInvestorAnalysis 事件发送顺序
原实现为先执行 analyzeInvestor 再发送 progress 事件，修改为在 analyzeInvestor 执行过程中通过回调实时发送 progress 事件。

### Requirement: result 事件不再覆盖 progressState
原实现在 result 事件中从 timeline 最后一条重新设置 progressState（导致强制100%），修改为 result 事件仅设置 loading=false 和保存结果，不再修改 progressState。
