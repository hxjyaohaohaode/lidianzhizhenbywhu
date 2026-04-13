# 系统质量与一致性保障升级 Spec

## Why
系统当前存在多项影响用户体验和数据可信度的关键缺陷：辩论机制使用模板拼接而非真实 LLM 对话、首页"自动刷新"为假象（仅更新时间戳不拉取新数据）、单位选择器组件已开发但未集成到主界面、小数精度在多处不一致、部分组件在浅色模式下显示异常。这些问题直接削弱了系统的智能性、实时性、个性化和数据精确性。

## What Changes
- **修复辩论机制**：将模板拼接的三轮辩论替换为真实 LLM 多模型对话，当 LLM 不可用时保留模板降级
- **修复实时数据刷新**：首页增加真正的定时数据拉取机制，移除误导性的"自动刷新 15s"假提示
- **集成单位选择器**：将 UnitSelector 组件接入首页、分析页和设置页，所有数值显示响应单位偏好变化
- **统一小数精度**：全局强制所有数值精确到小数点后两位，消除 3 位/4 位硬编码不一致
- **完善浅色模式**：检查并修复所有组件在浅色模式下的显示问题，确保无硬编码深色值
- **强化用户数据记忆**：确保用户偏好、画像、会话历史在页面刷新和浏览器重启后完整恢复
- **增强 RAG 实时性**：优化 RAG 缓存策略，确保关键查询获取最新数据
- **提升任务完成可靠性**：完善 Agent 工作流失败恢复和部分结果展示机制

## Impact
- Affected specs: 智能体工作流、RAG 检索、前端可视化、主题系统、数据格式化
- Affected code:
  - `src/server/business-service.ts` — 辩论机制
  - `src/server/agent-service.ts` — 工作流编排与失败恢复
  - `src/server/realtime-rag.ts` — RAG 缓存与刷新策略
  - `src/web/App.tsx` — 主界面集成（单位选择器、实时刷新、浅色模式）
  - `src/web/data-formatter.ts` — 全局精度控制
  - `src/web/UnitSelector.tsx` — 单位选择器集成
  - `src/web/styles.css` — 浅色模式样式修复
  - `src/web/chart-system.tsx` — 图表浅色模式与精度
  - `src/web/chart-renderer.tsx` — 图表渲染精度
  - `src/web/dqi-gmps-panels.tsx` — DQI/GMPS 面板精度与浅色模式

---

## ADDED Requirements

### Requirement: 真实 LLM 辩论机制
系统 SHALL 在分析工作流中使用真实 LLM 多模型对话实现三轮辩论，而非模板拼接。

#### Scenario: LLM 可用时执行真实辩论
- **WHEN** 分析工作流进入辩论阶段且至少一个 LLM 提供方可用
- **THEN** 系统 SHALL 调用 LLM API 生成辩论观点，每轮辩论包含正方论点、反方论点和裁判总结
- **AND** 辩论消息的 `source` 字段 SHALL 标记为 `"llm"` 而非 `"template"`

#### Scenario: LLM 不可用时降级到模板辩论
- **WHEN** 分析工作流进入辩论阶段且所有 LLM 提供方不可用
- **THEN** 系统 SHALL 降级使用模板拼接生成辩论内容
- **AND** 辩论消息 SHALL 标记 `source: "template"` 和 `degraded: true`
- **AND** 前端 SHALL 显示降级提示

### Requirement: 首页真实数据自动刷新
系统 SHALL 在首页实现真正的定时数据刷新，而非仅更新时间戳。

#### Scenario: 定时刷新获取最新数据
- **WHEN** 用户停留在首页超过刷新间隔（默认 60 秒）
- **THEN** 系统 SHALL 自动重新调用数据接口获取最新数据并更新界面
- **AND** 刷新时 SHALL 显示加载指示器
- **AND** 刷新间隔 SHALL 可在设置中配置

#### Scenario: 用户手动刷新
- **WHEN** 用户点击刷新按钮
- **THEN** 系统 SHALL 立即获取最新数据并更新界面

### Requirement: 单位选择器全局集成
系统 SHALL 将单位选择器集成到所有数据展示区域，用户切换单位后所有相关数值即时更新。

#### Scenario: 首页单位切换
- **WHEN** 用户在首页切换金额单位（元/万元/亿元）
- **THEN** 首页所有图表和表格中的金额数值 SHALL 即时按新单位重新计算和显示
- **AND** 单位标签 SHALL 同步更新

#### Scenario: 分析页单位切换
- **WHEN** 用户在分析页切换百分比单位（百分比/小数）
- **THEN** 分析结果中的所有百分比数值 SHALL 即时按新格式重新显示

#### Scenario: 单位偏好持久化
- **WHEN** 用户切换单位偏好
- **THEN** 偏好 SHALL 同时保存到 localStorage 和服务端用户档案
- **AND** 下次访问时 SHALL 自动恢复上次选择的单位

### Requirement: 全局小数精度统一为两位
系统 SHALL 确保所有面向用户展示的数值精确到小数点后两位，无例外。

#### Scenario: 数值显示精度
- **WHEN** 系统在任何位置显示数值（图表、表格、文本、面板）
- **THEN** 该数值 SHALL 精确到小数点后两位
- **AND** 不存在 3 位、4 位或其他精度的硬编码

