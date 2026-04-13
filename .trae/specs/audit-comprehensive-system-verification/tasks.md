# Tasks

## 阶段一：编译与基础设施验证

- [ ] Task 1: 验证TypeScript编译和单元测试
  - [ ] SubTask 1.1: 运行 `npx tsc -p tsconfig.server.json --noEmit` 确保后端0错误
  - [ ] SubTask 1.2: 运行 `npx tsc -p tsconfig.app.json --noEmit` 确保前端0错误
  - [ ] SubTask 1.3: 运行 `npx vitest run` 确保所有测试通过
  - [ ] SubTask 1.4: 检查 .env 文件中 API 密钥配置完整性

- [ ] Task 2: 验证服务启动和API端点可用性
  - [ ] SubTask 2.1: 启动后端服务，验证 /api/health 返回 200
  - [ ] SubTask 2.2: 验证所有数学模型端点可用（/api/models/dqi/calculate、/api/models/gmps/calculate）
  - [ ] SubTask 2.3: 验证企业端端点可用（/api/enterprise/collect、/api/enterprise/analyze）
  - [ ] SubTask 2.4: 验证投资端端点可用（/api/investor/profile、/api/investor/stream、/api/investor/recommend）
  - [ ] SubTask 2.5: 验证记忆端点可用（/api/memory CRUD）
  - [ ] SubTask 2.6: 验证RAG端点可用（/api/rag/realtime）
  - [ ] SubTask 2.7: 启动前端服务，验证页面正常加载

## 阶段二：数据处理与管理审计

- [ ] Task 3: 审计数据采集机制
  - [ ] SubTask 3.1: 检查 `src/server/data/data-fetcher.ts` 中 DataGatheringAgent 的数据抓取方法实现
  - [ ] SubTask 3.2: 验证 DataGatheringAgent 在 agent-service.ts 工作流中的集成状态
  - [ ] SubTask 3.3: 检查企业端采集接口 POST `/api/enterprise/collect` 的数据保存逻辑
  - [ ] SubTask 3.4: 验证采集数据的字段完整性（grossMarginInput、operatingQualityInput 等）

- [ ] Task 4: 审计数据计算精度
  - [ ] SubTask 4.1: 检查 `src/server/models.ts` 中 round() 函数统一保留2位小数
  - [ ] SubTask 4.2: 验证 DQI 计算结果精度（dqi值、roeRatio、growthRatio、ocfRatioChange）
  - [ ] SubTask 4.3: 验证 GMPS 计算结果精度（gmps值、概率、维度得分、特征得分）
  - [ ] SubTask 4.4: 检查前端 `dqi-gmps-panels.tsx` 中 toFixed(2) 的使用一致性
  - [ ] SubTask 4.5: 检查 `chart-data.ts` 中数值格式化函数的精度处理
  - [ ] SubTask 4.6: 检查 `chart-system.tsx` 中 applyNumberFactor 的 toFixed 精度

- [ ] Task 5: 审计数据单位一致性
  - [ ] SubTask 5.1: 检查基础信息面板中数字字段的单位显示（万元、%、GWh、天、亿元等）
  - [ ] SubTask 5.2: 验证 stripBaseInfoUnit 函数正确剥离单位后保存数值
  - [ ] SubTask 5.3: 检查 VisualizationBoard 中窗口模式切换的数据缩放逻辑
  - [ ] SubTask 5.4: 验证基准模式切换的标签和数据更新
  - [ ] SubTask 5.5: 检查 applyNumberFactor 函数在单位切换时的数值转换逻辑
  - [ ] SubTask 5.6: 验证 YAxisConfig 中 unit 字段的正确传递和显示

