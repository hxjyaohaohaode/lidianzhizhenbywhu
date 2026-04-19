# Tasks
- [x] Task 1: 修改 buildEnterpriseAnalysisRequestPayload 函数签名支持 focusMode 参数
  - [x] 在函数参数列表中增加 `focusMode?: "operationalDiagnosis" | "deepDive"` 参数
  - [x] 修改 focusMode 字段的赋值逻辑：优先使用传入值，否则使用正则表达式推断
  - [x] 确保类型正确匹配 EnterpriseAnalysisRequest 的 focusMode 类型
- [x] Task 2: 修复 requestJson 错误响应解析逻辑
  - [x] 修改错误消息提取逻辑，优先读取 `errorPayload.error.message`
  - [x] 保持向后兼容：如果 `error.message` 不存在则回退到 `message`
- [x] Task 3: 验证修复效果
  - [x] 确认构建无类型错误
  - [x] 确认错误消息能正确传递到前端

# Task Dependencies
- Task 2 依赖于 Task 1（两者可并行，但验证需要两者都完成）
