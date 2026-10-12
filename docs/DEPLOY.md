# 启动、备份、迁移与发布

## 本机

README是主启动入口。GitHub 源码需先运行 `npm ci --ignore-scripts` 和 `npm run build`，再安装 Python 依赖并运行 scripts/start.py；独立发布包可包含编译前端。默认localhost8000，DATA_DIR默认.runtime/workbench。端口占用用--port8001，不要随意结束其他程序。虚拟环境缺依赖时安装到同一解释器，不修改系统Python或PowerShell策略。

scripts/start.py会读取项目根目录的`.env`（简单KEY=value格式，不执行命令或变量插值，已有shell环境变量优先）；`.env.example`只是模板，不会自动读取。升级时先核对旧`.env`的路径、源地址和模式，勿把真实配置提交Git。启动脚本不替你安装未知软件、不提升管理员权限、不修改防火墙、不创建隧道。Windows批处理第一次仍需按README安装环境。2026-09-27 在 Windows/Python3.12 验证了实际启动、在线备份和文件句柄关闭后的隔离测试目录清理；其他操作系统仍需各自验证。

## 备份

```powershell
.\.venv\Scripts\python.exe scripts/backup.py --source .runtime/workbench/lidian.sqlite3 --output private-backups/lidian-copy.sqlite3
```

使用SQLite backup API，避免只拷贝主库丢失WAL；拒绝覆盖目标，输出文件哈希并在完成副本上执行 integrity_check 与 foreign_key_check；目标旁已有 WAL/SHM/journal 或回执时拒绝，不接管或清理这些旧文件。备份包含业务数据、密码哈希与会话信息，不是公开导出文件，必须受控保存。不要把真实备份放Git、聊天或发布ZIP。

恢复时先停止服务，确认无第二进程、另存当前数据库和日志，使用经过integrity_check的备份在独立数据目录试启动；不要把旧备份与新目录遗留的-wal/-shm文件混放。切换DATA_DIR指向已验证副本。完整备份能恢复运行状态但会按重启策略中断旧任务，不重放付费调用。个人JSON导出没有自动覆盖还原功能。

## V3工作台副本迁移

先对实际V3 SQLite库使用backup，再复制到新私人目录；令DATA_DIR指向副本，用当前代码启动。原表结构保持，新增workspace_schema/workspace_objects/dataset_revisions/event_integrity/agent_artifacts以及adaptive_controls/adaptive_graphs/adaptive_checkpoints/adaptive_calls、adaptive_schema和修订触发器。没有可恢复的旧版本历史不会补造；原有事件仅首次迁移回填哈希，其身份是本地迁移一致性记录，不是当时第三方签名。

已有库高于程序认识的schema版本时拒绝写入；回退应使用迁移前备份，不推荐让更老程序继续写入新增结构。这个迁移仅针对前次Python工作台，**不支持获奖旧TypeScript项目数据库无损直迁**，更不导入旧.env或共享访问码。

## 公网前置门槛

默认不公开。APP_ENV=production要求HTTPS APP_ORIGIN与至少16字符REGISTRATION_CODE，否则启动拒绝。需要自己的TLS终止反向代理、访问控制、日志策略、补丁更新、备份恢复演练、供应商隐私合规判断及原生浏览器验收。不得使用多worker指向同一SQLite库；Docker部署模板保持一个应用进程，需要持久化/data，并自行配置uid10001可写权限。

Dockerfile是构建说明，本次未实际构建。GitHub Actions 的 Ubuntu、Windows 回归与依赖审计须以所使用的精确提交对应运行记录为准；本地候选、PR #2 的 feat/research-workbench-hardening 分支和 main 可能不同，先核对交付清单及实际提交，不把 PR 链接当作候选已发布的证明。此系统需要持久化 SQLite、单进程后台任务及 HTTPS 入口；公网部署应在适合这些约束的运行环境中独立验收。本次交付不以 Vercel 预览作为验收条件。

## 构建产物与托管契约（2026-10-09）

`npm run build` 只执行 TypeScript 编译，输出 `web/dist/*.js`。它不会生成 `dist/web`，也不会把 HTML、CSS 或品牌文件复制到一个独立静态站目录。完整运行时布局是：

- `web/index.html`：由 FastAPI 的 `/` 返回。
- `web/dist/*.js`、`web/*.css`、`web/brand/*`：由 FastAPI 的 `/assets` 挂载返回；首页脚本地址是 `/assets/dist/app.js`。
- `/images/logo.png`、`/loading-video.mp4`：原始品牌文件的兼容地址；视频需要保留 Range 分段响应。
- `/api/*`：同一 FastAPI 服务的账户、数据、计划、报告与事件接口。浏览器请求与 SSE 使用同源 Cookie；`/api/docs` 与 `/api/openapi.json` 也由该服务提供。