- [ ] Task 6: 审计数学模型实现
  - [ ] SubTask 6.1: 验证 DQI 公式：DQI = w1*(ROE_t/ROE_{t-1}) + w2*(Growth_t/Growth_{t-1}) + w3*(OCF_t/OCF_{t-1})
  - [ ] SubTask 6.2: 验证 DQI 权重配置（w1=0.4, w2=0.3, w3=0.3）
  - [ ] SubTask 6.3: 验证 DQI 趋势判断逻辑（>1.05改善，0.95~1.05稳定，<0.95恶化）
  - [ ] SubTask 6.4: 验证 DQI 驱动因素识别（argmax）逻辑
  - [ ] SubTask 6.5: 验证 DQI OCF比率变化保留正负方向（不使用 Math.abs）
  - [ ] SubTask 6.6: 验证 GMPS A~E 五层维度指标计算和权重
  - [ ] SubTask 6.7: 验证 GMPS indVol 和 mfgCostRatio 使用 scoreIncreasingRisk
  - [ ] SubTask 6.8: 验证 GMPS gpmYoy 打分区分毛利率上升/下降
  - [ ] SubTask 6.9: 验证 GMPS 等级划分（<40低压，40-70中压，≥70高压）
  - [ ] SubTask 6.10: 验证 GMPS Logistic 回归预测功能
  - [ ] SubTask 6.11: 用标准测试数据调用 DQI/GMPS API，验证计算结果与预期一致

## 阶段三：智能体性能审计

- [ ] Task 7: 审计智能体工作流编排
  - [ ] SubTask 7.1: 检查 `src/server/agent-service.ts` 中 workflowPlan 定义，确认8个智能体的依赖关系
  - [ ] SubTask 7.2: 验证 diagnose 方法按依赖关系依次执行智能体，串行/并行逻辑正确
  - [ ] SubTask 7.3: 检查每个智能体的 status 返回值（completed/degraded/failed）
  - [ ] SubTask 7.4: 验证 degradationTrace 收集逻辑
  - [ ] SubTask 7.5: 检查 taskOrchestrator 智能体的任务拆解和复杂度评估
  - [ ] SubTask 7.6: 验证 memoryManagement 智能体的记忆召回和上下文注入

- [ ] Task 8: 审计智能体与数学模型集成
  - [ ] SubTask 8.1: 检查 extractDQIInputFromContext 和 extractGMPSInputFromContext 数据提取逻辑
  - [ ] SubTask 8.2: 验证 shouldCalculateDQI 在 operationalDiagnosis/deepDive 模式下返回 true
  - [ ] SubTask 8.3: 验证 shouldCalculateGMPS 在所有模式下均触发（含 investmentRecommendation）
  - [ ] SubTask 8.4: 验证 DQI/GMPS 降级时 mathAnalysis status 为 "degraded"
  - [ ] SubTask 8.5: 检查 dataProvenance 字段是否正确标注推算数据来源

- [ ] Task 9: 审计智能体响应性能
  - [ ] SubTask 9.1: 检查 ModelRouter 的 LLM 提供方降级链（deepseekReasoner→glm5→qwen35Plus）
  - [ ] SubTask 9.2: 验证 LLM 适配器可用性检查逻辑（hasApiKey→isAvailable）
  - [ ] SubTask 9.3: 检查 SSE 流式响应的实现和事件处理
  - [ ] SubTask 9.4: 验证异步任务管理器（AsyncTaskManager）的进度更新机制

## 阶段四：界面与可视化审计

- [ ] Task 10: 审计分析页面功能
  - [ ] SubTask 10.1: 验证企业端采集流程（EntCollect→collectEnterpriseData→sessionContext）
  - [ ] SubTask 10.2: 验证企业端分析流程（send→analyzeEnterprise→DQI/GMPS面板展示）
  - [ ] SubTask 10.3: 验证企业端毛利推演计算逻辑（baseMargin→inferredMargin）
  - [ ] SubTask 10.4: 验证企业端预警弹窗（showWarningPopup）触发条件
  - [ ] SubTask 10.5: 验证投资端画像创建流程（createInvestorProfile→sessionContext）
  - [ ] SubTask 10.6: 验证投资端SSE流式分析（streamInvestorAnalysis→事件处理）
  - [ ] SubTask 10.7: 验证投资端模式切换（switchInvestorMode→syncSession）
  - [ ] SubTask 10.8: 验证投资端splitMode对比分析功能
  - [ ] SubTask 10.9: 验证投资端进度条（progressState）实时更新

