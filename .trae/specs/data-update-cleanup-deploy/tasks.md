# Tasks

- [x] Task 1: 更新行业基准数据 INDUSTRY_STANDARD_DEFAULTS
  - [x] SubTask 1.1: 修改 chart-data.ts 中 INDUSTRY_STANDARD_DEFAULTS 对象，碳酸锂价格 12→16.5，毛利率均值 20→16，头部 30→25，库存天数 90→95，现金流比率 0.12→0.15，产销匹配度 0.78→0.82，需求指数 65→78，景气度 55→75
  - [x] SubTask 1.2: 更新企业端成本结构比例（原材料59.4%→62%，人工16%→14%，制造17%→16%，库存7.5%→8%）

- [x] Task 2: 更新投资端企业数据
  - [x] SubTask 2.1: 更新 buildInvestorHomeVisualization 中散点图/气泡图企业市值和毛利率数据（宁德时代19300亿/82分、比亚迪9462亿/75分、亿纬锂能1485亿/68分、海辰储能500亿/80分等）
  - [x] SubTask 2.2: 更新箱型图数据为更合理的2026年Q1行业风险分布
  - [x] SubTask 2.3: 更新热力图和桑基图中的数值比例

- [x] Task 3: 清理冗余文件
  - [x] SubTask 3.1: 删除根目录临时文件：APIKEY。txt, chinese_strings.txt, d567ed704ac9d8f479c525b5e6e102e2.png, dbd64c9e259b6d3612d5d6fafd76de0e.mp4, real-data-gathering-results.json, recover.mjs, simple-data-gather.ts, test-data-gathering.ts, test-dqi.ts, tsc-errors.txt, tsc-output.txt, extract.js, fix-encoding.cjs, 模版.html, 设计方案1.txt
  - [x] SubTask 3.2: 删除根目录冗余文档：DQI_GMPS_INTEGRATION_REPORT.md, API_USAGE.md
  - [x] SubTask 3.3: 删除 src/web 备份文件：App.original.txt, App.tsx.bak
  - [x] SubTask 3.4: 删除 docs/SYSTEM_UPGRADE_TECHNICAL_GUIDE.md

- [x] Task 4: 验证构建成功
  - [x] SubTask 4.1: 执行 npm run build 确认前后端构建无错误
  - [x] SubTask 4.2: 修复 TypeScript 类型错误（agent-service.ts 和 platform-store.ts）

- [x] Task 5: 编写部署方案文档
  - [x] SubTask 5.1: 编写 Docker Compose 部署方案（含 .env 配置、启动命令、访问方式）
  - [x] SubTask 5.2: 编写手动部署方案（含 Node.js 安装、构建、PM2、Nginx 配置）
  - [x] SubTask 5.3: 验证 Dockerfile 和 docker-compose.yml 配置正确性

# Task Dependencies
- [Task 2] depends on [Task 1] (投资端数据依赖行业基准)
- [Task 4] depends on [Task 1, Task 2, Task 3] (构建验证需在数据更新和清理后)
- [Task 5] 独立（部署方案编写可并行）
