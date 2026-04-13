# 系统全面检查与优化 - 验收检查清单

## 一、界面美观度与主题系统

- [ ] **UI-001**: 暗色主题下所有CSS变量（--t1~--t4, --glass, --glass-soft, --line, --rs, --bg, --bg2）正确解析
- [ ] **UI-002**: 亮色主题下所有CSS变量正确解析，与暗色主题形成完整对照
- [ ] **UI-003**: glass-morphism效果（backdrop-filter、border、shadow）在两种主题下一致
- [ ] **UI-004**: 主题切换时所有组件平滑过渡，无闪烁或样式残留
- [ ] **UI-005**: viz-accent-*系列变量在图表组件中正确使用
- [ ] **UI-006**: bento grid布局在不同屏幕尺寸下正常显示
- [ ] **UI-007**: 跑马灯动画流畅，涨跌颜色为涨红跌绿

## 二、数据表显示完整性

- [ ] **TABLE-001**: ZebraTable列对齐正确，数值格式统一，状态标签正确显示
- [ ] **TABLE-002**: BenchmarkTable行渲染正确，对标基准标签显示
- [ ] **TABLE-003**: HeatmapTable热力值渲染正确，颜色映射合理
- [ ] **TABLE-004**: PivotTable交叉透视渲染正确
- [ ] **TABLE-005**: TreeTable层级缩进和展开/折叠功能正常
- [ ] **TABLE-006**: SparkRow迷你趋势图渲染正确
- [ ] **TABLE-007**: StatusCard数值和状态显示正确
- [ ] **TABLE-008**: MetricBar进度条和数值显示正确
- [ ] **TABLE-009**: 所有数据表无溢出、截断或格式错位

## 三、数据表更新机制

- [ ] **UPDATE-001**: 企业端采集数据后VisualizationBoard实时更新
- [ ] **UPDATE-002**: 投资端画像更新后首页可视化实时刷新
- [ ] **UPDATE-003**: DQI/GMPS面板在分析完成后正确显示最新结果
- [ ] **UPDATE-004**: 记忆CRUD操作后记忆树实时更新
- [ ] **UPDATE-005**: 会话历史列表在新增/删除会话后实时更新

## 四、企业端分析页面功能（不含图表工作台）

- [ ] **ENT-ANA-001**: 企业端采集流程完整可用
- [ ] **ENT-ANA-002**: 企业端分析流程完整可用，DQI/GMPS面板正确展示
- [ ] **ENT-ANA-003**: 企业端消息列表渲染和滚动行为正常
- [ ] **ENT-ANA-004**: 企业端毛利推演计算逻辑正确
- [ ] **ENT-ANA-005**: 企业端预警弹窗在毛利率低于10%时正确触发
- [ ] **ENT-ANA-006**: 企业端复杂度自动推断逻辑正确

## 五、投资端分析页面功能（不含图表工作台）

- [ ] **INV-ANA-001**: 投资端画像创建流程完整可用
- [ ] **INV-ANA-002**: 投资端SSE流式分析正常工作
- [ ] **INV-ANA-003**: 投资端模式切换功能正常
- [ ] **INV-ANA-004**: 投资端会话历史管理功能正常
- [ ] **INV-ANA-005**: 投资端附件上传功能正常
- [ ] **INV-ANA-006**: 投资端splitMode对比分析功能正常
- [ ] **INV-ANA-007**: 投资端进度条实时更新

## 六、智能体协同工作

- [ ] **AGENT-001**: 8个智能体按workflowPlan依赖关系正确执行
- [ ] **AGENT-002**: 串行/并行执行模式正确
- [ ] **AGENT-003**: 每个智能体返回正确的status（completed/degraded/failed）
- [ ] **AGENT-004**: degradationTrace正确收集所有降级事件
- [ ] **AGENT-005**: taskOrchestrator正确拆解任务和评估复杂度
- [ ] **AGENT-006**: memoryManagement正确召回记忆和注入上下文

## 七、RAG搜索功能

- [ ] **RAG-001**: POST `/api/rag/realtime` 返回正确的RealtimeRagResponse结构
- [ ] **RAG-002**: 搜索降级机制正常（主提供商→备用提供商）
- [ ] **RAG-003**: 缓存机制正常（cacheTtlMs、cacheHit标记）
- [ ] **RAG-004**: 每条citation包含title、url、source、publishedAt、confidence
- [ ] **RAG-005**: industryRetrieval智能体正确调用RAG服务
- [ ] **RAG-006**: RAG降级时前端展示降级提示

