# 启动、备份、迁移与发布

## 本机

README是主启动入口。GitHub 源码需先运行 `npm ci --ignore-scripts` 和 `npm run build`，再安装 Python 依赖并运行 scripts/start.py；独立发布包可包含编译前端。默认localhost8000，DATA_DIR默认.runtime/workbench。端口占用用--port8001，不要随意结束其他程序。虚拟环境缺依赖时安装到同一解释器，不修改系统Python或PowerShell策略。

启动脚本不自动读.env，不替你安装未知软件、不提升管理员权限、不修改防火墙、不创建隧道。Windows批处理第一次仍需按README安装环境。2026-09-27 在 Windows/Python3.12 验证了实际启动、在线备份和文件句柄关闭后的隔离测试目录清理；其他操作系统仍需各自验证。

## 备份

```powershell
.\.venv\Scripts\python.exe scripts/backup.py --source .runtime/workbench/lidian.sqlite3 --output private-backups/lidian-copy.sqlite3
```

使用SQLite backup API，避免只拷贝主库丢失WAL；拒绝覆盖目标，输出文件哈希并执行integrity_check。备份包含业务数据、密码哈希与会话信息，不是公开导出文件，必须受控保存。不要把真实备份放Git、聊天或发布ZIP。

恢复时先停止服务，确认无第二进程、另存当前数据库和日志，使用经过integrity_check的备份在独立数据目录试启动；不要把旧备份与新目录遗留的-wal/-shm文件混放。切换DATA_DIR指向已验证副本。完整备份能恢复运行状态但会按重启策略中断旧任务，不重放付费调用。个人JSON导出没有自动覆盖还原功能。

## V3工作台副本迁移

先对实际V3 SQLite库使用backup，再复制到新私人目录；令DATA_DIR指向副本，用当前代码启动。原表结构保持，新增workspace_schema/workspace_objects/dataset_revisions/event_integrity/agent_artifacts以及adaptive_controls/adaptive_graphs/adaptive_checkpoints/adaptive_calls、adaptive_schema和修订触发器。没有可恢复的旧版本历史不会补造；原有事件仅首次迁移回填哈希，其身份是本地迁移一致性记录，不是当时第三方签名。

已有库高于程序认识的schema版本时拒绝写入；回退应使用迁移前备份，不推荐让更老程序继续写入新增结构。这个迁移仅针对前次Python工作台，**不支持获奖旧TypeScript项目数据库无损直迁**，更不导入旧.env或共享访问码。

## 公网前置门槛

默认不公开。APP_ENV=production要求HTTPS APP_ORIGIN与至少16字符REGISTRATION_CODE，否则启动拒绝。需要自己的TLS终止反向代理、访问控制、日志策略、补丁更新、备份恢复演练、供应商隐私合规判断及原生浏览器验收。不得使用多worker指向同一SQLite库；Docker部署模板保持一个应用进程，需要持久化/data，并自行配置uid10001可写权限。

Dockerfile是构建说明，本次未实际构建。GitHub Actions 的 Ubuntu、Windows 回归与依赖审计须以最终 main 提交对应的运行记录为准；这不代表公网部署成功。此系统需要持久化 SQLite、单进程后台任务及 HTTPS 入口；公网部署应在适合这些约束的运行环境中独立验收。本次交付不以 Vercel 预览作为验收条件。

## 外部服务

环境变量名见.env.example；配置后重启。模型ID应为自己账户确实可用的名称。先用无敏感数据的批准计划验证实际服务和费用，确认输出协议；无法连接会返回明确失败/受限；只有事先披露并批准的候补、明确HTTP429与剩余累计预算同时满足时才切换，未知结果不重发。对外搜索只在用户逐次同意后发生。

## 仓库

保留比赛原提交，不强推 main。远程状态以实际 Git 推送回执和提交 SHA 为准；本机通过不代表 GitHub CI 或生产部署通过。正式申请材料须来自最终核定的程序版本，不混用旧截图或过往测试结论。
