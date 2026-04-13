# 锂电池企业智能诊断系统工程骨架

这是一个可运行的全栈 TypeScript 工程骨架，包含 React + Vite 前端、Express API 服务、统一配置层、环境变量模板、结构化日志、统一错误处理、健康检查接口与基础测试框架。

当前版本已经接入金融数据连接器、实时 RAG 检索链路与多模型编排，但文档口径按实际实现校准如下：

- 最小部署要求是服务端至少配置 `DeepSeek`、`GLM`、`Qwen` 三者中的一个 API Key。
- `NBS` 国家统计局凭证为可选配置，缺失时宏观数据自动降级为公开样例数据。
- 实时 RAG 当前为“网页搜索 + 页面抓取 + 金融文本切片 + 词项相似度/元数据/权威度/时效性”混合排序，并带可追溯 citation，不依赖外部向量数据库或 embedding 服务。
- 模型验收结果区分 `passed`、`failed`、`unavailable`；自动化测试中的 mock 通过只代表验收逻辑生效，只有在真实密钥环境运行验收脚本时才算真实连通通过。

## 目录结构

```text
src/
  server/    API 服务、日志、错误处理、健康检查
  shared/    共享配置与接口类型
  web/       React 前端工作台骨架
```

## 快速开始

1. 复制环境变量模板并填写需要的服务端配置：

   ```bash
   cp .env.example .env
   ```

   如果本地缺少 `.env`，服务端现在会自动回退读取 `.env.example` 作为基础配置；但正式运行仍建议显式创建 `.env` 并填入真实密钥/凭证。

2. 至少填写一个模型 API Key。

   可选地再填写 `NBS_TOKEN`，或 `NBS_ACCOUNT + NBS_PASSWORD` 以启用国家统计局真实凭证链路。

3. 安装依赖：

   ```bash
   npm install
   ```

4. 启动前后端开发环境：

   ```bash
   npm run dev
   ```

5. 构建产物：

   ```bash
   npm run build
   ```

6. 质量校验：

   ```bash
   npm run lint
   npm run typecheck
   npm run test
   ```

## 默认接口

- `GET /api/health`：服务状态、运行时信息、模型密钥配置状态
- `GET /api/health/ready`：最小部署就绪度与降级信息
- `GET /api/meta`：前端展示所需的系统元数据
- `POST /api/agents/diagnose`：执行多智能体诊断工作流
- `POST /api/rag/realtime`：执行实时 RAG 检索并返回可追溯引用
- `GET /api/acceptance/competitive-baseline`：输出金融 RAG、模型连通性、业务质量基线验收报告
- `GET /api/acceptance/dual-portal-personalization-audit`：输出双端个性化审计报告
- `GET /api/acceptance/minimum-deployment`：输出"至少一个模型 API Key + 可选 NBS 凭证"是否足以运行主工作流的最小部署审计报告

### 数学模型接口（v2.0 新增）

- `POST /api/models/dqi/calculate`：**DQI 经营质量动态评价模型** - 基于盈利能力、成长能力、现金流质量三维综合评价，输出DQI指数、状态判断（改善/稳定/恶化）、驱动因素识别及置信度评估
- `POST /api/models/gmps/calculate`：**GMPS 毛利承压分析模型** - 五层十维架构（毛利率结果、材料成本冲击、产销负荷、外部风险、现金流安全），输出GMPS综合得分、压力等级（低压/中压/高压）、Logistic回归预测下季度恶化概率
- `POST /api/models/gross-margin-pressure`：基础毛利承压分析（v1.0，保留兼容）
- `POST /api/models/operating-quality`：基础经营质量评价（v1.0，保留兼容）

> **详细技术文档**：参见 [docs/SYSTEM_UPGRADE_TECHNICAL_GUIDE.md](docs/SYSTEM_UPGRADE_TECHNICAL_GUIDE.md) - 包含完整的API Schema、使用示例、系统集成指南和故障排查手册

## 验收口径

- 模型连通性脚本：`npx tsx src/server/acceptance-report.ts`
- 最小部署审计脚本：`npx tsx src/server/minimum-deployment-report.ts`
- `passed`：提供方已配置且探测调用成功
- `failed`：提供方已配置，但探测调用失败
- `unavailable`：提供方未配置，或当前环境不可调用
- 自动化测试：主要验证路由、降级、报表与连接器解析逻辑
- `automated_mock`：自动化测试环境，仅证明验收逻辑、工作流 smoke test 与降级链路通过
- `configured_runtime`：运行环境已按要求配置，可用于最小部署与真实连通性复核
- 真实验收：需要在服务端填写真实 API Key/凭证后运行上述脚本

## Live 阈值与现状

- 复核日期：`2026-04-05`
- 证据来源：`GET /api/health/ready`、`GET /api/acceptance/minimum-deployment`、`GET /api/acceptance/competitive-baseline`、`POST /api/rag/realtime`，以及在同一运行时直接调用 `fetchSSEReports()`、`fetchBSEReports()`、`fetchEastmoneyIndustryReports()`、`fetchEastmoneyStockReports()`、`fetchNBSMacroData()`
- 当前结论：真实环境验收未通过；自动化与降级闭环存在，但不得宣称已完成 live 上线验收

### SLA / 质量阈值

