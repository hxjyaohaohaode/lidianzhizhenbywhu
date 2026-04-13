# Tasks

- [ ] Task 1: 配置 .env 为生产模式
  - [ ] SubTask 1.1: 修改 .env 中 NODE_ENV=production, CORS_ORIGIN=*

- [ ] Task 2: 修复 Vercel Serverless 部署适配
  - [ ] SubTask 2.1: 修复 api/index.js 入口文件，确保正确导出 Express handler
  - [ ] SubTask 2.2: 修复 vercel.json 配置，确保路由和函数配置正确
  - [ ] SubTask 2.3: 适配 SSE 流式响应在 Vercel Serverless 环境下的兼容性
  - [ ] SubTask 2.4: 适配文件持久化到 /tmp 目录

- [ ] Task 3: 安装 Vercel CLI 并配置环境变量
  - [ ] SubTask 3.1: 通过环境变量方式登录 Vercel（设置 VERCEL_TOKEN）
  - [ ] SubTask 3.2: 在 Vercel 项目中配置所有环境变量（API Key 等）

- [ ] Task 4: 执行 Vercel 部署
  - [ ] SubTask 4.1: 执行 vercel --prod 部署到生产环境
  - [ ] SubTask 4.2: 验证云端系统功能正常

- [ ] Task 5: 验证云端功能
  - [ ] SubTask 5.1: 验证前端页面可访问
  - [ ] SubTask 5.2: 验证 API 端点正常（/api/health, DQI, GMPS）
  - [ ] SubTask 5.3: 验证 SSE 流式分析正常
  - [ ] SubTask 5.4: 验证个性化服务（用户记忆、偏好）正常

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 3]
- [Task 5] depends on [Task 4]
