# 修复 chart-renderer.tsx 编译错误 Spec

## Why
`src/web/chart-renderer.tsx` 中存在两处三元运算符嵌套语法错误，导致 TypeScript 编译和 Vite 构建均失败，前端完全无法构建。这是阻塞性问题，必须立即修复。

## What Changes
- 修复 `chart-renderer.tsx` 第346-353行饼图 Cell 组件的 `filter` 属性三元运算符嵌套错误
- 修复 `chart-renderer.tsx` 第473-480行柱状图 Bar 组件的 `filter` 属性三元运算符嵌套错误

## Impact
- Affected code: `src/web/chart-renderer.tsx`
- 影响范围：前端构建完全无法通过，所有图表渲染功能不可用

## ADDED Requirements

### Requirement: chart-renderer.tsx 编译通过
系统SHALL确保 `chart-renderer.tsx` 文件无 TypeScript 编译错误，Vite 构建成功。

#### Scenario: TypeScript 编译
- **WHEN** 执行 `tsc -p tsconfig.app.json --noEmit`
- **THEN** 编译SHALL成功，0错误

#### Scenario: Vite 构建
- **WHEN** 执行 `vite build`
- **THEN** 构建SHALL成功，无 esbuild transform 错误

### Requirement: 饼图 hover 滤镜逻辑正确
饼图 Cell 组件的 `filter` 属性SHALL在 hover 时应用亮度滤镜，非 hover 时无滤镜。

#### Scenario: hover 饼图扇区
- **WHEN** 用户 hover 饼图某个扇区
- **THEN** 该扇区SHALL应用 `brightness(1.1)` 滤镜效果

#### Scenario: 未 hover 饼图扇区
- **WHEN** 用户未 hover 饼图扇区
- **THEN** 扇区SHALL无滤镜效果（`none`）

### Requirement: 柱状图 hover 滤镜逻辑正确
柱状图 Bar 组件的 `filter` 属性SHALL在 hover 时应用亮度滤镜，非 hover 时无滤镜。

#### Scenario: hover 柱状图柱子
- **WHEN** 用户 hover 柱状图某个柱子
- **THEN** 该柱子SHALL应用 `brightness(1.1)` 滤镜效果

#### Scenario: 未 hover 柱状图柱子
- **WHEN** 用户未 hover 柱状图柱子
- **THEN** 柱子SHALL无滤镜效果（`none`）

## MODIFIED Requirements
无修改的需求。

## REMOVED Requirements
无移除的需求。