- 最小部署门槛：`configuredProviders` 至少有 1 个为 `true`，且 `GET /api/acceptance/minimum-deployment` 必须 `overallPassed=true`
- 模型连通门槛：`modelConnectivity.passedCaseCount=3/3`；若未配置真实密钥，仅可记为 `unavailable`，不得记为通过
- RAG 相关性门槛：`ragTraceability.passedScenarioCount=3/3`，每个场景至少返回 1 条 `financialReport` 或 `industryReport` 引用，且不得出现明显离题证据
- 业务质量门槛：`timeliness>=70`、`credibility>=75`、`personalization>=65`、`collaborationEfficiency>=70`
- 高竞争力判定：`businessQualityBaseline.overallPassed=true` 且 `overallScore>=75`
- 数据源可用性门槛：上交所、北交所、东方财富个股/行业研报、NBS 宏观链路均应返回非降级结果；若依赖凭证缺失，只能记为“已降级运行”，不能记为“真实链路通过”
- 性能观测门槛：`averageWorkflowDurationMs<=6000` 可记为基础可用；只有在满足前述质量与链路门槛时，才可宣称性能达标

### 2026-04-05 实测结果

- 就绪状态：`GET /api/health/ready` 返回 `status=degraded`，`configuredProviders.deepseekReasoner/glm5/qwen35Plus=false`，`canRunWithApiOnly=false`
- 最小部署：`GET /api/acceptance/minimum-deployment` 返回 `overallPassed=false`；`workflow_smoke_test` 与记忆召回通过，但 `minimum_api_inputs` 未通过
- 模型连通：`GET /api/acceptance/competitive-baseline` 中 `modelConnectivity.passedCaseCount=0/3`，三个模型均为 `unavailable`
- 业务质量：`businessQualityBaseline.overallScore=49.341`、`overallPassed=false`；其中 `timeliness=76.417`、`personalization=100` 达阈值，但 `credibility=67.633`、`collaborationEfficiency=51.994` 未达阈值
- RAG 质量：`ragTraceability.passedScenarioCount=0/3`；单独调用 `POST /api/rag/realtime` 时，`bing-rss` 返回了 `Key West Hotels`、`booking.com` 等明显无关页面，说明 live RAG 存在误召回，不能视为通过
- 上交所链路：`fetchSSEReports()` 返回 `degraded=true`，仅产生降级占位报告，未拿到可用真实公告 URL
- 北交所链路：`fetchBSEReports()` 返回 `degraded=true`，运行时日志显示 `redirect count exceeded`
- 东方财富链路：`fetchEastmoneyIndustryReports()` 与 `fetchEastmoneyStockReports()` 均返回 `degraded=true`，运行时日志显示 `HTTP 400`
- NBS 链路：`fetchNBSMacroData()` 返回 `degraded=true`，当前因缺少 `NBS_TOKEN` 或 `NBS_ACCOUNT + NBS_PASSWORD`，仅能回退到公开样例数据

### 当前上线口径

- 可以宣称：自动化验收、降级工作流、文件持久化与个性化记忆链路可运行
- 不可宣称：真实三模型连通通过、金融 RAG 真实可用、上交所/北交所/东方财富/NBS 真实链路通过、整体系统已达到高竞争力 SLA
- 进入上线候选前需补齐：至少一个真实模型 API Key、可用 NBS 凭证，并基于真实网络重新复核 RAG 收紧效果与 SSE/BSE/东方财富连接恢复情况，再执行上述 live 验收脚本

## RAG 实现说明

- 检索源：优先网页实时搜索，失败时回退到内置行业资料
- 来源策略：默认优先金融/官方站点（如交易所、东方财富、政府/教育源），并过滤明显离题来源
- 处理链路：HTML 清洗、金融长文本切片、指标元数据提取、分片排序、citation 追溯
- 排序信号：词项相似度、金融元数据命中、搜索排名、来源权威度、发布时间新鲜度
- 追溯能力：每条引用都包含 `documentId`、`chunkId`、`contentHash` 与 ranking signals
- 当前边界：尚未接入独立向量库，因此文档中“混合向量检索”统一解释为当前实现的混合排序检索链路，而非 embedding 向量召回

## 外部数据兜底

- 环境配置：`src/server/env.ts` 在找不到 `.env` 时会自动回退加载 `.env.example`
- 财报连接器：SSE、BSE 在接口空结果或异常时，会继续尝试官网 HTML 页面解析
- 东方财富：行业研报与个股研报在 API 失败或空结果时，会继续尝试官网 HTML 页面兜底解析
- 国家统计局：支持 `NBS_COOKIE`、`NBS_TOKEN`、`NBS_ACCOUNT + NBS_PASSWORD` 三种模式；优先级依次为 Cookie、Token、账号密码
- Cookie 模式：建议使用浏览器登录国家统计局数据系统后的完整 Cookie 字符串填入 `.env` 的 `NBS_COOKIE`
- 验收边界：以上兜底增强仅说明代码具备更强鲁棒性，不能替代真实网络、真实凭证和 live 质量复核

## 当前骨架特性

- 单仓全栈 TypeScript 工程组织
- 服务端统一环境配置与密钥状态检查
- 结构化日志与统一错误中间件
- 前端工作台首页与 API 健康状态联动
- Vitest + Supertest 基础测试
