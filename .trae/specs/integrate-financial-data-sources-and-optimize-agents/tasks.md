# Tasks

- [x] Task 1: 数据采集与解析 Agent 开发
  - [x] SubTask 1.1: 开发上交所、深交所、北交所定期财报数据的自动化检索与下载模块。
  - [x] SubTask 1.2: 开发东方财富网行业研报与个股研报的数据抓取与核心内容解析脚本。
  - [x] SubTask 1.3: 开发国家统计局宏观经济数据的获取模块，支持账号模拟登录或凭证认证配置机制。

- [x] Task 2: 升级 RAG 知识库系统
  - [x] SubTask 2.1: 建立针对金融长文本（研报、财报）的自动化清洗、切片（Chunking）规则。
  - [x] SubTask 2.2: 实现结构化存储（元数据标注）与向量化存储的混合检索链路。
  - [x] SubTask 2.3: 开发信息提取智能体，将检索到的高价值段落进行初步清洗和格式化输出。

- [x] Task 3: 实现多模型（deepseek-reasoner, GLM-5, Qwen3.5-Plus）智能协同与路由调度
  - [x] SubTask 3.1: 在底层大模型适配层（LLM Adapter）中接入三款模型的 API 并在 `.env` 中提供统一配置入口。
  - [x] SubTask 3.2: 升级工作流编排器（Workflow Orchestrator），实现根据任务特性（长文本、深推理、快交互）自动路由大模型。
  - [x] SubTask 3.3: 配置 Qwen3.5-Plus 为中枢交互大脑，负责意图识别与任务分发；配置 GLM-5 专门处理研报与财报的长文本阅读抽取；配置 deepseek-reasoner 负责最终的诊断决策与投资建议的深层逻辑推导。

- [x] Task 4: 智能体间协同工作流联调与优化
  - [x] SubTask 4.1: 实现数据采集 Agent、信息提取 Agent、数学计算 Agent 与决策推理 Agent 之间的数据流转与标准化接口。
  - [x] SubTask 4.2: 引入结果交叉验证机制（例如：deepseek-reasoner 负责审核提取的数据与数学模型计算结果是否匹配）。

- [x] Task 5: 极简配置与系统稳定性验证
  - [x] SubTask 5.1: 完善 `.env.example` 与配置校验模块，确保仅需填入模型 API 即可一键启动，数据源凭证缺失时可优雅降级。
  - [x] SubTask 5.2: 针对全链路数据流转进行端到端性能测试与优化，确保系统具有极强的响应速度和竞争力。

- [x] Task 6: 落实真实金融数据连接器
  - [x] SubTask 6.1: 将交易所与东方财富接口从模拟返回切换为真实请求与解析
  - [x] SubTask 6.2: 完成国家统计局凭证登录或令牌链路并补充集成测试
  - [x] SubTask 6.3: 将真实采集结果接入主工作流并校验降级策略

- [x] Task 7: 完成金融 RAG 与模型实体验证
  - [x] SubTask 7.1: 为财报与研报建立可追溯的混合检索索引与召回测试
  - [x] SubTask 7.2: 增加三模型真实连通性与能力验收用例
  - [x] SubTask 7.3: 输出可复现的性能基线与业务质量验收结果

- [x] Task 8: 修复金融验收阻断项并校准上线口径
  - [x] SubTask 8.1: 修复当前 `npm run typecheck` 在 `data-fetcher.ts` 与 `agent-service.ts` 的类型错误
  - [x] SubTask 8.2: 补齐上交所/北交所、东方财富行业研报、国家统计局账号密码链路的自动化验收覆盖
  - [x] SubTask 8.3: 将 RAG 能力描述与实际实现对齐，明确当前为混合排序检索链路而非外部向量库召回
  - [x] SubTask 8.4: 为 DeepSeek、GLM、Qwen 校准真实连通性与质量验收口径，区分 mock 通过与真实通过
  - [x] SubTask 8.5: 修正文档与 `.env.example` 中“必需/可选配置”表述，确保最小部署口径一致

- [x] Task 9: 完成最小部署闭环与真实性能验收
  - [x] SubTask 9.1: 在真实或准真实 API/凭证环境下执行最小部署验证，确认仅填写约定 API 后主流程可稳定运行
  - [x] SubTask 9.2: 补充 `GET /api/health/ready`、主工作流与个性化存储的端到端验收记录，证明无需额外复杂配置
  - [x] SubTask 9.3: 建立性能与业务质量基线，区分自动化 mock 验收与运行时环境验收结果

