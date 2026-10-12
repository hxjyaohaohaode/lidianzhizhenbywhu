# Windows 验证修复：原失败与边界

原提交 `7d135acffe87dc9c8d26600746ae05cef53496a4` 的 [CI 38283962009](https://github.com/hxjyaohaohaode/lidianzhizhenbywhu/actions/runs/38283962009) 返回 37 项成功、2 项失败。一个失败是原 L9 Linux 地域访问限制的明确保留；本文件只处理另一个 Windows regression 中的三个可修复问题，不移除或转移受限任务。

原 Windows 工件 `11763442500`，SHA-256 `10116a0641e235e316b65bc59f8f108ac8b2473431f12c0de4aea4df9998038d`，完整失败保留。两个 pytest 子进程都正常完成并确认清理，非超时；总计 28 个 setup 错误和 1 个断言失败。聚合器的“process exit or cleanup failed”不能解读成已经证实进程泄漏。

## 1. 测试宿主的 Windows 唤醒连接

`test_watch_comparison_scope` 原先在 TestClient 初始化前全局拒绝 socket.connect，Windows 的 asyncio 宿主创建自唤醒 socketpair 时被挡住，导致 28 项业务检查未进入执行。

改为复用仓库既有 `offline_test_client`：先只建立空测试宿主，再在禁联网保护下构造应用，复用同一 portal 到启动、请求和关闭。没有白名单放行任意回环或公网地址；连接、DNS、监听、数据报、额外 socketpair 和供应商尝试均仍失败，被应用捕获的尝试也会使测试失败。其保护是测试中的 Python I/O 合同，不是任意原生代码的网络沙箱。

## 2. 备份 JSON 在窄编码管道中输出失败

真实隔离 `-I` 子进程在 Windows 默认管道编码中不能输出收据里的中文。备份数据库和磁盘收据已创建，但命令打印时失败，不能要求用户盲目重试同一目标。

stdout 改用 JSON ASCII 转义，解析后原中文警告和路径完全保留；落盘收据仍是 UTF-8。不依赖会被 `-I` 忽略的环境变量。新增实际隔离进程的 ASCII/cp1252 严格管道回归，核对收据与磁盘记录完全相等、中文路径、数据库完整性、配套 key 标志以及不输出私有凭据。

## 3. 崩溃诊断的只读 SQLite 连接

四场景均通过、14 个受管进程清理成功且源码身份不变，但父进程 snapshot 使用 SQLite 事务上下文，退出并不 close 连接。Windows 因仍有数据库句柄而拒绝删除测试临时目录。

只对诊断快照连接使用 `contextlib.closing`，正常返回和异常均关闭。新增回归先在原实现复现失败，再验证关闭与最终清理；其他残余文件锁仍必须判失败并保留目录。没有使用 ignore_errors、无界重试或跳过清理证明。

## 验证身份

修复不改变 server/web、品牌、数学公式、业务数据或供应商权限。定向 Linux 回归和模拟 Windows 文件锁只证明其各自范围；真实 Windows 是否通过须查看本次修复提交对应的 GitHub CI，不能复用原失败或先前 Linux 的通过结果。
