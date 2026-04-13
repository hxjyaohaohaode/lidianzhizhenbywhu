# Tasks

- [x] Task 1: 界面布局与导航升级
  - [x] SubTask 1.1: 在无限画布 (PanZoom) 右下角引入全局小地图 (Minimap) 与一键归中控件。
  - [x] SubTask 1.2: 开发工作台分屏 (Split View) 与多标签页模式，支持并排显示两份诊断报告。
  - [x] SubTask 1.3: 引入全局命令面板 (Cmd+K / Ctrl+K)，支持快速搜索历史会话、跳转页面与呼出快捷操作。

- [x] Task 2: 经营沙盘推演与报告导出功能
  - [x] SubTask 2.1: 开发 What-If 经营沙盘推演面板，添加“原材料价格”、“良品率”、“产能利用率”等核心变量滑块。
  - [x] SubTask 2.2: 接入并计算上述变量对系统“毛利率”、“净利润”指标的实时冲击逻辑，绑定到分析数据源。
  - [x] SubTask 2.3: 实现一键导出诊断报告功能，将当前会话历史、沙盘推演结果及可视化图表组合输出为结构化 PDF/PPT。

- [x] Task 3: 数据源接入与可视化配置面板
  - [x] SubTask 3.1: 开发基于拖拽与推荐的可视化数据映射 (Visual Data Mapping) UI，允许用户在上传附件后匹配系统标准财务字段。
  - [x] SubTask 3.2: 新增外部数据接口配置入口，模拟/接入锂电大宗商品历史价格走势（碳酸锂、六氟磷酸锂等）进行基准对标。

- [x] Task 4: 图表系统与数据可视化进阶
  - [x] SubTask 4.1: 扩展 `VisualizationPayload` 协议，新增并渲染专门用于毛利拆解的瀑布图 (Waterfall Chart)。
  - [x] SubTask 4.2: 实现图表间的联动 (Cross-filtering) 与下钻：在某图表中选中特定时间段/业务板块，其他相关图表同步过滤更新。
  - [x] SubTask 4.3: 为折线图等核心图表开发动态阈值预警线及 AI 智能异常标注 (Smart Annotations) UI。

# Task Dependencies
- [Task 1.2] 依赖于 [App.tsx / 工作台布局组件] 的重构。
- [Task 2.2] 依赖于 [Task 2.1] 的 UI 滑块与数据状态管理。
- [Task 4.1] 依赖于现有 `chart-system.tsx` 与 `chart-data.ts` 的拓展。
- [Task 2.3] 依赖于 [Task 4] 图表渲染完成与报告排版组件的就绪。