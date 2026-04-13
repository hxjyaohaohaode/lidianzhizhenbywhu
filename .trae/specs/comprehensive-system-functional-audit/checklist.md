# 系统全面功能审计 - 验收检查清单

## 一、AI智能体功能

### 工作流编排
- [x] **AGENT-001**: 8个智能体按 workflowPlan 依赖关系依次执行
- [x] **AGENT-002**: 串行/并行执行模式正确（taskOrchestrator→memoryManagement→dataGathering→dataUnderstanding→mathAnalysis/industryRetrieval→evidenceReview→expressionGeneration）
- [x] **AGENT-003**: 每个智能体返回正确的 status（completed/degraded/failed）
- [x] **AGENT-004**: degradationTrace 正确收集所有降级事件

### 数学分析智能体
- [x] **AGENT-005**: shouldCalculateDQI 在 operationalDiagnosis/deepDive 模式下返回 true
- [x] **AGENT-006**: shouldCalculateGMPS 在所有模式下均触发（含 investmentRecommendation）
- [x] **AGENT-007**: DQI/GMPS 降级时 mathAnalysis status 为 "degraded"
- [x] **AGENT-008**: dataProvenance 字段正确标注推算数据来源

### 证据审查智能体
- [x] **AGENT-009**: DQI 范围检查（0.3-2.5）正确执行
- [x] **AGENT-010**: GMPS 范围检查（0-100）正确执行
- [x] **AGENT-011**: 概率范围检查（0-1）正确执行

## 二、表格数据展示

### 首页可视化
- [x] **TABLE-001**: 企业端 VisualizationBoard 正确渲染 buildEnterpriseVisualization 的所有 widget
- [x] **TABLE-002**: 投资端 VisualizationBoard 正确渲染 buildInvestorHomeVisualization 的所有 widget
- [x] **TABLE-003**: StatusCard、MetricBar、ZebraTable 等组件数据渲染正确
- [x] **TABLE-004**: 指标数值、状态标签、进度条按预设样式显示

### 分析工作台
- [x] **TABLE-005**: DQIResultPanel 展示 DQI 数值（48px字体）、状态徽章、驱动因素标签
- [x] **TABLE-006**: GMPSResultPanel 展示 GMPS 数值、等级、五维度评分条形图
- [x] **TABLE-007**: 图表按预设样式渲染（折线图、雷达图、仪表盘、瀑布图）
- [x] **TABLE-008**: 风险概率圆形指示器显示正确

### 会话历史
- [x] **TABLE-009**: 投资端会话历史列表展示正确的摘要、模式标签、时间戳
- [x] **TABLE-010**: 会话搜索和筛选功能正常工作
- [x] **TABLE-011**: 企业端历史会话展示正确

## 三、用户数据记忆功能

### CRUD操作
- [x] **MEM-001**: POST `/api/memory` 创建记忆成功，返回包含 id、createdAt 的完整记录
- [x] **MEM-002**: GET `/api/memory/:userId` 返回该用户的记忆列表，按时间倒序
- [x] **MEM-003**: PUT `/api/memory/:memoryId` 更新记忆的 summary、details、tags
- [x] **MEM-004**: DELETE `/api/memory/:memoryId` 删除记忆成功
- [x] **MEM-005**: PlatformStore 记忆持久化正常工作

### 记忆展示与交互
- [x] **MEM-006**: MemoryScreen 记忆树节点正确构建和展示
- [x] **MEM-007**: 点击记忆节点展示详情对话框
- [x] **MEM-008**: 记忆创建/编辑对话框功能正常
- [x] **MEM-009**: 记忆标签筛选功能正常
- [x] **MEM-010**: 企业端仅展示 role="enterprise" 的记忆
- [x] **MEM-011**: 投资端仅展示 role="investor" 的记忆

## 四、界面显示稳定性

### CSS变量
- [x] **UI-001**: 暗色主题下 var(--t4) 正确解析为弱化文字颜色（非黑色）
- [x] **UI-002**: 暗色主题下 var(--glass) 正确解析为半透明玻璃背景色
- [x] **UI-003**: 暗色主题下 var(--line) 正确解析为边框颜色
- [x] **UI-004**: 暗色主题下 var(--glass-soft) 正确解析为柔和玻璃背景色
- [x] **UI-005**: 暗色主题下 var(--rs) 正确解析为小圆角值
- [x] **UI-006**: 亮色主题下以上5个变量均正确解析
- [x] **UI-007**: viz-accent-* 系列变量在图表中正确使用

