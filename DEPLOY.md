# 锂电池企业智能诊断系统 - 部署方案

本文档提供三种部署方式，按推荐程度排序。请根据你的服务器环境和实际需求选择。

---

## 方案A：Docker Compose 部署（推荐）

最简单、最可靠的方式。一条命令完成构建和启动，Nginx 反向代理、Basic Auth 认证、SSE 流式传输全部自动配好。

### 前置条件

| 条件 | 说明 |
|------|------|
| Docker | 已安装 Docker Engine 20.10+ |
| Docker Compose | 已安装 Docker Compose V2（`docker compose` 命令可用） |
| 内存 | 至少 2GB |
| 端口 | 80 端口未被占用且已开放 |
| API Key | 至少拥有 DeepSeek / GLM / Qwen 三者之一的 API Key |

### 部署步骤

#### 1. 上传项目到服务器

```bash
# 方式一：通过 Git 克隆（如果项目在仓库中）
git clone <你的仓库地址> /opt/battery-diagnostic
cd /opt/battery-diagnostic

# 方式二：通过 scp 上传本地项目
scp -r ./battery-diagnostic root@你的服务器IP:/opt/battery-diagnostic
```

#### 2. 创建 .env 文件

```bash
# 从模板复制
cp .env.example .env

# 编辑 .env，填写 API Key（三选一，必填）
nano .env
```

**最简 .env 配置示例：**

```env
NODE_ENV=production
PORT=3001
CORS_ORIGIN=*

# 三选一，填写你拥有的 API Key
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
```

> ⚠️ `CORS_ORIGIN=*` 表示允许所有来源访问，适用于内网部署。如果是公网部署，建议改为具体域名或 IP。

#### 3. 可选：修改访问密码

项目默认的 Basic Auth 密码是占位符，**必须修改**才能正常登录：

```bash
# 安装 htpasswd 工具（如果没有）
# Ubuntu/Debian:
apt-get install apache2-utils
# CentOS/RHEL:
yum install httpd-tools

# 生成新的密码文件（用户名 admin，会提示输入密码）
htpasswd -c deploy/.htpasswd admin

# 如果要添加更多用户（不加 -c，否则会覆盖）：
htpasswd deploy/.htpasswd another_user
```

#### 4. 启动服务

```bash
docker-compose up -d --build
```

首次启动需要构建镜像，大约需要 3-5 分钟。构建完成后，Docker 会自动启动应用和 Nginx 两个容器。

#### 5. 验证部署

```bash
# 检查容器状态（两个容器都应该是 healthy）
docker-compose ps

# 查看应用日志
docker-compose logs -f app

# 测试健康检查接口（无需认证）
curl http://localhost/api/health
```

浏览器访问 `http://服务器IP`，输入 Basic Auth 用户名和密码即可使用。

### 常用命令

```bash
# 启动（后台运行）
docker-compose up -d

# 停止所有容器
docker-compose down

# 查看实时日志
docker-compose logs -f

# 只看应用日志
docker-compose logs -f app

# 只看 Nginx 日志
docker-compose logs -f nginx

# 重新构建并启动（代码更新后）
docker-compose up -d --build

# 重启单个服务
docker-compose restart app

# 进入应用容器调试
docker-compose exec app sh

# 查看容器资源占用
docker stats battery-diagnostic-app battery-diagnostic-nginx
```

### 数据持久化

Docker Compose 配置了 `app-data` 卷，挂载到容器内的 `/app/.runtime` 目录，用于存储运行时缓存和平台数据。即使容器重建，数据也不会丢失。

```bash
# 查看卷位置
docker volume inspect battery-diagnostic_app-data
```

---

## 方案B：手动部署（VPS/云服务器）

适用于不想使用 Docker，或需要更精细控制服务器的场景。

### 前置条件

| 条件 | 说明 |
|------|------|
| 操作系统 | Ubuntu 20.04+ / CentOS 7+ / Debian 11+ |
| Node.js | 20.x（必须，低于 20 可能无法运行） |
| 内存 | 至少 2GB |
| Nginx | 1.18+（用于反向代理和静态文件服务） |
| PM2 | 用于进程守护（推荐） |

