# 系统全局深度体验升级 Spec (System Comprehensive Upgrade Proposal)

## Why
作为本套“面向锂电池企业毛利承压与经营质量变化的智能诊断系统”的重度使用者，目前系统在深色高质感 UI、记忆树（图谱）、AI 辩论及流式输出等基础能力上已具备较高水准。但在高频、深度的业务使用场景（如多企业财报对比、归因分析、数据溯源、汇报演示）中，存在以下痛点：
1. **无限画布定位难**：记忆树及图谱节点展开多层后，易迷失视图中心。
2. **多维对比效率低**：分析页难以同时对比多个季度的诊断结果或多份报告。
3. **业务贴合度待提升**：缺乏专门针对锂电毛利拆解的专属图表（如瀑布图）和数据变量沙盘推演。
4. **数据接入成本高**：强依赖手动附件上传，缺乏外部实时宏观数据（如碳酸锂价格）对照与可视化的数据字段清洗映射。
本次升级旨在从**界面布局、功能推演、数据接入、可视化图表**四大维度全面提升系统的专业度与易用性，将其打造为极致高效的经营诊断工作站。

## What Changes
- **界面布局 (UI/Layout)**：
  - 引入**全局小地图 (Minimap)** 控件与“一键归中”快捷操作，解决无限画布(PanZoom)迷航问题。
  - 分析工作台新增**多标签页与左右分屏 (Split View) 模式**，支持同屏对比多份 AI 辩论记录或图表。
  - 引入 **Cmd+K (Ctrl+K) 全局命令面板**，支持快捷搜索记忆节点、跳转分析会话、导出报告。
- **功能 (Features)**：
  - 增加 **What-If 经营沙盘推演模块**，提供核心变量（原材料价格、良品率等）滑块，实时计算并展示对毛利率的冲击。
  - 增加**一键报告导出功能**，支持将 AI 诊断结论与图表排版导出为 PDF/PPT 格式。
- **数据来源与配置 (Data Sources & Config)**：
  - 构建**可视化数据映射 (Visual Data Mapping) 面板**，用户上传 Excel/CSV 附件后可拖拽对齐“营业收入”、“成本”等系统标准字段。
  - 新增**宏观/行业数据 API 配置入口**，支持接入（或模拟接入）碳酸锂、六氟磷酸锂等核心原材料的历史价格走势作为对标数据源。
- **图表样式与可视化 (Chart Styles & Data Visualization)**：
  - 基于统一可视化协议 (VisualizationPayload)，新增**瀑布图 (Waterfall Chart)**，专用于毛利与成本构成的逐级拆解。
  - 实现**全局图表联动与下钻 (Cross-filtering & Drill-down)**：点击趋势图某季度节点，相关成本结构图同步更新。
  - 支持**图表动态阈值与 AI 智能标注 (Smart Annotations)**，自动在利润骤降拐点处绘制辅助线并添加原因批注。

## Impact
- Affected specs: UI Layout, Analysis Workspace, Data Ingestion Flow, Chart System.
- Affected code: `src/web/App.tsx` (布局/快捷键), `src/web/chart-system.tsx` (瀑布图/联动), `src/web/chart-data.ts` (可视化协议拓展), 数据接入/沙盘推演相关组件。

## ADDED Requirements
### Requirement: 经营沙盘推演与瀑布图拆解
系统应当提供专门针对锂电企业毛利的动态推演和拆解视图。
#### Scenario: 模拟原材料涨价冲击
- **WHEN** 用户在沙盘模块将“碳酸锂价格”滑块上调 20%
- **THEN** 界面上的毛利瀑布图实时重绘，展示材料成本增加导致的毛利缩减，AI 自动生成应对策略。

### Requirement: 可视化数据映射
系统应当允许用户直观地配置上传附件的数据结构。
#### Scenario: 用户上传非标财报表格
- **WHEN** 用户上传含有非标准表头（如“24Q1营收合计”）的 Excel
- **THEN** 系统弹出数据映射面板，推荐匹配系统标准字段“营业收入”，用户确认后落盘。

### Requirement: 视图分屏与命令面板
系统应当提升重度用户的多任务处理与导航效率。
#### Scenario: 快速对比分析
- **WHEN** 用户在分析页点击“分屏对比”并按下 Cmd+K 搜索历史企业 B 的记录
- **THEN** 工作台左右分为两栏，左侧为当前企业 A 诊断，右侧加载企业 B 记录供直观比对。

## MODIFIED Requirements
### Requirement: 记忆树无限画布增强
- 原有无限画布拖拽缩放 (`transform` 机制) 基础上，增加悬浮于右下角的全局小地图 (Minimap)，实时反映当前视口在全量图谱中的位置。

### Requirement: 图表系统 (Chart System) 增强
- 拓展现有的共享 `VisualizationPayload` 结构，增加 `linkId` 或 `group` 字段，以实现多图表之间的联动过滤 (Cross-filtering)。