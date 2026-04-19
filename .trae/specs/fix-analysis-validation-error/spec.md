# 修复分析页面参数校验失败 Spec

## Why
在 Render 部署环境中，用户在分析页面输入信息查询时，系统总是返回"分析失败请求参数校验失败。"错误。根因有两个：
1. `buildEnterpriseAnalysisRequestPayload` 函数定义只接受6个参数，但调用时传递了7个参数（`effectiveFocusMode` 被忽略）
2. 前端 `requestJson` 函数在解析错误响应时，读取 `errorPayload.message` 但服务器实际返回格式为 `{ ok: false, error: { message: "..." } }`，导致真实错误信息丢失

## What Changes
- 修改 `buildEnterpriseAnalysisRequestPayload` 函数签名，增加 `focusMode` 可选参数
- 修复 `requestJson` 错误解析逻辑，优先读取 `errorPayload.error.message`
- 确保 `focusMode` 值始终符合 `enterpriseAnalysisRequestSchema` 定义的枚举值

## Impact
- Affected specs: 企业端分析请求参数构建、API 错误响应解析
- Affected code: `src/web/utils/enterprise-payload.ts`, `src/web/api.ts`, `src/web/components/EnterpriseScreen.tsx`

## MODIFIED Requirements
### Requirement: 企业端分析请求参数构建
`buildEnterpriseAnalysisRequestPayload` 函数 SHALL 支持调用方显式指定 `focusMode` 参数，同时保持向后兼容的默认推断逻辑。

#### Scenario: 调用方传入有效 focusMode
- **WHEN** 调用方传入 `"deepDive"` 作为 focusMode
- **THEN** 请求 payload 中的 focusMode 字段应为 `"deepDive"`

#### Scenario: 调用方未传入 focusMode
- **WHEN** 调用方不传入 focusMode 参数
- **THEN** 函数使用原有的查询文本正则表达式推断逻辑确定 focusMode

### Requirement: API 错误响应解析
`requestJson` 函数 SHALL 正确解析服务器返回的错误响应结构 `{ ok: false, error: { message: string, ... } }`。

#### Scenario: 服务器返回 400 错误
- **WHEN** 服务器返回 `{ "ok": false, "error": { "message": "请求参数校验失败。" } }`
- **THEN** 前端错误消息应为 `"请求参数校验失败。"`
