# 系统稳定性与功能完整性修复 Spec

## Why
系统当前存在严重的UI样式失效、数学模型计算逻辑错误、AI智能体降级事件不可见、数据获取不稳定等问题，导致界面移位/无法加载、分析结果不可信、系统状态不透明。必须全面修复以确保系统以数学模型为底座、AI智能体为辅助的架构正确运行。

## What Changes

### 一、前端UI稳定性修复（严重）
- 补充5个缺失的CSS变量定义：`--t4`、`--glass`、`--line`、`--glass-soft`、`--rs`
- 修复跑马灯样式重复定义和涨跌颜色冲突
- 修复前端API调用中`JSON.parse`缺少try-catch保护的问题
- 修复`requestJson`在2xx响应时仍可能抛出异常的问题
- 修复`dangerouslySetInnerHTML`未做HTML转义的XSS风险
- 修复CSS类`iwb-split`未定义导致splitMode功能无效的问题
- 清理未使用的类型导入

### 二、数学模型计算逻辑修复（严重）
- 修复GMPS中`indVol`和`mfgCostRatio`打分方向颠倒（使用了`scoreDecreasingRisk`但应为`scoreIncreasingRisk`）
- 修复GMPS中`gpmYoy`取绝对值打分导致毛利率改善被标为高风险
- 修复DQI中OCF比率变化使用`Math.abs`丢失现金流方向信息
- 修复DQI基期增长率硬编码为0导致成长能力维度失真
- 修复DQI的`identifyDriver`在稳定状态下仍返回"驱动因素"的问题

### 三、AI智能体与数学模型集成修复（严重）
- 修复DQI输入数据通过硬编码比例推算（净利润率8%/9%、净资产占比44%-46%），应在输出中标注数据来源
- 修复GMPS库存值用`InventoryExpense * 1.2/1.1`估算，缺乏业务依据
- 修复GMPS碳酸锂价格和行业波动率使用硬编码默认值
- 修复`shouldCalculateGMPS`对`investmentRecommendation`模式不触发
- 修复`runMathAnalysisAgent`始终标记为`completed`，DQI/GMPS降级事件不可见
- 修复DQI/GMPS降级事件未记录到`degradationTrace`

### 四、类型定义与治理一致性修复（中等）
- 修复`DQIResult`缺少`governance`字段
- 修复`MathAnalysisOutput`中`dqiModel`/`gmpsModel`类型与`DQIResult`/`GMPSResult`重复定义且不同步
- 修复DQI的`trend`字段为string而其他模型使用结构化`TrendAssessment`

### 五、数据获取稳定性修复（中等）
- 优化外部数据获取的超时和重试策略
- 确保NBS宏观数据获取失败时正确降级
- 确保数据采集失败时降级消息准确

## Impact
- Affected specs: 数学模型核心、智能体工作流、前端UI系统
- Affected code:
  - `src/web/App.tsx` — CSS变量定义、主题系统
  - `src/web/styles.css` — 跑马灯样式冲突
  - `src/web/api.ts` — API错误处理
  - `src/server/models.ts` — DQI/GMPS计算逻辑
  - `src/server/agent-service.ts` — 智能体集成、降级事件
  - `src/shared/diagnostics.ts` — DQIResult类型定义
  - `src/shared/agents.ts` — MathAnalysisOutput类型定义

## ADDED Requirements

### Requirement: CSS变量完整性
系统SHALL在暗色和亮色主题中都定义所有被引用的CSS变量，包括`--t4`、`--glass`、`--line`、`--glass-soft`、`--rs`。

#### Scenario: 暗色主题下所有CSS变量可用
- **WHEN** 用户切换到暗色主题
- **THEN** 所有`var(--t4)`、`var(--glass)`、`var(--line)`、`var(--glass-soft)`、`var(--rs)`引用都能正确解析为有效颜色值
- **AND** 文字、边框、背景、圆角均正常显示

#### Scenario: 亮色主题下所有CSS变量可用
- **WHEN** 用户切换到亮色主题
- **THEN** 同上

### Requirement: GMPS打分方向正确性
系统SHALL确保GMPS模型中所有指标的打分函数方向与业务语义一致。

#### Scenario: 行业波动率打分
- **WHEN** `indVol = 0.5`（高波动）
- **THEN** 得分SHALL为高风险（≥60分）
- **WHEN** `indVol = 0.15`（低波动）
- **THEN** 得分SHALL为低风险（≤40分）

#### Scenario: 制造费用占比打分
- **WHEN** `mfgCostRatio = 0.85`（高占比）
- **THEN** 得分SHALL为高风险（≥60分）
- **WHEN** `mfgCostRatio = 0.5`（低占比）
- **THEN** 得分SHALL为低风险（≤40分）

### Requirement: 毛利率同比变化方向性
系统SHALL区分毛利率上升（改善）和下降（恶化），不使用绝对值统一打分。

#### Scenario: 毛利率大幅改善
- **WHEN** `gpmYoy = 0.15`（毛利率上升15%）
- **THEN** 得分SHALL为低风险（≤40分）

#### Scenario: 毛利率大幅恶化
- **WHEN** `gpmYoy = -0.15`（毛利率下降15%）
- **THEN** 得分SHALL为高风险（≥60分）

### Requirement: DQI现金流方向保留
系统SHALL在DQI的OCF比率变化计算中保留现金流正负方向信息。

#### Scenario: 现金流转负
- **WHEN** 当期OCF比率为负值，基期OCF比率为正值
- **THEN** `ocfRatioChange` SHALL反映恶化方向（<1）

### Requirement: 数学模型降级事件可见
系统SHALL将DQI/GMPS计算降级事件记录到工作流的`degradationTrace`中，并正确标记`mathAnalysis`智能体状态。

#### Scenario: DQI计算降级
- **WHEN** DQI输入数据不足导致降级
- **THEN** `degradationTrace` SHALL包含对应的降级事件
- **AND** `mathAnalysis`智能体status SHALL为"degraded"

#### Scenario: GMPS计算降级
- **WHEN** GMPS输入数据不足导致降级
- **THEN** 同上

### Requirement: 推算数据标注
系统SHALL在DQI/GMPS输入数据为推算值时，在输出中明确标注数据来源和推算方法。

#### Scenario: DQI使用推算数据
- **WHEN** DQI的净利润或净资产数据通过比例推算获得
- **THEN** 输出SHALL包含`dataProvenance`字段标注哪些数据为推算值

### Requirement: 前端API调用健壮性
系统SHALL在前端API调用中对JSON解析进行try-catch保护，防止服务端异常导致前端崩溃。

#### Scenario: SSE流式数据格式错误
- **WHEN** 服务端发送了非JSON格式的SSE数据行
- **THEN** 前端SHALL跳过该行并继续处理后续数据
- **AND** 不SHALL导致整个流式读取中断

## MODIFIED Requirements

### Requirement: GMPS模型打分函数
原实现中`indVol`和`mfgCostRatio`使用`scoreDecreasingRisk`，修改为使用`scoreIncreasingRisk`，与"高波动危险"和"高占比危险"的业务语义一致。

### Requirement: DQI模型成长能力计算
原实现中`baselineGrowth`硬编码为0，修改为从请求输入中获取`baselineGrowth`字段（可选，缺失时使用合理的默认推算逻辑并在输出中标注）。

### Requirement: mathAnalysis智能体状态报告
原实现中`runMathAnalysisAgent`始终返回`status: "completed"`和空`degradationTrace`，修改为根据DQI/GMPS实际计算状态返回正确的status和degradationTrace。

## REMOVED Requirements
无移除的需求。
