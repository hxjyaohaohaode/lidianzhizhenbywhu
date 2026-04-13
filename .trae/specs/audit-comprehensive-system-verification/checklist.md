# 系统全面审计验证 - 验收检查清单

## 一、编译与基础设施

- [ ] **INFRA-001**: 后端 TypeScript 编译 0 错误
- [ ] **INFRA-002**: 前端 TypeScript 编译 0 错误
- [ ] **INFRA-003**: 所有单元测试通过
- [ ] **INFRA-004**: .env 文件中 API 密钥配置完整（DEEPSEEK_API_KEY、GLM_API_KEY、QWEN_API_KEY）
- [ ] **INFRA-005**: 后端服务正常启动，/api/health 返回 200
- [ ] **INFRA-006**: 所有 API 端点可用（企业端、投资端、模型、记忆、RAG）
- [ ] **INFRA-007**: 前端服务正常启动，页面正常加载

## 二、数据处理与管理

### 数据采集
- [ ] **DATA-001**: DataGatheringAgent 数据抓取方法实现完整
- [ ] **DATA-002**: DataGatheringAgent 在 agent-service.ts 工作流中正确集成
- [ ] **DATA-003**: 企业端采集接口正确保存数据到会话上下文
- [ ] **DATA-004**: 采集数据字段完整（grossMarginInput、operatingQualityInput 等）

### 计算精度
- [ ] **DATA-005**: 后端 round() 函数统一保留2位小数
- [ ] **DATA-006**: DQI 计算结果精度正确（dqi值、roeRatio、growthRatio、ocfRatioChange）
- [ ] **DATA-007**: GMPS 计算结果精度正确（gmps值、概率、维度得分、特征得分）
- [ ] **DATA-008**: 前端 dqi-gmps-panels.tsx 中 toFixed(2) 使用一致
- [ ] **DATA-009**: chart-data.ts 中数值格式化函数精度处理正确
- [ ] **DATA-010**: chart-system.tsx 中 applyNumberFactor 的 toFixed 精度正确

### 单位一致性
- [ ] **DATA-011**: 基础信息面板数字字段单位显示正确（万元、%、GWh、天、亿元等）
- [ ] **DATA-012**: stripBaseInfoUnit 函数正确剥离单位后保存数值
- [ ] **DATA-013**: 窗口模式切换（quarterly/rolling/forward）数据缩放正确
- [ ] **DATA-014**: 基准模式切换标签和数据更新正确
- [ ] **DATA-015**: applyNumberFactor 函数数值转换逻辑正确
- [ ] **DATA-016**: YAxisConfig 中 unit 字段正确传递和显示

### 数学模型
- [ ] **DATA-017**: DQI 公式实现正确（w1*ROE比率 + w2*Growth比率 + w3*OCF比率）
- [ ] **DATA-018**: DQI 权重配置正确（w1=0.4, w2=0.3, w3=0.3）
- [ ] **DATA-019**: DQI 趋势判断逻辑正确（>1.05改善，0.95~1.05稳定，<0.95恶化）
- [ ] **DATA-020**: DQI 驱动因素识别（argmax）逻辑正确
- [ ] **DATA-021**: DQI OCF比率变化保留正负方向（不使用 Math.abs）
- [ ] **DATA-022**: GMPS A~E 五层维度指标计算和权重正确
- [ ] **DATA-023**: GMPS indVol 和 mfgCostRatio 使用 scoreIncreasingRisk
- [ ] **DATA-024**: GMPS gpmYoy 打分区分毛利率上升/下降
- [ ] **DATA-025**: GMPS 等级划分正确（<40低压，40-70中压，≥70高压）
- [ ] **DATA-026**: GMPS Logistic 回归预测功能正常
- [ ] **DATA-027**: DQI/GMPS API 用标准测试数据返回与预期一致的结果

## 三、智能体性能

### 工作流编排
- [ ] **AGENT-001**: 8个智能体按 workflowPlan 依赖关系正确执行
- [ ] **AGENT-002**: 串行/并行执行模式正确
- [ ] **AGENT-003**: 每个智能体返回正确的 status（completed/degraded/failed）
- [ ] **AGENT-004**: degradationTrace 正确收集所有降级事件
- [ ] **AGENT-005**: taskOrchestrator 正确拆解任务和评估复杂度
- [ ] **AGENT-006**: memoryManagement 正确召回记忆和注入上下文

### 智能体与模型集成
- [ ] **AGENT-007**: extractDQIInputFromContext/extractGMPSInputFromContext 数据提取逻辑正确
- [ ] **AGENT-008**: shouldCalculateDQI 在 operationalDiagnosis/deepDive 模式下返回 true
- [ ] **AGENT-009**: shouldCalculateGMPS 在所有模式下均触发（含 investmentRecommendation）
- [ ] **AGENT-010**: DQI/GMPS 降级时 mathAnalysis status 为 "degraded"
- [ ] **AGENT-011**: dataProvenance 字段正确标注推算数据来源

