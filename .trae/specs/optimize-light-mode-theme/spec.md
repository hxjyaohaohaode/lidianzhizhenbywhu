# Optimize Light Mode Theme Spec

## Why
当前浅色模式下，界面配色不够协调，且很多弹窗（如提示框、节点详情）的内容颜色对比度不足，导致文字无法正常显示和阅读。同时，浅色模式缺乏质感和“生命感”，未能提供与深色模式同等高品质的视觉体验。

## What Changes
- 重构浅色模式的 CSS 变量，优化背景色、文本色、边框色等基础调色板，引入更具“生命感”的色彩搭配（如清新自然的渐变与点缀）。
- 在浅色模式下全面引入“微磨砂”玻璃态质感（Glassmorphism），通过 `backdrop-filter: blur()` 与半透明背景色的结合，使界面元素（弹窗、侧边栏、卡片等）看起来更加真实、通透。
- 修复浅色模式下的对比度问题，确保所有文本、图标在所有界面组件（包括 Chart Modal、Tooltip、Memory Screen Dialog）中清晰可见。

## Impact
- Affected specs: 浅色模式视觉主题与可读性
- Affected code: `src/web/App.tsx`, `src/web/index.css`

## ADDED Requirements
### Requirement: 微磨砂玻璃质感
系统在浅色模式下，应为浮层、弹窗及部分面板应用微磨砂质感。

#### Scenario: Success case
- **WHEN** 用户在浅色模式下打开弹窗或查看图表浮层
- **THEN** 背景呈现半透明且带有底层模糊（blur）的玻璃态效果，质感高级且不影响文字阅读。

### Requirement: 增强色彩生命感
浅色模式的色调应避免死板的纯白与灰色，融入具有生机与活力的色调。

#### Scenario: Success case
- **WHEN** 用户切换至浅色模式
- **THEN** 界面呈现清新、灵动的整体氛围，控件与背景色彩搭配自然。

## MODIFIED Requirements
### Requirement: 浅色模式高对比度与可读性
重写所有弹窗和浮层在浅色模式下的文本颜色与背景颜色逻辑，确保符合 WCAG 文本对比度标准。
