# 2026-09-27 整合版验收记录

本记录对应 2026-09-27 整合后的源码及重新构建的 `web/dist`。本机环境为 Windows、Python 3.12.13、Node 24.15.0、TypeScript 5.8.3。所有验收账户及财务输入均在临时目录中生成，明确标记为合成测试数据；正常注册后的业务数据仍为空。原始 Logo 与开场 MP4 由源码守卫及真实 HTTP 散列检查核对，没有替换。

|实际执行|本机结果|记录|
|---|---|---|
|`npm ci --ignore-scripts`、`npm run build`、TypeScript 类型检查、Python 编译|通过|`web/dist`、`evidence/verification.json`|
|`python scripts/verify.py --full-chain`|后端 492 passed，前端 42 passed；源码守卫通过；12 组真实 HTTP 链通过|`evidence/verification.json`、`evidence/full-chain-http.json`|
|`python scripts/native_acceptance.py`|原生 Chromium 27 组业务检查通过，实际 Cookie/CSP/ESM/SSE；15 个工作区在 390px 下无文档级横向溢出|`evidence/native-service-browser.json`、`evidence/native-service-command.json`|
|`python scripts/native_acceptance.py --bridge`|显式 DOM/API 桥接 24 组业务检查通过，单独记录，不作为原生浏览器证明|`evidence/service-browser-check.json`、`evidence/bridge-service-command.json`|
|核心依赖审计|17 项解析依赖，在当次审计数据中未报告已知漏洞|`evidence/dependency-audit.json`|

整合验收覆盖了同一账户的研究视角切换、服务身份隔离、助手会话与公式/季度追踪、提案预览与确认、Agent DAG 和数学输出、跟踪提醒去重、私有连接密钥不回显。工作视角是账户偏好，切换后同一服务身份的历史会话仍可读取；服务身份与企业范围才是会话上下文边界。后端测试包括所有者与版本冲突、无授权外发、输入范围、重启恢复、事件及检查点一致性等逆向路径。真实 Uvicorn 链检查了文件暂存与确认入库、CSRF/跨账户拒绝、SSE 续读、强制退出后显式恢复、人工评估后演进门槛与在线 SQLite 备份。前端测试覆盖迟到响应、SSE 终态竞态、渲染转义与布局边界。

Windows 首次执行真实链路及原生浏览器时，业务检查均完成，但进程退出后短暂的 SQLite 文件占用令临时目录清理报错。验收脚本现对 `PermissionError` 进行最多约两秒的有界重试；文件持续被占用时仍失败，不把清理错误记录为通过。修复后两种链路均重新执行并通过。没有放宽产品 CSP、绕过浏览器策略或改用桥接代替原生验收。

首次整合后的远端运行 `36268062469` 揭示两处验收脚本错误：Windows 的旧 worker 测试在注入授权夹具前可能已被后台 worker 执行完成；Ubuntu 的视角切换脚本误要求原会话消失。前者改为先准备夹具、再显式启动 worker，并在供应商测试替身真正进入后检查取消；后者验证账户偏好持久化、页面重绘及已有会话可读。这两处没有删除安全断言或把失败改名为通过。本地定向测试、原生浏览器和桥接复跑均通过，远端仍以修复提交的 CI 结果为准。

真实外部模型及公网搜索供应商调用为 **0**。测试替身只证明协议与错误边界，不证明真实账户额度、模型质量或公网可用性。Docker、公网 HTTPS、跨设备兼容、长期负载、可选 PDF 路径及领域预测外部校准尚未在本次验证。GitHub CI 需以最终 `main` 提交的运行结果单独确认；本机通过不自动等于远端通过。Vercel 不属于本次交付验收链。
