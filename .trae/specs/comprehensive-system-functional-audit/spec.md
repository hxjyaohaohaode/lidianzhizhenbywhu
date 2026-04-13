# 系统全面功能审计 Spec

## Why
系统已实现双门户架构（企业端/投资端）、8个AI智能体协作、DQI/GMPS数学模型、RAG数据检索、用户记忆、图表可视化等核心功能，但缺少一次端到端的功能完整性审计。需要系统性验证所有功能模块是否按预设样式正常工作，确保企业端与投资端界面和数据严格分离，图表按预设样式渲染，数据闭环完整，智能体协作链路畅通。

## What Changes
- **AI智能体功能审计**：验证8个智能体的工作流编排、降级机制、状态报告是否正常
- **表格数据展示审计**：验证所有表格/列表组件的数据渲染、排序、筛选、分页是否正常
- **用户数据记忆功能审计**：验证记忆的创建、读取、更新、删除、标签筛选、角色隔离是否正常
- **界面显示稳定性审计**：验证CSS变量完整性、主题切换、组件布局、动画效果是否稳定
- **数据闭环与利用审计**：验证从数据采集→模型计算→结果存储→前端展示的完整闭环
- **RAG数据获取功能审计**：验证实时行业检索、搜索降级、引用溯源、缓存机制是否正常
- **数学模型利用功能审计**：验证DQI/GMPS模型计算、打分方向、等级划分、API接口是否正确
- **双端隔离审计**：验证企业端和投资端的界面、数据、API、会话、画像严格分离

## Impact
- Affected specs: 双端架构、智能体工作流、数学模型、RAG检索、记忆系统、图表系统
- Affected code:
  - `src/web/App.tsx` — 前端主应用、双端界面
  - `src/web/api.ts` — API调用层
  - `src/web/chart-data.ts` — 图表数据构建
  - `src/web/chart-system.tsx` — 图表渲染系统
  - `src/web/chart-renderer.tsx` — 图表渲染器
  - `src/web/dqi-gmps-panels.tsx` — DQI/GMPS面板
  - `src/web/styles.css` — CSS样式系统
  - `src/server/agent-service.ts` — 智能体服务
  - `src/server/app.ts` — API路由
  - `src/server/business-service.ts` — 业务服务
  - `src/server/models.ts` — 数学模型
  - `src/server/realtime-rag.ts` — RAG服务
  - `src/server/memory.ts` — 记忆存储
  - `src/server/session-store.ts` — 会话存储
  - `src/server/platform-store.ts` — 平台存储
  - `src/shared/agents.ts` — 智能体类型定义
  - `src/shared/business.ts` — 业务类型定义
  - `src/shared/diagnostics.ts` — 诊断模型Schema
  - `src/shared/rag.ts` — RAG类型定义

---

## ADDED Requirements

### Requirement: AI智能体功能完整性
系统 SHALL 确保8个智能体（taskOrchestrator、memoryManagement、dataGathering、dataUnderstanding、mathAnalysis、industryRetrieval、evidenceReview、expressionGeneration）按预设工作流正确编排执行。

#### Scenario: 完整诊断流程执行
- **WHEN** 用户发起企业端或投资端诊断请求
- **THEN** 系统 SHALL 按 workflowPlan 定义的依赖关系依次执行8个智能体
- **AND** 每个智能体 SHALL 返回正确的 status（"completed" | "degraded" | "failed"）
- **AND** 降级事件 SHALL 记录到 degradationTrace 中

#### Scenario: 数学分析智能体模型选择
- **WHEN** 诊断请求 focusMode 为 "operationalDiagnosis" 或 "deepDive"
- **THEN** mathAnalysis 智能体 SHALL 同时计算 DQI 和 GMPS
- **WHEN** focusMode 为 "investmentRecommendation"
- **THEN** mathAnalysis 智能体 SHALL 触发 GMPS 计算

#### Scenario: 证据审查智能体验证
- **WHEN** mathAnalysis 智能体返回 DQI/GMPS 计算结果
- **THEN** evidenceReview 智能体 SHALL 验证结果合理性
- **AND** DQI 范围检查（0.3-2.5）、GMPS 范围检查（0-100）、概率范围检查（0-1）

