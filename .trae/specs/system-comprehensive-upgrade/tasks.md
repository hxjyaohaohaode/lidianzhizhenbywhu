# Tasks

- [x] Task 1: 企业端分析页模式切换与工作台框架重构
  - [x] SubTask 1.1: 在 EntAna 组件中添加模式切换标签栏（经营诊断/深度解析/辩论模式），参考投资端 InvAna 的 mts 组件
  - [x] SubTask 1.2: 定义企业端模式选项常量 ENTERPRISE_MODE_OPTIONS（operationalDiagnosis/deepDive/debate），包含标签、图标、占位提示、快速追问
  - [x] SubTask 1.3: 实现模式切换逻辑，调用后端 API 切换 focusMode，切换后清空对话并重新初始化
  - [x] SubTask 1.4: 重构 EntAna 布局为工作台结构：顶部操作栏 + 模式标签 + 对话区 + 侧边栏

- [x] Task 2: 企业端 WHAT-IF 推演沙盘
  - [x] SubTask 2.1: 在企业端分析页侧边栏添加 WHAT-IF 推演面板，包含4个滑块参数（碳酸锂价格波动、产销比率、库存费用变动、经营现金流比率）
  - [x] SubTask 2.2: 实现基于 GMPS 特征权重的推演公式计算，实时显示基准毛利率 vs 推演后毛利率
  - [x] SubTask 2.3: 添加压力等级变化指示（低压/中压/高压），推演结果颜色编码

- [x] Task 3: 企业端会话管理功能
  - [x] SubTask 3.1: 实现企业端会话创建/删除/切换 API 调用（参考投资端 createInvestorSession/deleteCurrentInvestorSession/fetchInvestorSessions）
  - [x] SubTask 3.2: 在侧边栏添加历史对话列表，显示会话标题、时间、模式、摘要
  - [x] SubTask 3.3: 实现新建会话和删除当前会话功能
  - [x] SubTask 3.4: 实现附件上传功能（文件选择+内容解析+API上传）
  - [x] SubTask 3.5: 实现分屏对比功能（左右分屏对比两个历史会话）

- [x] Task 4: 企业端流式响应与任务时间线
  - [x] SubTask 4.1: 在企业端 API 层添加流式分析接口 streamEnterpriseAnalysis（参考投资端 streamInvestorAnalysis）
  - [x] SubTask 4.2: 修改 EntAna 的 send 函数，从等待完整响应改为流式接收
  - [x] SubTask 4.3: 实现流式事件处理（progress/delta/debate_message/result/error）
  - [x] SubTask 4.4: 在侧边栏添加任务时间线面板，显示分析步骤进度
  - [x] SubTask 4.5: 实现进度条和阶段标签的实时更新

- [x] Task 5: 图表缩放与浮动信息卡修复
  - [x] SubTask 5.1: 修复 ChartZoomWrapper 组件，确保缩放控件始终可见且不遮挡图表
  - [x] SubTask 5.2: 修复缩放后浮动信息卡位置偏移问题，确保 tooltip 位置基于缩放后的坐标计算
  - [x] SubTask 5.3: 修复箱型图浮动信息卡显示，确保中位数/Q1/Q3/最大值/最小值正确渲染
  - [x] SubTask 5.4: 优化浮动信息卡样式为毛玻璃效果，添加出现/消失动画（200ms）
  - [x] SubTask 5.5: 确保信息卡不超出视口边界，自动调整显示位置

- [x] Task 6: 记忆中的你二级展开功能
  - [x] SubTask 6.1: 修改 MemoryTreeLayer 组件，支持一级节点展开/折叠交互
  - [x] SubTask 6.2: 展开一级节点时渲染其下属二级记忆节点，显示摘要和内容预览（截断3行）
  - [x] SubTask 6.3: 添加展开/折叠动画（300ms），子节点依次淡入
  - [x] SubTask 6.4: 点击二级节点打开详情对话框，显示完整记忆内容
  - [x] SubTask 6.5: 展开状态在当前会话内持久化（使用 useState 管理）

- [x] Task 7: AI输出与数学模型强关联
  - [x] SubTask 7.1: 修改企业端分析响应格式化函数，增加 GMPS 五维度得分和 DQI 三维度得分展示
  - [x] SubTask 7.2: AI 回答中引用模型特征变量时标注特征名称和权重
  - [x] SubTask 7.3: 诊断结论包含量化评分和压力等级
  - [x] SubTask 7.4: 在企业端分析页添加 DQI/GMPS 诊断面板（参考投资端 DQIGMPSPanelsContainer）
  - [x] SubTask 7.5: 增强个性化输出：注入用户画像、添加个性化摘要、建议下一步、记忆关联

- [x] Task 8: 数据源增强与时效性验证
  - [x] SubTask 8.1: 在 DataGatheringAgent 中增加东方财富行情接口（碳酸锂实时价格、行业指数）
  - [x] SubTask 8.2: 增加巨潮资讯公告接口（上市公司财报、公告摘要）
  - [x] SubTask 8.3: 增加国家统计局宏观数据接口（PPI、CPI、工业增加值）
  - [x] SubTask 8.4: 优化数据采集超时（3000ms→8000ms）和并发请求数（2→4）
  - [x] SubTask 8.5: 增加本地缓存层（TTL 5分钟），避免重复请求
  - [x] SubTask 8.6: 实现数据时效性标注（采集时间、发布时间、超过24小时警告）
  - [x] SubTask 8.7: 实现数据交叉验证（多源对比、差异超10%标注冲突）
  - [x] SubTask 8.8: 实现数据源可信度评级和异常值检测

- [x] Task 9: 界面视觉层次优化
  - [x] SubTask 9.1: 优化首页图表比例（主图表区55%:45%，辅助区28%）
  - [x] SubTask 9.2: 指标卡增加数值变化动画（闪烁+颜色过渡）和状态色点脉冲动画
  - [x] SubTask 9.3: 导航栏激活标签增加品牌色底部指示条，悬停图标微缩放+颜色变亮
  - [x] SubTask 9.4: 页面切换过渡动画（淡入+上浮200ms）
  - [x] SubTask 9.5: 分析页加载时显示骨架屏

# Task Dependencies
- [Task 2] depends on [Task 1] (WHAT-IF沙盘需要工作台框架)
- [Task 3] depends on [Task 1] (会话管理需要工作台框架)
- [Task 4] depends on [Task 1] (流式响应需要工作台框架)
- [Task 5] 独立（图表修复可并行）
- [Task 6] 独立（记忆功能可并行）
- [Task 7] depends on [Task 4] (模型关联输出需要流式响应支持)
- [Task 8] 独立（数据源增强可并行）
- [Task 9] 独立（视觉优化可并行）