### 部署步骤

#### 1. 安装 Node.js 20

```bash
# Ubuntu/Debian - 使用 NodeSource 仓库
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS/RHEL - 使用 NodeSource 仓库
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# 验证版本
node -v   # 应显示 v20.x.x
npm -v    # 应显示 10.x.x
```

#### 2. 上传项目代码

```bash
# 创建项目目录
sudo mkdir -p /opt/battery-diagnostic
cd /opt/battery-diagnostic

# 上传代码后，确保文件权限正确
sudo chown -R $USER:$USER /opt/battery-diagnostic
```

#### 3. 安装依赖

```bash
cd /opt/battery-diagnostic
npm ci
```

> 💡 `npm ci` 比 `npm install` 更适合部署场景，它会严格按照 package-lock.json 安装，确保依赖版本一致。

#### 4. 创建 .env 文件

```bash
cp .env.example .env
nano .env
```

修改以下关键配置：

```env
NODE_ENV=production
PORT=3001
CORS_ORIGIN=http://你的域名,http://你的服务器IP

# 必填：三选一
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
```

#### 5. 构建项目

```bash
npm run build
```

此命令会依次执行：
1. `vite build` — 编译前端 React 项目到 `dist/web`
2. `tsc -p tsconfig.server.json` — 编译后端 TypeScript 到 `dist/server`

构建完成后，确认产物存在：

```bash
ls dist/web/index.html          # 前端入口
ls dist/server/server/index.js  # 后端入口
```

#### 6. 安装 PM2 并启动

```bash
# 全局安装 PM2
sudo npm install -g pm2

# 启动应用
pm2 start dist/server/server/index.js --name battery-diagnostic

# 查看状态
pm2 status

# 查看日志
pm2 logs battery-diagnostic
```

#### 7. 设置开机自启

```bash
# 生成开机启动脚本
pm2 startup

# 执行上面命令输出的 sudo 命令（通常是类似下面的内容）
# sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp /home/$USER

# 保存当前进程列表
pm2 save
```

#### 8. 配置 Nginx 反向代理

```bash
# 安装 Nginx
# Ubuntu/Debian:
sudo apt-get install -y nginx
# CentOS/RHEL:
sudo yum install -y nginx

# 创建配置文件
sudo nano /etc/nginx/conf.d/battery-diagnostic.conf
```

将以下内容写入配置文件：

```nginx
upstream battery_app {
    server 127.0.0.1:3001;
}

server {
    listen 80;
    server_name 你的域名或IP;

    client_max_body_size 10m;

    # 可选：Basic Auth 认证（取消注释即可启用）
    # auth_basic "Battery Diagnostic System - Authorized Access Only";
    # auth_basic_user_file /etc/nginx/.htpasswd;

    # 前端静态文件和 API 都由 Node.js 服务处理
    location / {
        proxy_pass http://battery_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # SSE 流式传输 - 企业诊断流
    location /api/enterprise/stream {
        proxy_pass http://battery_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_cache off;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        chunked_transfer_encoding on;
    }

    # SSE 流式传输 - 投资者分析流
    location /api/investor/stream {
        proxy_pass http://battery_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_cache off;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        chunked_transfer_encoding on;
    }

    # 健康检查（无需认证）
    location /api/health {
        auth_basic off;
        proxy_pass http://battery_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```

启用配置并重启 Nginx：

```bash
# 测试配置是否正确
sudo nginx -t

# 如果启用了 Basic Auth，生成密码文件
sudo htpasswd -c /etc/nginx/.htpasswd admin

# 重启 Nginx
sudo systemctl restart nginx

# 设置 Nginx 开机自启
sudo systemctl enable nginx
```

#### 9. 验证部署

```bash
# 检查应用是否运行
pm2 status

# 检查健康接口
curl http://localhost:3001/api/health

# 通过 Nginx 访问
curl http://localhost/api/health
```

浏览器访问 `http://服务器IP` 即可使用。