### 主题和布局
- [x] **UI-008**: 主题切换时所有组件平滑过渡，无闪烁或移位
- [x] **UI-009**: 图表颜色随主题变化
- [x] **UI-010**: 首页 bento grid 布局在不同屏幕尺寸下正常显示
- [x] **UI-011**: 跑马灯动画流畅，涨跌颜色为涨红跌绿
- [x] **UI-012**: iwb-split 样式在 splitMode 下生效
- [x] **UI-013**: glass-morphism 效果在两种主题下正常显示
- [x] **UI-014**: Recharts 图表在容器内正确渲染，Tooltip/Legend 正常交互

## 五、数据闭环与利用

### 企业端闭环
- [x] **LOOP-001**: 企业采集数据通过 POST `/api/enterprise/collect` 正确保存到会话
- [x] **LOOP-002**: 企业分析数据通过 POST `/api/enterprise/analyze` 正确传递给 DQI/GMPS
- [x] **LOOP-003**: grossMarginInput 和 operatingQualityInput 正确传递给数学模型
- [x] **LOOP-004**: 模型计算结果通过 DQIGMPSPanelsContainer 正确展示
- [x] **LOOP-005**: 企业基础信息保存到用户画像并参与后续个性化

### 投资端闭环
- [x] **LOOP-006**: 投资画像通过 POST `/api/investor/profile` 正确保存
- [x] **LOOP-007**: 画像数据驱动 focusMode 推荐和个性化内容
- [x] **LOOP-008**: 投资分析通过 POST `/api/investor/stream` 返回 SSE 流式响应
- [x] **LOOP-009**: 会话上下文通过 GET `/api/context/:sessionId` 正确恢复
- [x] **LOOP-010**: 投资者基础信息保存到用户画像并参与后续个性化

### 记忆闭环
- [x] **LOOP-011**: memoryManagement 智能体正确召回历史记忆
- [x] **LOOP-012**: 记忆数据参与后续智能体的上下文构建
- [x] **LOOP-013**: 新的分析结论写入记忆供未来使用

## 六、RAG数据获取功能

### 核心检索
- [x] **RAG-001**: POST `/api/rag/realtime` 返回正确的 RealtimeRagResponse 结构
- [x] **RAG-002**: 检索结果包含 citations 和 indexStats
- [x] **RAG-003**: indexStats 包含 searchHits、fetchedPages、chunkCount 等统计
- [x] **RAG-004**: 搜索降级时 fallbackUsed 为 true
- [x] **RAG-005**: 缓存命中时 cacheHit 为 true
- [x] **RAG-006**: 每条 citation 包含 title、url、source、publishedAt、confidence

### RAG与智能体集成
- [x] **RAG-007**: industryRetrieval 智能体正确调用 RAG 服务
- [x] **RAG-008**: RAG 检索结果传递给后续智能体
- [x] **RAG-009**: RAG 降级时 industryRetrieval status 为 "degraded"
- [x] **RAG-010**: 前端展示 RAG 降级提示（ragEvidenceDegraded 标记）

## 七、数学模型利用功能

### DQI模型
- [x] **MODEL-001**: ROE = 净利润 / 平均净资产 × 100% 计算正确
- [x] **MODEL-002**: Growth = (当期营收 - 基期营收) / 基期营收 计算正确
- [x] **MODEL-003**: OCF比率 = 经营现金流 / 营业收入 计算正确
- [x] **MODEL-004**: DQI = w1·(ROE_t/ROE_{t-1}) + w2·(Growth_t/Growth_{t-1}) + w3·(OCF_t/OCF_{t-1}) 计算正确
- [x] **MODEL-005**: 权重配置 w1=0.4, w2=0.3, w3=0.3 正确
- [x] **MODEL-006**: 驱动因素识别（argmax）正确
- [x] **MODEL-007**: 趋势判断正确（DQI>1.05改善，0.95≤DQI≤1.05稳定，DQI<0.95恶化）
- [x] **MODEL-008**: OCF 比率变化保留正负方向（不使用 Math.abs）
- [x] **MODEL-009**: POST `/api/models/dqi/calculate` 返回格式正确

