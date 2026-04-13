# 系统全面检查与优化 Spec

## Why
系统经过多轮迭代后，需要在界面美观度、数据展示准确性、智能体协同、记忆功能、单位切换及小数精度等方面进行全面审查与优化，确保用户体验与数据质量达到生产标准。

## What Changes
- 审查并优化整体界面美观度，确保CSS变量、主题系统、玻璃态效果在各场景下一致
- 全面检查所有数据表（ZebraTable、BenchmarkTable、HeatmapTable、PivotTable等）的显示状态，修复格式错位和数据丢失
- 验证数据表的CRUD更新机制，确保新增/修改/删除后数据实时准确显示
- 检查分析页面（EntAna/InvAna）功能完整性（不含图表工作台模块）
- 验证8个智能体间的协同工作能力、任务分配与完成流程
- 验证RAG搜索功能的准确性与响应速度
- 全面测试记忆功能（CRUD、展示、交互、角色隔离）
- 验证个性化服务功能（用户画像驱动内容定制）
- 重点测试"记忆中的你"功能模块
- 确保所有界面提供单位选择功能，单位切换时数据正确转换
- 验证所有数据精确到小数点后两位，计算过程准确
- 全面测试数据获取→计算→显示全流程

## Impact
- Affected specs: comprehensive-system-functional-audit, verify-e2e-system-runtime
- Affected code:
  - `src/web/App.tsx` — 界面组件、数据展示、分析页面、记忆页面
  - `src/web/chart-system.tsx` — VisualizationBoard、数据表组件
  - `src/web/chart-data.ts` — 数据构建与格式化
  - `src/web/chart-renderer.tsx` — 图表渲染
  - `src/web/dqi-gmps-panels.tsx` — DQI/GMPS结果面板
  - `src/web/styles.css` — CSS变量与主题系统
  - `src/server/agent-service.ts` — 智能体工作流
  - `src/server/memory.ts` — 记忆CRUD
  - `src/server/realtime-rag.ts` — RAG检索
  - `src/server/models.ts` — 数学模型计算
  - `src/server/app.ts` — API端点

## ADDED Requirements

### Requirement: 界面美观度审查与优化
系统 SHALL 确保所有页面在暗色/亮色主题下视觉效果一致、美观，无CSS变量遗漏或样式冲突。

#### Scenario: 主题切换一致性
- **WHEN** 用户在暗色与亮色主题之间切换
- **THEN** 所有CSS变量（--t1~--t4, --glass, --glass-soft, --line, --rs, --bg, --bg2等）正确解析，无闪烁或样式残留

#### Scenario: 玻璃态效果一致性
- **WHEN** 页面渲染glass-morphism组件
- **THEN** backdrop-filter、border、shadow效果在两种主题下均正确显示，无透明度异常

### Requirement: 数据表显示完整性
系统 SHALL 确保所有数据表（ZebraTable、BenchmarkTable、HeatmapTable、PivotTable、TreeTable、SparkRow等）格式正确、无错位、无数据丢失。

#### Scenario: 数据表格式正确
- **WHEN** VisualizationBoard渲染任意widget类型
- **THEN** 表格列对齐正确，数值格式统一，状态标签正确显示，无溢出或截断

#### Scenario: 数据表实时更新
- **WHEN** 用户执行新增、修改或删除操作后
- **THEN** 相关数据表立即反映最新状态，无需手动刷新

### Requirement: 分析页面功能完整性（不含图表工作台）
系统 SHALL 确保企业端分析页面（EntAna）和投资端分析页面（InvAna）的核心分析功能完整可用。

#### Scenario: 企业端分析流程
- **WHEN** 用户在企业端分析页面提交诊断请求
- **THEN** 系统正确执行采集→分析→结果展示流程，DQI/GMPS面板正确显示

#### Scenario: 投资端分析流程
- **WHEN** 用户在投资端分析页面提交分析请求
- **THEN** 系统正确执行画像→分析→结果展示流程，SSE流式响应正常

### Requirement: 智能体协同工作验证
系统 SHALL 确保8个智能体按workflowPlan依赖关系正确协同执行。

#### Scenario: 智能体依赖执行
- **WHEN** 诊断工作流启动
- **THEN** 智能体按 taskOrchestrator→memoryManagement→dataGathering→dataUnderstanding→mathAnalysis/industryRetrieval→evidenceReview→expressionGeneration 顺序执行，串行/并行逻辑正确

