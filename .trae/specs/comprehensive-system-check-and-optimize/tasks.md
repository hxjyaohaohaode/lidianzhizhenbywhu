# Tasks

## 阶段一：界面与数据展示检查

- [ ] Task 1: 审查界面美观度与主题系统
  - [ ] SubTask 1.1: 检查 `src/web/styles.css` 中暗色/亮色主题CSS变量定义完整性（--t1~--t4, --glass, --glass-soft, --line, --rs, --bg, --bg2等）
  - [ ] SubTask 1.2: 验证glass-morphism效果（backdrop-filter、border、shadow）在两种主题下一致
  - [ ] SubTask 1.3: 检查所有组件的过渡动画，确保主题切换无闪烁或样式残留
  - [ ] SubTask 1.4: 检查viz-accent-*系列变量在图表组件中的使用一致性
  - [ ] SubTask 1.5: 验证bento grid布局在不同屏幕尺寸下的响应式表现

- [ ] Task 2: 全面检查数据表显示状态
  - [ ] SubTask 2.1: 检查 `src/web/chart-system.tsx` 中ZebraTable组件的列对齐、数值格式、状态标签显示
  - [ ] SubTask 2.2: 检查BenchmarkTable组件的行渲染、对标基准显示
  - [ ] SubTask 2.3: 检查HeatmapTable组件的热力值渲染、颜色映射
  - [ ] SubTask 2.4: 检查PivotTable组件的交叉透视渲染
  - [ ] SubTask 2.5: 检查TreeTable组件的层级缩进和展开/折叠
  - [ ] SubTask 2.6: 检查SparkRow组件的迷你趋势图渲染
  - [ ] SubTask 2.7: 检查StatusCard、MetricBar组件的数值和状态显示
  - [ ] SubTask 2.8: 验证所有数据表无溢出、截断或格式错位问题

- [ ] Task 3: 验证数据表更新机制
  - [ ] SubTask 3.1: 检查企业端采集数据后VisualizationBoard的实时更新
  - [ ] SubTask 3.2: 检查投资端画像更新后首页可视化的实时刷新
  - [ ] SubTask 3.3: 验证DQI/GMPS面板在分析完成后正确显示最新结果
  - [ ] SubTask 3.4: 验证记忆CRUD操作后记忆树的实时更新
  - [ ] SubTask 3.5: 检查会话历史列表在新增/删除会话后的实时更新

## 阶段二：分析页面功能检查（不含图表工作台）

- [ ] Task 4: 检查企业端分析页面（EntAna）功能完整性
  - [ ] SubTask 4.1: 验证企业端采集流程（EntCollect→collectEnterpriseData→sessionContext）
  - [ ] SubTask 4.2: 验证企业端分析流程（send→analyzeEnterprise→DQI/GMPS面板展示）
  - [ ] SubTask 4.3: 检查企业端消息列表的渲染和滚动行为
  - [ ] SubTask 4.4: 验证企业端毛利推演计算逻辑（baseMargin→inferredMargin）
  - [ ] SubTask 4.5: 检查企业端预警弹窗（showWarningPopup）触发条件
  - [ ] SubTask 4.6: 验证企业端复杂度自动推断（classifyQueryIntent + complexity推断）

- [ ] Task 5: 检查投资端分析页面（InvAna）功能完整性
  - [ ] SubTask 5.1: 验证投资端画像创建流程（createInvestorProfile→sessionContext）
  - [ ] SubTask 5.2: 验证投资端SSE流式分析（streamInvestorAnalysis→事件处理）
  - [ ] SubTask 5.3: 检查投资端模式切换（switchInvestorMode→syncSession）
  - [ ] SubTask 5.4: 验证投资端会话历史管理（fetchInvestorSessions→deleteInvestorSessions）
  - [ ] SubTask 5.5: 检查投资端附件上传功能（uploadInvestorAttachment）
  - [ ] SubTask 5.6: 验证投资端splitMode对比分析功能
  - [ ] SubTask 5.7: 检查投资端进度条（progressState）实时更新

## 阶段三：智能体功能验证

