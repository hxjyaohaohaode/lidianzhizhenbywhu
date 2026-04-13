# Apply Grainy Frosted Glass Texture Spec

## Why
用户期望浅色模式下具有强烈的物理质感，特别是带有噪点（Grain/Noise）的磨砂玻璃效果，以达到参考图片中的高品质视觉标准。当前的实现仅使用了平滑的 blur，缺乏细腻的颗粒感、边缘的高光反光，以及通透的色彩融合。此外，各个组件的比例、边框和阴影细节需进一步打磨以达到极致的拟真度。

## What Changes
- 引入 SVG Noise (噪点) 纹理叠加，为浅色模式的背景和玻璃面板增加真实的颗粒磨砂质感。
- 重新调配浅色模式的底层渐变背景，采用参考图中的清透蓝、青、紫融合渐变色，营造空灵感。
- 细化玻璃态（Glassmorphism）的边框（添加半透明高光反光边框）、圆角比例、以及多层阴影（内发光+外阴影），提升立体感。
- 检查并优化各个组件（面板、弹窗、侧边栏）的 Padding 和排版比例，确保在强质感下内容依然协调，不显拥挤或粗糙。

## Impact
- Affected specs: 浅色模式视觉主题、玻璃态组件细节、全局 UI 比例
- Affected code: `src/web/App.tsx`, `src/web/index.css`

## ADDED Requirements
### Requirement: 噪点磨砂质感 (Grainy Frosted Glass)
系统在浅色模式下必须表现出带有细微颗粒噪点的真实物理磨砂玻璃效果，背景色彩必须与玻璃材质形成通透的交互。

#### Scenario: Success case
- **WHEN** 用户在浅色模式下浏览页面
- **THEN** 界面背景及半透明面板呈现出类似物理毛玻璃的颗粒纹理，边框具有玻璃边缘的折射感，整体色彩通透且富有层次。

## MODIFIED Requirements
### Requirement: 全局比例与边框精调
重构组件的 border、box-shadow、border-radius 和 padding，确保组件细节精致且富有呼吸感。
