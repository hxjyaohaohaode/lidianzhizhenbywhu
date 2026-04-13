# Tasks

- [x] Task 1: Update App.tsx imports
  - [x] SubTask 1.1: Import `createPortal` from `react-dom` at the top of `src/web/App.tsx`.
- [x] Task 2: Optimize EntHome Popups
  - [x] SubTask 2.1: Wrap `.chart-tooltip` rendering in `EntHome` with `createPortal(..., document.body)`.
  - [x] SubTask 2.2: Wrap `.chart-modal-overlay` rendering in `EntHome` with `createPortal(..., document.body)`.
- [x] Task 3: Optimize InvHome Popups
  - [x] SubTask 3.1: Wrap `.chart-tooltip` rendering in `InvHome` with `createPortal(..., document.body)`.
  - [x] SubTask 3.2: Wrap `.chart-modal-overlay` rendering in `InvHome` with `createPortal(..., document.body)`.
- [x] Task 4: Optimize MemoryNodeDialog
  - [x] SubTask 4.1: Wrap `MemoryNodeDialog`'s return JSX (`.ndo`) with `createPortal(..., document.body)`.