## 八、记忆功能

- [ ] **MEM-001**: POST `/api/memory` 创建记忆成功
- [ ] **MEM-002**: GET `/api/memory/:userId` 返回正确的记忆列表
- [ ] **MEM-003**: PUT `/api/memory/:memoryId` 更新记忆成功
- [ ] **MEM-004**: DELETE `/api/memory/:memoryId` 删除记忆成功
- [ ] **MEM-005**: PlatformStore记忆持久化正常
- [ ] **MEM-006**: 记忆标签筛选功能正常
- [ ] **MEM-007**: 记忆角色隔离正确（enterprise/investor不混显）

## 九、个性化服务功能

- [ ] **PERS-001**: 企业端基础信息保存到enterpriseBaseInfo字段
- [ ] **PERS-002**: 投资端基础信息保存到investorBaseInfo字段
- [ ] **PERS-003**: 画像数据驱动focusMode推荐
- [ ] **PERS-004**: 会话上下文通过GET `/api/context/:sessionId`正确恢复
- [ ] **PERS-005**: EditableBaseInfoPanel保存和回显逻辑正确

## 十、"记忆中的你"功能模块

- [ ] **MEM-YOU-001**: buildMemoryNodes正确构建所有类型节点
- [ ] **MEM-YOU-002**: MemoryScreen拖拽平移和缩放交互正常
- [ ] **MEM-YOU-003**: 记忆节点点击展示详情对话框
- [ ] **MEM-YOU-004**: 记忆创建/编辑/删除对话框功能正常
- [ ] **MEM-YOU-005**: MemoryBackgroundCanvas视觉效果和性能正常
- [ ] **MEM-YOU-006**: 记忆数据5秒自动同步机制正常
- [ ] **MEM-YOU-007**: minimap导航功能正常
- [ ] **MEM-YOU-008**: 用户数据被正确记忆与调用（画像→记忆树→分析闭环）

## 十一、单位选择与数据转换

- [ ] **UNIT-001**: 基础信息面板数字字段单位显示正确（万元、%、GWh、天、亿元等）
- [ ] **UNIT-002**: stripBaseInfoUnit函数正确剥离单位后保存数值
- [ ] **UNIT-003**: 窗口模式切换（quarterly/rolling/forward）数据缩放正确
- [ ] **UNIT-004**: 基准模式切换（industry/leader/portfolio）标签和数据更新正确
- [ ] **UNIT-005**: applyNumberFactor函数数值转换逻辑正确
- [ ] **UNIT-006**: YAxisConfig中unit字段正确传递和显示

## 十二、数据精度标准

- [ ] **PREC-001**: 后端round函数统一保留2位小数
- [ ] **PREC-002**: DQI计算结果精度正确（dqi值、roeRatio、growthRatio、ocfRatioChange）
- [ ] **PREC-003**: GMPS计算结果精度正确（gmps值、概率、维度得分、特征得分）
- [ ] **PREC-004**: dqi-gmps-panels.tsx中toFixed(2)使用一致
- [ ] **PREC-005**: chart-data.ts中数值格式化函数精度处理正确
- [ ] **PREC-006**: 数据表中数值显示精度一致（至少2位小数）
- [ ] **PREC-007**: chart-system.tsx中applyNumberFactor的toFixed精度正确

## 十三、数据全流程验证

- [ ] **FLOW-001**: 企业端数据闭环完整（采集→API→存储→计算→展示）
- [ ] **FLOW-002**: 投资端数据闭环完整（画像→API→SSE→展示）
- [ ] **FLOW-003**: grossMarginInput和operatingQualityInput正确传递给数学模型
- [ ] **FLOW-004**: 模型计算结果通过DQIGMPSPanelsContainer正确展示
- [ ] **FLOW-005**: 记忆数据参与智能体上下文构建
- [ ] **FLOW-006**: RAG检索结果传递给后续智能体

## 十四、综合验证

- [ ] **SYS-001**: 后端TypeScript编译0错误
- [ ] **SYS-002**: 前端TypeScript编译0错误
- [ ] **SYS-003**: 所有单元测试通过
- [ ] **SYS-004**: 后端服务正常启动，所有API端点可用
- [ ] **SYS-005**: 前端服务正常启动，页面正常加载
- [ ] **SYS-006**: 企业端完整诊断流程端到端可完成
- [ ] **SYS-007**: 投资端完整分析流程端到端可完成
- [ ] **SYS-008**: "记忆中的你"页面完整交互流程可完成
