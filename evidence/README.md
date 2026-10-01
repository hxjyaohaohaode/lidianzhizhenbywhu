# 验收证据索引（2026-10-01）

当前候选范围见 `docs/CANDIDATE_ACCEPTANCE_20261001.md`，最终精确提交与 CI 终态见 [PR #2 顶部](https://github.com/hxjyaohaohaode/lidianzhizhenbywhu/pull/2)。历史文件、旧数量和旧同名截图不替代新提交结果。

## 当前生成记录

- `verification.json`：最近一次本地聚合的实际时间、逐阶段命令、退出码、耗时及未测范围；带 `--full-chain` 的运行有七阶段，不与早先六阶段混同。后端/前端具体计数见对应同次日志和CI工件
- `full-chain-http.json`：当前17组实际Uvicorn/HTTP/SSE/强制退出恢复/在线备份旅程；不是原生浏览器验收
- `launcher-smoke-20261001.json`：复制当前受版本控制的应用与启动器到无.env/业务库的临时目录，实际通过start.py注册、读取前端静态资源、关闭后重启再登录；本地Linux，未执行Windows批处理双击
- `comparison-cleanup-20261001.json`、`copilot-research-inputs-20261001.json`：各自功能轮次的合同与回归；记录当时的数量，不随新测试自动变成新结果
- `source-guard.json`：限定语法/模式检查，不是完整安全审计；`brand-integrity.json`为原始PNG/MP4来源与摘要，不是素材授权证明

## 原生工件身份

最近已核对的应用基线为 `865a43abbd14aeecd0d388bb8b989b092e3afdf8` / tree `859bd2632e4dea97a85b6eeb794c80b9a7ac2df7`。成功原生来源是运行 [36866612001](https://github.com/hxjyaohaohaode/lidianzhizhenbywhu/actions/runs/36866612001) 与 [36866617534](https://github.com/hxjyaohaohaode/lidianzhizhenbywhu/actions/runs/36866617534) 的四份Windows/Linux报告，各48检查、14图、998后端、239前端和17HTTP。PR Windows成功为attempt 2，首次44项后连接读取失败仍保留，原因未确认。

本次只补诊断/测试/材料，应用字节不变，但新精确提交仍须新CI实跑。每次CI首先清理已知生成输出并写 `run-context.json`，只认匹配SHA、运行号及尝试号的新报告：

- `native-service-browser.json`：实际业务结果、原生/桥接区别、截图名称、逐图SHA-256和run_identity
- `native-service-command.json`：子命令退出码；没有产生报告的阶段不能算通过
- `native-browser-events.jsonl`：有界原生请求/失败/console分类与页面时间；路径模板化，不记录任意console正文、请求/响应体、headers、cookies或查询值
- `native-process-events.jsonl`：隔离服务、健康探测、子进程、清理与观察退出码时间；不是自动重试或成功替代品
- `*.log`、`pytest.xml`：同次实际输出。依赖审计由同SHA独立job提供，当时未报告漏洞不等于零漏洞保证

仓库本地的 `native-service-browser.json`、`native-service-command.json`仍是先前宿主Chromium受限记录，保留失败事实，不表示远端当前CI状态。不得绕过策略或混用桥接结果。

## 历史与图证边界

`docs/copyright-screenshot-sources.json`是上述应用基线四份工件及56张图片的已核对摘要。后续诊断候选的新图摘要直接在新CI报告中生成，以精确SHA身份复核；不把基线工件冒充新运行。8张新增清理确认图逐一看过，其他做来源/摘要核验和移动端抽查，不宣称56张均做完整视觉审阅。

仓库里的 `ui-current-*.png`、`service-browser-check.json`、`bridge-service-command.json`、`dependency-audit.json`及`history/`为历史资料，没有因同名自动成为当前视觉证据。`premerge-acceptance-20261001.json`、`execution-resilience-20261001.json`等专题保留其当时范围；重叠用例不加总。工件会过期，需及时保存所需证据；图片存在不等于正式申报插图完成。

只使用临时合成账户与输入，不提交数据库、密钥、.env、依赖缓存。真实供应商调用、真实企业样本、生产负载、公网部署及正式登记仍未验证或完成。