### Requirement: 表格数据展示正确性
系统 SHALL 确保所有表格和列表组件正确渲染数据，包括 VisualizationBoard 中的各类可视化组件。

#### Scenario: 首页可视化面板数据展示
- **WHEN** 用户进入企业端或投资端首页
- **THEN** VisualizationBoard SHALL 正确渲染 buildEnterpriseVisualization / buildInvestorHomeVisualization 返回的所有 widget
- **AND** 每个 widget 的数据 SHALL 与后端返回一致
- **AND** 表格行、指标卡片、状态标签 SHALL 按预设样式显示

#### Scenario: 分析工作台数据展示
- **WHEN** 用户在分析工作台查看诊断结果
- **THEN** DQI/GMPS 面板 SHALL 正确展示模型计算结果
- **AND** 图表 SHALL 按预设样式渲染（折线图、雷达图、仪表盘、瀑布图）
- **AND** 数据表格 SHALL 展示关键指标和评分

#### Scenario: 会话历史列表展示
- **WHEN** 投资端用户查看会话历史
- **THEN** 会话列表 SHALL 展示正确的会话摘要、模式标签、时间戳
- **AND** 会话搜索和筛选功能 SHALL 正常工作

### Requirement: 用户数据记忆功能完整性
系统 SHALL 确保用户记忆的创建、读取、更新、删除全生命周期功能正常。

#### Scenario: 记忆创建
- **WHEN** 用户在记忆页面创建新记忆
- **THEN** 系统 SHALL 通过 POST `/api/memory` 保存记忆
- **AND** 记忆 SHALL 包含 summary、details、tags、role、userId 字段
- **AND** 记忆 SHALL 关联到正确的角色（enterprise/investor）

#### Scenario: 记忆读取与展示
- **WHEN** 用户打开记忆页面
- **THEN** 系统 SHALL 通过 GET `/api/memory/:userId` 获取记忆列表
- **AND** 记忆树节点 SHALL 正确展示记忆摘要和标签
- **AND** 点击节点 SHALL 展示记忆详情

#### Scenario: 记忆更新
- **WHEN** 用户编辑已有记忆
- **THEN** 系统 SHALL 通过 PUT `/api/memory/:memoryId` 更新记忆
- **AND** 更新后记忆树 SHALL 刷新展示

#### Scenario: 记忆删除
- **WHEN** 用户删除记忆
- **THEN** 系统 SHALL 通过 DELETE `/api/memory/:memoryId` 删除记忆
- **AND** 删除后记忆树 SHALL 移除对应节点

#### Scenario: 记忆角色隔离
- **WHEN** 企业端用户查看记忆
- **THEN** 仅展示 role="enterprise" 的记忆
- **WHEN** 投资端用户查看记忆
- **THEN** 仅展示 role="investor" 的记忆

### Requirement: 界面显示稳定性
系统 SHALL 确保所有界面元素在暗色和亮色主题下稳定显示，无移位、无加载失败、无样式异常。

#### Scenario: CSS变量完整性
- **WHEN** 用户在任意主题下浏览页面
- **THEN** 所有 CSS 变量（--t1~--t4, --glass, --glass-soft, --line, --rs, --viz-accent-* 等）SHALL 正确解析
- **AND** 文字颜色、背景色、边框色 SHALL 在两种主题下均可见且合理

#### Scenario: 主题切换稳定性
- **WHEN** 用户在暗色/亮色主题之间切换
- **THEN** 所有页面元素 SHALL 平滑过渡
- **AND** 图表颜色 SHALL 随主题变化
- **AND** 无闪烁、移位或样式错乱

#### Scenario: 图表渲染稳定性
- **WHEN** 页面包含 Recharts 图表
- **THEN** 图表 SHALL 在容器内正确渲染
- **AND** 响应式容器 SHALL 正确适配容器尺寸
- **AND** Tooltip、Legend SHALL 正常交互

### Requirement: 数据闭环与利用完整性
系统 SHALL 确保从数据输入到最终展示的完整数据闭环，每一步的数据都得到正确利用。

