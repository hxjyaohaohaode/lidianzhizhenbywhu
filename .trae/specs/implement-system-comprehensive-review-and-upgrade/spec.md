# System Comprehensive Review and Upgrade Spec

## Why
当前系统虽然具备了基础的图表展示和AI对话能力，但在面临锂电行业复杂的“产能过剩、价格战、原材料波动”等现实挑战时，仍需进一步提升。为了让系统从“数据展示工具”进化为“智能经营决策大脑”，我们需要站在资深用户的角度，全面提升系统的实用性、易用性、稳定性、数据的全能性与实时性，以及系统的核心智能性。

## What Changes
- **实用性与易用性 (Usefulness & Ease of Use)**: 
  - 引入“What-If”经营沙盘推演面板，支持通过滑块动态调整核心假设（如碳酸锂价格、产能利用率），实时预览毛利变化。
  - 为普通用户端首页增加“一句话懂公司”卡片与企业健康度雷达图，降低财务数据认知门槛。
  - 增加自然语言查询 (NL2SQL) 模拟入口，允许用户通过大白话快速生成对比图表。
- **全能性与实时性 (Data Comprehensiveness & Real-time)**: 
  - 首页新增“实时大宗商品行情走势”滚动播报（如电池级碳酸锂现货价），强化产业链上下游数据的实时感知。
- **稳定性 (Stability)**: 
  - 引入异步长耗时任务的 UI 交互模式（如“全行业深度对标分析”），采用进度条与轮询机制，避免复杂计算导致的前端假死或请求超时。
- **智能性 (System Intelligence)**: 
  - 引入“诊断-预警-策略”智能体闭环机制 (Agentic Workflow)：当关键指标（如毛利率）跌破设定阈值时，AI 自动生成并推送破局策略与建议。

## Impact
- Affected specs: 首页布局、分析工作台布局、AI 聊天上下文。
- Affected code: `src/web/App.tsx`, `src/web/styles.css`, `src/server/index.ts` (如有), `src/web/chart-system.tsx`, `src/web/chart-data.ts`。

## ADDED Requirements
### Requirement: 经营沙盘推演 (What-If Simulation)
The system SHALL provide a simulation panel in the enterprise workspace allowing users to adjust raw material prices and capacity utilization, instantly updating the predicted gross margin charts.

### Requirement: 企业健康度与一句话总结 (Health Radar & Summary)
The system SHALL display a Radar chart and a concise AI-generated summary of the company's health on the regular user homepage.

### Requirement: 实时大宗商品行情 (Real-time Commodities Ticker)
The system SHALL feature a scrolling or real-time updating widget on the homepage showing the latest spot prices of key battery materials.

### Requirement: 异步诊断任务机制 (Async Diagnostic Tasks)
The system SHALL support long-running tasks (e.g., industry-wide stress testing) with a non-blocking UI, displaying progress and notifying the user upon completion.

### Requirement: 阈值触发的智能体策略闭环 (Threshold-triggered Agentic Strategy)
The system SHALL monitor key financial metrics and automatically trigger an AI strategy recommendation panel if anomalies or drops below thresholds are detected.