### 响应性能
- [ ] **AGENT-012**: ModelRouter LLM 降级链正确（deepseekReasoner→glm5→qwen35Plus）
- [ ] **AGENT-013**: LLM 适配器可用性检查逻辑正确
- [ ] **AGENT-014**: SSE 流式响应实现正确，事件处理正常
- [ ] **AGENT-015**: AsyncTaskManager 进度更新机制正常

## 四、界面与可视化

### 分析页面功能
- [ ] **UI-ANA-001**: 企业端采集流程完整可用
- [ ] **UI-ANA-002**: 企业端分析流程完整可用，DQI/GMPS 面板正确展示
- [ ] **UI-ANA-003**: 企业端毛利推演计算逻辑正确
- [ ] **UI-ANA-004**: 企业端预警弹窗在毛利率低于10%时正确触发
- [ ] **UI-ANA-005**: 投资端画像创建流程完整可用
- [ ] **UI-ANA-006**: 投资端 SSE 流式分析正常工作
- [ ] **UI-ANA-007**: 投资端模式切换功能正常
- [ ] **UI-ANA-008**: 投资端 splitMode 对比分析功能正常
- [ ] **UI-ANA-009**: 投资端进度条实时更新

### 数据可视化
- [ ] **UI-VIZ-001**: VisualizationBoard 正确渲染所有18种 Widget 类型
- [ ] **UI-VIZ-002**: 各可视化组件数据渲染逻辑正确
- [ ] **UI-VIZ-003**: DQIResultPanel 展示 DQI 数值、状态徽章、驱动因素
- [ ] **UI-VIZ-004**: GMPSResultPanel 展示 GMPS 数值、等级、五维度评分
- [ ] **UI-VIZ-005**: 各图表类型渲染逻辑正确（line、pie、radar、bar、area）
- [ ] **UI-VIZ-006**: DQI 趋势折线图含基准线1.0
- [ ] **UI-VIZ-007**: GMPS 仪表盘按等级着色（绿/黄/红）

### 界面稳定性
- [ ] **UI-STAB-001**: 暗色/亮色主题下所有 CSS 变量定义完整
- [ ] **UI-STAB-002**: 主题切换时所有组件平滑过渡
- [ ] **UI-STAB-003**: bento grid 布局在不同屏幕尺寸下正常显示
- [ ] **UI-STAB-004**: glass-morphism 效果在两种主题下正常显示
- [ ] **UI-STAB-005**: 跑马灯动画流畅，涨跌颜色正确

### 数据更新
- [ ] **UI-UPD-001**: 企业端采集数据后 VisualizationBoard 实时更新
- [ ] **UI-UPD-002**: 投资端画像更新后首页可视化实时刷新
- [ ] **UI-UPD-003**: DQI/GMPS 面板在分析完成后正确显示最新结果
- [ ] **UI-UPD-004**: 记忆 CRUD 操作后记忆树实时更新
- [ ] **UI-UPD-005**: 会话历史列表在新增/删除会话后实时更新

## 五、RAG与实时搜索

### 核心检索
- [ ] **RAG-001**: POST `/api/rag/realtime` 返回正确的 RealtimeRagResponse 结构
- [ ] **RAG-002**: 搜索降级机制正常（主提供商→备用提供商）
- [ ] **RAG-003**: 缓存机制正常（cacheTtlMs、cacheHit 标记）
- [ ] **RAG-004**: 每条 citation 包含 title、url、source、publishedAt、confidence
- [ ] **RAG-005**: 金融相关性过滤和偏题惩罚逻辑正确
- [ ] **RAG-006**: 时效性过滤和权威度评分正确

### RAG与智能体集成
- [ ] **RAG-007**: industryRetrieval 智能体正确调用 RAG 服务
- [ ] **RAG-008**: RAG 检索结果传递给后续智能体
- [ ] **RAG-009**: RAG 降级时 industryRetrieval status 为 "degraded"
- [ ] **RAG-010**: 前端展示 RAG 降级提示（ragEvidenceDegraded 标记）

## 六、多租户架构

### 界面隔离
- [ ] **ISO-001**: 企业端渲染 EntHome/EntAna/EntSet，投资端渲染 InvHome/InvAna/InvSet
- [ ] **ISO-002**: 企业端仅展示企业端专属文案和模块
- [ ] **ISO-003**: 投资端仅展示投资端专属文案和模块
- [ ] **ISO-004**: 角色切换时界面完全切换，无残留内容

