# 验收证据索引（2026-10-01）

当前权威范围及已验收源码树见 `docs/VALIDATION.md` 顶部；较早阶段记录不替代当前结果。

- `verification.json`：2026-10-01 04:22:20 UTC最终本地compile/typecheck/build、953后端、162前端与source-guard六阶段结果；此次命令未含HTTP阶段，另行执行的HTTP记录见下方
- `execution-resilience-20261001.json`：同轮详细数量、传输/授权/整数/实时读取合同、源码摘要、迭代及明确未验证范围
- `full-chain-http.json`：16组真实Uvicorn/HTTP/SSE/强制退出重启/在线备份检查；不是原生浏览器验收
- `premerge-acceptance-20261001.json`：同树补充本地16组HTTP重跑、4组重启/重放探针、multipart边界与121项重点逆向测试；121项与953项重叠，不相加
- `native-service-browser.json`、`native-service-command.json`：本地Chromium宿主socket权限受限的记录，保留失败事实；不代表远端CI状态
- 当前成功的原生验收来自GitHub运行 [36806115964](https://github.com/hxjyaohaohaode/lidianzhizhenbywhu/actions/runs/36806115964) 与 [36806117503](https://github.com/hxjyaohaohaode/lidianzhizhenbywhu/actions/runs/36806117503)。四份Windows/Linux报告各44组原生检查、11张图；工件/源码树/截图摘要见 `docs/copyright-screenshot-sources.json`
- `dependency-audit-current.json`、`npm-audit-current.json`：已有联网依赖审计快照；无已知报告不是零漏洞保证，Python安装解析差异与许可核对见 `docs/THIRD_PARTY_NOTICES.md`
- `source-guard.json`：限定语法/模式检查，不是全量安全审计
- `brand-integrity.json`：原始PNG/MP4来源与摘要，当前核对未改变，不是素材授权证明

## 历史证据与保存边界

`ui-current-*.png`、`service-browser-check.json`、`bridge-service-command.json`、`dependency-audit.json`与`history/`是历史基线资料。尽管已有当前CI截图，仓库内这些同名旧图片没有被替换，不能当作当前源码的视觉证明。较早日期的专题JSON记录各自范围，完整结果以当前索引为准。

日志及JUnit由命令生成，GitHub Actions另存独立工件；CI清理旧生成输出并写入 `run-context.json` 标识SHA/运行号/尝试号。工件有保存期限，应在过期前保存所需原始证据。截图存在不等于已经整理成正式提交用插图。

测试账户与财报仅使用临时合成输入；不提交数据库、密钥、.env、依赖缓存或运行时业务样例。补充清单只保留检查名、计数、边界及安全摘要，不含账户、请求ID、凭据或机器绝对路径。真实模型/公开搜索供应商调用为0；没有部署或合并。
