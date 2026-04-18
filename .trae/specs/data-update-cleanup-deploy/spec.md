# 数据更新、文件清理与部署方案 Spec

## Why
系统中的行业基准数据（碳酸锂价格、行业毛利率、景气指数等）仍停留在旧值，需要更新为2026年4月最新数据；项目根目录存在大量冗余/临时文件影响构建和部署；用户需要将系统部署到服务器让朋友直接使用，需要完整可执行的部署方案。

## What Changes
- 更新 `chart-data.ts` 中 `INDUSTRY_STANDARD_DEFAULTS` 为2026年4月最新行业数据
- 更新投资端企业数据（市值、毛利率等）为最新值
- 删除项目根目录下的冗余/临时文件
- 删除 `src/web/` 下的备份文件
- 确保 `vite build` 和 `npm run build` 构建成功
- 提供 Docker 部署方案和手动部署方案的完整步骤

## Impact
- Affected specs: chart-data 行业基准数据、投资端/企业端图表数据
- Affected code: `src/web/chart-data.ts`、项目根目录文件结构

## ADDED Requirements

### Requirement: 行业基准数据更新至2026年4月
系统 SHALL 将以下行业基准数据更新为最新值：
- 碳酸锂价格：12 → 16.5（万元/吨，2026年4月电池级均价）
- 行业毛利率均值：20 → 16（%，2026年Q1电池制造行业均值）
- 行业毛利率头部：30 → 25（%，宁德时代Q1毛利率24.82%为参考）
- 库存周转天数：90 → 95（天，宁德时代Q1约95天）
- 现金流比率：0.12 → 0.15（行业现金流改善）
- 产销匹配度：0.78 → 0.82（行业排产利用率回升）
- 行业需求指数：65 → 78（4月排产同比+46%-63%，高景气）
- 储能增速：55 → 55（维持高增速）
- 行业景气度：55 → 75（行业进入上行周期）

#### Scenario: 数据更新后图表显示最新值
- WHEN 用户进入企业端或投资端首页
- THEN 图表中碳酸锂价格显示16.5万/吨，行业毛利率均值显示16%，景气指数显示78

### Requirement: 投资端企业数据更新
系统 SHALL 更新投资端图表中的企业数据为2026年4月最新值：
- 宁德时代：市值9800→19300亿，毛利率78→82分
- 比亚迪：市值7200→9462亿，毛利率82→75分（承压）
- 亿纬锂能：市值1800→1485亿，毛利率72→68分
- 海辰储能：市值350→500亿，毛利率85→80分
- 新增/更新企业：天齐锂业、蜂巢能源、欣旺达、孚能科技、中创新航、瑞浦兰钧等

#### Scenario: 投资端散点图显示最新市值
- WHEN 用户进入投资端首页
- THEN 散点图中宁德时代市值显示19300亿，比亚迪9462亿

### Requirement: 冗余文件清理
系统 SHALL 删除以下不再需要的文件：
- 根目录临时文件：`APIKEY。txt`, `chinese_strings.txt`, `d567ed704ac9d8f479c525b5e6e102e2.png`, `dbd64c9e259b6d3612d5d6fafd76de0e.mp4`, `real-data-gathering-results.json`, `recover.mjs`, `simple-data-gather.ts`, `test-data-gathering.ts`, `test-dqi.ts`, `tsc-errors.txt`, `tsc-output.txt`, `extract.js`, `fix-encoding.cjs`, `模版.html`, `设计方案1.txt`
- 根目录文档（已整合）：`DQI_GMPS_INTEGRATION_REPORT.md`, `API_USAGE.md`
- src/web 备份文件：`App.original.txt`, `App.tsx.bak`
- docs 目录冗余文档：`SYSTEM_UPGRADE_TECHNICAL_GUIDE.md`

#### Scenario: 清理后构建不受影响
- WHEN 删除上述文件后执行 `npm run build`
- THEN 构建成功，无错误

### Requirement: 部署方案
系统 SHALL 提供两种可执行的部署方案：

#### 方案A：Docker Compose 部署（推荐）
- 使用现有 Dockerfile + docker-compose.yml
- 配置 .env 文件（至少一个 LLM API Key）
- Nginx 反向代理 + 可选 Basic Auth
- 一键启动：`docker-compose up -d`

#### 方案B：手动部署（VPS/云服务器）
- Node.js 20+ 环境
- 构建前端+后端
- PM2 进程管理
- Nginx 反向代理配置

#### Scenario: 朋友可通过IP访问系统
- WHEN 部署完成后朋友在浏览器输入服务器IP
- THEN 看到载入动画 → 身份选择 → 进入系统

## MODIFIED Requirements

### Requirement: 行业基准默认值
原值：碳酸锂12万/吨、毛利率均值20%、头部30%、库存90天、需求指数65、景气55
新值：碳酸锂16.5万/吨、毛利率均值16%、头部25%、库存95天、需求指数78、景气75

## REMOVED Requirements
无删除需求