- [ ] Task 11: 审计数据可视化完整性
  - [ ] SubTask 11.1: 检查 VisualizationBoard 组件正确渲染所有18种 Widget 类型
  - [ ] SubTask 11.2: 检查 chart-system.tsx 中各可视化组件的数据渲染逻辑
  - [ ] SubTask 11.3: 验证 DQIResultPanel 展示 DQI 数值、状态徽章、驱动因素
  - [ ] SubTask 11.4: 验证 GMPSResultPanel 展示 GMPS 数值、等级、五维度评分
  - [ ] SubTask 11.5: 验证 chart-renderer.tsx 中各图表类型的渲染逻辑（line、pie、radar、bar、area）
  - [ ] SubTask 11.6: 验证 DQI 趋势折线图含基准线1.0
  - [ ] SubTask 11.7: 验证 GMPS 仪表盘按等级着色（绿/黄/红）

- [ ] Task 12: 审计界面稳定性
  - [ ] SubTask 12.1: 检查暗色/亮色主题下所有 CSS 变量定义完整性
  - [ ] SubTask 12.2: 验证主题切换时所有组件平滑过渡
  - [ ] SubTask 12.3: 检查 bento grid 布局在不同屏幕尺寸下的响应式表现
  - [ ] SubTask 12.4: 验证 glass-morphism 效果在两种主题下正常显示
  - [ ] SubTask 12.5: 检查跑马灯动画流畅性和涨跌颜色

- [ ] Task 13: 审计数据更新功能
  - [ ] SubTask 13.1: 验证企业端采集数据后 VisualizationBoard 实时更新
  - [ ] SubTask 13.2: 验证投资端画像更新后首页可视化实时刷新
  - [ ] SubTask 13.3: 验证 DQI/GMPS 面板在分析完成后正确显示最新结果
  - [ ] SubTask 13.4: 验证记忆 CRUD 操作后记忆树实时更新
  - [ ] SubTask 13.5: 验证会话历史列表在新增/删除会话后实时更新

## 阶段五：RAG与实时搜索审计

- [ ] Task 14: 审计RAG检索核心功能
  - [ ] SubTask 14.1: 检查 `src/server/realtime-rag.ts` 中 RealtimeIndustryRagService 的搜索和检索逻辑
  - [ ] SubTask 14.2: 验证 POST `/api/rag/realtime` 返回正确的 RealtimeRagResponse 结构
  - [ ] SubTask 14.3: 检查搜索提供商和备用搜索提供商的降级机制
  - [ ] SubTask 14.4: 验证缓存机制（cacheTtlMs、cacheHit 标记）
  - [ ] SubTask 14.5: 检查引用溯源（citations 包含 title、url、source、publishedAt、confidence）
  - [ ] SubTask 14.6: 检查金融相关性过滤和偏题惩罚逻辑
  - [ ] SubTask 14.7: 验证时效性过滤（maxSourceAgeDays）和权威度评分

- [ ] Task 15: 审计RAG与智能体集成
  - [ ] SubTask 15.1: 检查 industryRetrieval 智能体调用 RAG 服务的逻辑
  - [ ] SubTask 15.2: 验证 RAG 检索结果传递给后续智能体
  - [ ] SubTask 15.3: 检查 RAG 降级时 industryRetrieval 智能体的 status 和 degradationTrace
  - [ ] SubTask 15.4: 验证前端展示 RAG 降级提示（ragEvidenceDegraded 标记）

## 阶段六：多租户架构审计

- [ ] Task 16: 审计界面隔离
  - [ ] SubTask 16.1: 检查 App.tsx 中企业端组件和投资端组件的渲染条件
  - [ ] SubTask 16.2: 验证企业端界面仅展示企业端专属文案和模块
  - [ ] SubTask 16.3: 验证投资端界面仅展示投资端专属文案和模块
  - [ ] SubTask 16.4: 检查角色切换时界面完全切换，无残留内容

