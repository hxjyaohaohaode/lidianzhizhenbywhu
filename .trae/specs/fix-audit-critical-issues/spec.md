# 系统审计问题修复与优化 Spec

## Why
综合系统审计发现11个严重问题、11个高级问题、23个中级问题和24个低级问题，涵盖数据处理、智能体性能、界面可视化、多租户架构和持久化层。这些问题影响系统计算准确性、数据安全性和生产可靠性，需要按优先级逐一修复。

## What Changes
- 修复DQI模型负OCF比率反转语义错误
- 修复GMPS库存估算不对称乘数偏差
- 为模型输出链添加NaN/Infinity防护
- 为API路由添加认证中间件和角色授权
- 添加`requireEnterpriseSession`方法
- 按角色过滤用户画像响应
- 修复PlatformStore并发控制和数据丢失防护
- 修复SSE心跳/保活机制
- 添加SSE客户端断开处理
- 完善浅色主题CSS覆盖
- 为可视化构建器添加useMemo优化
- 修复DataFormatter百分比双重除法
- 修复简单路径不写记忆的问题
- 统一API响应格式
- 添加服务端货币单位校验

## Impact
- Affected specs: 数据处理、多租户隔离、智能体工作流、界面可视化、持久化层
- Affected code: `src/server/models.ts`, `src/server/agent-service.ts`, `src/server/app.ts`, `src/server/business-service.ts`, `src/server/platform-store.ts`, `src/server/memory.ts`, `src/web/App.tsx`, `src/web/styles.css`, `src/web/data-formatter.ts`, `src/web/chart-data.ts`, `src/web/chart-system.tsx`, `src/web/dqi-gmps-panels.tsx`

## ADDED Requirements

### Requirement: DQI负OCF比率语义修正
系统在计算DQI时，当基期和当期OCF比率均为负值时，SHALL使用绝对值比较而非比率除法来判断改善/恶化方向。

#### Scenario: 双负OCF比率正确判断趋势
- **WHEN** baselineOCFRatio = -0.05 且 currentOCFRatio = -0.10
- **THEN** ocfRatioChange应反映恶化（值<1），而非当前错误地返回2.0（改善）

#### Scenario: 单负OCF比率保持现有逻辑
- **WHEN** baselineOCFRatio = 0.05 且 currentOCFRatio = -0.03
- **THEN** ocfRatioChange = -0.03 / 0.05 = -0.6（恶化），逻辑正确不变

### Requirement: 模型输出NaN/Infinity防护
系统SHALL在所有数学模型输出函数（round、weightedScore、normalizeHigherBetter等）中添加NaN和Infinity检查，确保任何异常输入不会传播到最终结果。

#### Scenario: NaN输入被拦截
- **WHEN** 某个normalizedScore为NaN
- **THEN** weightedScore返回0而非NaN，并记录degradation事件

#### Scenario: Infinity输入被拦截
- **WHEN** 除法产生Infinity
- **THEN** round函数将Infinity钳位为0，并记录degradation事件

### Requirement: API认证中间件
系统SHALL为所有API路由添加认证中间件，验证请求中的userId与已认证会话匹配。

#### Scenario: 未认证请求被拒绝
- **WHEN** 请求不包含有效的认证信息
- **THEN** 返回401 Unauthorized

#### Scenario: 跨角色访问被拒绝
- **WHEN** 投资端用户尝试调用 /api/enterprise/collect
- **THEN** 返回403 Forbidden

### Requirement: 企业端会话所有权验证
系统SHALL添加`requireEnterpriseSession`方法，镜像现有的`requireInvestorSession`，验证会话属于请求用户且角色为enterprise。

#### Scenario: 非所有者访问企业会话被拒绝
- **WHEN** 用户B尝试访问用户A的企业会话
- **THEN** 返回403 Forbidden

### Requirement: 用户画像按角色过滤
系统SHALL在`GET /api/users/:userId`响应中，根据请求者角色过滤返回的baseInfo字段，企业端用户只能看到enterpriseBaseInfo，投资端用户只能看到investorBaseInfo。

#### Scenario: 企业端用户无法看到投资端信息
- **WHEN** 企业端用户请求 GET /api/users/:userId
- **THEN** 响应中investorBaseInfo为空对象{}

### Requirement: PlatformStore并发安全与数据丢失防护
系统SHALL为PlatformStore添加写锁机制防止并发数据丢失，并在读取失败时备份数据文件而非返回空状态。

#### Scenario: 并发写入不丢失数据
- **WHEN** 两个请求同时触发状态更新
- **THEN** 两个更新都完整保存，无数据丢失

#### Scenario: 损坏文件不导致数据清空
- **WHEN** platform-state.json文件损坏
- **THEN** 系统将损坏文件重命名为.bak备份，创建新空状态，并记录错误日志

### Requirement: SSE心跳与断开处理
系统SHALL为SSE流添加30秒间隔的心跳注释（`: keepalive\n\n`），并在客户端断开时中止进行中的LLM调用。

#### Scenario: 长时间分析不断开
- **WHEN** 投资端辩论分析持续超过60秒
- **THEN** 客户端每30秒收到心跳，连接保持活跃

#### Scenario: 客户端断开停止服务端处理
- **WHEN** 用户在SSE流期间关闭浏览器
- **THEN** 服务端在5秒内中止所有进行中的LLM API调用

### Requirement: 浅色主题完整性
系统SHALL为可视化看板和小组件容器添加`.theme-light` CSS覆盖，确保浅色主题下所有元素可见。

#### Scenario: 浅色主题下看板可见
- **WHEN** 用户切换到浅色主题
- **THEN** .viz-board背景为浅色，.viz-widget背景为白色半透明，文字颜色为深色

### Requirement: 简单路径记忆写入
系统SHALL在简单复杂度路径的diagnose方法中添加记忆写入，确保简单查询也贡献到用户记忆历史。

#### Scenario: 简单查询写入记忆
- **WHEN** 用户发送简单查询（如"计算当前毛利率"）
- **THEN** 分析完成后记忆被写入memoryStore

### Requirement: GMPS库存估算对称化
系统SHALL将GMPS库存估算的当前期和基期乘数统一，消除系统性偏差。

#### Scenario: 库存估算无偏差
- **WHEN** currentInventoryExpense = baselineInventoryExpense
- **THEN** currentInventory = baselineInventory（估算值相等）

### Requirement: API响应格式统一
系统SHALL统一所有模型端点的响应格式，全部使用`{success, data}`包装。

#### Scenario: 毛利率端点返回统一格式
- **WHEN** 调用 POST /api/models/gross-margin-pressure
- **THEN** 响应格式为 `{success: true, data: result}`

## MODIFIED Requirements

### Requirement: DQI现金流贡献钳位范围
DQI现金流贡献的钳位范围从[-0.5, 3]修改为[0, 3]，与盈利和增长贡献保持一致，确保DQI最小值为0。

### Requirement: 记忆召回数量
buildWorkflowMemoryNotes中的记忆召回数量从2条增加到5条，增强跨会话上下文连续性。

## REMOVED Requirements
（无移除项）
