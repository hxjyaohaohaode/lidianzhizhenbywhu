# Tasks
- [x] Task 1: 准备蓝天图片资源
  - 说明：由于无法直接从聊天提取图片，请在 `public/images/` 目录下创建一个名为 `blue-sky.jpg` 的占位图片文件（如果目录不存在则创建），并确保代码引用此路径。任务完成后，系统会提示用户将自己的图片替换到该位置。

- [x] Task 2: 更新浅色模式下的背景样式
  - 目标：修改 `src/web/App.tsx` 中的 `MemoryBackgroundCanvas` 和相关样式，使其在浅色模式（`!isDark`）下显示蓝天阳光图片。
  - 步骤：
    - 在 `src/web/styles.css` 中为 `.mbg` 元素添加在浅色模式下应用背景图的样式规则（或者在组件内联控制），引用 `/images/blue-sky.jpg`，并设置 `background-size: cover; background-position: center;`。
    - 修改 `src/web/App.tsx` 的画布绘制逻辑：在 `!isDark` 的 `else` 分支中，清除原有渐变背景和可能与图片冲突的云朵绘制逻辑（`drawCloud`），保留高光（glow）等交互效果，或直接将 canvas 设为透明以透出下层 `.mbg` 的图片背景。
    - 确保 `MemoryBackgroundCanvas` 的最外层 `div.mbg` 能正确应用浅色模式样式。

- [x] Task 3: 验证深浅色模式切换
  - 目标：确保深色模式下原有的星空动画不受影响，仅浅色模式下使用图片背景。
