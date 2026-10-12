# 锂电智诊：单机 HTTPS 安装、重启和恢复

这是待审核部署模板，不代表已经安装 systemd、设置网络或部署服务器。只支持单进程 SQLite 和持久本地目录，不包含 PostgreSQL 适配器。

## 最简安装

先核验源码包 SHA256 和逐文件 manifest。保留现有版本，不覆盖旧工作区或数据。
以独立应用账户在 `/srv/lidian/current` 解包，使用 Python 3.13：

```sh
python3.13 -m venv /srv/lidian/venv
/srv/lidian/venv/bin/python -m pip install -r /srv/lidian/current/requirements.txt
```

完整发布包带编译 JS，无需在线安装 Node。开发或重建时使用 Node >=22、`npm ci && npm run build`。
先在独立空目录本机验收，再接生产数据库。运行账户需独占并能写入 DATA_DIR；目录 0700，数据库、WAL/SHM、锁和 key 0600。不要把密钥打印到终端或粘贴进报告。

## 生产环境配置

环境变量由用户在服务器安全配置，不提交 Git，不包含在发布 ZIP：

```text
APP_ENV=production
APP_ORIGIN=https://你的实际域名
DATA_DIR=/var/lib/lidian
REGISTRATION_CODE=由用户设置的至少16位邀请码
SERVER_AI_ENABLED=false
SERVER_AI_BASE_URL=
SERVER_AI_MODEL=
SERVER_AI_API_KEY=
TAVILY_API_KEY=
```

`APP_ORIGIN` 必须是精确 HTTPS 源，若使用非标准端口需含端口。AI 为空时本地业务继续工作；外部调用须另行保存账户私有连接并逐次确认计划。不得把测试凭据当生产凭据。

```sh
/srv/lidian/venv/bin/python /srv/lidian/current/scripts/start.py --host 127.0.0.1 --port 8000 --trusted-local-proxy
```

该显式开关只允许生产模式、127.0.0.1 绑定，并固定只信任 peer 127.0.0.1。默认关闭；不接受 `*`、任意 CIDR 或环境变量扩大信任。所有同机可直连进程必须可信，nginx 必须覆盖 X-Forwarded-For 为实际 `$remote_addr`，不能追加客户端伪造值。
此方案不适用于容器 bridge、Render 或异机代理；不能直接照搬开启。应用端口不能对公网直连。

`deploy/native-vm/nginx.conf.example` 是同机模板：替换域名和真实证书，保留默认 Host 拒绝、原 Host 传递、SSE 不缓冲、上传限制与超时。生产证书需浏览器正常信任；不得跳过证书警告。
按 IP 限流：认证端点 30 次/分钟、普通 API 600 次/分钟。多个用户共用 NAT 仍共用该 IP 桶，这不是按账户独立限流，也不是供应商计费上限。

## 重启与监控

`deploy/native-vm/lidian.service.example` 仅模板。需管理员审核并安装，当前未操作。始终单实例，禁止多个 worker 或同数据库双服务。Restart=on-failure 限制短时重启次数；失败先读脱敏日志。
`RequiresMountsFor` 需要真实持久盘及正确挂载配置，不能把同名空目录误当已挂载数据盘。应由主机安装流程检查实际挂载点和预计设备标识，失败不启动。
`GET /api/health` 仅证明请求/数据库健康，不证明 key 正确、供应商连通或业务恢复完成。进程重启会把未完成任务标为中断；未知外部调用不能自动重发，须在界面审阅恢复状态。

## 在线备份

```sh
/srv/lidian/venv/bin/python scripts/backup.py --source /var/lib/lidian/lidian.sqlite3 --output /安全独立备份目录/日期.sqlite3 --include-key
```

保留命令生成的完整收据和配套 key。数据库包含业务与身份数据，key 可解密私有 AI 凭据；备份对需要用户批准的加密离机存储，不能上传公开 Git/附件。不要直接拷贝活动数据库文件代替 SQLite online backup。缺失/错误 key 时应失败，不能自动生成新 key 掩盖问题。

## 恢复与回退

1. 停止或隔离待替换实例，保留原数据库、key、代码与失败日志；不要覆盖唯一副本。
2. 在独立空恢复目录核验收据 hash、SQLite integrity_check 和 foreign_key_check；配套数据库和 key 必须来自同次备份。
3. 将数据库复制为 `lidian.sqlite3`、配套 key 为 `credentials.key`；按原运行账户设置目录 0700、文件 0600。这是服务器管理员操作步骤，不是此审计已修改系统权限。
4. 在新目录再次执行 `backup.py --include-key`，确认全部私有连接可解密。使用同一源码版本、隔离端口、正确 HTTPS 入口启动。核对账户、数据版本/hash、已冻结报告以及中断任务，不重复未知外部调用。
5. 经用户确认再切换正式入口；失败时停新实例并回到保留的旧代码/数据对。不得双写或直接在唯一旧副本上试迁移。

## 本地协议验收

`scripts/tls_proxy_check.py --nginx <可信官方二进制> --output <独立证据目录>` 使用临时合成数据库、自签临时证书和客户端显式信任该证书，不修改全局 trust store、不绕过浏览器警告。它验证同机 TLS/HTTP/SSE/重启/备份，不代表真实服务器重启或原生浏览器验收。
`python scripts/verify.py --full-chain` 是完整本地回归；所有报告必须绑定实际新候选 SHA，历史报告不能冒充本轮结果。