### GMPS模型
- [x] **MODEL-010**: A~E 五层维度指标计算正确
- [x] **MODEL-011**: indVol 打分使用 scoreIncreasingRisk（高波动→高风险）
- [x] **MODEL-012**: mfgCostRatio 打分使用 scoreIncreasingRisk（高占比→高风险）
- [x] **MODEL-013**: gpmYoy 打分区分毛利率上升（低风险）和下降（高风险）
- [x] **MODEL-014**: 加权综合得分和等级划分正确（<40低压，40-70中压，≥70高压）
- [x] **MODEL-015**: Logistic 回归预测功能正常
- [x] **MODEL-016**: POST `/api/models/gmps/calculate` 返回格式正确

### 模型结果前端展示
- [x] **MODEL-017**: DQI趋势折线图含基准线1.0
- [x] **MODEL-018**: GMPS仪表盘按等级着色（绿/黄/红）
- [x] **MODEL-019**: 五维度雷达图正确展示 A~E 层
- [x] **MODEL-020**: 特征得分瀑布图正确展示10个特征变量

## 八、企业端与投资端隔离

### 界面隔离
- [x] **ISO-001**: 企业端渲染 EntHome/EntAna/EntSet，投资端渲染 InvHome/InvAna/InvSet
- [x] **ISO-002**: 企业端展示"企业端工作台"、"经营诊断入口已闭环"等专属文案
- [x] **ISO-003**: 投资端展示"投资端工作台"、"投资分析入口已闭环"等专属文案
- [x] **ISO-004**: 企业端不展示投资端专属内容（投资模式切换、投资推荐、投资画像）
- [x] **ISO-005**: 投资端不展示企业端专属内容（经营诊断、企业采集、企业基础信息）
- [x] **ISO-006**: 角色切换时界面完全切换，无残留内容

### API隔离
- [x] **ISO-007**: 企业端使用 /api/enterprise/collect 和 /api/enterprise/analyze
- [x] **ISO-008**: 投资端使用 /api/investor/profile、/api/investor/recommend 等
- [x] **ISO-009**: 企业端请求 role 为 "enterprise"
- [x] **ISO-010**: 投资端请求 role 为 "investor"
- [x] **ISO-011**: 企业端 focusMode 限定为 operationalDiagnosis/deepDive
- [x] **ISO-012**: 投资端 focusMode 包含 industryStatus/investmentRecommendation/deepDive

### 会话隔离
- [x] **ISO-013**: 企业端会话包含 enterpriseName
- [x] **ISO-014**: 投资端会话包含 investedEnterprises 和 investorProfileSummary
- [x] **ISO-015**: 企业端会话 role 为 "enterprise"
- [x] **ISO-016**: 投资端会话 role 为 "investor"

### 画像隔离
- [x] **ISO-017**: 企业端基础信息保存到 enterpriseBaseInfo 字段
- [x] **ISO-018**: 投资端基础信息保存到 investorBaseInfo 字段
- [x] **ISO-019**: enterpriseBaseInfo 和 investorBaseInfo 字段互不干扰

### 图表数据隔离
- [x] **ISO-020**: 企业端使用 buildEnterpriseVisualization 构建图表数据
- [x] **ISO-021**: 投资端使用 buildInvestorHomeVisualization 构建图表数据
- [x] **ISO-022**: 企业端图表聚焦经营指标和毛利承压
- [x] **ISO-023**: 投资端图表聚焦行业景气和投资信号

### 记忆隔离
- [x] **ISO-024**: 企业端记忆 role 为 "enterprise"
- [x] **ISO-025**: 投资端记忆 role 为 "investor"
- [x] **ISO-026**: 记忆列表查询按 role 过滤，不混显

## 九、综合验证

- [x] **SYS-001**: 后端 TypeScript 编译 0 错误
- [x] **SYS-002**: 前端 TypeScript 编译 0 错误
- [x] **SYS-003**: 所有单元测试通过
- [x] **SYS-004**: 后端服务正常启动，所有 API 端点可用
- [x] **SYS-005**: 前端服务正常启动，页面正常加载
- [x] **SYS-006**: 企业端完整诊断流程端到端可完成
- [x] **SYS-007**: 投资端完整分析流程端到端可完成
- [x] **SYS-008**: DQI/GMPS API 端到端调用返回正确结果