### PM2 常用命令

```bash
# 启动
pm2 start dist/server/server/index.js --name battery-diagnostic

# 重启
pm2 restart battery-diagnostic

# 停止
pm2 stop battery-diagnostic

# 删除进程
pm2 delete battery-diagnostic

# 查看日志
pm2 logs battery-diagnostic

# 查看实时日志（最近 100 行）
pm2 logs battery-diagnostic --lines 100

# 查看进程详情
pm2 describe battery-diagnostic

# 监控面板
pm2 monit
```

### 更新部署

当代码更新后，执行以下步骤：

```bash
cd /opt/battery-diagnostic

# 拉取最新代码（如果是 Git 管理）
git pull

# 重新安装依赖（如果 package.json 有变化）
npm ci

# 重新构建
npm run build

# 重启应用
pm2 restart battery-diagnostic
```

---

## 方案C：Windows 本地部署（局域网分享）

最简单的方式，适合在本地电脑上运行，让局域网内的同事或朋友访问。

### 前置条件

| 条件 | 说明 |
|------|------|
| 操作系统 | Windows 10/11 |
| Node.js | 20.x |
| 网络 | 与访问者处于同一局域网 |

### 部署步骤

#### 1. 安装 Node.js 20

1. 访问 [Node.js 官网](https://nodejs.org/) 下载 LTS 版本（v20.x）
2. 运行安装程序，一路 Next 即可
3. 打开 PowerShell 验证：

```powershell
node -v   # 应显示 v20.x.x
npm -v    # 应显示 10.x.x
```

#### 2. 进入项目目录

```powershell
cd "C:\你的路径\面向锂电池企业毛利承压与经营质量变化的智能诊断系统"
```

#### 3. 安装依赖

```powershell
npm ci
```

#### 4. 配置环境变量

```powershell
# 复制模板
copy .env.example .env

# 用记事本编辑
notepad .env
```

修改以下内容：

```env
NODE_ENV=production
PORT=3001
CORS_ORIGIN=*

# 必填：三选一
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
```

> ⚠️ `CORS_ORIGIN` 必须改为 `*`，否则局域网其他设备无法访问。

#### 5. 构建项目

```powershell
npm run build
```

等待构建完成，应看到类似输出：

```
vite v6.x.x building for production...
✓ xx modules transformed.
dist/web/index.html                  0.xx kB │ gzip: 0.xx kB
...
```

#### 6. 启动服务

```powershell
node dist/server/server/index.js
```

看到类似输出表示启动成功：

```
Server running on port 3001
```

#### 7. 局域网访问

1. 查看本机 IP 地址：

```powershell
ipconfig
# 找到 "IPv4 地址"，例如 192.168.1.100
```

2. 局域网内其他设备访问：`http://192.168.1.100:3001`

3. 本机也可以访问：`http://localhost:3001`

### Windows 防火墙设置

如果局域网其他设备无法访问，需要开放 3001 端口：

**方式一：通过 PowerShell（管理员权限）**

```powershell
# 添加防火墙入站规则
New-NetFirewallRule -DisplayName "Battery Diagnostic System" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
```

**方式二：通过图形界面**

1. 打开"Windows Defender 防火墙"
2. 点击"高级设置"
3. 选择"入站规则" → "新建规则"
4. 选择"端口" → "TCP" → 特定本地端口输入 `3001`
5. 选择"允许连接"
6. 勾选所有网络配置文件
7. 名称填"Battery Diagnostic System"

### 后台运行（可选）

直接运行 `node dist/server/server/index.js` 时，关闭 PowerShell 窗口服务就会停止。如果想让服务在后台持续运行：

**方式一：使用 PM2**

```powershell
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start dist/server/server/index.js --name battery-diagnostic

# 查看状态
pm2 status

# 查看日志
pm2 logs battery-diagnostic

# 设置开机自启（需要额外安装 pm2-windows-startup）
npm install -g pm2-windows-startup
pm2-startup install
pm2 save
```

**方式二：使用 nssm 注册为 Windows 服务**

```powershell
# 下载 nssm: https://nssm.cc/download
# 安装服务
nssm install BatteryDiagnostic "C:\Program Files\nodejs\node.exe" "C:\你的路径\dist\server\server\index.js"

# 设置工作目录
nssm set BatteryDiagnostic AppDirectory "C:\你的路径"

# 启动服务
nssm start BatteryDiagnostic
```

---

## 环境变量配置说明

所有配置项都在 `.env` 文件中设置。从 `.env.example` 复制后按需修改。

### 必填项

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥（三选一） | `sk-xxxxxxxx` |
| `GLM_API_KEY` | 智谱 GLM API 密钥（三选一） | `xxxxxxxx.xxxxxxxx` |
| `QWEN_API_KEY` | 通义千问 API 密钥（三选一） | `sk-xxxxxxxx` |

> ⚠️ 以上三个 API Key **至少填写一个**，系统会自动选择可用的模型。推荐 DeepSeek，性价比最高。

### 基础配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `NODE_ENV` | `development` | 运行环境，生产环境必须设为 `production` |
| `PORT` | `3001` | 服务监听端口 |
| `LOG_LEVEL` | `info` | 日志级别：`debug` / `info` / `warn` / `error` |
| `CORS_ORIGIN` | `http://localhost:5173` | 允许的跨域来源，生产环境设为 `*` 或具体域名 |

### 前端配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `VITE_APP_TITLE` | `锂电池企业智能诊断系统` | 浏览器标签页标题 |
| `VITE_API_BASE_URL` | `/api` | API 请求前缀 |

### 存储与缓存

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PERSISTENCE_MODE` | `file` | 持久化方式，目前仅支持 `file` |
| `STORAGE_DIR` | `.runtime/platform` | 数据存储目录 |
| `CACHE_TTL_SECONDS` | `300` | 缓存有效期（秒） |
| `CACHE_STALE_TTL_SECONDS` | `1800` | 缓存过期后仍可使用的时间（秒） |

### 限流与并发

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `RATE_LIMIT_WINDOW_MS` | `60000` | 限流时间窗口（毫秒） |
| `RATE_LIMIT_MAX_REQUESTS` | `120` | 时间窗口内最大请求数 |
| `ASYNC_TASK_CONCURRENCY` | `2` | 异步任务并发数 |

### Agent 配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `AGENT_BUDGET_TOTAL_TOKENS` | `16000` | 单次诊断最大 Token 数 |
| `AGENT_BUDGET_MAX_STEPS` | `12` | 单次诊断最大推理步骤 |
| `AGENT_RETRY_LIMIT` | `2` | LLM 调用失败重试次数 |

### 网络请求

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `EXTERNAL_FETCH_TIMEOUT_MS` | `4000` | 外部数据源请求超时（毫秒） |
| `EXTERNAL_FETCH_RETRY_COUNT` | `2` | 外部请求重试次数 |

### RAG 数据源

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `RAG_SOURCE_WHITELIST` | `sse.com.cn,szse.cn,...` | 允许抓取的数据源域名白名单 |
| `RAG_MAX_SOURCE_AGE_DAYS` | `60` | 数据源最大时效（天） |

### 可选数据源凭证

| 变量名 | 说明 |
|--------|------|
| `NBS_COOKIE` | 国家统计局 Cookie（优先推荐） |
| `NBS_ACCOUNT` | 国家统计局账号 |
| `NBS_PASSWORD` | 国家统计局密码 |
| `NBS_TOKEN` | 国家统计局 Token |

> 💡 NBS 凭证为可选项。缺失时系统会平滑降级，使用内置的公开样例数据，不影响核心诊断功能。

### LLM 模型 Base URL（可选）

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | DeepSeek API 地址 |
| `GLM_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | GLM API 地址 |
| `QWEN_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | Qwen API 地址 |

> 💡 如果你使用的是第三方中转 API，修改对应的 Base URL 即可。

### 部署验证

配置完成后，可以运行最小部署验证脚本：

```bash
npx tsx src/server/minimum-deployment-report.ts
```

该脚本会检查"至少一个模型 API Key + 可选 NBS 凭证"是否满足最小部署条件，并输出详细的配置状态报告。

---

## 故障排查

### 1. 端口被占用

**症状：** 启动时报错 `EADDRINUSE: address already in use :::3001`

**解决方案：**

```bash
# Linux/Mac - 查找占用端口的进程
lsof -i :3001
# 或
ss -tlnp | grep 3001

# 杀掉占用进程
kill -9 <PID>

# Windows - 查找占用端口的进程
netstat -ano | findstr :3001
# 杀掉占用进程
taskkill /PID <PID> /F
```

或者修改 `.env` 中的 `PORT` 为其他可用端口。

### 2. API Key 无效

**症状：** 页面加载正常，但诊断分析时报错或无响应

**排查步骤：**

```bash
# 1. 检查 .env 文件中 API Key 是否正确填写
cat .env | grep API_KEY

# 2. 确认没有多余的空格或引号
# 正确：DEEPSEEK_API_KEY=sk-abc123
# 错误：DEEPSEEK_API_KEY="sk-abc123"
# 错误：DEEPSEEK_API_KEY = sk-abc123

# 3. 手动测试 API Key 是否有效
curl https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer 你的API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hello"}]}'
```

### 3. 构建失败

**症状：** `npm run build` 报错

**常见原因及解决方案：**

| 错误信息 | 原因 | 解决方案 |
|----------|------|----------|
| `npm ci` 失败 | package-lock.json 与 node_modules 不一致 | 删除 `node_modules` 后重新 `npm ci` |
| TypeScript 编译错误 | 类型不匹配 | 检查 Node.js 版本是否为 20+ |
| Vite 构建内存不足 | 服务器内存不足 | 增加 swap 或使用更大内存的服务器 |
| `ENOENT: no such file` | 文件路径问题 | 确认项目目录结构完整 |

```bash
# 清理并重新构建
rm -rf node_modules dist
npm ci
npm run build
```

### 4. 访问超时 / 页面加载慢

**可能原因及解决方案：**

| 原因 | 解决方案 |
|------|----------|
| 服务器带宽不足 | 升级带宽或使用 CDN |
| LLM API 响应慢 | 检查网络到 API 服务的连通性，考虑换用国内 API |
| Nginx 代理超时 | 增大 `proxy_read_timeout` 值 |
| SSE 流被缓冲 | 确认 Nginx 配置了 `proxy_buffering off` |

```bash
# 测试到 LLM API 的网络连通性
curl -w "time_total: %{time_total}s\n" -o /dev/null -s https://api.deepseek.com

# 测试 SSE 流是否正常
curl -N http://localhost:3001/api/enterprise/stream \
  -H "Content-Type: application/json" \
  -d '{"enterprise_id":"test"}'
```

### 5. Docker 相关问题

**容器无法启动：**

```bash
# 查看详细日志
docker-compose logs app

# 常见原因：.env 文件不存在或格式错误
# 确认 .env 文件存在
ls -la .env

# 重新构建（不使用缓存）
docker-compose build --no-cache
docker-compose up -d
```

**容器健康检查失败：**

```bash
# 查看健康检查日志
docker inspect --format='{{json .State.Health}}' battery-diagnostic-app | python3 -m json.tool

# 手动测试容器内健康接口
docker-compose exec app wget -qO- http://localhost:3001/api/health
```

**Nginx 容器报错：**

```bash
# 检查 nginx 配置是否正确挂载
docker-compose exec nginx nginx -t

# 常见原因：.htpasswd 文件不存在
# 确认文件存在
ls -la deploy/.htpasswd
```

### 6. Windows 特有问题

**`npm ci` 报错 ENOENT：**

- 确认项目路径中没有中文字符导致的编码问题
- 尝试使用短路径：`cd C:\temp\battery-diagnostic`

**PowerShell 执行策略限制：**

```powershell
# 如果提示无法运行脚本
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

**node 命令找不到：**

- 确认 Node.js 安装时勾选了"Add to PATH"
- 重启 PowerShell 或重启电脑
