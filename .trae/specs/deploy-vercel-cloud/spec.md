# 云端持久化部署与个性化服务 Spec

## Why
用户需要将系统部署到云端，让朋友能7x24小时随时访问，且系统需提供个性化服务（用户身份识别、偏好记忆、历史记录跨会话保留）。当前局域网部署方案无法满足"随时可用"的需求，隧道方案受网络限制不可用。

## What Changes
- 将 .env 配置为生产模式（NODE_ENV=production, CORS_ORIGIN=*）
- 配置 Vercel Serverless 部署方案（免费额度足够朋友使用）
- 修复 Vercel 部署所需的代码适配（文件系统只读、SSE 流式响应兼容性）
- 确保个性化服务功能在云端正常工作（用户记忆、偏好、历史记录持久化）

## Impact
- Affected specs: deploy-system-for-sharing
- Affected code: api/index.js（Vercel 入口）、src/server/app.ts（SSE 兼容）、src/server/platform-store.ts（/tmp 适配）

## ADDED Requirements

### Requirement: Vercel 云端部署
系统 SHALL 能通过 Vercel CLI 一键部署到云端，生成公网 URL 供朋友随时访问。

#### Scenario: Vercel 部署成功
- **WHEN** 执行 `vercel --prod` 部署
- **THEN** 系统 SHALL 成功部署并生成公网 URL
- **AND** 朋友通过该 URL 可正常访问系统

#### Scenario: API 端点云端可用
- **WHEN** 朋友通过云端 URL 访问 /api/health
- **THEN** 返回系统健康状态，3个模型提供方全部就绪

#### Scenario: SSE 流式响应云端兼容
- **WHEN** 朋友在云端触发智能分析
- **THEN** SSE 流式响应 SHALL 正常工作
- **AND** 分析结果逐步推送到前端

### Requirement: 个性化服务云端可用
系统 SHALL 在云端部署后仍能提供个性化服务。

#### Scenario: 用户记忆跨会话保留
- **WHEN** 用户首次使用系统并输入企业信息
- **THEN** 系统 SHALL 记住用户信息
- **WHEN** 用户再次访问
- **THEN** 系统 SHALL 恢复之前的记忆和偏好

#### Scenario: 文件持久化适配云端
- **WHEN** 系统运行在 Vercel Serverless 环境
- **THEN** 存储 SHALL 使用 /tmp 目录
- **AND** 单次请求内数据读写正常

### Requirement: 环境变量云端配置
系统 SHALL 在 Vercel 项目中配置所有必需的环境变量。

#### Scenario: API Key 云端配置
- **WHEN** Vercel 项目环境变量中配置了 DEEPSEEK_API_KEY、GLM_API_KEY、QWEN_API_KEY
- **THEN** 系统 SHALL 能正常调用三个大模型
- **AND** /api/health 显示所有模型提供方已就绪

## MODIFIED Requirements

### Requirement: Vercel 部署入口
api/index.js SHALL 正确导出 Express app 作为 Vercel Serverless Function，处理所有 /api/* 路由。

## REMOVED Requirements

无移除需求。
