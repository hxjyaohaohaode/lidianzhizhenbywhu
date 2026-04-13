# Refine Light Ribbon Texture and Interactivity Spec

## Why
当前“记忆中的你”页面的光带视觉效果较为单薄，缺乏质感，未能达到柔顺发丝般的自然丝滑与细腻纹理。同时，页面在交互性与稳定性方面还有提升空间。为了提升视觉品质与用户体验，需要对光带细节进行重构与优化。

## What Changes
- 重构光带渲染逻辑，将粗犷的发光带替换为多条细密、半透明、相互交叠的曲线，模拟柔顺发丝的质感。
- 增加光带动画的平滑度，通过优化正弦波组合与时间变量的控制，使流动更加自然丝滑。
- 增强交互性，使光带流动路径能够对鼠标移动或页面滚动做出轻微的响应与偏移。
- 提升渲染稳定性，通过精简不必要的 `shadowBlur` 重绘，采用更轻量级的细线叠加模式，优化 Canvas 渲染性能，确保帧率稳定。

## Impact
- Affected specs: 光带视觉效果、页面交互性能
- Affected code: `src/web/App.tsx` (主要是 `MemoryBackgroundCanvas` 及光带相关计算和绘制函数)

## ADDED Requirements
### Requirement: 发丝质感光带
系统应能够渲染多条细密、平滑、具有自然色阶过渡的曲线，组合成具有发丝质感的光带效果。

#### Scenario: Success case
- **WHEN** 用户进入“记忆中的你”页面
- **THEN** 看到光带如同柔顺的发丝般丝滑流动，线条细腻且具有层次感。

### Requirement: 光带交互响应
光带的流动轨迹应能轻微响应用户的交互动作（如鼠标移动、滚动）。

#### Scenario: Success case
- **WHEN** 用户在页面内移动鼠标或滚动视图
- **THEN** 光带的波纹和流动方向产生柔和的跟随或偏移效果，增加沉浸感。

## MODIFIED Requirements
### Requirement: 提升渲染稳定性
重构光带的绘制方式，用多次低透明度细线绘制替代多次高成本的阴影模糊 (`shadowBlur`)，提升 60fps 的稳定率。
