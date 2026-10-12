# Render 与可选基础 AI 准备（2026-10-10）

## 免费是否可行

当前版本可以作为完整 Python Web Service 运行，不能作为纯静态站运行。但免费 Render **不适合保存这个版本的真实业务数据**。

已核对 [Render 免费实例说明](https://render.com/docs/free) 与 [持久盘说明](https://render.com/docs/disks)：免费 Web Service 无法挂持久盘，休眠、重启、重新部署会丢本地文件。当前 DATA_DIR 同时保存 SQLite 账户/业务/历史、后台状态以及私有连接的匹配主密钥；仅设置 DATA_DIR 不会使它耐久。免费 Postgres 有30天到期限制，且本程序没有 Postgres 存储适配，填 DATABASE_URL 不能完成迁移。

因此没有发布可一键启用的免费生产模板。若以后只做可丢弃的空数据试验，必须事先明确允许丢失所有内容，不导入真实企业数据、不保存个人模型凭据、不把该实例当备份或持续跟踪服务；本轮没有创建此实例，也没有验收免费运行。未来如坚持免费长期使用，需另行设计外部持久存储、密钥托管和持久调度，并测试迁移/恢复；不是更改一个套餐字段即可实现。

## 保持现有存储结构

`deploy/render.persistent.yaml.example` 是未启用的 **付费 Web Service + 付费持久盘** 审阅示例，自动部署关闭；不是已经购买或部署。使用前需核对价格、费用授权和实际服务配置。仓库仍无自动生效的根目录 render.yaml。

1. 单进程运行 Dockerfile；已让启动器读取 PORT（未设默认8000），显式 --port 优先，环境文件中的 PORT 同样可用。容器不再固定覆盖平台 PORT。
2. 私下配置 HTTPS APP_ORIGIN 与至少16字符 REGISTRATION_CODE。APP_ORIGIN 必须对应真实健康检查 Host；不放宽 Host/CSRF/Origin 检查。反向代理头仍不自动信任。
3. 持久盘覆盖整个 /data，确认 UID 10001 可写。只挂数据库文件而丢 credentials.key 无法恢复私有连接。运行备份、匹配密钥恢复、升级/停机演练后才可接收真实数据。
4. 原品牌和完整 web 运行布局不变；所有路由、Cookie、SSE、Range 同源转发。没有更换 Logo、开场视频或加入业务样例。

## 可选基础 AI 环境变量

`.env.example` 的四项是实际支持的配置，不是空占位接口：

- SERVER_AI_ENABLED：仅 true（不区分大小写）启用检查，默认 false。
- SERVER_AI_BASE_URL：用户选定的已核对国内官方 HTTPS 接口，限下列精确路由，支持写完整 /chat/completions；拒绝境外网关/其他域名/其他路径。
- SERVER_AI_MODEL：该账户确实可用的模型名，不提供预设。按域名分别限 deepseek、qwen、mimo 家族；阿里入口本轮仅支持千问，不允许经该国内入口选国外厂商模型。
- SERVER_AI_API_KEY：仅由部署者在私密环境设置中填写，不提交 Git、截图、报告或聊天。

官方接口白名单（2026-10-10查阅）：[DeepSeek](https://api-docs.deepseek.com/) 的 https://api.deepseek.com 或 /v1；[千问北京](https://help.aliyun.com/zh/model-studio/beijing-access-information) 的 https://dashscope.aliyuncs.com/compatible-mode/v1；[小米MiMo](https://platform.xiaomimimo.com/docs/en-US/usage-guide/passing-back-reasoning_content) 的 https://api.xiaomimimo.com/v1。千问国际/美国/Hong Kong入口均未放行。为避免强制思考模型增加成本，智谱本轮不进入基础站点白名单；原私有连接不受此新增配置限制。此名单约束官方服务入口，不承诺由程序证明供应商每次请求的物理处理地点；模型保持手填，选型时再核对最新低价产品及账户可用性。原有私有BYOK连接不改写或删除。

配置后重启。关闭、缺项或格式不合法时，不注册 server_ai，基础应用、本地数学工具和原有账户私有连接继续运行。若“身份与连接”没有出现部署方共享连接，先在私密设置界面核对四项；没有配置成功或真实连通的推断。填齐不表示供应商兼容或免费。

完整配置会显示 server_ai（部署方共享），不会默认取代个人连接，也不会自动补到空账户的默认模型。必须在模型选择中显式选择它；研究预览、外发范围、逐次批准、调用预算、dispatch guard、固定公共地址的 HTTPS 传输和超时仍沿用现有代码。接口不返回密钥；连接列表和计划外发批准范围披露供应商域名/路径和模型，便于核对接收方。任何进程重启会生成新配置版本，已有该共享连接的旧批准必须重新预览；未知外部结果不能重发。个人连接及其版本不变。

基础站点调用DeepSeek显式 thinking.type=disabled，千问显式 enable_thinking=false，小米沿用 thinking.type=disabled 和 max_completion_tokens=1000。千问也用 max_completion_tokens=1000（不同时发送旧 max_tokens），DeepSeek max_tokens=1000；不自动更换不兼容模型，不增加原计划上限。这些是协议夹具验证，不是已连通承诺。官方参数：[DeepSeek](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)、[千问](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions)、[小米](https://mimo.mi.com/docs/zh-CN/api/chat/openai-api)。

共享基础 AI 同一进程跨所有账户最多预留100次调用（失败/取消不返还），与所有连接合计最多8个在途传输；每次输出仍限制1000 token预算。达到总量后拒绝新共享调用，需部署者处理；重启会重置这个进程内限额，因此它不是持久计费账本。仅支持单实例，部署者还必须在供应商侧设置硬预算。共享基础 AI 的费用由部署者承担，任何获准登录该部署的账户都可能显式选用它；不要在不接受此范围时启用。未改变后台任务为自动调用 AI，未真实请求外部供应商。检查供应商数据政策与费用后，使用无敏感内容的新批准计划验证。

## 验证仍有边界

本轮结果记录见 `RENDER_AI_VALIDATION_20261010.md`。本地协议/回归、完整HTTP链与原生浏览器是不同证据。L9 Linux Playwright 官方下载此前遭地域403拒绝，仍为 blocked，不重试受拒下载、不换镜像/代理、不跳过或弱化门禁。合法剩余路径是由有权限的管理员/供应商解决官方下载可用性后，在获准环境重新执行精确候选的完整矩阵；不能把已有 Chrome 或 DOM 桥接当作 Playwright 全矩阵通过。Docker镜像、Windows原生、公网HTTPS/Render健康检查、持久盘及真实供应商仍需各自实际验收。
