# 优化首页数据模块横向布局 Spec

## Why
当前首页数据模块的布局存在大片空白，视觉效果不佳。主要问题包括：
1. `viz-section-shell` 使用两栏布局（左侧固定宽度 rail + 右侧 body），在宽屏上导致左侧信息栏占用过多空间
2. `home-utility-grid` 的两栏布局比例不够合理
3. 整体布局缺乏横向扩展感，留白过多

## What Changes
- **移除左侧固定宽度信息栏**：将 `viz-section-rail` 的内容整合到 `viz-board-top` 中，使主要内容区域占据全宽
- **优化 `home-utility-grid` 布局**：调整为更合理的比例，减少空白
- **优化 `viz-widget-grid` 布局**：调整 widget 的 span 分配，使布局更加紧凑
- **优化 `viz-board-top` 布局**：将原来分散的信息整合到顶部，形成更紧凑的头部区域

## Impact
- Affected specs: UI Layout, Dashboard Visualization
- Affected code: `src/web/styles.css`, `src/web/chart-system.tsx`

## ADDED Requirements

### Requirement: 首页数据模块紧凑横向布局
系统应提供紧凑的横向布局，减少大片空白区域。

#### Scenario: 宽屏显示优化
- **WHEN** 用户在宽屏（>1400px）下查看首页
- **THEN** 数据模块应充分利用横向空间，不会出现大片空白

#### Scenario: 信息整合显示
- **WHEN** 用户查看图表区域
- **THEN** 左侧信息栏的内容应整合到顶部，主要内容区域占据全宽

## MODIFIED Requirements

### Requirement: viz-section-shell 布局
- **BEFORE**: 使用两栏布局 `grid-template-columns: minmax(240px,300px) minmax(0,1fr)`
- **AFTER**: 使用单栏布局，移除左侧固定宽度信息栏

### Requirement: home-utility-grid 布局
- **BEFORE**: `grid-template-columns: minmax(0,1fr) minmax(320px,420px)`
- **AFTER**: 调整为更合理的比例，或使用单栏堆叠布局

### Requirement: viz-board-top 布局
- **BEFORE**: 信息分散在多个区域
- **AFTER**: 将 `viz-section-rail` 的内容整合到 `viz-board-top` 中，形成紧凑的头部信息区