### API数据隔离
- [ ] **ISO-005**: 企业端 API 的 role 参数为 "enterprise"
- [ ] **ISO-006**: 投资端 API 的 role 参数为 "investor"
- [ ] **ISO-007**: 企业端 focusMode 限定为 operationalDiagnosis/deepDive
- [ ] **ISO-008**: 投资端 focusMode 包含 industryStatus/investmentRecommendation/deepDive

### 会话与画像隔离
- [ ] **ISO-009**: 企业端会话包含 enterpriseName
- [ ] **ISO-010**: 投资端会话包含 investedEnterprises 和 investorProfileSummary
- [ ] **ISO-011**: 企业端基础信息保存到 enterpriseBaseInfo 字段
- [ ] **ISO-012**: 投资端基础信息保存到 investorBaseInfo 字段
- [ ] **ISO-013**: enterpriseBaseInfo 和 investorBaseInfo 字段互不干扰

### 图表数据隔离
- [ ] **ISO-014**: 企业端使用 buildEnterpriseVisualization 构建图表数据
- [ ] **ISO-015**: 投资端使用 buildInvestorHomeVisualization 构建图表数据
- [ ] **ISO-016**: 企业端图表聚焦经营指标和毛利承压
- [ ] **ISO-017**: 投资端图表聚焦行业景气和投资信号

### 记忆隔离
- [ ] **ISO-018**: 企业端记忆 role 为 "enterprise"
- [ ] **ISO-019**: 投资端记忆 role 为 "investor"
- [ ] **ISO-020**: 记忆列表查询按 role 过滤，不混显

## 七、记忆功能与个性化

### 记忆CRUD
- [ ] **MEM-001**: POST `/api/memory` 创建记忆成功
- [ ] **MEM-002**: GET `/api/memory/:userId` 返回正确的记忆列表
- [ ] **MEM-003**: PUT `/api/memory/:memoryId` 更新记忆成功
- [ ] **MEM-004**: DELETE `/api/memory/:memoryId` 删除记忆成功
- [ ] **MEM-005**: PlatformStore 记忆持久化正常

### 记忆展示与交互
- [ ] **MEM-006**: MemoryScreen 记忆树节点正确构建和展示
- [ ] **MEM-007**: 记忆节点点击展示详情功能正常
- [ ] **MEM-008**: 记忆创建/编辑对话框功能正常
- [ ] **MEM-009**: 记忆标签筛选功能正常
- [ ] **MEM-010**: 记忆角色隔离正确
- [ ] **MEM-011**: 记忆数据5秒自动同步机制正常
- [ ] **MEM-012**: minimap 导航功能正常

### 个性化服务
- [ ] **PERS-001**: 企业端基础信息保存到 enterpriseBaseInfo 并参与后续个性化
- [ ] **PERS-002**: 投资端基础信息保存到 investorBaseInfo 并参与后续个性化
- [ ] **PERS-003**: 画像数据驱动 focusMode 推荐
- [ ] **PERS-004**: 会话上下文通过 GET `/api/context/:sessionId` 正确恢复
- [ ] **PERS-005**: EditableBaseInfoPanel 保存和回显逻辑正确

## 八、数据闭环

### 企业端闭环
- [ ] **LOOP-001**: 企业采集数据完整保存到会话（EntCollect→API→存储）
- [ ] **LOOP-002**: 企业分析数据正确传递给 DQI/GMPS（EntAna→API→计算）
- [ ] **LOOP-003**: grossMarginInput 和 operatingQualityInput 正确传递给数学模型
- [ ] **LOOP-004**: 模型计算结果通过 DQIGMPSPanelsContainer 正确展示

### 投资端闭环
- [ ] **LOOP-005**: 投资画像完整保存（InvAna→API→存储）
- [ ] **LOOP-006**: 投资分析 SSE 流式响应正常（InvAna→API→SSE→展示）
- [ ] **LOOP-007**: 画像数据驱动 focusMode 推荐和个性化内容
- [ ] **LOOP-008**: 会话上下文通过 GET `/api/context/:sessionId` 正确恢复

### 记忆闭环
- [ ] **LOOP-009**: memoryManagement 智能体正确召回历史记忆
- [ ] **LOOP-010**: 记忆数据参与后续智能体的上下文构建
- [ ] **LOOP-011**: 新的分析结论写入记忆供未来使用

## 九、综合验证

- [ ] **SYS-001**: 企业端完整诊断流程端到端可完成
- [ ] **SYS-002**: 投资端完整分析流程端到端可完成
- [ ] **SYS-003**: DQI/GMPS API 端到端调用返回正确结果
- [ ] **SYS-004**: "记忆中的你"页面完整交互流程可完成
- [ ] **SYS-005**: 审计发现的所有问题已修复
