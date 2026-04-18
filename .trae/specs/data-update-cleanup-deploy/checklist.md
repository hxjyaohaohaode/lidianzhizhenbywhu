# 验证清单

## 行业数据更新
- [x] INDUSTRY_STANDARD_DEFAULTS.lithiumPrice 更新为 16.5
- [x] INDUSTRY_STANDARD_DEFAULTS.grossMarginAverage 更新为 16
- [x] INDUSTRY_STANDARD_DEFAULTS.grossMarginHead 更新为 25
- [x] INDUSTRY_STANDARD_DEFAULTS.inventoryDays 更新为 95
- [x] INDUSTRY_STANDARD_DEFAULTS.cashFlowRatio 更新为 0.15
- [x] INDUSTRY_STANDARD_DEFAULTS.capacityUtilization 更新为 0.82
- [x] INDUSTRY_STANDARD_DEFAULTS.demandIndex 更新为 78
- [x] INDUSTRY_STANDARD_DEFAULTS.industryWarmth 更新为 75

## 投资端企业数据
- [x] 宁德时代市值更新为 19300 亿
- [x] 比亚迪市值更新为 9462 亿
- [x] 亿纬锂能市值更新为 1485 亿
- [x] 海辰储能市值更新为 500 亿
- [x] 散点图/气泡图数据反映最新市值和毛利率

## 文件清理
- [x] 根目录临时文件已删除（APIKEY。txt, chinese_strings.txt, png, mp4, json, mjs, ts, txt, js, cjs, html 等）
- [x] 根目录冗余文档已删除（DQI_GMPS_INTEGRATION_REPORT.md, API_USAGE.md）
- [x] src/web 备份文件已删除（App.original.txt, App.tsx.bak）
- [x] docs/SYSTEM_UPGRADE_TECHNICAL_GUIDE.md 已删除

## 构建验证
- [x] npm run build 构建成功（前端 vite build + 后端 tsc 编译均通过）
- [x] TypeScript 类型检查通过（修复了 agent-service.ts 和 platform-store.ts 的类型错误）
- [x] dist/web/index.html 和 dist/server/server/index.js 均已生成

## 部署方案
- [x] Docker Compose 部署方案完整可执行
- [x] 手动部署方案完整可执行
- [x] Windows 本地部署方案完整可执行
- [x] DEPLOY.md 文档已创建
