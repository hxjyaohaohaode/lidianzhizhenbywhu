# 验证临时目录清理与明确访问阻碍 · 2026-10-06

完整产品验收进行中，暂不建议合并。本轮只修改验证工具、CI条件和相应测试；应用、财务规则、品牌与原生成功判据保持。

## 804 的实际结果

[Push 37426794931](https://github.com/hxjyaohaohaode/lidianzhizhenbywhu/actions/runs/37426794931) 为38成功、1失败；[PR 37426800700](https://github.com/hxjyaohaohaode/lidianzhizhenbywhu/actions/runs/37426800700) 为37成功、2失败。三份失败不改记通过。

- 两份Windows都完成4055个节点，分配2028/2027，阶段、原序和JUnit归属完整；包含3个额外子断言及13项真实进程归属控制。command、bootstrap和guardian均退出0，Windows Job进程树清理确认。pytest阶段实耗843.034秒、911.029秒，均未触及1500秒上限。最后删除本次临时目录时发生PermissionError，聚合正确退出1，随后原生与启动验收未运行。原日志没有保留失败路径、errno或winerror，不能据此把原因认定为Git只读文件或文件锁。
- PR的L9 Linux任务在安装Chromium Headless Shell时被官方CDN明确返回403 AccessDenied及地域不可用文本，供应商自带fallback另返回400。原生任务未启动，随后打包因没有本次报告而失败。它是环境访问阻碍，不是业务断言失败，更不是通过。
- 两份Linux综合各完成4059节点、1114前端、18条实际HTTP链与58项通用原生检查。新增报告读取的五组内容实际使用三张原图，原问题、季度、40%/50万元/20万元、完整输入与公式可见；该桌面流程有独立读图核对。Windows此新增读数未执行，不能由Linux代替。

## 私有临时目录清理

原进程树的cleanup_confirmed保持其原义；目录删除结果另列temporary_cleanup，不把进程结束混同于文件已删净。记录原始操作、相对路径、异常类型、errno/winerror、实际文件属性和处理结果，不上传目录中的数据库或凭据内容。

只有本次私有根及祖先、目标身份均匹配，且实际Windows普通单链接文件带只读属性、原unlink返回WinError5时，才清该文件只读位并重试同一unlink一次。不修改ACL，不跟随reparse叶，不对整棵树重试。锁、未知权限、越界、链接、检查失败、身份变化或截止耗尽仍失败。整个目录确已消失且未超原期限才记complete=true。

自定义只读回调在新修改/重试前检查同一截止；它不能抢占普通rmtree遍历或卡住的操作系统调用，迟完成仍判失败。私有路径检查也不声称能原子阻止无关进程恶意替换文件。进程与目录都成功才可授聚合通过，1500秒总期限、120秒单例与其他原有预算保持。

此有界处理及新增诊断不等于已证实804的具体故障原因。新Windows需要实际只读、锁、链接控制和完整目录清理原件；仍有未知错误就继续保留失败及诊断。

## L9 Linux 的明确停止

保留同名product-strategy-consent的Linux矩阵节点，在现有push、pull_request和workflow_dispatch事件中记录blocked、complete=false、native_started=false、browser_download_attempted=false，并非零退出。回执分别保存本次head/tree/event/run/job和原804拒绝来源，不把历史身份冒充本次执行。

该Linux分支不进入依赖安装、浏览器下载、原生任务或打包，始终上传小型阻碍回执和本次运行上下文。没有换runner、CDN、代理或任务名称补验。Windows L9及其余独立任务保持；其他任务的成功不能替代此项。该CI节点将明确保持非通过，直至访问限制被合法解除并明确恢复任务。

## 当前验证边界

两个窄包均有独立源码/本地合同复核。组合源码e0a75ff于2026-10-06T07:50:17.695518+00:00完成七阶段，进程退出0：4078项按2039/2039原序完整执行，另3个子断言；1114项前端与18条真实HTTP/SSE/重启/备份链通过。pytest阶段288.210秒，517份非evidence文件前后hash一致，22份原产物逐一核对。进程树清理与temporary_cleanup.complete分别为true；本机Linux没有尝试Windows只读位修复。见[本轮完整本地记录](../evidence/verification-cleanup-access-20261006.json)。新Windows只读处理、锁控制及完整浏览器结果仍需新精确CI；旧两份PermissionError与地域403均保留。

本轮没有业务代码、模型公式、品牌、生产数据或外部供应商调用变更，没有合并或部署。完整移动端、多输入策略成功激活/回滚、真实供应商、生产负载、收费运营与登记材料仍未获整体验收。