#### Scenario: 企业端数据闭环
- **WHEN** 企业端用户提交采集数据
- **THEN** 数据 SHALL 通过 POST `/api/enterprise/collect` 保存到会话
- **AND** 数据 SHALL 传递给 POST `/api/enterprise/analyze` 进行分析
- **AND** 分析结果中的 grossMarginInput / operatingQualityInput SHALL 用于 DQI/GMPS 计算
- **AND** 模型计算结果 SHALL 通过 DQIGMPSPanelsContainer 展示在前端
- **AND** 企业基础信息 SHALL 保存到用户画像并参与后续个性化

#### Scenario: 投资端数据闭环
- **WHEN** 投资端用户创建画像
- **THEN** 画像数据 SHALL 通过 POST `/api/investor/profile` 保存
- **AND** 画像 SHALL 驱动 focusMode 推荐和个性化内容
- **AND** 会话上下文 SHALL 通过 GET `/api/context/:sessionId` 恢复
- **AND** 分析结果 SHALL 包含基于画像的推荐和深度分析
- **AND** 投资者基础信息 SHALL 保存到用户画像并参与后续个性化

#### Scenario: 记忆数据闭环
- **WHEN** 诊断流程中 memoryManagement 智能体召回历史记忆
- **THEN** 记忆 SHALL 参与后续智能体的上下文构建
- **AND** 新的分析结论 SHALL 写入记忆供未来使用

### Requirement: RAG数据获取功能完整性
系统 SHALL 确保实时行业检索功能正常工作，包括搜索、页面抓取、分块、索引、检索和引用溯源。

#### Scenario: RAG检索正常流程
- **WHEN** industryRetrieval 智能体执行行业检索
- **THEN** 系统 SHALL 通过 RealtimeIndustryRagService 执行搜索
- **AND** 搜索结果 SHALL 包含 citations 和 indexStats
- **AND** indexStats SHALL 包含 searchHits、fetchedPages、chunkCount 等统计

#### Scenario: RAG搜索降级
- **WHEN** 主搜索提供商不可用
- **THEN** 系统 SHALL 使用备用搜索提供商
- **AND** indexStats.fallbackUsed SHALL 为 true
- **AND** 降级事件 SHALL 记录到 degradationTrace

#### Scenario: RAG缓存机制
- **WHEN** 相同查询在缓存有效期内重复请求
- **THEN** 系统 SHALL 返回缓存结果
- **AND** indexStats.cacheHit SHALL 为 true

#### Scenario: RAG引用溯源
- **WHEN** RAG返回检索结果
- **THEN** 每条 citation SHALL 包含 title、url、source、publishedAt
- **AND** citation.confidence SHALL 标注置信度（high/medium/low）

### Requirement: 数学模型利用功能完整性
系统 SHALL 确保 DQI 和 GMPS 数学模型按预设公式正确计算，并通过 API 和前端正确展示。

#### Scenario: DQI模型计算
- **WHEN** 前端调用 POST `/api/models/dqi/calculate`
- **THEN** 系统 SHALL 计算 ROE = 净利润 / 平均净资产 × 100%
- **AND** 计算 Growth = (当期营收 - 基期营收) / 基期营收
- **AND** 计算 OCF比率 = 经营现金流 / 营业收入
- **AND** 计算 DQI = w1·(ROE_t/ROE_{t-1}) + w2·(Growth_t/Growth_{t-1}) + w3·(OCF_t/OCF_{t-1})
- **AND** 识别驱动因素（argmax{ROE比率, Growth比率, OCF比率}）
- **AND** 判断趋势状态（DQI>1.05改善，0.95≤DQI≤1.05稳定，DQI<0.95恶化）

#### Scenario: GMPS模型计算
- **WHEN** 前端调用 POST `/api/models/gmps/calculate`
- **THEN** 系统 SHALL 计算 A~E 五层维度指标
- **AND** 对10个特征变量进行标准化打分（0-100分）
- **AND** 计算加权综合得分 GMPS = Σ w_k · score_k
- **AND** 划分承压等级（<40低压，40-70中压，≥70高压）
- **AND** 使用 Logistic 回归预测下季度承压概率

#### Scenario: 模型打分方向正确性
- **WHEN** 行业波动率高（indVol=0.5）
- **THEN** 得分 SHALL 为高风险（≥60分）
- **WHEN** 毛利率同比下降（gpmYoy=-0.15）
- **THEN** 得分 SHALL 为高风险（≥60分）
- **WHEN** 毛利率同比上升（gpmYoy=0.15）
- **THEN** 得分 SHALL 为低风险（≤40分）

