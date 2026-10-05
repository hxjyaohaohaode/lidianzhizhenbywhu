# 辅助读连接的有界修正（2026-10-05）

## 原失败保持失败

`a9f71deffb0ef83d2bb472f3ecb2b6b31129dbf2` 的 Push run `37282239822`、Windows job `111672762441` 在I7坏输入页面完成56步之后，辅助 `Probe.get('/api/auth/me')` 出现 `socket hang up`。恢复阶段没有到达，不能将本次任务记为通过。

原始6个官方ZIP、5片段、100893590字节归档及237个文件hash已全部核对，归档SHA-256为 `cbd1529c1d25974a90baab8a6b042e2d78eea8d854947fb6b642294602723ced`。109个保护文件hash与固定提交一致。原trace显示辅助请求距上一辅助响应完成5002.226毫秒，在8.348毫秒内失败；真实浏览器此前已读取tracking 200并显示坏输入拒绝、无值、无提醒，随后sync仍200，服务直到明确清理仍存活。此证据强支持5秒空闲关闭与复用的时序问题，但不能证明失败socket一定被复用或该请求是否到达服务器；warning级日志没有访问记录，不据此推断未接收。

## 单次请求与范围

`Probe.get` 从第一条辅助读起请求 `Connection: close`，让当前Uvicorn完成响应后关闭连接，不将本helper的连接留在空闲池。仍只有一次API调用、原30秒上限、严格200状态和原JSON/传输错误传播；没有重试、fallback、放宽断言或全局网络设置。部分GET会评估并产生跟踪提醒，不能因其方法名为GET就自动重放。

使用实际固定Playwright HTTP agent加内存Duplex、实际Uvicorn h11加内存transport进行了无网络协议检查：默认对照会复用；Uvicorn遵守close请求、关闭transport且不安排空闲timer，后续本helper请求不留下空闲连接。逆向控制也证明header不是强制新socket选项：其它调用者先放入池中的连接仍可能被借用。I7没有这种其它helper；已有两个contract竞态任务使用`route.fetch`，所以不宣称混合路径全局绝不复用。没有启动本地浏览器、监听器或应用服务。

`tests/test_product_read_transport.py` 有21项协议检查；相关聚焦检查122项通过，另3个同一用例内subtests不相加。新的46项CI矩阵和原生Windows结果仍待本轮提交后执行，协议测试不是恢复成功或产品通过的替代证据。
