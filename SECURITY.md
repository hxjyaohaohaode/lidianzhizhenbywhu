# 安全状态与边界

本包经过本地正向、反向与故障注入回归；没有“零漏洞”“全部环境安全”认证。

## 已执行的隔离

独立scrypt密码/随机盐、服务端会话、HttpOnly和SameSite=Strict；生产Secure；CSRF与来源检查；不信任客户端内部标识或代理IP。资源所有权在服务端执行，版本冲突拒绝覆盖。禁止共享访问码冒充用户。提前拒绝请求也携带no-store、防嗅探、frame与请求ID等头。

请求体2MB、总上传deadline、有限鉴权/接口频率、资源配额、排队上限、单进程锁。文件格式白名单，XLSX只允许单表、限制展开规模/条目/压缩比，拒绝公式和不规范数值。TXT/MD文本不执行，显示前统一HTML转义。

公开抓取为固定域名白名单+HTTPS+公网DNS检查+连接IP固定，不跟随重定向至任意地址。模型仅固定供应商接口，不接受用户可编辑任意base_url，不让不可信输入生成工具命令。密钥只来自服务端环境，解析子进程清理环境变量。

模型文本、证据、历史、前序角色输出都不可信。模型无数据库写入、shell、交易能力，外发先预览再逐次批准；排队/多步骤间可撤销未发送内容；取消不允许晚到结果覆盖状态。不能保证自然语言提示注入完全消失，因此使用能力边界而不是“更强提示词”作为唯一防线。

## PDF与依赖

环境存在旧pypdf5.9.0，**核心requirements已不再安装pypdf，运行时阻止小于6.13.2的PDF解析**。默认可用路径为TXT/MD和结构化CSV/XLSX/JSON。可选requirements-pdf要求6.13.2至7之前版本；已查上游6.13.2修复循环Pages树等安全问题，但这个下限不是“所有将来漏洞已修复”的保证。尚未安装并验收该可选解析器。解析位于限时子进程，Linux资源限额不等于Windows也已实测。

requirements固定本次实际运行版本，未宣称是最新版本。当前运行环境的包索引联网安装/完整pip-audit没有完成；需在目标部署环境完成漏洞审计、兼容升级、全套回归后再公网放行。单靠应用层限制不能替代第三方补丁。证据见evidence及DEPENDENCIES。

## 保留风险

- 数据库与备份没有内建静态加密。使用操作系统磁盘加密、私有目录和受控备份；本地管理员能读取及修改数据和哈希链。
- 删除原始证据/记忆不会暗改历史快照。可以分别清理计划、实验、行动、会话或整个账户；不能替你删除导出文件和供应商已收到的内容。
- 同一来源IP共享本地速率桶；反向代理需额外边缘限流，不能直接信任X-Forwarded-For换取宽松限制。数据库日志无自动无限期轮转策略，运营者需设保留与备份规则。
- 网络请求一旦发出可能计费；超时/取消无法保证远端终止。不对未知结果自动重试；用户批准的HTTP429候补尝试仍可能有供应商费用，全部计入次数台账。
- 结构门禁、词法相关、手工接受与哈希一致性都不是事实真实性保证。用户财务信息未经独立验证，未接入完整实时金融源。
- 目前是个人工作区，不是企业多租户协作/SSO/MFA产品。行动负责人标签不会授予访问权。
- 原生浏览器网络、生产HTTPS、真实供应商、目标Windows和长期负载未完成本次验收。

## 外部设计依据

OWASP LLM Prompt Injection Prevention Cheat Sheet：最小权限、区分指令与资料、人工审批、输出校验，多层控制而非承诺完全免疫。https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html

pypdf6.13.2官方变更日志（2026-06-10安全修复）：https://pypdf.readthedocs.io/en/6.13.2/meta/CHANGELOG.html

FastAPI官方变更记录：https://fastapi.tiangolo.com/release-notes/ 。本地固定版本不是“已升级到此页面最新版本”的声明。

## 新执行器安全边界

声明式能力白名单、DAG无环验证、事务累计预算、服务端固定模型绑定、断点哈希复核、授权撤回和终态禁止晚写是独立控制。策略激活要求当前案例集合、原输入、人工评估、候选和策略版本均匹配；不会让模型自动改代码或自行提升权限。模型输出的语义正确性和相互独立性未被这些控制证明。

本次实际新增本机TCP/HTTP原始资源、认证、CSRF、导入、冻结报告、真实SSE续读、暂停后SIGKILL与恢复、策略激活回滚、在线备份检查。浏览器原生导航仍遭管理员策略阻止，未修改策略；DOM/API桥接记录单独列出，不伪装同源Cookie/CSP/SSE浏览器验收。

当前联网依赖元数据检查15项均因连接失败标记not_checked，见evidence/current-dependency-advisories.json。它不是15项无漏洞，不替代完整依赖与源码安全审计。

## Current security update

Runtime constraints are FastAPI 0.141.1, Starlette 1.3.1, python-multipart 0.0.32 and cryptography 50.0.1. Official package metadata and advisories were checked; historical local pins are not advertised as safe. GitHub dependency-audit installs and resolves the release constraints independently. A successful audit reflects the advisories available at that run, not proof of zero vulnerabilities.

Service connections are owner-scoped and encrypted with a separate local Fernet key. Same-machine administrators can read both: this is not protection against a compromised host. Missing keys fail closed. Backup keys must remain private. Sensitive operations reauthenticate and limit password-hash concurrency. Work identities do not add organizational permissions.

Raw ambiguous Host authorities, control characters and Windows UNC/drive-style paths are rejected before URL construction or static-file resolution. This is defense in depth, not a substitute for patched dependencies.