#### Scenario: RAG 评分精度
- **WHEN** RAG 检索结果包含评分数据
- **THEN** 评分 SHALL 精确到小数点后两位（当前为 3 位）

### Requirement: 浅色模式完整适配
系统 SHALL 确保所有 UI 组件在浅色模式下正确显示，无硬编码深色值、无文字不可读、无对比度不足。

#### Scenario: 图表浅色模式
- **WHEN** 用户切换到浅色模式
- **THEN** 所有 Recharts 图表的网格线、坐标轴、Tooltip、Legend SHALL 使用浅色模式配色
- **AND** 图表文字 SHALL 为深色，背景 SHALL 为浅色

#### Scenario: 弹窗和浮层浅色模式
- **WHEN** 用户在浅色模式下打开弹窗或浮层
- **THEN** 弹窗背景 SHALL 使用浅色毛玻璃效果
- **AND** 弹窗内文字 SHALL 清晰可读

#### Scenario: DQI/GMPS 面板浅色模式
- **WHEN** 用户在浅色模式下查看 DQI/GMPS 分析面板
- **THEN** 面板背景、文字、指标数值 SHALL 使用浅色模式配色
- **AND** 仪表盘和雷达图 SHALL 正确渲染

### Requirement: 用户数据完整记忆与恢复
系统 SHALL 确保用户所有数据（偏好、画像、会话历史、记忆）在页面刷新和浏览器重启后完整恢复。

#### Scenario: 页面刷新后数据恢复
- **WHEN** 用户刷新页面
- **THEN** 系统 SHALL 从服务端恢复用户档案、偏好设置、会话历史
- **AND** 当前角色和主题设置 SHALL 与刷新前一致
- **AND** 单位偏好 SHALL 与刷新前一致

#### Scenario: 浏览器重启后数据恢复
- **WHEN** 用户关闭浏览器后重新打开系统
- **THEN** 系统 SHALL 从 localStorage 读取 userId 并从服务端恢复完整用户数据
- **AND** 所有设置 SHALL 与上次访问时一致

### Requirement: RAG 检索实时性保障
系统 SHALL 优化 RAG 缓存策略，确保用户获取的是最新相关数据。

#### Scenario: 首次查询无缓存
- **WHEN** 用户发起分析请求且 RAG 缓存中无相关条目
- **THEN** 系统 SHALL 执行实时搜索和数据抓取
- **AND** 返回结果 SHALL 包含最新的行业数据

#### Scenario: 缓存过期后刷新
- **WHEN** RAG 缓存条目超过 TTL（5 分钟）
- **THEN** 后续查询 SHALL 重新执行搜索和数据抓取
- **AND** 不返回过期数据

#### Scenario: 用户强制刷新 RAG 数据
- **WHEN** 用户在分析页点击"刷新行业数据"按钮
- **THEN** 系统 SHALL 清除当前 RAG 缓存并重新检索

### Requirement: Agent 工作流失败恢复
系统 SHALL 在 Agent 工作流中实现完善的失败恢复机制，确保部分结果可见。

#### Scenario: 单个 Agent 失败
- **WHEN** 工作流中某个非关键 Agent 失败
- **THEN** 系统 SHALL 继续执行依赖该 Agent 的后续步骤（使用降级结果）
- **AND** 前端 SHALL 显示哪些分析项使用了降级数据

#### Scenario: 关键 Agent 失败
- **WHEN** taskOrchestrator 或 expressionGeneration 失败
- **THEN** 系统 SHALL 返回错误信息和建议重试操作
- **AND** 已完成的分析结果 SHALL 仍然展示给用户

### Requirement: 个性化服务深度增强
系统 SHALL 确保个性化不仅停留在画像展示层面，而是深入影响分析结果和内容推荐。

#### Scenario: 个性化驱动分析重点
- **WHEN** 用户画像中标记了特定兴趣（如"现金流质量"）
- **THEN** 分析结果 SHALL 优先展示与该兴趣相关的指标和结论
- **AND** 可视化面板 SHALL 将相关指标置于显著位置

#### Scenario: 个性化驱动 RAG 检索
- **WHEN** RAG 检索构建搜索查询时
- **THEN** 查询 SHALL 融入用户画像中的兴趣标签和关注领域
- **AND** 检索结果 SHALL 按用户偏好重新排序

---

## MODIFIED Requirements

### Requirement: 数据格式化精度
所有 `formatFixed`、`formatPercent`、`formatAmount`、`formatVolume`、`formatGap` 函数 SHALL 默认 `digits=2`，且不允许调用方传入其他精度值。RAG 评分的 `roundScore` 函数 SHALL 使用 `toFixed(2)` 而非 `toFixed(3)`。

### Requirement: 首页数据展示
首页数据展示 SHALL 响应单位偏好变化，所有金额、百分比、数量数值 SHALL 通过 `DataFormatter` 格式化后显示，而非硬编码格式。

### Requirement: 分析工作流辩论
分析工作流的辩论阶段 SHALL 优先使用真实 LLM 对话，仅在所有 LLM 不可用时降级为模板。辩论消息 SHALL 包含 `source` 字段标识来源。

---

## REMOVED Requirements

### Requirement: 假性自动刷新时间戳
**Reason**: 当前首页 setInterval 仅更新时间戳字符串而不获取新数据，误导用户以为数据在自动刷新
**Migration**: 替换为真正的定时数据拉取机制，移除仅更新时间戳的 setInterval
