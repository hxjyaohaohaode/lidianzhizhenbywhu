# 分析页面修复与智能体任务分级 Spec

## Why
分析页面打开时自动滚动到最底部并默认显示"AI辩论"功能，导致用户无法正常使用；当前智能体工作流对所有问题都执行完整的8步流水线，简单问题耗时过长。需要修复页面交互问题并实现任务分级制度。

## What Changes

### 一、分析页面自动滚动修复
- 修复投资端分析页面（InvAna）的`scrollIntoView`在`isActive`变化时无条件触发，导致页面打开即滚到底部
- 修复企业端分析页面（EntAna）同样的问题
- 仅在有新消息到达或流式更新时才自动滚动

### 二、分析页面默认视图修复
- 投资端默认模式为`industryStatus`（行业状况分析），但`investmentRecommendation`模式会触发辩论流程，导致页面默认显示辩论内容
- 修复模式切换逻辑，确保页面初始状态显示正确的模式内容
- 辩论内容仅在`investmentRecommendation`模式下显示，不应污染其他模式的视图

### 三、智能体任务分级制度
- 实现简单问题/复杂问题的自动识别
- 简单问题（如数据查询、指标计算）：仅执行`mathAnalysis`智能体，跳过LLM调用
- 中等复杂问题（如行业分析、经营诊断）：执行`mathAnalysis` + `dataGathering` + `industryRetrieval`并行
- 复杂问题（如投资建议、深度解析）：执行完整8步流水线（含辩论）

## Impact
- Affected code:
  - `src/web/App.tsx` — 分析页面滚动逻辑、模式默认值、辩论显示条件
  - `src/server/agent-service.ts` — 智能体工作流分级逻辑
  - `src/shared/agents.ts` — 任务分级类型定义

## ADDED Requirements

### Requirement: 分析页面滚动行为
系统SHALL仅在对话消息更新时自动滚动到底部，页面初次激活时不触发自动滚动。

#### Scenario: 页面初次打开
- **WHEN** 用户切换到分析页面（isActive变为true）
- **THEN** 页面SHALL停留在顶部，不自动滚动到底部

#### Scenario: 新消息到达
- **WHEN** AI回复消息到达或流式更新
- **THEN** 页面SHALL自动滚动到最新消息位置

### Requirement: 智能体任务分级
系统SHALL根据问题复杂度自动选择执行路径，简单问题跳过不必要的LLM调用以降低耗时。

#### Scenario: 简单问题（数据查询/指标计算）
- **WHEN** 用户输入简单问题（如"当前毛利率是多少"、"计算DQI指数"）
- **THEN** 系统仅执行`mathAnalysis`智能体（本地计算），跳过LLM调用
- **AND** 响应时间SHALL < 2秒

#### Scenario: 中等复杂问题（行业分析/经营诊断）
- **WHEN** 用户输入中等复杂问题（如"分析毛利承压情况"、"行业景气如何"）
- **THEN** 系统执行`mathAnalysis` + `dataGathering` + `industryRetrieval`并行
- **AND** 跳过`taskOrchestrator`、`memoryManagement`、`dataUnderstanding`的LLM调用
- **AND** 响应时间SHALL < 10秒

#### Scenario: 复杂问题（投资建议/深度解析）
- **WHEN** 用户输入复杂问题（如"给出投资建议"、"深度拆解盈利修复路径"）
- **THEN** 系统执行完整8步流水线
- **AND** 响应时间根据问题复杂度而定

## MODIFIED Requirements

### Requirement: 分析页面默认模式
投资端分析页面默认模式保持为`industryStatus`，辩论内容仅在`investmentRecommendation`模式且确实有辩论结果时显示。

### Requirement: diagnose方法执行路径
`diagnose`方法新增`complexity`参数（可选，默认"full"），支持"simple"、"moderate"、"full"三种执行路径。
