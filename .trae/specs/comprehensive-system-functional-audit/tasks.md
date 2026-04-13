# Tasks

## 阶段一：AI智能体功能审计

- [ ] Task 1: 审计8个智能体工作流编排
  - [ ] SubTask 1.1: 检查 `src/server/agent-service.ts` 中 workflowPlan 定义，确认8个智能体的依赖关系和执行模式
  - [ ] SubTask 1.2: 验证 `diagnose` 方法按依赖关系依次执行智能体，确认串行/并行逻辑正确
  - [ ] SubTask 1.3: 检查每个智能体的 status 返回值（completed/degraded/failed）是否正确
  - [ ] SubTask 1.4: 验证 degradationTrace 收集逻辑，确认降级事件被正确记录
  - [ ] SubTask 1.5: 检查 mathAnalysis 智能体中 shouldCalculateDQI/shouldCalculateGMPS 的触发条件
  - [ ] SubTask 1.6: 验证 evidenceReview 智能体的 DQI/GMPS 范围检查逻辑

- [ ] Task 2: 审计智能体与数学模型集成
  - [ ] SubTask 2.1: 检查 `extractDQIInputFromContext` 和 `extractGMPSInputFromContext` 数据提取逻辑
  - [ ] SubTask 2.2: 验证 `buildMathAnalysisOutput` 中 DQI/GMPS 降级时 status 为 "degraded"
  - [ ] SubTask 2.3: 检查 dataProvenance 字段是否正确标注推算数据来源
  - [ ] SubTask 2.4: 验证 investmentRecommendation 模式下 GMPS 正常触发

## 阶段二：表格数据展示审计

- [ ] Task 3: 审计首页可视化面板
  - [ ] SubTask 3.1: 检查 `buildEnterpriseVisualization` 返回的 widget 结构和内容
  - [ ] SubTask 3.2: 检查 `buildInvestorHomeVisualization` 返回的 widget 结构和内容
  - [ ] SubTask 3.3: 验证 VisualizationBoard 组件正确渲染所有 widget 类型
  - [ ] SubTask 3.4: 检查 chart-system.tsx 中各可视化组件（StatusCard、MetricBar、ZebraTable、SparkRow 等）的数据渲染逻辑

- [ ] Task 4: 审计分析工作台数据展示
  - [ ] SubTask 4.1: 检查 DQIResultPanel 组件的数据展示（DQI数值、状态徽章、驱动因素、分解进度条）
  - [ ] SubTask 4.2: 检查 GMPSResultPanel 组件的数据展示（GMPS数值、等级、五维度评分、风险概率）
  - [ ] SubTask 4.3: 验证 chart-renderer.tsx 中各图表类型的渲染逻辑（line、pie、radar、bar、area）
  - [ ] SubTask 4.4: 检查 chart-data.ts 中 buildDQITrendChart、buildDriverRadarChart、buildGMPSGaugeChart 等函数的输出

- [ ] Task 5: 审计会话历史和列表展示
  - [ ] SubTask 5.1: 检查投资端会话历史列表的数据渲染
  - [ ] SubTask 5.2: 验证会话搜索和筛选功能
  - [ ] SubTask 5.3: 检查企业端历史会话展示

## 阶段三：用户数据记忆功能审计

- [ ] Task 6: 审计记忆CRUD功能
  - [ ] SubTask 6.1: 检查 `src/server/memory.ts` 中 InMemoryMemoryStore 的 list、get、write、update、delete 方法
  - [ ] SubTask 6.2: 验证 POST `/api/memory` 创建记忆接口
  - [ ] SubTask 6.3: 验证 GET `/api/memory/:userId` 读取记忆接口
  - [ ] SubTask 6.4: 验证 PUT `/api/memory/:memoryId` 更新记忆接口
  - [ ] SubTask 6.5: 验证 DELETE `/api/memory/:memoryId` 删除记忆接口
  - [ ] SubTask 6.6: 检查 PlatformStore 中记忆持久化逻辑

