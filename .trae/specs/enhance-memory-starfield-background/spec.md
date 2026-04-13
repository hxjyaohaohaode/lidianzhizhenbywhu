# "记忆中得你"深色模式星空背景 Spec

## Why
当前"记忆中得你"功能在深色模式下使用简单的星空背景，用户希望将其升级为更具沉浸感的视觉效果：高度还原参考图中的星空背景和金色光带，并添加动态流星、流动的光带效果，同时提升节点和连线的玻璃质感。

## What Changes
- 深色模式下"记忆中得你"界面背景升级为高度还原的星空背景
- 添加动态流星划过效果
- 实现流动的金色光带，光带光韵能透过信息节点显示
- 节点质感升级为更强的玻璃效果
- 节点连线加粗并升级为玻璃质感

## Impact
- 受影响组件: `MemoryScreen` (App.tsx)
- 受影响样式: CSS 变量和 canvas 绘制逻辑
- 用户体验: 深色模式下视觉沉浸感显著提升

## ADDED Requirements

### Requirement: 星空背景
The system SHALL provide a highly realistic starfield background in dark mode.

#### Scenario: 星空渲染
- **GIVEN** 用户处于深色模式
- **WHEN** 打开"记忆中得你"功能
- **THEN** 背景显示深蓝色星空，包含闪烁的星星和星云效果
- **AND** 星星具有不同大小和亮度，呈现自然闪烁

### Requirement: 动态流星
The system SHALL display animated shooting stars periodically.

#### Scenario: 流星划过
- **GIVEN** 星空背景已渲染
- **WHEN** 随机时间间隔触发
- **THEN** 流星从屏幕一侧划过，带有尾迹效果
- **AND** 流星出现频率适中，不干扰主要内容

### Requirement: 流动光带
The system SHALL render an animated golden light ribbon flowing across the screen.

#### Scenario: 光带动画
- **GIVEN" 用户处于深色模式下的"记忆中得你"界面
- **WHEN" 界面渲染完成
- **THEN" 一条蜿蜒的金色光带从屏幕一角流向另一角
- **AND" 光带具有流动动画效果
- **AND" 光带的光韵能够透过信息节点内容显示（半透明叠加效果）

### Requirement: 玻璃质感节点
The system SHALL render memory nodes with enhanced glass morphism effect.

#### Scenario: 节点显示
- **GIVEN" 记忆树节点需要显示
- **WHEN" 节点渲染时
- **THEN" 节点具有毛玻璃背景效果（backdrop-blur）
- **AND" 节点边缘有柔和的光晕
- **AND" 节点背景半透明，能够透出底层星空和光带

### Requirement: 玻璃质感连线
The system SHALL render connections between nodes with glass-like appearance.

#### Scenario: 连线显示
- **GIVEN" 记忆树节点间需要连线
- **WHEN" 连线渲染时
- **THEN" 连线比当前更粗（2-3px）
- **AND" 连线具有半透明玻璃质感
- **AND" 连线带有微弱的发光效果

## MODIFIED Requirements

### Requirement: MemoryScreen Canvas 绘制
**原需求**: 深色模式下使用简单的星空背景和基础光带
**新需求**: 
- 星空背景更加真实，参考图中深蓝色调配紫色星云
- 光带改为参考图中的金色蜿蜒光带，带有粒子流动效果
- 添加动态流星效果

## REMOVED Requirements
无
