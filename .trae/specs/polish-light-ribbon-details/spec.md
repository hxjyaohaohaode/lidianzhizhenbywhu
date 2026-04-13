# 光带细节美化 Spec

## Why
当前"记忆中得你"深色模式下的金色光带已经实现了基本的流动效果，但视觉上仍显得较为平面化，缺乏自然的光学特性（如柔和的辉光、真实的透光感、细腻的渐变）。用户希望进一步美化光带细节，使其看起来更加自然、真实，增强星空背景的沉浸感。

## What Changes
- 优化光带渐变色彩，实现更自然的金色到暖黄色过渡
- 增强光带辉光效果，使光晕更柔和、扩散更自然
- 改进光带动画曲线，使流动更加平滑、有机
- 提升光带粒子效果，增加闪烁亮度和运动随机性
- 添加光带深度感，通过透明度变化模拟远近层次
- 优化光带与星空背景的融合，避免生硬边缘

## Impact
- 受影响组件: `MemoryScreen` 中的 canvas 绘制逻辑（App.tsx）
- 受影响代码: 光带绘制函数、粒子系统、渐变生成
- 用户体验: 光带视觉效果显著提升，更接近真实宇宙中的星云光带

## ADDED Requirements

### Requirement: 自然渐变光带
The system SHALL render light ribbons with more natural color gradients.

#### Scenario: 渐变色彩优化
- **GIVEN** 光带正在绘制
- **WHEN** 用户观察光带
- **THEN** 光带色彩呈现平滑的金色到暖黄色渐变
- **AND** 渐变中带有微妙的色调变化（如淡紫色/橙色调）
- **AND** 色彩过渡无明显硬边

### Requirement: 柔和辉光效果
The system SHALL apply soft glow effects to light ribbons.

#### Scenario: 辉光渲染
- **GIVEN** 光带主体绘制完成
- **WHEN** 光带发光时
- **THEN** 光带周围有柔和的光晕扩散
- **AND** 光晕强度随距离衰减自然
- **AND** 光晕能够轻微透过节点内容显示

### Requirement: 有机流动动画
The system SHALL animate light ribbons with organic flowing motion.

#### Scenario: 流动效果优化
- **GIVEN** 光带动画运行中
- **WHEN** 用户观看光带移动
- **THEN** 光带流动曲线更加平滑自然
- **AND** 流动速度有轻微随机变化（类似真实流体）
- **AND** 不同光带间流动相位错开，避免同步机械感

### Requirement: 增强粒子效果
The system SHALL enhance sparkle particles along light ribbons.

#### Scenario: 粒子效果优化
- **GIVEN** 光带粒子系统运行中
- **WHEN** 粒子沿光带移动
- **THEN** 粒子有更明亮的闪烁效果
- **AND** 粒子大小和亮度有随机变化
- **AND** 粒子运动轨迹更自然（略带随机偏移）

### Requirement: 深度层次感
The system SHALL create depth perception in light ribbons.

#### Scenario: 深度效果
- **GIVEN** 多条光带同时显示
- **WHEN** 用户观察光带层次
- **THEN** 远处光带略微模糊且透明度更高
- **AND** 近处光带更清晰、色彩更饱和
- **AND** 光带间有自然的遮挡关系

## MODIFIED Requirements

### Requirement: 光带绘制逻辑
**原需求**: 使用多层描边和简单渐变绘制光带
**新需求**: 
- 采用更复杂的径向/线性渐变组合
- 添加高斯模糊模拟柔光效果
- 实现动态透明度变化模拟呼吸效果
- 优化阴影参数获得更自然的光晕

## REMOVED Requirements
无