- [ ] Task 17: 审计API数据隔离
  - [ ] SubTask 17.1: 检查企业端 API 的 role 参数为 "enterprise"
  - [ ] SubTask 17.2: 检查投资端 API 的 role 参数为 "investor"
  - [ ] SubTask 17.3: 验证企业端 focusMode 限定为 operationalDiagnosis/deepDive
  - [ ] SubTask 17.4: 验证投资端 focusMode 包含 industryStatus/investmentRecommendation/deepDive

- [ ] Task 18: 审计会话与画像隔离
  - [ ] SubTask 18.1: 检查 session-store.ts 中企业端会话包含 enterpriseName
  - [ ] SubTask 18.2: 检查 session-store.ts 中投资端会话包含 investedEnterprises 和 investorProfileSummary
  - [ ] SubTask 18.3: 验证企业端基础信息保存到 enterpriseBaseInfo 字段
  - [ ] SubTask 18.4: 验证投资端基础信息保存到 investorBaseInfo 字段
  - [ ] SubTask 18.5: 检查 platform-store.ts 中 enterpriseBaseInfo 和 investorBaseInfo 字段隔离

- [ ] Task 19: 审计图表数据隔离
  - [ ] SubTask 19.1: 验证企业端使用 buildEnterpriseVisualization 构建图表数据
  - [ ] SubTask 19.2: 验证投资端使用 buildInvestorHomeVisualization 构建图表数据
  - [ ] SubTask 19.3: 检查企业端图表内容聚焦经营指标和毛利承压
  - [ ] SubTask 19.4: 检查投资端图表内容聚焦行业景气和投资信号

- [ ] Task 20: 审计记忆隔离
  - [ ] SubTask 20.1: 验证企业端记忆 role 为 "enterprise"
  - [ ] SubTask 20.2: 验证投资端记忆 role 为 "investor"
  - [ ] SubTask 20.3: 检查记忆列表查询时按 role 过滤，不混显

## 阶段七：记忆功能与个性化审计

- [ ] Task 21: 审计记忆CRUD功能
  - [ ] SubTask 21.1: 验证 POST `/api/memory` 创建记忆接口
  - [ ] SubTask 21.2: 验证 GET `/api/memory/:userId` 读取记忆接口
  - [ ] SubTask 21.3: 验证 PUT `/api/memory/:memoryId` 更新记忆接口
  - [ ] SubTask 21.4: 验证 DELETE `/api/memory/:memoryId` 删除记忆接口
  - [ ] SubTask 21.5: 检查 PlatformStore 中记忆持久化逻辑

- [ ] Task 22: 审计记忆展示与交互
  - [ ] SubTask 22.1: 检查 MemoryScreen 组件的记忆树节点构建逻辑
  - [ ] SubTask 22.2: 验证记忆节点点击展示详情功能
  - [ ] SubTask 22.3: 验证记忆创建/编辑对话框功能
  - [ ] SubTask 22.4: 检查记忆标签筛选功能
  - [ ] SubTask 22.5: 验证记忆角色隔离（enterprise/investor 记忆不混显）
  - [ ] SubTask 22.6: 验证记忆数据5秒自动同步机制
  - [ ] SubTask 22.7: 检查 minimap 导航功能

- [ ] Task 23: 审计个性化服务
  - [ ] SubTask 23.1: 验证企业端基础信息保存到 enterpriseBaseInfo 并参与后续个性化
  - [ ] SubTask 23.2: 验证投资端基础信息保存到 investorBaseInfo 并参与后续个性化
  - [ ] SubTask 23.3: 验证画像数据驱动 focusMode 推荐
  - [ ] SubTask 23.4: 验证会话上下文通过 GET `/api/context/:sessionId` 正确恢复
  - [ ] SubTask 23.5: 检查 EditableBaseInfoPanel 组件的保存和回显逻辑

## 阶段八：数据闭环审计

- [ ] Task 24: 审计企业端数据闭环
  - [ ] SubTask 24.1: 追踪企业采集数据从 EntCollect → POST `/api/enterprise/collect` → 会话存储的完整链路
  - [ ] SubTask 24.2: 追踪企业分析数据从 EntAna → POST `/api/enterprise/analyze` → DQI/GMPS 计算的完整链路
  - [ ] SubTask 24.3: 验证 grossMarginInput 和 operatingQualityInput 正确传递给数学模型
  - [ ] SubTask 24.4: 验证模型计算结果通过 DQIGMPSPanelsContainer 正确展示

