# 系统全面审计验证 Spec

## Why
系统经过多轮迭代开发后，需要一次全面的端到端审计验证，确保所有功能模块完整可用、数据流转正确、多租户隔离严格、数学模型实现准确、RAG检索可靠，以及前端界面稳定运行。此前虽有审计记录，但部分审计项仅基于代码审查而非实际运行验证，且存在已知的潜在问题尚未确认。

## What Changes
- 对数据处理与管理全链路进行验证（数据采集、计算精度、单位一致性、数学模型）
- 对8个智能体的工作流编排、降级机制、响应性能进行验证
- 对前端界面（分析页面、可视化、记忆页面）进行功能与稳定性验证
- 对RAG检索增强生成和实时搜索功能进行正确性验证
- 对企业端/投资端多租户数据隔离进行严格验证
- 对代码完整性和运行时错误进行验证
- 修复审计过程中发现的所有问题

## Impact
- Affected specs: comprehensive-system-functional-audit, comprehensive-system-check-and-optimize, verify-e2e-system-runtime
- Affected code: src/server/ 全部文件, src/web/ 全部文件, src/shared/ 全部文件

## ADDED Requirements

### Requirement: 数据处理与管理验证
系统 SHALL 通过实际运行验证以下数据处理能力：

#### Scenario: 数据采集机制验证
- **WHEN** 调用企业端采集接口 POST `/api/enterprise/collect`
- **THEN** 数据正确保存到会话上下文，包含所有必填字段

#### Scenario: 数据计算精度验证
- **WHEN** 调用 DQI/GMPS 计算接口
- **THEN** 所有数值结果保留2位小数，公式实现与设计文档一致

#### Scenario: 数据单位一致性验证
- **WHEN** 前端提交含单位的数据（万元、%、GWh等）
- **THEN** stripBaseInfoUnit 正确剥离单位，数值与单位分别存储和展示

#### Scenario: 数学模型有效性验证
- **WHEN** 输入标准测试数据到 DQI/GMPS 模型
- **THEN** 计算结果与手算预期值一致，权重、趋势判断、等级划分逻辑正确

### Requirement: 智能体性能验证
系统 SHALL 验证8个智能体的协同工作机制：

#### Scenario: 工作流编排验证
- **WHEN** 触发诊断流程
- **THEN** 8个智能体按依赖关系执行，串行/并行逻辑正确

#### Scenario: 降级机制验证
- **WHEN** 主LLM提供方不可用
- **THEN** 自动降级到备用提供方，degradationTrace 正确记录

#### Scenario: 记忆智能体验证
- **WHEN** 用户有历史记忆数据
- **THEN** memoryManagement 智能体正确召回并注入上下文

### Requirement: 界面与可视化验证
系统 SHALL 验证所有前端页面的功能完整性：

#### Scenario: 分析页面功能验证
- **WHEN** 用户进入企业端/投资端分析页面
- **THEN** 采集→分析→结果展示完整流程可用，DQI/GMPS面板正确渲染

#### Scenario: 可视化完整性验证
- **WHEN** 首页加载 VisualizationBoard
- **THEN** 18种Widget类型均能正确渲染，数据无溢出或截断

#### Scenario: 界面稳定性验证
- **WHEN** 执行主题切换、窗口缩放、数据更新等操作
- **THEN** 界面无闪烁、无布局错位、过渡动画流畅

#### Scenario: 数据更新实时性验证
- **WHEN** 后端数据变更
- **THEN** 前端对应组件实时刷新，无延迟或需手动刷新

### Requirement: RAG与实时搜索验证
系统 SHALL 验证RAG检索增强生成的正确性：

#### Scenario: RAG检索核心功能验证
- **WHEN** 调用 POST `/api/rag/realtime`
- **THEN** 返回包含 citations 和 indexStats 的完整响应

#### Scenario: RAG降级机制验证
- **WHEN** 主搜索提供商不可用
- **THEN** 自动回退到内置行业数据源，fallbackUsed 为 true

#### Scenario: 引用溯源验证
- **WHEN** RAG返回检索结果
- **THEN** 每条 citation 包含 title、url、source、publishedAt、confidence 字段

### Requirement: 多租户架构验证
系统 SHALL 严格验证企业端与投资端的数据隔离：

#### Scenario: 界面隔离验证
- **WHEN** 切换到企业端/投资端角色
- **THEN** 仅展示对应角色的组件和文案，无跨角色内容残留

#### Scenario: API数据隔离验证
- **WHEN** 企业端和投资端分别调用各自API
- **THEN** 企业端数据不会出现在投资端，反之亦然

#### Scenario: 会话与画像隔离验证
- **WHEN** 查询企业端/投资端的会话和画像
- **THEN** enterpriseBaseInfo 和 investorBaseInfo 互不干扰

#### Scenario: 记忆隔离验证
- **WHEN** 查询记忆列表
- **THEN** 企业端仅返回 role="enterprise" 的记忆，投资端仅返回 role="investor" 的记忆

#### Scenario: 图表数据隔离验证
- **WHEN** 加载首页可视化
- **THEN** 企业端使用 buildEnterpriseVisualization，投资端使用 buildInvestorHomeVisualization

### Requirement: 代码完整性与运行时验证
系统 SHALL 确保所有代码无编译错误和运行时异常：

#### Scenario: TypeScript编译验证
- **WHEN** 运行 tsc --noEmit
- **THEN** 后端和前端均0错误

#### Scenario: 单元测试验证
- **WHEN** 运行 vitest
- **THEN** 所有测试通过

#### Scenario: 服务启动验证
- **WHEN** 启动后端和前端服务
- **THEN** 所有API端点可用，页面正常加载

#### Scenario: 端到端流程验证
- **WHEN** 执行企业端完整诊断流程和投资端完整分析流程
- **THEN** 全流程无错误，结果正确展示

## MODIFIED Requirements
（无修改，本次为纯审计验证）

## REMOVED Requirements
（无移除）
