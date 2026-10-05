# 原开场结束与注册入口就绪（2026-10-05）

## 已核验的原失败

Windows 原生验收 run `37277881673`、job `111658890459` 的 F3 在注册前失败。原记录保持红色：F1、F2 通过，F3 为 `blocked_or_error`，没有执行到财务报告百分点业务断言。本次诊断不能将它改记为通过。

证据对应提交 `8e3a5f19852e0e6fc60ce2a0228768b44a7ba9e7`，完整树 `cb9cac620330b305f297089ccf5fd754f5515a3d`，web 树 `4d9127eff44785520d33efac0c9592e06f98a0c6`，server 树 `51c91049a339c58c6263d5cf9333cd65d3a7212a`。执行前后受保护文件哈希一致。

已检查官方 `product-audit-windows-latest-summary` 与 `product-audit-windows-latest-part-01` 至 `06`：7 个外层 ZIP 的官方 SHA-256、6 个片段的大小和 SHA-256、重组归档及清单内 315 个文件均匹配。归档为 131,230,034 字节，SHA-256 为 `e11e684fd1f99474e5a2cfc7d7b3da421ce902dd242b52c4cc56b26f218c87a7`。轻量核验记录见 `evidence/intro-readiness-20261005.json`；没有把原始视频、trace、PNG 或下载地址加入仓库。

### 原始 trace 与像素时间线

以下为同一 Playwright trace 的单调时钟毫秒值：

- 75,868.187：`[data-intro-skip]` 的 `isVisible` 返回 true
- 75,904.236–77,339.204：步骤 002 的 viewport-before 截图；`002-before.png` 仍显示原开场、进入按钮和被遮挡的登录页
- 77,350.874–77,511.915：同一步骤的 full-page-before 截图；`002-before-full.png` 已显示无遮挡的真实登录页
- 77,550.702–87,582.297：之后的 `waitForSelector` 等待已移除的进入按钮可见，最终超时；trace 中没有发出进入按钮 click
- `002-after-failure.png` 与 `002-before-full.png` 字节完全一致，SHA-256 均为 `5d7cff23211d8d7f26625c12ac50844cd1f26315477b10d3e8080dc9c747da60`

F3 无 JavaScript 异常、无意外对话框、无外部请求。原开场的正常结束函数会关闭并移除 dialog；原视频约 5.041667 秒，另有 6,500 毫秒结束定时器。截图间自行消失、没有点击或键盘输入及未改动的源码共同支持正常自动结束判断；trace 不区分具体由视频 ended 还是定时器触发，不能把某一个触发机制称为已证明。

根因是验收前置步骤的检查与使用时序：先检查短生命周期按钮可见，再拍摄两张证据图，最后要求同一按钮再次出现。截图耗时足以跨过正常开场结束点。

## 有界修复及严格入口条件

`Probe.await_registration_ready()` 只用于注册前置阶段，并同时替换 `Probe.bootstrap()` 与 `register_empty_workspace()` 中相同的竞态路径：

1. 在既有 `FORM_TIMEOUT_MS = 10,000` 毫秒限制内等待原 `dialog.brand-intro` 从 DOM 移除；仅隐藏或找不到 skip 按钮不等于就绪
2. 要求真实 `#auth-form` 唯一且可见
3. 要求真实 `.auth-panel [data-action="auth-toggle"]` 唯一且可见，并通过原生 `click(trial=True)` 验证可操作；trial 不发送点击
4. 只有上述检查全部通过才记录就绪，然后继续原来的实际注册点击和业务断言

没有捕获或吞掉任何超时；开场卡住、入口缺失/重复/禁用/被遮挡、页面关闭都继续失败并保留步骤证据。普通 `click`、`visible`、等待预算、注册后的业务检查没有放宽。步骤标题准确描述等待开场结束，不声称已点击跳过。没有修改品牌标识、视频、开场代码、财务公式或应用行为。选择正常自动结束可能为每个新上下文增加几秒等待。

## 已执行检查与边界

`tests/test_product_intro_readiness.py` 新增 13 项纯协议回归，覆盖正常结束、截图之间结束、进入时已结束、旧路径复现失败、卡住的开场、缺失/重复控件、禁用/遮挡入口、页面关闭，以及两条入口共用就绪检查。这些替身测试没有运行浏览器，不是新的原生 UI 验收。

已执行：

```text
../lidian-venv/bin/python -m pytest -q tests/test_product_intro_readiness.py tests/test_product_dialog_confirmation.py tests/test_product_first_use.py tests/test_product_audit_runner.py
66 passed, 1 warning, 3 subtests passed
```

66 个通过测试与 3 个通过 subtests 分别记录，不合并计数；新增 13 项已包含在 66 项中。上述两个脚本及新增测试的 `py_compile`、`git diff --check` 通过。警告为既有 Starlette TestClient/httpx 弃用提示。

修复后的原生行为仍待新提交的授权 Linux/Windows CI 验证；全量整合测试由独立执行记录承担。本记录没有运行本地浏览器或监听服务、没有绕过策略、没有外部供应商调用，也没有发布远程变更。