- [ ] Task 7: 审计记忆展示与交互
  - [ ] SubTask 7.1: 检查 MemoryScreen 组件的记忆树节点构建逻辑（buildMemoryNodes）
  - [ ] SubTask 7.2: 验证记忆节点点击展示详情功能
  - [ ] SubTask 7.3: 验证记忆创建/编辑对话框功能
  - [ ] SubTask 7.4: 检查记忆标签筛选功能
  - [ ] SubTask 7.5: 验证记忆角色隔离（enterprise/investor 记忆不混显）

## 阶段四：界面显示稳定性审计

- [ ] Task 8: 审计CSS变量和主题系统
  - [ ] SubTask 8.1: 检查暗色主题下所有 CSS 变量定义（--t1~--t4, --glass, --glass-soft, --line, --rs）
  - [ ] SubTask 8.2: 检查亮色主题下所有 CSS 变量定义
  - [ ] SubTask 8.3: 验证 var(--t4) 在两种主题下正确解析为弱化文字颜色（非黑色）
  - [ ] SubTask 8.4: 验证 var(--glass) 和 var(--glass-soft) 在两种主题下正确解析
  - [ ] SubTask 8.5: 检查 viz-accent-* 系列变量在图表中的使用

- [ ] Task 9: 审计组件布局和动画
  - [ ] SubTask 9.1: 检查首页 bento grid 布局在不同屏幕尺寸下的表现
  - [ ] SubTask 9.2: 验证主题切换时所有组件的过渡动画
  - [ ] SubTask 9.3: 检查跑马灯动画流畅性和涨跌颜色（涨红跌绿）
  - [ ] SubTask 9.4: 验证 iwb-split 样式在 splitMode 下生效
  - [ ] SubTask 9.5: 检查 glass-morphism 效果在两种主题下的显示

## 阶段五：数据闭环与利用审计

- [ ] Task 10: 审计企业端数据闭环
  - [ ] SubTask 10.1: 追踪企业采集数据从 EntCollect → POST `/api/enterprise/collect` → 会话存储的完整链路
  - [ ] SubTask 10.2: 追踪企业分析数据从 EntAna → POST `/api/enterprise/analyze` → DQI/GMPS 计算的完整链路
  - [ ] SubTask 10.3: 验证 grossMarginInput 和 operatingQualityInput 正确传递给数学模型
  - [ ] SubTask 10.4: 验证模型计算结果通过 DQIGMPSPanelsContainer 正确展示
  - [ ] SubTask 10.5: 验证企业基础信息保存到用户画像并参与后续个性化

- [ ] Task 11: 审计投资端数据闭环
  - [ ] SubTask 11.1: 追踪投资画像从 InvAna → POST `/api/investor/profile` → 会话存储的完整链路
  - [ ] SubTask 11.2: 追踪投资分析从 InvAna → POST `/api/investor/stream` → SSE 流式响应的完整链路
  - [ ] SubTask 11.3: 验证画像数据驱动 focusMode 推荐和个性化内容
  - [ ] SubTask 11.4: 验证会话上下文通过 GET `/api/context/:sessionId` 正确恢复
  - [ ] SubTask 11.5: 验证投资者基础信息保存到用户画像并参与后续个性化

- [ ] Task 12: 审计记忆数据闭环
  - [ ] SubTask 12.1: 验证 memoryManagement 智能体正确召回历史记忆
  - [ ] SubTask 12.2: 验证记忆数据参与后续智能体的上下文构建
  - [ ] SubTask 12.3: 验证新的分析结论写入记忆供未来使用

## 阶段六：RAG数据获取功能审计

- [ ] Task 13: 审计RAG检索核心功能
  - [ ] SubTask 13.1: 检查 `src/server/realtime-rag.ts` 中 RealtimeIndustryRagService 的搜索和检索逻辑
  - [ ] SubTask 13.2: 验证 POST `/api/rag/realtime` 接口返回正确的 RealtimeRagResponse 结构
  - [ ] SubTask 13.3: 检查搜索提供商和备用搜索提供商的降级机制
  - [ ] SubTask 13.4: 验证缓存机制（cacheTtlMs、cacheHit 标记）
  - [ ] SubTask 13.5: 检查引用溯源（citations 包含 title、url、source、publishedAt、confidence）

