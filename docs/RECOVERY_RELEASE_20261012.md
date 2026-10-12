# 2026-10-12 源码恢复与交付边界

## 版本来源

本轮执行环境丢失了此前同日未上传的候选与测试文件；不能将此前的 844a04bb 或 4732 测试结果归给本轮源码。
本轮从已交付 Library v8 的完整 manifest 逐项验证恢复 556 文件，并保留远端候选分支的 178 份其他历史文件。
恢复后的基线 Git tree 精确为 `02496dc63abaf765b688b1fd7f2652f9420ae22c`，与旧 bf5 基线 tree 相同；恢复提交为新生成的 `61fac1b`，不是旧历史提交。
本轮后续修复通过新提交和新的验证收据交付。历史 evidence 保持原样，不能代表当前代码通过。

## 重新构建的保护

- 有限输入仍可能产生不可表示比值；在每一个可查询季度截面上预检同/环比，拒绝 overflow、非零 underflow 和不可编码结果。保留原始历史数据与正常公式，不设任意最小金额、不静默截断。
- 使用实际恢复 v8 的旧 `server/models.py` 先生成 400 组计算输出，再运行改后代码逐字比较。两者 SHA256 均为 `b1e6f3e880eda90cfa7a67410f34c47f0b0a551af893f47205fa682d52b952bf`。GMPS/DQI 公式段逐字一致。这只保障兼容性，不证明模型经验准确度。
- Host authority 在 URL 构造前检查 ASCII、端口和完整格式。TrustedHost、CSRF、会话和账户权限不放宽。
- 可信代理为显式同机选项，默认关闭、固定 peer 127.0.0.1、仅生产/回环绑定。不能用于任意容器代理，也不受环境通配符扩大。
- 四种真实 dispatch 崩溃边界、实际 TLS/SSE/注销/不同源 IP 限流、备份和私有 key 故障，使用隔离合成数据验证。报告分别标明传输方式和模拟供应商，零真实模型调用。

## 部署架构

需要持久本地 SQLite 数据目录和配套私有凭据 key，单进程服务。免费临时文件系统无法满足耐久要求；不删除持久化保护或业务以适配免费运行。具体主机及其收费/限制须由用户选择后核实。
最简安装、原生同机 HTTPS 与备份恢复见 `NATIVE_VM_TLS_RUNBOOK.md`。Docker 声明 Python 3.13、Node 22；本轮以隔离相应工具链验证源码，但未实际构建/启动 Docker 容器，不能将直接运行等同容器通过。

## 推送副作用与安全同步

读取到的远端 main 为 `cdca0052a23273efb4366ca204b0d9bac40da2a5`，候选分支 `feat/research-workbench-hardening` 为 `6c108b438dbb223e630ccd9521dd6edfaf33da7d`；新恢复源码尚未推送。
仓库是公开仓库。`.github/workflows/ci.yml` 的 push、pull_request、workflow_dispatch 均可触发；共有 19 组 Linux/Windows 作业和一个依赖审计，即 39 作业。只有内容读取权限，源码中未发现部署或收费资源创建步骤。
GitHub 公共仓库标准托管 runner 时间免费，但 artifact/cache 存储配额、账户计费配置、外部 webhook 或 Render 自动部署不能仅由仓库文件排除。推送前需核对连接服务。
官方计费说明：https://docs.github.com/en/billing/concepts/product-billing/github-actions

不要使用 `scripts/publish.py --confirm` 同步本轮版本。该脚本会在临时克隆删除旧 tracked tree 再按过滤规则替换，可能移除原历史证据，并会推远端分支。
用户目标为最终只保留 main。本轮已核对 main 是 6c 候选祖先，main 独有提交 0、6c 独有提交 56；恢复提交的父为 6c。因此在远端未变化的前提下，新提交可通过普通非 force fast-forward 整合到 main，完整保留历史。实际同步须获得授权并先重新读取远端和外部自动部署配置；若 main 已前进，先重新审阅差异，不盲推。核对远端 SHA 后再等待该 SHA 的 CI；远端 SHA 相同不等于 CI 通过。旧分支删除另行确认，不能当源码同步的隐含副作用。发布包/patch 都不是已发布证明。

## 未完成或未验证的部署事项

真实公网域名与证书、真实服务器/系统重启、实际 Docker、长期负载、跨设备浏览器、真实国内 API 凭据与供应商网络仍需后续验收。
本轮默认原生 Chromium 实际启动受环境 Unix socket 权限限制；没有修改系统安全设置或绕过 TLS 警告。协议/API/DOM 测试都不能冒充原生浏览器通过。