- [ ] Task 6: 验证智能体协同工作能力
  - [ ] SubTask 6.1: 检查 `src/server/agent-service.ts` 中workflowPlan的8个智能体依赖关系
  - [ ] SubTask 6.2: 验证diagnose方法按依赖关系执行智能体，串行/并行逻辑正确
  - [ ] SubTask 6.3: 检查每个智能体的status返回值（completed/degraded/failed）
  - [ ] SubTask 6.4: 验证degradationTrace收集逻辑，降级事件被正确记录
  - [ ] SubTask 6.5: 检查taskOrchestrator智能体的任务拆解和复杂度评估
  - [ ] SubTask 6.6: 验证memoryManagement智能体的记忆召回和上下文注入

- [ ] Task 7: 验证RAG搜索功能
  - [ ] SubTask 7.1: 检查 `src/server/realtime-rag.ts` 中RealtimeIndustryRagService的搜索逻辑
  - [ ] SubTask 7.2: 验证POST `/api/rag/realtime` 返回正确的RealtimeRagResponse结构
  - [ ] SubTask 7.3: 检查搜索降级机制（主提供商→备用提供商）
  - [ ] SubTask 7.4: 验证缓存机制（cacheTtlMs、cacheHit标记）
  - [ ] SubTask 7.5: 检查引用溯源（citations包含title、url、source、publishedAt、confidence）
  - [ ] SubTask 7.6: 验证industryRetrieval智能体调用RAG服务的逻辑和降级处理

- [ ] Task 8: 全面测试记忆功能
  - [ ] SubTask 8.1: 验证POST `/api/memory` 创建记忆接口
  - [ ] SubTask 8.2: 验证GET `/api/memory/:userId` 读取记忆接口
  - [ ] SubTask 8.3: 验证PUT `/api/memory/:memoryId` 更新记忆接口
  - [ ] SubTask 8.4: 验证DELETE `/api/memory/:memoryId` 删除记忆接口
  - [ ] SubTask 8.5: 检查PlatformStore中记忆持久化逻辑
  - [ ] SubTask 8.6: 验证记忆标签筛选功能
  - [ ] SubTask 8.7: 验证记忆角色隔离（enterprise/investor不混显）

- [ ] Task 9: 验证个性化服务功能
  - [ ] SubTask 9.1: 验证企业端基础信息保存到enterpriseBaseInfo字段
  - [ ] SubTask 9.2: 验证投资端基础信息保存到investorBaseInfo字段
  - [ ] SubTask 9.3: 验证画像数据驱动focusMode推荐
  - [ ] SubTask 9.4: 验证会话上下文通过GET `/api/context/:sessionId`正确恢复
  - [ ] SubTask 9.5: 检查EditableBaseInfoPanel组件的保存和回显逻辑

- [ ] Task 10: 重点测试"记忆中的你"功能模块
  - [ ] SubTask 10.1: 检查buildMemoryNodes函数的节点构建逻辑（center/theme/portrait/session/memory/analysis/signal）
  - [ ] SubTask 10.2: 验证MemoryScreen的拖拽平移和缩放交互
  - [ ] SubTask 10.3: 验证记忆节点点击展示详情对话框
  - [ ] SubTask 10.4: 验证记忆创建/编辑/删除对话框功能
  - [ ] SubTask 10.5: 检查MemoryBackgroundCanvas的视觉效果和性能
  - [ ] SubTask 10.6: 验证记忆数据5秒自动同步机制
  - [ ] SubTask 10.7: 检查minimap导航功能
  - [ ] SubTask 10.8: 验证用户数据被正确记忆与调用（画像→记忆树→分析闭环）

## 阶段四：数据处理与显示标准

- [ ] Task 11: 确保单位选择功能与数据转换
  - [ ] SubTask 11.1: 检查基础信息面板中数字字段的单位显示（万元、%、GWh、天、亿元等）
  - [ ] SubTask 11.2: 验证stripBaseInfoUnit函数正确剥离单位后保存数值
  - [ ] SubTask 11.3: 检查VisualizationBoard中窗口模式切换（quarterly/rolling/forward）的数据缩放
  - [ ] SubTask 11.4: 验证基准模式切换（industry/leader/portfolio）的标签和数据更新
  - [ ] SubTask 11.5: 检查applyNumberFactor函数在单位切换时的数值转换逻辑
  - [ ] SubTask 11.6: 验证YAxisConfig中unit字段的正确传递和显示

