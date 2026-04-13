# Tasks

- [x] Task 1: 验证TypeScript编译和单元测试
  - [x] SubTask 1.1: 运行 `npx tsc -p tsconfig.server.json --noEmit` 确保后端0错误
  - [x] SubTask 1.2: 运行 `npx tsc -p tsconfig.app.json --noEmit` 确保前端0错误
  - [x] SubTask 1.3: 运行 `npx vitest run` 确保所有测试通过

- [x] Task 2: 验证API密钥配置和LLM适配器
  - [x] SubTask 2.1: 检查 .env 文件中 DEEPSEEK_API_KEY、GLM_API_KEY、QWEN_API_KEY 均已配置
  - [x] SubTask 2.2: 检查 src/server/llm.ts 中三个LLM适配器的初始化逻辑
  - [x] SubTask 2.3: 验证适配器可用性检查逻辑（hasApiKey → isAvailable）

- [x] Task 3: 验证后端服务启动
  - [x] SubTask 3.1: 启动后端服务 `npx tsx src/server/index.ts`
  - [x] SubTask 3.2: 验证 /api/health 端点返回 200
  - [x] SubTask 3.3: 验证 /api/models/dqi/calculate 端点可用
  - [x] SubTask 3.4: 验证 /api/models/gmps/calculate 端点可用

- [x] Task 4: 验证前端服务启动
  - [x] SubTask 4.1: 启动前端开发服务器 `npx vite --host`
  - [x] SubTask 4.2: 验证页面在 http://localhost:5173 正常加载

- [x] Task 5: 勾选上一轮审计checklist中所有已通过的检查项
  - [x] SubTask 5.1: 更新 comprehensive-system-functional-audit/checklist.md，勾选所有已验证通过的项

# Task Dependencies

- [Task 2] depends on [Task 1] — 先确保编译通过再验证配置
- [Task 3] depends on [Task 2] — 先验证配置再启动服务
- [Task 4] depends on [Task 3] — 先启动后端再启动前端
- [Task 5] depends on [Task 1] — 编译和测试通过后即可勾选
