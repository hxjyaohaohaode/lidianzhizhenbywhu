# 本轮验收记录：自主协同与交互加固

## 对象与环境

对象是本轮实际修改的源代码与由其TypeScript编译产生的前端，不沿用上一包的通过标记。Linux、Python3.13.5、Node22.16.0、TypeScript5.8.3；依赖是本机已安装固定版本。未将这些结果推广为Windows/macOS或全新联网安装结果。

## 当前执行结果

|检查|实际结果|证据|
|---|---|---|
|Python正向/反向/故障注入回归|384 passed，无跳过；保留原307例并新增77例|pytest.log、pytest.xml|
|Python语句覆盖|2915/3090 = 94.34%|coverage.json|
|Python分支覆盖|804/982 = 81.87%|coverage.json|
|前端函数、协议、事件竞争与渲染合同|33项通过|frontend-tests.log|
|TypeScript严格检查/构建、Python编译、限定源码守卫|通过；守卫不是漏洞审计|typecheck.log、frontend-build.log、python-compile.log、source-guard.json|
|独立服务真实HTTP联动|12组检查通过|full-chain-http.json、full-chain-http.log|
|Chromium真实DOM+本地API桥接|32流程通过；12工作区+运行详情390px无文档级溢出|dom-check.json、dom-final.log、ui-*.png|
|原始品牌素材|PNG及MP4字节相同；HTTP路径与Range通过|brand-integrity.json、full-chain-http.json|
|原生浏览器导航|ERR_BLOCKED_BY_ADMINISTRATOR，未通过；未修改策略|native-browser.json、native-browser.log|
|15项运行依赖联网元数据检查|全部连接失败，not_checked，不是零漏洞|current-dependency-advisories.json|

Python覆盖率保留parse_worker子进程未采集的0%，未排除未覆盖模块；语句或分支覆盖不是需求穷举或安全证明。测试含参数化，不把384例说成384个不同功能。前端静态扫描只是一部分；新增异步终态/网络故障/销毁后迟到响应有实际Promise和EventSource测试驱动。

## 真实协议链路

full_chain_check.py使用随机本机端口、独立Uvicorn进程、隔离临时数据库与真实HTTP请求，无前端桥接：原资源→认证/CSRF→multipart暂存→正式数据→证据/批准记忆→计划→动态DAG→数学工具→报告/事件/快照→导出；真实流式SSE并按Last-Event-ID续读；暂停后SIGKILL进程、启动同一数据库、显式继续并验证无重复节点产物；人工验收→候选→回放→激活→旧计划失效→回滚；SQLite在线备份副本完整性。4并发64次读取只构成小负载探针，延迟保留在JSON，不是生产吞吐或长期SLA。

浏览器路径真实运行本项目编译JS和CSS，但因原生导航被阻止而用显式本地HTTPX桥接业务API；品牌图像/视频使用相同原始字节的显式测试装载。未绕过管理员策略，不能据此声称原生网络模块加载、Cookie/SameSite、CSP或浏览器SSE完整通过。后端HTTP与SSE的真实通过也不能替代这一浏览器边界。

## 测试中发现并回归的缺陷

真实联动暴露了证据立场未带入冻结片段的问题；动态分工验证发现规划建议只记录但依赖未真正改变的问题；成本边界测试发现完全重复解释导致多付费修订；UI暴露节点详情缓存过旧和运行/运行时两接口跨越终态后页面停留；异步测试覆盖终止事件与在途读取竞争、失败后不降级、旧账户迟到响应。演进门禁补上重命名输入去重、保持显式研究深度、评估案例集合变化时禁止旧评估激活。

这些失败与修复不是将失败用例删除。中途一次覆盖率调用达执行时限，没有完整结果；之后完整重复执行通过，早先不完整调用不计成功。最终以当前日志、清单和ZIP重新解压后的独立记录为准。

## 不在通过结论内

真实付费模型/搜索供应商调用0；供应商边界用明确测试替身和严格解析测试，不代表真实模型服务可用。未完成目标Windows/macOS、Docker构建、公网HTTPS、长时间压力、分布式运行、全量依赖漏洞联网审计、可选PDF修复版本安装联调、领域预测经验校准、获奖TypeScript数据库无损迁移。本轮没有向GitHub主分支写入或形成远程提交。

## 复现

先构建前端：npm ci --ignore-scripts && npm run build；已有编译发布包可直接运行。安装requirements-dev.txt后，python scripts/verify.py --full-chain；另运行python -m pytest --cov=server --cov-branch --cov-report=json:evidence/coverage.json。UI检查需要隔离运行库和Playwright浏览器：python scripts/browser_check.py（原生）；python scripts/dom_check.py（明确桥接）。不要对真实业务库运行会创建测试账户的UI脚本。

发布包清单记录每个文件的SHA256与字节数（不包含清单自身）；包外最终复验在重新解压目录核对清单、再次测试和独立HTTP链。打包前记录不替代包后验证。