- [ ] Task 12: 验证数据精度标准（小数点后两位）
  - [ ] SubTask 12.1: 检查 `src/server/models.ts` 中round函数统一保留2位小数
  - [ ] SubTask 12.2: 验证DQI计算结果（dqi值、roeRatio、growthRatio、ocfRatioChange）精度
  - [ ] SubTask 12.3: 验证GMPS计算结果（gmps值、概率、维度得分、特征得分）精度
  - [ ] SubTask 12.4: 检查 `src/web/dqi-gmps-panels.tsx` 中toFixed(2)的使用一致性
  - [ ] SubTask 12.5: 检查 `src/web/chart-data.ts` 中数值格式化函数的精度处理
  - [ ] SubTask 12.6: 验证数据表（ZebraTable等）中数值显示的精度一致性
  - [ ] SubTask 12.7: 检查chart-system.tsx中applyNumberFactor的toFixed精度

- [ ] Task 13: 全面测试数据全流程
  - [ ] SubTask 13.1: 追踪企业端数据闭环：EntCollect→POST `/api/enterprise/collect`→会话存储→DQI/GMPS计算→前端展示
  - [ ] SubTask 13.2: 追踪投资端数据闭环：InvAna→POST `/api/investor/stream`→SSE响应→前端展示
  - [ ] SubTask 13.3: 验证grossMarginInput和operatingQualityInput正确传递给数学模型
  - [ ] SubTask 13.4: 验证模型计算结果通过DQIGMPSPanelsContainer正确展示
  - [ ] SubTask 13.5: 验证记忆数据参与智能体上下文构建
  - [ ] SubTask 13.6: 验证RAG检索结果传递给后续智能体

## 阶段五：综合验证

- [ ] Task 14: 运行编译和测试
  - [ ] SubTask 14.1: 运行 `npx tsc -p tsconfig.server.json --noEmit` 确保后端0错误
  - [ ] SubTask 14.2: 运行 `npx tsc -p tsconfig.app.json --noEmit` 确保前端0错误
  - [ ] SubTask 14.3: 运行 `npx vitest run` 确保所有测试通过

- [ ] Task 15: 端到端功能验证
  - [ ] SubTask 15.1: 启动后端服务，验证所有API端点可用
  - [ ] SubTask 15.2: 启动前端服务，验证页面正常加载
  - [ ] SubTask 15.3: 验证企业端完整诊断流程
  - [ ] SubTask 15.4: 验证投资端完整分析流程
  - [ ] SubTask 15.5: 验证"记忆中的你"页面完整交互流程

# Task Dependencies

- [Task 2] depends on [Task 1] — 数据表检查依赖主题系统审查
- [Task 3] depends on [Task 2] — 更新机制检查依赖显示状态检查
- [Task 5] depends on [Task 4] — 投资端分析检查依赖企业端分析检查
- [Task 7] depends on [Task 6] — RAG验证依赖智能体协同验证
- [Task 9] depends on [Task 8] — 个性化验证依赖记忆功能验证
- [Task 10] depends on [Task 8] — "记忆中的你"测试依赖记忆功能验证
- [Task 12] depends on [Task 11] — 精度验证依赖单位选择验证
- [Task 13] depends on [Task 6, 8, 11, 12] — 全流程验证依赖智能体、记忆、单位、精度验证
- [Task 14, 15] depends on [Task 1-13] — 综合验证依赖所有检查完成

## 并行执行建议

**第一批（可并行）**：
- Task 1, 4, 6, 8（界面、企业端分析、智能体、记忆）

**第二批（可并行）**：
- Task 2, 5, 7, 9（数据表、投资端分析、RAG、个性化）

**第三批（可并行）**：
- Task 3, 10, 11（更新机制、"记忆中的你"、单位选择）

**第四批（可并行）**：
- Task 12, 13（精度、全流程）

**第五批**：
- Task 14, 15（综合验证）
