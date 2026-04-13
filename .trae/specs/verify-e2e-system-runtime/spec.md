# 系统端到端运行验证 Spec

## Why
前一轮审计已修复了6个关键代码缺陷（GMPS lev打分反转、DQI OCF clamp截断、记忆role过滤缺失、DQI触发条件遗漏、evidenceReview消息不一致、记忆写入缺role字段），且137个单元测试全部通过。但尚未验证系统在真实环境下能否端到端运行——即使用真实API密钥（DeepSeek/千问/智谱）启动服务，完成企业端和投资端的完整诊断流程。

## What Changes
- 验证后端服务使用真实API密钥正常启动
- 验证前端服务正常启动并与后端通信
- 验证企业端完整诊断流程（采集→分析→DQI/GMPS结果展示）
- 验证投资端完整分析流程（画像→分析→结果展示）
- 验证DQI/GMPS API端到端调用返回正确结果
- 验证API密钥配置正确（DeepSeek/千问/智谱三个提供商）
- 勾选上一轮审计checklist中所有已通过的检查项

## Impact
- Affected specs: comprehensive-system-functional-audit
- Affected code: 无代码修改，仅运行验证

## ADDED Requirements

### Requirement: 系统端到端运行验证
系统 SHALL 在真实环境下使用配置的API密钥正常启动并完成完整诊断流程。

#### Scenario: 后端服务启动
- **WHEN** 使用 .env 中配置的 API 密钥启动后端服务
- **THEN** 服务 SHALL 在端口 3001 正常监听
- **AND** /api/health 端点 SHALL 返回 200

#### Scenario: 前端服务启动
- **WHEN** 启动前端开发服务器
- **THEN** 页面 SHALL 在 http://localhost:5173 正常加载
- **AND** 页面标题包含"锂电池企业智能诊断系统"

#### Scenario: DQI/GMPS API端到端调用
- **WHEN** 调用 POST /api/models/dqi/calculate 传入有效数据
- **THEN** 返回 { success: true, data: { dqi, status, driver, ... } }
- **WHEN** 调用 POST /api/models/gmps/calculate 传入有效数据
- **THEN** 返回 { success: true, data: { gmps, level, probabilityNextQuarter, ... } }

#### Scenario: API密钥配置验证
- **WHEN** 检查 .env 文件中的 API 密钥配置
- **THEN** DEEPSEEK_API_KEY、GLM_API_KEY、QWEN_API_KEY 均已配置
- **AND** LLM 适配器 SHALL 能使用至少一个提供商成功调用

## MODIFIED Requirements

### Requirement: 审计checklist勾选
上一轮审计中已验证通过的检查项 SHALL 在 checklist.md 中勾选确认。

## REMOVED Requirements

无移除需求。
