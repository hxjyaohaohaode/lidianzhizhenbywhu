# Change Memory Page Light Background Spec

## Why
用户希望在浅色模式下，将“记忆中的你”页面的背景替换为提供的蓝天阳光图片，以提升界面的视觉美观度并符合浅色模式的主题氛围。

## What Changes
- 添加用户提供的蓝天阳光图片作为浅色模式下“记忆中的你”页面的背景图。
- 修改 `src/web/App.tsx` 中的 `MemoryBackgroundCanvas` 渲染逻辑，在浅色模式 (`!isDark`) 下，使用该图片替换原有的线性渐变背景。
- 在浅色模式下，隐藏或调整画布中的云朵绘制逻辑，避免与图片中自带的云朵冲突。

## Impact
- Affected specs: 浅色模式下的记忆页面视觉展示
- Affected code: 
  - `src/web/App.tsx` (`MemoryBackgroundCanvas` 组件)
  - `src/web/styles.css` (可能需要添加或修改样式)
  - 静态资源目录 (例如 `public/images/blue-sky.jpg`)

## ADDED Requirements
### Requirement: Light Mode Image Background
The system SHALL use a specific blue sky sunshine image as the background for the "Memories of You" page when in light mode.

#### Scenario: Success case
- **WHEN** user opens the "记忆中的你" page in light mode
- **THEN** the background displays the blue sky sunshine image instead of the default gradient.

## MODIFIED Requirements
### Requirement: Memory Page Background Rendering
- **Old**: Uses a linear gradient and animated clouds for light mode.
- **New**: Uses a static blue sky sunshine image (with optional pointer glow if appropriate) to provide a better visual experience.
