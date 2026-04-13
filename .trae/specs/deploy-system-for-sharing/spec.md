# 系统部署就绪验证与部署方案 Spec

## Why
系统已完成核心功能开发，需要将其部署上线让朋友能够直接使用。部署前必须全面验证系统功能正常，同时需要解决生产环境配置（CORS、环境变量、安全加固等）问题，并提供清晰的部署方案。

## What Changes
- 全面验证系统构建、启动、API端点、前端页面功能
- 修复生产环境部署所需的配置问题（CORS_ORIGIN、NODE_ENV、安全头等）
- 添加生产环境静态文件服务配置（Express 直接托管前端构建产物）
- 创建 Dockerfile 和 docker-compose.yml 容器化部署方案
- 创建部署脚本和启动配置
- 更新 .env.example 增加生产环境配置说明
- 验证所有 API 端点在构建后模式下正常工作

## Impact
- Affected specs: verify-e2e-system-runtime, comprehensive-system-functional-audit
- Affected code: src/server/app.ts（CORS/安全头配置）、vite.config.ts（构建输出）、新增 Dockerfile/docker-compose.yml

## ADDED Requirements

### Requirement: 系统功能全面验证
系统 SHALL 在构建后（`npm run build` + `npm start`）模式下通过以下全部验证。

#### Scenario: 构建成功
- **WHEN** 执行 `npm run build`
- **THEN** 前端构建产物输出到 `dist/web/`，后端编译产物输出到 `dist/server/`
- **AND** 构建过程无错误

#### Scenario: 生产模式启动
- **WHEN** 执行 `NODE_ENV=production npm start`
- **THEN** 服务 SHALL 在配置端口正常监听
- **AND** `/api/health` 返回 200
- **AND** 前端页面通过同一端口可访问

#### Scenario: 前端页面可访问
- **WHEN** 访问服务根路径 `/`
- **THEN** 返回前端 HTML 页面
- **AND** 页面标题包含"锂电池企业智能诊断系统"

#### Scenario: 核心 API 端点验证
- **WHEN** 调用 `GET /api/health`
- **THEN** 返回系统健康状态 JSON
- **WHEN** 调用 `GET /api/health/ready`
- **THEN** 返回部署就绪状态
- **WHEN** 调用 `GET /api/meta`
- **THEN** 返回系统元数据
- **WHEN** 调用 `POST /api/models/dqi/calculate` 传入有效数据
- **THEN** 返回 DQI 计算结果
- **WHEN** 调用 `POST /api/models/gmps/calculate` 传入有效数据
- **THEN** 返回 GMPS 计算结果

### Requirement: 生产环境配置适配
系统 SHALL 支持生产环境部署所需的配置调整。

#### Scenario: CORS 动态配置
- **WHEN** `CORS_ORIGIN` 环境变量设置为逗号分隔的多个源
- **THEN** 系统 SHALL 允许来自任一源的跨域请求
- **WHEN** `CORS_ORIGIN` 设置为 `*`
- **THEN** 系统 SHALL 允许所有源的跨域请求（适用于内网部署场景）

#### Scenario: 安全响应头
- **WHEN** 系统以生产模式运行
- **THEN** 响应 SHALL 包含基本安全头（X-Content-Type-Options, X-Frame-Options 等）

#### Scenario: 前端构建产物托管
- **WHEN** `dist/web/` 目录存在
- **THEN** Express SHALL 托管前端静态文件
- **AND** 非 API 路径的 GET 请求 SHALL 返回 `index.html`（SPA 路由兜底）

### Requirement: Docker 容器化部署
系统 SHALL 提供开箱即用的 Docker 部署方案。

#### Scenario: Docker 镜像构建
- **WHEN** 执行 `docker build -t battery-diagnostic .`
- **THEN** Docker 镜像 SHALL 成功构建
- **AND** 镜像包含 Node.js 运行时、构建产物和必要配置

#### Scenario: Docker 容器启动
- **WHEN** 执行 `docker run -p 3001:3001 --env-file .env battery-diagnostic`
- **THEN** 容器 SHALL 正常启动并监听端口 3001
- **AND** 通过 `http://localhost:3001` 可访问系统

#### Scenario: docker-compose 一键部署
- **WHEN** 执行 `docker-compose up -d`
- **THEN** 系统 SHALL 一键启动
- **AND** 数据持久化目录 SHALL 挂载到宿主机

### Requirement: 部署文档与脚本
系统 SHALL 提供清晰的部署指南。

#### Scenario: 本地局域网部署
- **WHEN** 用户按照部署指南在本地启动系统
- **THEN** 同一局域网内的朋友 SHALL 能通过 `http://<内网IP>:3001` 访问系统

#### Scenario: 云服务器部署
- **WHEN** 用户按照部署指南在云服务器上部署系统
- **THEN** 外部用户 SHALL 能通过 `http://<公网IP>:3001` 访问系统

## MODIFIED Requirements

### Requirement: CORS 配置增强
现有 CORS 中间件 SHALL 支持多源配置和通配符模式，以适应不同部署场景。

## REMOVED Requirements

无移除需求。