因此，将静态输出目录改为 `web/dist` 会缺少首页；改为 `web` 虽有首页，其 `/assets/*` 路径仍不对应普通静态目录，且不会出现 Python API。单独补静态路径重写也不能提供账户、数据库或后台执行。当前没有配置独立 API 代理或跨源 API 地址，不应把“静态页面部署成功”记为完整产品可用。

[Vercel 输出目录说明](https://vercel.com/docs/builds/configure-a-build)仅承诺静态提供所选目录内容。其[本地 SQLite 说明](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)明确指出函数实例没有共享的持久本地文件系统。当前程序还在应用 lifespan 中启动工作队列与定时跟踪，依赖同一存活进程；不能只把 ASGI 入口改成函数就保留这些运行语义。若未来选用该类运行环境，需要另外设计并验证存储、调度和凭据托管迁移，本轮不实施。

### 保留现有架构的最小运行方案

使用已获批准的常驻容器或服务器，在同一个 HTTPS 源下转发整个应用：

1. 保留现有多阶段 Dockerfile：Node 编译前端，Python 运行完整服务；启动入口固定为一个 `scripts/start.py` 进程。镜像包含 `scripts/backup.py`，不需要在运行中下载备份脚本。
2. 显式配置 `APP_ENV=production`、实际 HTTPS `APP_ORIGIN`、受控保存的至少16字符 `REGISTRATION_CODE`。不把真实值写入仓库、镜像或执行记录。
3. 将持久卷挂载到 `/data`，并确认应用用户 UID 10001 可读写。必须一起保留 `lidian.sqlite3`、SQLite 活跃侧文件及需要时生成的 `credentials.key`；`server.lock` 位于同目录，防止两个服务进程同时接管数据库。容器内部创建了 `/data` 不代表它已经持久化，挂载后权限也需重新核对。
4. 现有容器监听 `0.0.0.0`，端口读取 `PORT`（未设时为8000，显式 `--port` 优先）。反向代理保持 `APP_ORIGIN` 对应的 Host 和浏览器 Origin，将 `/`、`/assets/*`、`/api/*` 及品牌兼容地址一并转发，保留 Cookie、CSRF 请求头、Range 和 SSE 流。健康检查 `/api/health` 同样使用允许的 Host；不要通过关闭 Host/Origin 检查让错误入口变绿。
5. 当前启动器不信任 `X-Forwarded-*`，速率限制按实际连接来源计数。反向代理后的访问可能共享同一个限流桶；应在获准上线前实测代理拓扑与容量，不能假定已按真实终端 IP 隔离，也不要为此直接信任任意代理头。
6. 不启多 worker 或多副本，不让新旧版本重叠写同一数据库。升级前做应用一致性备份，停止旧进程后切换；已执行的外部请求未知结果不得因重启自动重发。

容器中的在线备份命令使用显式源路径，例如 `python scripts/backup.py --source /data/lidian.sqlite3 --output /private-backups/lidian-copy.sqlite3`。`/private-backups` 应是另行受控、应用用户可写的备份目标；不要使用静态目录。需要恢复私有模型连接时，再明确添加 `--include-key`，保护数据库、匹配密钥及备份回执。只有单独复制主库或保留容器层都不构成可靠备份。

恢复时，在已停止服务、保存现有数据且通过副本完整性核验后，把备份数据库放入新的受控目录并命名为 `DATA_DIR/lidian.sqlite3`；如备份含私有连接，将同一份备份配套的 `<备份数据库文件名>.credentials.key` 放入该目录并命名为 `DATA_DIR/credentials.key`。不要只切换到仍叫 `lidian-copy.sqlite3` 的目录，否则启动器会另建 `lidian.sqlite3` 空库。逐项核对数据库与原密钥匹配、无遗留 WAL/SHM/journal 混入、目录及数据库可由 UID 10001 访问和写入、密钥保持受限且应用可读；不要新建替代密钥或放宽权限给所有用户。最后以新 DATA_DIR 启动单进程，核对原账户、数据及历史报告后再切换入口。

仓库当前没有自动生效的 `render.yaml` 或已验证的 Render 资源声明；未启用的付费持久盘示例与免费边界见 [Render准备](RENDER_READINESS_20261010.md)。如果未来选择 Render，应先核对服务类型、持久盘、单实例、权限、Host 与健康检查，而不是创建静态站。[Render 持久盘文档](https://render.com/docs/disks)说明其默认文件系统是临时的，持久盘限付费服务且不能多实例，并会使更新短暂停机。这是候选适配边界，不是已选套餐、创建资源或部署成功记录。

具体还需核对两个平台入口约定：[Render 端口说明](https://render.com/docs/web-services#port-binding)的默认 `PORT` 为10000，启动器现已读取 `PORT`，容器不再固定覆盖；仍应在获准配置时核对实际平台端口与启动参数一致。[Render HTTP 健康检查](https://render.com/docs/health-checks)使用已验证自定义域名之一，否则使用服务的 `onrender.com` 域名，该 Host 必须与当前允许的 `APP_ORIGIN` 主机一致。未核对目标服务前，不假定平台自动选中的域名或端口已经匹配。

本地合同测试会从 Dockerfile 最终阶段的实际 COPY 指令暂存运行布局，执行其中的备份脚本，再用暂存的服务模块校验合成数据库和匹配密钥恢复。暂存器只接受已审的 `/app` WORKDIR 与 `.dockerignore` 规则集合，拒绝布局/忽略规则变化和缺少目录尾斜杠的多源 COPY；它不是通用 Docker 解析器。页面资源检查分别遍历首页 `app.js` 与 API 文档 `docs.js` 的 AST 依赖闭包。该测试使用本地已安装依赖，不执行 Docker 的 RUN、基础镜像拉取、UID/挂载或平台 TLS，因此不能替代真实镜像构建和目标环境验收。

2026-10-09 本地执行：普通构建通过；部署、启动、备份、鉴权、HTTP准入及发布定向合同共110项通过，源码 guard 无发现。旧 Docker COPY 布局实际暂存后缺少备份脚本，调用退出2；本轮只补入现有 `backup.py`。修后暂存运行布局的真实 Uvicorn/HTTP 路径、原品牌散列与视频 Range、空库注册/拒绝链、纯本地合成任务与 SSE、在线备份、新进程副本登录及数据/历史报告一致性通过。另在暂存服务模块中完成合成私有连接配对密钥恢复。HTTP探针对合成 Cookie 显式回放，不冒充浏览器 Secure/SameSite 或公网 TLS 验收；未构建真实镜像、配置托管资源、调用外部模型、推送或部署。该增量不替代最终整套及独立审查记录。

同日独审建议补强后，13项部署合同（含新增9项拒绝负例）重新通过；其余此前定向项与完整HTTP旅程未在此次仅测试/说明增量后重复运行。

### 常驻服务的启动、升级和回退操作

以下是沿用现有 Python/SQLite 架构的操作顺序，不创建托管资源、账户、生产密钥或真实业务数据。使用操作者已批准的常驻 Linux 服务或容器环境；源码只读放在版本目录，数据库和备份放在版本目录以外的持久路径。服务管理器应直接管理一个 `scripts/start.py` 前台进程，固定工作目录、解释器和环境；不要使用多 worker、双副本、计划任务反复启动或交互终端关闭后即退出的临时会话。

1. 核对本次源码清单与构建产物，使用同一虚拟环境安装 `requirements.txt`；记录 Python 和实际依赖版本。独立源码包已经包含 `web/dist`，从 Git 获取源码时仍按 README 构建。
2. 在服务的私有配置中明确设置 `APP_ENV=production`、批准的 HTTPS `APP_ORIGIN`、由操作者安全设置的注册邀请码和绝对 `DATA_DIR`。使用启动器读取的 `.env` 或服务管理器的环境文件；不把文件当 shell 脚本执行，不在命令行、日志、截图或报告中输出值。不要把文档占位符当作真实配置。
3. 确认持久目录及备份目录由运行身份拥有，数据库可写、原 `credentials.key` 可读且权限受限；目录不得在静态资源树中。第一次安装使用空目录，不能以合成测试库初始化真实工作区。已有数据必须先核对原库及密钥，不能因路径错误创建空库后误称迁移成功。
4. 由已有服务管理器运行以下形态的命令，替换为实际获准的版本目录和虚拟环境。它保持前台单进程，端口占用或生产配置缺失会拒绝启动，不结束其他进程。

   ```sh
   cd /srv/lidian/releases/已核对的版本目录
   /srv/lidian/venv/bin/python scripts/start.py --host 127.0.0.1 --port 8000
   ```

   同机 HTTPS 反向代理可使用这个回环监听。现有 Docker 命令监听容器内 `0.0.0.0:8000`，必须另由获准的容器网络和入口提供隔离。这里没有配置真实代理、证书、系统服务或网络权限。
5. 从批准的 HTTPS 源检查 `/api/health`、首页和品牌/脚本资源，再做新建空工作区、登录、正常关闭/重登及 SSE 验证。内部健康探测必须保留允许的 Host；不要用 `--insecure`、任意 Host 放行或取消 Secure Cookie 来代替入口配置。健康接口返回正常只证明进程可响应，不能代替后台执行、备份和业务核对。
6. 上线前用显式合成、独立目录完成一次在线备份及恢复演练；实际备份使用本节前述 `backup.py` 命令和拒绝覆盖约束。含私有连接时同时保护配对密钥。停止恢复目标进程后按准确的 `lidian.sqlite3`/`credentials.key` 文件名恢复，核对回执散列、库完整性、账户和历史报告；不让两个服务指向同一个 DATA_DIR。
7. 升级前保存旧版本、数据库一致性备份、匹配密钥和私有配置引用。停止旧进程并确认退出后，用新版本接管同一持久目录。`server.lock` 是单进程保护，不应为绕过拒绝而删除；先排除仍在运行的旧进程。后台工作队列与每60秒的本地跟踪都属于应用 lifespan，只有该服务持续存活时才运行。
8. 出现问题时先停止新版本并保留其数据和日志，使用升级前备份与匹配密钥恢复到另一个已验证目录，再启动旧版本。不能通过降低 schema 数字或让旧程序继续写新库实现回退。重启后的未知外部请求不得自动重放；需要按现有暂停/继续和授权流程处理。

### 当前 R9 配置与验证边界（2026-10-09）

最新范围见 [2026-10-09 验收记录](VALIDATION.md)：冻结 R9 原 550 文件树的完整本地验收为 4625 项后端、1174 项前端和 18 组真实 HTTP 链；后续同树复核新跑的是 324 项定向后端、1174 项前端和 18 组真实 HTTP 链，未重跑完整后端。本次仅三份文档增量，生产源码与冻结 R9 一致；文档增量后的全树不是旧完整验收的精确树。以下 R4 结果及发布配置沿革保留其历史范围。

2026-10-09 的 R4 业务源码在 Python 3.13.5、精确8项运行依赖、Node 22.23.3 下完成一次全新的七阶段验收：4416个后端用例及3条子断言、1152项前端、18组真实 HTTP/SSE/重启/备份链。原品牌字节保持，真实供应商调用为0。独立浏览器检查仅覆盖当次明确记录的跟踪流程，不等于全部原生 CI。

本轮发布配置增量只把18个原生任务的显式源码树 pin 更新到已审的实际 web/server 树，并在 `vercel.json` 中对 main 与 feat/research-workbench-hardening 分别声明 `deploymentEnabled: false`。根据 [Vercel Git 配置说明](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled)，未指定分支默认启用，匹配的 true 规则可以覆盖 false；因此不添加 `*: true` 等规则。该文件在本地存在不代表远端项目已经停用部署，必须在发布前核对实际目标版本和平台结果。

Linux L9 的既有地域访问拒绝记录和非通过状态保持，业务断言、录像/trace、操作系统矩阵及预算未取消。当前没有对受拒资源重新下载、代理或换地区重试；已有 Chrome 也不能自动提供 Playwright 所需的录像组件。实际 Docker 镜像、当前 Windows 与完整原生矩阵、真实 HTTPS/持久盘环境及长期运行仍需对应环境验收。静态配置修复和本地通过不会自动完成这些条件；在这些前置未满足前，不为得到绿色结果跳过检查或触发已知失败 CI。

## 外部服务

环境变量名见.env.example；配置后重启。模型ID应为自己账户确实可用的名称。先用无敏感数据的批准计划验证实际服务和费用，确认输出协议；无法连接会返回明确失败/受限；只有事先披露并批准的候补、明确HTTP429与剩余累计预算同时满足时才切换，未知结果不重发。对外搜索只在用户逐次同意后发生。

## 仓库

保留比赛原提交，不强推 main。远程状态以实际 Git 推送回执和提交 SHA 为准；本机通过不代表 GitHub CI 或生产部署通过。正式申请材料须来自最终核定的程序版本，不混用旧截图或过往测试结论。

## 保存企业对照的版本保护

基础数据库版本仍为 3，工作区扩展版本为 3。新增对照使用现有工作区对象表，没有重建财务表；扩展标记阻止旧应用忽略新增多企业批准范围后继续写入或执行。升级前先备份实际 DATA_DIR，并在独立副本验证；回退使用升级前备份和匹配密钥，不修改 schema 数字，也不承诺把升级后的新记录自动回灌旧库。
