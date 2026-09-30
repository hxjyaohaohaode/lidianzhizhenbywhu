# 验收证据索引（2026-09-30）

当前权威范围见 `docs/VALIDATION.md`，功能/兼容边界见 `docs/RELEASE_4_1.md`。

- `verification.json`：本轮完整编译、类型、构建、589项后端、60项前端、源码检查、真实HTTP链结果
- `full-chain-http.json`：本轮真实Uvicorn/HTTP/SSE/退出重启/在线备份12组检查
- `native-service-browser.json`、`native-service-command.json`：本轮Chromium启动因socket权限被阻止，未进入页面；不继承旧通过标志
- `dependency-audit-current.json`、`npm-audit-current.json`：本轮联网依赖审计；无已知报告不等于不存在漏洞
- `source-guard.json`：本轮限定语法/模式检查
- `brand-integrity.json`：原始PNG/MP4摘要，本轮重新核对不变
- `orchestration-hardening-20260930.json`：本輪有界执行/恢复/治理演进的定向检查及限制；最终整合以verification为准

以下是**历史基线资料，未在本轮重跑或重拍**：`ui-current-*.png`、`service-browser-check.json`、`bridge-service-command.json`、`dependency-audit.json`以及`history/`。保留旧文件名是为了历史引用，不把它们当作4.1视觉或桥接验收证明。只有新的原生CI执行成功并写出对应截图，才能更新此结论。

日志及JUnit由执行生成，不纳入源码；GitHub Actions将其作为独立工件保存。测试账户/财报均在临时目录，不打包数据库、密钥、`.env`、依赖缓存或运行时样例。真实模型/公开搜索供应商调用为0。

CI新增 `run-context.json` 标识每次提交与尝试；执行前清理旧生成输出，上传仅含本轮阶段输出。未产生原生报告即不把历史截图当成已执行。首轮远端候选a39e204的26组原生通过及1024px失败见docs/VALIDATION.md后续修复记录。


## 第三轮最新本地记录（2026-09-30）

`verification.json` 当前对应 694 项后端、107 项前端及完整七个检查阶段全部通过；`research-grounding-20260930.json` 记录数学引用、财务期间与回放变更的复核范围。上述旧基线数字保留为历史，本节及当前JSON优先。新增三组原生流程未在本机运行，须当前远端提交CI证明。没有真实供应商调用。