- [ ] Task 14: 审计RAG与智能体集成
  - [ ] SubTask 14.1: 检查 industryRetrieval 智能体调用 RAG 服务的逻辑
  - [ ] SubTask 14.2: 验证 RAG 检索结果传递给后续智能体（evidenceReview、expressionGeneration）
  - [ ] SubTask 14.3: 检查 RAG 降级时 industryRetrieval 智能体的 status 和 degradationTrace
  - [ ] SubTask 14.4: 验证前端展示 RAG 降级提示（ragEvidenceDegraded 标记）

## 阶段七：数学模型利用功能审计

- [ ] Task 15: 审计DQI模型计算逻辑
  - [ ] SubTask 15.1: 检查 `src/server/models.ts` 中 calculateDQI 函数的 ROE、Growth、OCF 计算公式
  - [ ] SubTask 15.2: 验证 DQI 综合指数权重配置（w1=0.4, w2=0.3, w3=0.3）
  - [ ] SubTask 15.3: 验证驱动因素识别逻辑（argmax）
  - [ ] SubTask 15.4: 验证趋势判断逻辑（DQI>1.05改善，0.95≤DQI≤1.05稳定，DQI<0.95恶化）
  - [ ] SubTask 15.5: 验证 OCF 比率变化保留正负方向（不使用 Math.abs）
  - [ ] SubTask 15.6: 验证 POST `/api/models/dqi/calculate` 接口返回格式正确

- [ ] Task 16: 审计GMPS模型计算逻辑
  - [ ] SubTask 16.1: 检查 calculateGMPS 函数的 A~E 五层指标计算
  - [ ] SubTask 16.2: 验证10个特征变量的标准化打分方向正确（indVol、mfgCostRatio 使用 scoreIncreasingRisk）
  - [ ] SubTask 16.3: 验证 gpmYoy 打分区分毛利率上升（低风险）和下降（高风险）
  - [ ] SubTask 16.4: 验证加权综合得分和等级划分（<40低压，40-70中压，≥70高压）
  - [ ] SubTask 16.5: 验证 Logistic 回归预测功能
  - [ ] SubTask 16.6: 验证 POST `/api/models/gmps/calculate` 接口返回格式正确

- [ ] Task 17: 审计模型结果前端展示
  - [ ] SubTask 17.1: 检查 DQIResultPanel 组件展示 DQI 数值、状态徽章、驱动因素
  - [ ] SubTask 17.2: 检查 GMPSResultPanel 组件展示 GMPS 数值、等级、五维度评分
  - [ ] SubTask 17.3: 验证图表按预设样式渲染（DQI趋势折线图含基准线1.0、GMPS仪表盘按等级着色）
  - [ ] SubTask 17.4: 验证 extractMathAnalysisFromResponse 正确提取模型数据

## 阶段八：企业端与投资端隔离审计

- [ ] Task 18: 审计界面隔离
  - [ ] SubTask 18.1: 检查 App.tsx 中企业端组件（EntHome、EntAna、EntSet）和投资端组件（InvHome、InvAna、InvSet）的渲染条件
  - [ ] SubTask 18.2: 验证企业端界面仅展示企业端专属文案和模块
  - [ ] SubTask 18.3: 验证投资端界面仅展示投资端专属文案和模块
  - [ ] SubTask 18.4: 检查角色切换时界面完全切换，无残留内容

- [ ] Task 19: 审计API隔离
  - [ ] SubTask 19.1: 检查企业端 API（/api/enterprise/collect、/api/enterprise/analyze）的 role 参数
  - [ ] SubTask 19.2: 检查投资端 API（/api/investor/profile、/api/investor/recommend 等）的 role 参数
  - [ ] SubTask 19.3: 验证企业端 focusMode 限定为 operationalDiagnosis/deepDive
  - [ ] SubTask 19.4: 验证投资端 focusMode 包含 industryStatus/investmentRecommendation/deepDive

