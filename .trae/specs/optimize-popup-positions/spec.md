# Optimize Popup Positions Spec

## Why
Currently, tooltips and modals (such as `.chart-tooltip` and `.chart-modal-overlay`) within the application (e.g., in `EntHome` and `InvHome` components) are suffering from incorrect positioning and clipping. This occurs because parent containers (like `.pg`) utilize CSS properties such as `backdrop-filter` or `transform` (from animations), which unintentionally establish a new containing block for `position: fixed` elements. As a result, the tooltips and modals are positioned relative to their parent container rather than the viewport, leading to visual bugs and misalignment.

## What Changes
- Implement React Portals (`createPortal`) for all `.chart-tooltip` elements so they are rendered directly into `document.body`.
- Implement React Portals (`createPortal`) for all `.chart-modal-overlay` elements so they are rendered directly into `document.body`.
- Implement React Portals for `MemoryNodeDialog` (`.ndo`) to ensure consistent modal behavior across the app.
- Ensure that `createPortal` is imported from `react-dom` in `App.tsx`.

## Impact
- Affected specs: UI alignment, Modal and Tooltip positioning.
- Affected code: `src/web/App.tsx`.

## MODIFIED Requirements
### Requirement: Popup Rendering
**Reason**: Fix incorrect positioning caused by CSS containing blocks (`transform`/`backdrop-filter` on parent elements).
**Migration**: Wrap the tooltip and modal JSX elements with `createPortal(..., document.body)` to escape the DOM hierarchy and align them correctly with the viewport.