- [ ] Task 25: 审计投资端数据闭环
  - [ ] SubTask 25.1: 追踪投资画像从 InvAna → POST `/api/investor/profile` → 会话存储的完整链路
  - [ ] SubTask 25.2: 追踪投资分析从 InvAna → POST `/api/investor/stream` → SSE 流式响应的完整链路
  - [ ] SubTask 25.3: 验证画像数据驱动 focusMode 推荐和个性化内容
  - [ ] SubTask 25.4: 验证会话上下文通过 GET `/api/context/:sessionId` 正确恢复

- [ ] Task 26: 审计记忆数据闭环
  - [ ] SubTask 26.1: 验证 memoryManagement 智能体正确召回历史记忆
  - [ ] SubTask 26.2: 验证记忆数据参与后续智能体的上下文构建
  - [ ] SubTask 26.3: 验证新的分析结论写入记忆供未来使用

## 阶段九：综合验证与问题修复

- [ ] Task 27: 端到端功能验证
  - [ ] SubTask 27.1: 验证企业端完整诊断流程（采集→分析→结果展示）
  - [ ] SubTask 27.2: 验证投资端完整分析流程（画像→分析→结果展示）
  - [ ] SubTask 27.3: 验证 DQI/GMPS API 端到端调用返回正确结果
  - [ ] SubTask 27.4: 验证"记忆中的你"页面完整交互流程

- [ ] Task 28: 修复审计发现的问题
  - [ ] SubTask 28.1: 修复编译错误（如有）
  - [ ] SubTask 28.2: 修复测试失败（如有）
  - [ ] SubTask 28.3: 修复数据精度问题（如有）
  - [ ] SubTask 28.4: 修复隔离问题（如有）
  - [ ] SubTask 28.5: 修复功能缺失（如有）

# Task Dependencies

- [Task 2] depends on [Task 1] — 服务启动依赖编译通过
- [Task 4, 5, 6] depends on [Task 2] — 数据审计依赖服务可用
- [Task 8] depends on [Task 7] — 智能体集成审计依赖工作流审计
- [Task 9] depends on [Task 7] — 性能审计依赖工作流审计
- [Task 11] depends on [Task 10] — 可视化审计依赖分析页面审计
- [Task 13] depends on [Task 12] — 更新功能审计依赖稳定性审计
- [Task 15] depends on [Task 14] — RAG集成审计依赖RAG核心审计
- [Task 17, 18, 19, 20] depends on [Task 16] — API/会话/图表/记忆隔离审计依赖界面隔离审计
- [Task 22] depends on [Task 21] — 记忆展示审计依赖CRUD审计
- [Task 23] depends on [Task 21] — 个性化审计依赖记忆审计
- [Task 24, 25, 26] depends on [Task 7, 21] — 数据闭环审计依赖智能体和记忆审计
- [Task 27] depends on [Task 1-26] — 综合验证依赖所有审计完成
- [Task 28] depends on [Task 27] — 修复依赖问题发现

## 并行执行建议

**第一批（可并行）**：
- Task 1（编译测试）

**第二批（可并行）**：
- Task 2（服务启动）

**第三批（可并行）**：
- Task 3, 7, 10, 14, 16, 21（数据采集、智能体、分析页面、RAG、界面隔离、记忆CRUD）

**第四批（可并行）**：
- Task 4, 8, 11, 15, 17, 22（精度、智能体集成、可视化、RAG集成、API隔离、记忆展示）

**第五批（可并行）**：
- Task 5, 9, 12, 18, 23（单位、性能、稳定性、会话隔离、个性化）

**第六批（可并行）**：
- Task 6, 13, 19, 20, 24, 25, 26（模型、更新、图表隔离、记忆隔离、数据闭环）

**第七批**：
- Task 27（综合验证）

**第八批**：
- Task 28（问题修复）