- [ ] Task 10: 完成真实环境性能与业务质量阈值验收
  - [ ] SubTask 10.1: 在真实模型密钥与真实外部数据源环境下执行接受度脚本，产出 live 环境性能结果
  - [ ] SubTask 10.2: 为关键工作流定义可量化 SLA、质量阈值与高竞争力判定标准
  - [ ] SubTask 10.3: 基于真实环境结果更新最终性能验收清单与上线结论
  - 2026-04-05 宏观数据策略调整：国家统计局不再作为主工作流硬依赖，默认改为公开网页 RAG 提供宏观证据；NBS 保留为可选的结构化增强源，不再阻塞最小部署与主流程可运行性判断。
  - 2026-04-05 本轮 live 失败补救：`config` 已忽略 `.env`/`.env.example` 中的 `your_*`、`example-*`、`<PLACEHOLDER>`、`replace_me` 等占位凭证，避免 readiness 误判为已配置真实密钥。
  - 2026-04-05 本轮 data-fetcher 修复：已对用户直接提供的上交所 regular 页面、北交所 announcement 页面、东方财富个股官网列表页 URL 增加优先解析；仅当页面解析不到结果时才继续回退既有 API/HTML 链路，以降低 `redirect count exceeded` 与 `HTTP 400` 的触发概率。
  - 2026-04-05 本轮自动化回归：已补充 `config.test.ts` 占位凭证识别用例，以及 `data-fetcher.test.ts` 中三类官网列表页 URL 优先解析用例；并重新执行 `npm run test`、`npm run typecheck`，结果均通过。
  - 2026-04-05 代码层整改补充：已实现 `env.ts` 在缺少 `.env` 时自动回退加载 `.env.example`，并为 SSE/BSE/东方财富增加官网 HTML 兜底解析；实时 RAG 也已收紧搜索词、过滤离题结果并优先金融/官方源，同时补充了对应自动化测试。
  - 2026-04-05 本地代码验收结果：已执行 `npm run test` 与 `npm run typecheck` 用于验证上述整改未破坏现有链路；这仅代表代码层回归通过，不代表 live 环境验收通过。
  - 2026-04-05 后续 live 复核结果：模型 API 已可被当前环境读取，最小部署主工作流能够通过；旧的“未配置任何真实模型 API Key”结论已失效，不再作为阻断项。
  - 2026-04-05 最小部署审计补充：`minimum-deployment-report` 已证明服务端私有配置、主工作流 smoke test 与个性化记忆链路可运行；当前阻断点转移为外部源详细数据与真实质量阈值。
  - 2026-04-05 竞争性验收结果：`GET /api/acceptance/competitive-baseline` 返回 `businessQualityBaseline.overallScore=49.341`、`overallPassed=false`；分项仅 `timeliness=76.417`、`personalization=100` 达阈值，`credibility=67.633<75`、`collaborationEfficiency=51.994<70` 未达标。
  - 2026-04-05 RAG 复核结果：`POST /api/rag/realtime` 在 live 网络下返回 `bing-rss` 误召回 `Key West Hotels` 等明显无关页面，`documentTypes=["unknown"]`，`ragTraceability.passedScenarioCount=0/3`，因此当前不能宣称金融 RAG 链路通过真实业务质量验收。
  - 2026-04-05 外部数据源复核补充：已完成官网 HTML 兜底、URL 优先解析与 `NBS_COOKIE` 支持；但实测 `NBS_COOKIE` 访问 `QueryData` 仍返回 `403`，因此 NBS 目前仅可视为未通过的可选增强源，不再作为主链路阻断项。
  - 当前 Task 10 结论：模型与最小部署已不再是主要阻断项；剩余未通过点集中在公开网页 RAG 的真实质量与外部源 live 质量证据。NBS 详细结构化数据未通过，但已降级为可选增强项，不影响“默认走 RAG 的宏观证据链”成立。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 3]
- [Task 5] depends on [Task 4]
- [Task 6] depends on [Task 1]
- [Task 6] depends on [Task 5]
- [Task 7] depends on [Task 2]
- [Task 7] depends on [Task 3]
- [Task 7] depends on [Task 6]
- [Task 8] depends on [Task 6]
- [Task 8] depends on [Task 7]
- [Task 9] depends on [Task 8]
- [Task 10] depends on [Task 9]