- [ ] Task 20: 审计会话和画像隔离
  - [ ] SubTask 20.1: 检查 session-store.ts 中企业端会话包含 enterpriseName
  - [ ] SubTask 20.2: 检查 session-store.ts 中投资端会话包含 investedEnterprises 和 investorProfileSummary
  - [ ] SubTask 20.3: 验证企业端基础信息保存到 enterpriseBaseInfo 字段
  - [ ] SubTask 20.4: 验证投资端基础信息保存到 investorBaseInfo 字段
  - [ ] SubTask 20.5: 检查 platform-store.ts 中用户画像的 enterpriseBaseInfo 和 investorBaseInfo 字段隔离

- [ ] Task 21: 审计图表数据隔离
  - [ ] SubTask 21.1: 验证企业端使用 buildEnterpriseVisualization 构建图表数据
  - [ ] SubTask 21.2: 验证投资端使用 buildInvestorHomeVisualization 构建图表数据
  - [ ] SubTask 21.3: 检查企业端图表内容聚焦经营指标和毛利承压
  - [ ] SubTask 21.4: 检查投资端图表内容聚焦行业景气和投资信号

- [ ] Task 22: 审计记忆隔离
  - [ ] SubTask 22.1: 验证企业端记忆 role 为 "enterprise"
  - [ ] SubTask 22.2: 验证投资端记忆 role 为 "investor"
  - [ ] SubTask 22.3: 检查记忆列表查询时按 role 过滤

## 阶段九：综合验证

- [ ] Task 23: 运行TypeScript编译和测试
  - [ ] SubTask 23.1: 运行 `npx tsc -p tsconfig.server.json --noEmit` 确保后端0错误
  - [ ] SubTask 23.2: 运行 `npx tsc -p tsconfig.app.json --noEmit` 确保前端0错误
  - [ ] SubTask 23.3: 运行 `npx vitest run` 确保所有测试通过

- [ ] Task 24: 端到端功能验证
  - [ ] SubTask 24.1: 启动后端服务，验证所有 API 端点可用
  - [ ] SubTask 24.2: 启动前端服务，验证页面正常加载
  - [ ] SubTask 24.3: 验证企业端完整诊断流程（采集→分析→结果展示）
  - [ ] SubTask 24.4: 验证投资端完整分析流程（画像→分析→结果展示）
  - [ ] SubTask 24.5: 验证 DQI/GMPS API 端到端调用返回正确结果

# Task Dependencies

- [Task 2] depends on [Task 1] — 智能体集成审计依赖工作流审计
- [Task 4] depends on [Task 3] — 分析工作台审计依赖首页审计
- [Task 7] depends on [Task 6] — 记忆展示审计依赖CRUD审计
- [Task 10, 11, 12] depends on [Task 1, 6] — 数据闭环审计依赖智能体和记忆审计
- [Task 14] depends on [Task 13] — RAG集成审计依赖RAG核心审计
- [Task 16] depends on [Task 15] — GMPS审计依赖DQI审计
- [Task 17] depends on [Task 15, 16] — 前端展示审计依赖模型审计
- [Task 19, 20, 21, 22] depends on [Task 18] — API/会话/图表/记忆隔离审计依赖界面隔离审计
- [Task 23, 24] depends on [Task 1-22] — 综合验证依赖所有审计完成

## 并行执行建议

**第一批（可并行）**：
- Task 1, 3, 6, 8（智能体、表格、记忆、界面审计）

**第二批（可并行）**：
- Task 2, 4, 7, 9（集成、工作台、记忆展示、布局审计）

**第三批（可并行）**：
- Task 10, 11, 12, 13, 15（数据闭环、RAG、DQI审计）

**第四批（可并行）**：
- Task 14, 16, 18（RAG集成、GMPS、界面隔离审计）

**第五批（可并行）**：
- Task 17, 19, 20, 21, 22（前端展示、API/会话/图表/记忆隔离审计）

**第六批**：
- Task 23, 24（综合验证）
