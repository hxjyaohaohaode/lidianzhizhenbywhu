# 通用原生验收：原金额与中文元的读取（2026-10-05）

本修正只改变验收读取，不改产品。基线为 `971552845ac6eb4a7950ef9083d97b0e079fb418`；原字段实现和旧提交 `8a3e98f` 保留。

## 原红事实

Push `abb2d5b09c3b0dcb7d6e1daf6ce487c2a8126506` / run `37383460564` attempt `1` 的 Ubuntu、Windows 综合原生验收均在已完成43项后，停在总资产来源的 `CNY in tile.inner_text()` 断言。API仍使用CNY及原始元数值，产品把这个数值显示为中文“元”，这是合理的界面表达。

两份原截图的主值分别为资产负债率40%、总资产50万元、总负债20万元；总资产来源details已经展开，但下半内容仍在聊天滚动区域下方。因此这次断言失败不能据此认定金额计算错误，原图也不能证明路径、完整原金额和单位已经被用户完整看到。

已逐字节核对原失败图与原报告中的散列：

- Ubuntu `ui-current-failure.png`：`edb3e11ee163b1fa844bfa8214a09e959f092c13b75748cd794c07411924de59`
- Windows `ui-current-failure.png`：`e17e0ecdca6c91cedffd502a3f624eb2970025320e330e56980ad7f1cd81aa34`

旧原生失败保持失败，没有把修正后的脚本用于改写旧原件结论。

## 窄修

`scripts/recorded_balance_reading.py`只负责验收：独立按保存数据核对原金额与显示的“元”标签。它读取完整来源行的路径和数额，通过Decimal比较原始人民币元，而不是把产品的`display_value`或同一个金额formatter作为预期值。万元、亿元、百分比、错误币种、错数额、错路径、缺单位或尾随其他文本均不能混过。

API的CNY、原值、季度、字段路径、数据集ID/版本/hash检查保留。实际消息、提案、计划、新运行和可见报告卡的精确绑定保留；不会按列表第一项或同值旧运行认领结果。

公式复核单击单独捕获该thread/message精确GET响应，核对原消息/会话、问题范围、当前数据修订及三条事实。公式复核来源行使用这次响应自己的facts，不把保存消息的元信息当成本次复核来源。

两个金额在服务事实和公式复核中各读取一次。读取复用原 `_read_groups` 与 `_TEXT_GEOMETRY`，整行必须通过真实祖先裁剪范围检查；必要时只用原有正常滚动与指针滚轮。没有缩短文本、改DOM/CSS、强制可见、放宽几何或扩大10秒/300秒预算。

每条成功的整行读取经现有 `snap` 保存原viewport PNG，名称是 `ui-current-recorded-balance-source-{service|trace}-{assets|liabilities}-reader-1.png`。它们进入原 `screenshots` 列表和SHA256字段，并被现有 `evidence/ui-current-*.png` 官方工件路径收集。`native-service-browser.json`新增 `balance_source_readings`，将实际message ID、字段、完整路径、原CNY值和读取索引关联到整行几何及截图。读不到或滚动不动仍失败，不生成完成读取记录。

## 验证边界

新增合同以真实隔离鉴权API取得指定非最新季度，再执行实际编译后的两个renderer读取普通、0和微小非零金额，共12条原来源行。反例覆盖错数额、错单位、错路径、API来源不匹配以及关闭、隐藏、缺失range、裁剪后滚轮无实际运动。

[实际API→compiled来源行记录](../evidence/recorded-balance-source-rows-20261005.json)保留这12条路径、原CNY值、界面原文及对应来源修订/hash；记录不包含浏览器或像素通过声明。

这些是API、compiled HTML和明确的几何双身合同，不是新原生浏览器通过。两个原平台的旧红保留；新截图、真实滚动布局和完整下游新报告仍需后继原生执行验证。

最终冻结执行 `python scripts/verify.py --full-chain`：编译、TypeScript检查/构建、3873项后端及3项子测试、1068项前端、源码检查、真实HTTP/SSE/重启/备份链七阶段全部通过。362份源码、编译产物、测试与CI文件运行前后hash一致；产品、共享几何、原实体绑定测试及CI/预算文件相对基线没有变化。相关作者聚焦78项通过，独立聚焦42项通过。

[冻结验证记录](../evidence/recorded-balance-native-units-validation-20261005.json)同时保留旧原生失败的原图hash和新native仍待执行的边界。未安装依赖、未运行本地浏览器或实际供应商、未修改产品/共享几何/CI注册及预算、未发布。