#### Scenario: 智能体降级处理
- **WHEN** 某个智能体执行降级或失败
- **THEN** degradationTrace正确记录，后续智能体仍可执行，前端展示降级提示

### Requirement: RAG搜索功能验证
系统 SHALL 确保RAG检索功能准确、快速，降级机制可靠。

#### Scenario: RAG正常检索
- **WHEN** 用户请求行业数据检索
- **THEN** 返回结果包含citations和indexStats，每条citation包含title、url、source、publishedAt、confidence

#### Scenario: RAG降级
- **WHEN** 主搜索提供商不可用
- **THEN** 自动切换到备用提供商，fallbackUsed为true，缓存机制正常工作

### Requirement: 记忆功能全面验证
系统 SHALL 确保记忆的CRUD、展示、交互、角色隔离功能完整可用。

#### Scenario: 记忆CRUD
- **WHEN** 用户创建/读取/更新/删除记忆
- **THEN** 操作成功完成，数据持久化到PlatformStore，前端实时反映变更

#### Scenario: 记忆角色隔离
- **WHEN** 企业端和投资端分别查看记忆
- **THEN** 企业端仅显示role="enterprise"的记忆，投资端仅显示role="investor"的记忆

### Requirement: "记忆中的你"功能模块验证
系统 SHALL 确保"记忆中的你"页面正确记忆与调用用户数据。

#### Scenario: 记忆树节点构建
- **WHEN** 用户打开"记忆中的你"页面
- **THEN** buildMemoryNodes正确构建中心节点、主题节点、画像节点、会话节点、记忆节点、分析节点、信号节点

#### Scenario: 记忆节点交互
- **WHEN** 用户点击记忆节点
- **THEN** 显示详情对话框，支持查看、编辑、删除操作

#### Scenario: 记忆数据同步
- **WHEN** 记忆页面打开期间
- **THEN** 每5秒自动同步用户画像数据，lastSyncAt正确更新

### Requirement: 个性化服务功能验证
系统 SHALL 确保能根据用户特征提供定制化体验。

#### Scenario: 企业端个性化
- **WHEN** 企业用户完成基础信息填写
- **THEN** 基础信息保存到enterpriseBaseInfo，后续分析使用该信息进行个性化

#### Scenario: 投资端个性化
- **WHEN** 投资用户完成画像配置
- **THEN** 画像数据驱动focusMode推荐和个性化内容

### Requirement: 单位选择与数据转换
系统 SHALL 确保所有界面提供单位选择功能，且单位切换时数据能正确转换。

#### Scenario: 基础信息单位显示
- **WHEN** 用户在设置页面查看基础信息
- **THEN** 数字字段自动补充单位（万元、%、GWh、天、亿元等），单位显示正确

#### Scenario: 可视化面板单位切换
- **WHEN** 用户在VisualizationBoard中切换窗口模式（季度/滚动/前瞻）或基准模式
- **THEN** 数据值按factor正确缩放，displayValue同步更新，单位标签正确

### Requirement: 数据精度标准
系统 SHALL 确保所有数据精确到小数点后两位，计算过程准确无误。

#### Scenario: DQI/GMPS数值精度
- **WHEN** 系统计算并展示DQI/GMPS结果
- **THEN** DQI值、GMPS值、概率值、比率值均使用toFixed(2)格式化，后端round函数统一保留2位小数

#### Scenario: 图表数据精度
- **WHEN** 图表渲染数值数据
- **THEN** 所有数值至少保留2位小数，tooltip和标签显示一致

#### Scenario: 数据表精度
- **WHEN** 数据表展示数值
- **THEN** 所有数值字段精确到小数点后两位，百分比字段保留1-2位小数

### Requirement: 数据全流程验证
系统 SHALL 确保数据从获取→计算→显示的全流程无异常或错误展示。

#### Scenario: 企业端数据闭环
- **WHEN** 企业用户完成采集→分析流程
- **THEN** 数据从EntCollect→API→会话存储→DQI/GMPS计算→前端展示全链路正确

#### Scenario: 投资端数据闭环
- **WHEN** 投资用户完成画像→分析流程
- **THEN** 数据从InvAna→API→会话存储→SSE响应→前端展示全链路正确

## MODIFIED Requirements
（无修改的已有需求）

## REMOVED Requirements
（无移除的已有需求）
