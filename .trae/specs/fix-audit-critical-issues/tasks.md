# Tasks

## 阶段一：严重问题修复（Critical）

- [x] Task 1: 修复DQI负OCF比率语义错误
  - [x] SubTask 1.1: 使用绝对值比较修复双负OCF比率
  - [x] SubTask 1.2: 修复DQI现金流贡献钳位范围（与Task 9合并）

- [x] Task 2: 修复GMPS库存估算不对称乘数
  - [x] SubTask 2.1: 统一乘数为1.15
  - [x] SubTask 2.2: 验证修复后无系统性偏差

- [x] Task 3: 为模型输出链添加NaN/Infinity防护
  - [x] SubTask 3.1: round()函数添加NaN/Infinity检查
  - [x] SubTask 3.2: weightedScore()函数过滤NaN
  - [x] SubTask 3.3: normalizeHigherBetter/Lower添加防护
  - [x] SubTask 3.4: 验证NaN/Infinity输入被正确处理

- [x] Task 4: 添加API认证中间件和角色授权
  - [x] SubTask 4.1: 创建authenticateRequest中间件
  - [x] SubTask 4.2: 创建authorizeRole中间件
  - [x] SubTask 4.3: 应用到企业端和投资端路由
  - [x] SubTask 4.4: 应用角色授权
  - [x] SubTask 4.5: 为共享端点添加所有权验证
  - [x] SubTask 4.6: 测试适配完成

- [x] Task 5: 添加requireEnterpriseSession方法
  - [x] SubTask 5.1: 创建requireEnterpriseSession方法
  - [x] SubTask 5.2: 在analyzeEnterprise中使用
  - [x] SubTask 5.3: 验证非所有者访问返回403

- [x] Task 6: 按角色过滤用户画像响应
  - [x] SubTask 6.1: 修改buildUserProfileResponse接受viewerRole
  - [x] SubTask 6.2: 按角色过滤baseInfo
  - [x] SubTask 6.3: 修改GET /api/users/:userId端点
  - [x] SubTask 6.4: 前端适配完成

- [x] Task 7: 修复PlatformStore并发安全与数据丢失防护
  - [x] SubTask 7.1: 添加写锁（Promise-based mutex）
  - [x] SubTask 7.2: 修改readState()备份损坏文件
  - [x] SubTask 7.3: 使用原子写入（.tmp+重命名）
  - [x] SubTask 7.4: 修复所有async callers

## 阶段二：高级问题修复（High）

- [x] Task 8: 添加SSE心跳与客户端断开处理
  - [x] SubTask 8.1: 添加30秒间隔心跳
  - [x] SubTask 8.2: 使用response.destroyed检测断开
  - [x] SubTask 8.3: 在LLM调用前检查aborted标志
  - [x] SubTask 8.4: 清理心跳interval

- [x] Task 9: 修复DQI现金流贡献钳位范围
  - [x] SubTask 9.1: clamp范围改为[0,3]
  - [x] SubTask 9.2: DQI最小值为0

- [x] Task 10: 修复简单路径不写记忆
  - [x] SubTask 10.1: 添加memoryStore.append调用
  - [x] SubTask 10.2: summary格式一致

- [x] Task 11: 统一API响应格式
  - [x] SubTask 11.1: 包装为{success: true, data: result}
  - [x] SubTask 11.2: 前端api.ts适配完成

## 阶段三：中级问题修复（Medium）

- [x] Task 12: 完善浅色主题CSS
  - [x] SubTask 12.1-12.4: 添加浅色主题覆盖

- [x] Task 13: 为可视化构建器添加useMemo
  - [x] SubTask 13.1-13.3: useMemo包装完成

- [x] Task 14: 修复DataFormatter百分比双重除法
  - [x] SubTask 14.1-14.3: 移除percent()中的/100除法

- [x] Task 15: 增加记忆召回数量
  - [x] SubTask 15.1-15.2: 召回数量从2改为5

- [x] Task 16: 修复模块级可变格式化器竞态
  - [x] SubTask 16.1-16.2: 添加null防护

- [x] Task 17: 添加服务端货币单位校验
  - [x] SubTask 17.1-17.2: 添加monetaryAmount和salesVolumeAmount schema

## 阶段四：验证

- [x] Task 18: 运行编译和测试验证
  - [x] SubTask 18.1: 后端TypeScript编译0错误
  - [x] SubTask 18.2: 前端TypeScript编译0错误
  - [x] SubTask 18.3: 142测试全部通过
  - [x] SubTask 18.4: 修复了SSE流测试（response.destroyed替代clientDisconnected）和认证中间件测试适配