#### Scenario: 模型结果前端展示
- **WHEN** 诊断结果包含 DQI/GMPS 数据
- **THEN** DQIResultPanel SHALL 展示 DQI 数值、状态徽章、驱动因素、分解进度条
- **AND** GMPSResultPanel SHALL 展示 GMPS 数值、等级、五维度评分、风险概率
- **AND** 图表 SHALL 按预设样式渲染（折线图含基准线、雷达图、仪表盘着色）

### Requirement: 企业端与投资端严格隔离
系统 SHALL 确保企业端和投资端的界面、数据、API、会话、画像严格分离，二者不能混为一谈。

#### Scenario: 界面隔离
- **WHEN** 用户以企业端角色登录
- **THEN** 界面 SHALL 展示 EntHome、EntAna、EntSet 组件
- **AND** 界面 SHALL 展示"企业端工作台"、"经营诊断入口已闭环"等企业端专属文案
- **AND** 界面 SHALL NOT 展示投资端专属内容（投资模式切换、投资推荐、投资画像等）
- **WHEN** 用户以投资端角色登录
- **THEN** 界面 SHALL 展示 InvHome、InvAna、InvSet 组件
- **AND** 界面 SHALL 展示"投资端工作台"、"投资分析入口已闭环"等投资端专属文案
- **AND** 界面 SHALL NOT 展示企业端专属内容（经营诊断、企业采集、企业基础信息等）

#### Scenario: API隔离
- **WHEN** 企业端调用分析接口
- **THEN** SHALL 使用 POST `/api/enterprise/collect` 和 POST `/api/enterprise/analyze`
- **AND** 请求中 role SHALL 为 "enterprise"
- **AND** focusMode SHALL 限定为 "operationalDiagnosis" 或 "deepDive"
- **WHEN** 投资端调用分析接口
- **THEN** SHALL 使用 POST `/api/investor/profile`、POST `/api/investor/recommend` 等
- **AND** 请求中 role SHALL 为 "investor"
- **AND** focusMode SHALL 包含 "industryStatus"、"investmentRecommendation"、"deepDive"

#### Scenario: 会话隔离
- **WHEN** 企业端创建会话
- **THEN** 会话的 role SHALL 为 "enterprise"
- **AND** 会话 SHALL 包含 enterpriseName 而非 investedEnterprises
- **WHEN** 投资端创建会话
- **THEN** 会话的 role SHALL 为 "investor"
- **AND** 会话 SHALL 包含 investedEnterprises 和 investorProfileSummary

#### Scenario: 画像隔离
- **WHEN** 企业端用户保存基础信息
- **THEN** 信息 SHALL 保存到 enterpriseBaseInfo 字段
- **AND** 信息 SHALL NOT 写入 investorBaseInfo 字段
- **WHEN** 投资端用户保存基础信息
- **THEN** 信息 SHALL 保存到 investorBaseInfo 字段
- **AND** 信息 SHALL NOT 写入 enterpriseBaseInfo 字段

#### Scenario: 图表数据隔离
- **WHEN** 企业端首页展示可视化
- **THEN** SHALL 使用 buildEnterpriseVisualization 构建数据
- **AND** 图表内容 SHALL 聚焦经营指标、毛利承压、经营质量
- **WHEN** 投资端首页展示可视化
- **THEN** SHALL 使用 buildInvestorHomeVisualization 构建数据
- **AND** 图表内容 SHALL 聚焦行业景气、投资信号、风险收益

#### Scenario: 记忆隔离
- **WHEN** 企业端用户查看记忆
- **THEN** 仅展示 role="enterprise" 的记忆
- **WHEN** 投资端用户查看记忆
- **THEN** 仅展示 role="investor" 的记忆

---

## MODIFIED Requirements

### Requirement: 系统审计范围
原审计仅覆盖数学模型和API接口，现扩展为覆盖AI智能体、表格展示、记忆功能、界面稳定性、数据闭环、RAG检索、数学模型和双端隔离的全面审计。

---

## REMOVED Requirements

无移除需求。本次为增量式审计，保留所有现有功能。
