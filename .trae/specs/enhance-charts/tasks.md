# Tasks

- [x] Task 1: 精简 widget 文字渲染，移除冗余文本
  - [x] SubTask 1.1: 在 chart-system.tsx 中移除 widget 的 subtitle、description、footnote、emphasisTag、dataSources 渲染逻辑
  - [x] SubTask 1.2: 精简 section 副标题和强调文本的渲染
  - [x] SubTask 1.3: 精简看板标题为 ≤6 字
  - [x] SubTask 1.4: 调整图表容器比例，图表区域占比提升至 85%+

- [x] Task 2: 企业端首页启用 VisualizationBoard 图表渲染
  - [x] SubTask 2.1: 修改 EnterpriseScreen.tsx，在首页（page="home"）引入 VisualizationBoard 组件
  - [x] SubTask 2.2: 替换当前的"经营诊断对话入口"单一卡片为完整图表看板
  - [x] SubTask 2.3: 确保企业端首页的 11 个 widget 正确渲染

- [x] Task 3: 升级雷达图为高质量可视化
  - [x] SubTask 3.1: 实现多边形填充渐变效果
  - [x] SubTask 3.2: 添加发光边线 + 数据点脉冲动画
  - [x] SubTask 3.3: 实现悬停维度放大效果
  - [x] SubTask 3.4: 添加基准对比虚线

- [x] Task 4: 升级瀑布图为高质量可视化
  - [x] SubTask 4.1: 实现浮动柱形渐变填充
  - [x] SubTask 4.2: 正负值色彩区分（绿色正值/红色负值）
  - [x] SubTask 4.3: 添加累计连线
  - [x] SubTask 4.4: 实现悬停柱条上浮动画

- [x] Task 5: 升级热力图为高质量可视化
  - [x] SubTask 5.1: 实现连续色阶渐变
  - [x] SubTask 5.2: 单元格圆角 + 悬停光晕扩散
  - [x] SubTask 5.3: 添加色阶图例
  - [x] SubTask 5.4: 实现点击聚焦效果

- [x] Task 6: 升级三维气泡图为高质量可视化
  - [x] SubTask 6.1: 气泡大小映射优化
  - [x] SubTask 6.2: 气泡颜色渐变 + 悬停放大动画
  - [x] SubTask 6.3: 添加维度轴标签
  - [x] SubTask 6.4: 实现气泡拖拽交互

- [x] Task 7: 升级箱型图为高质量可视化
  - [x] SubTask 7.1: 中位数线高亮 + 四分位填充渐变
  - [x] SubTask 7.2: 离群值标记动画
  - [x] SubTask 7.3: 悬停展开统计详情
  - [x] SubTask 7.4: 多组对比优化

- [x] Task 8: 升级散点图为高质量可视化
  - [x] SubTask 8.1: 数据点渐变 + 悬停光晕
  - [x] SubTask 8.2: 添加趋势线
  - [x] SubTask 8.3: 实现聚类着色
  - [x] SubTask 8.4: 点击详情弹窗

- [x] Task 9: 新增桑基图（Sankey Diagram）
  - [x] SubTask 9.1: 在 chart-system.tsx 中新增 sankeyChart widget 类型
  - [x] SubTask 9.2: 实现 SVG 桑基图渲染引擎（节点色块 + 流向带宽映射 + 渐变连线）
  - [x] SubTask 9.3: 实现悬停高亮完整路径 + 点击追踪上下游
  - [x] SubTask 9.4: 在 chart-data.ts 中构建企业端成本流向桑基图数据
  - [x] SubTask 9.5: 在 chart-data.ts 中构建投资端资金流向桑基图数据
  - [x] SubTask 9.6: 将桑基图添加到企业端首页和投资端首页 widget 列表

- [x] Task 10: 升级折线图为高质量可视化
  - [x] SubTask 10.1: 渐变面积填充优化
  - [x] SubTask 10.2: 数据点发光效果
  - [x] SubTask 10.3: 阈值线样式优化
  - [x] SubTask 10.4: 悬停放大 + 区域选择交互

- [x] Task 11: 深度优化图表动态交互
  - [x] SubTask 11.1: 实现 hover 弹性动画（cubic-bezier(0.34, 1.56, 0.64, 1)）
  - [x] SubTask 11.2: 实现点击涟漪扩散动画
  - [x] SubTask 11.3: 实现点击聚焦（其他元素淡出 opacity 0.3）
  - [x] SubTask 11.4: 实现图表加载动画（数据从 0 增长至目标值，800ms stagger）
  - [x] SubTask 11.5: 实现浮动信息卡（替代传统 tooltip，毛玻璃设计 + 关键指标 + 迷你趋势线）

- [x] Task 12: 重构弹窗系统为沉浸式详情面板
  - [x] SubTask 12.1: 重设计 ChartDetailModal 为沉浸式面板（80vw × 85vh）
  - [x] SubTask 12.2: 面板内渲染放大版图表（可交互、可缩放）
  - [x] SubTask 12.3: 添加数据明细表格（可排序、可筛选）
  - [x] SubTask 12.4: 添加关联指标卡片（同比/环比/排名）
  - [x] SubTask 12.5: 添加建议追问按钮
  - [x] SubTask 12.6: 实现面板打开/关闭动画（从点击位置缩放展开/收回）
  - [x] SubTask 12.7: 支持键盘 ESC 关闭 + 点击遮罩关闭

- [x] Task 13: 优化图表缩放组件
  - [x] SubTask 13.1: 缩放范围扩展至 30%~300%
  - [x] SubTask 13.2: 缩放时图表内容自适应重排
  - [x] SubTask 13.3: 缩放控件优化（始终可见、不遮挡图表）
  - [x] SubTask 13.4: 支持触摸屏双指缩放
  - [x] SubTask 13.5: 缩放状态持久化

- [x] Task 14: 确保双端图表对称展示
  - [x] SubTask 14.1: 验证企业端首页包含：折线图、瀑布图、雷达图、箱型图、散点图、气泡图、热力图、桑基图
  - [x] SubTask 14.2: 验证投资端首页包含：柱状图、雷达图、箱型图、散点图、气泡图、热力图、桑基图
  - [x] SubTask 14.3: 验证企业端分析页包含 DQI/GMPS 面板 + 预警表格 + 成本桑基图
  - [x] SubTask 14.4: 验证投资端分析页包含 DQI/GMPS 面板 + 对照表 + 资金桑基图 + What-If 沙盘

- [x] Task 15: 构建验证与测试
  - [x] SubTask 15.1: vite build 构建成功，无 TypeScript 错误
  - [x] SubTask 15.2: 开发服务器正常运行
  - [x] SubTask 15.3: 企业端和投资端所有页面图表正常渲染
  - [x] SubTask 15.4: 所有图表交互功能正常（hover、click、zoom、弹窗）

# Task Dependencies

- Task 1 → Task 3-10（精简文字是图表升级的基础，减少干扰）
- Task 2 → 独立（企业端首页启用渲染可并行开发）
- Task 9 → Task 14.1, 14.2（桑基图是双端对称展示的前提）
- Task 11 → Task 12（动态交互优化是弹窗重构的前置条件）
- Task 12 → Task 14（弹窗系统是验证双端图表的前置条件）
- Task 13 → 独立（缩放优化可并行开发）
- Task 3-10 → Task 14（所有图表升级完成后才能验证双端对称）
- Task 14 → Task 15（验证双端对称是构建验证的前提）
