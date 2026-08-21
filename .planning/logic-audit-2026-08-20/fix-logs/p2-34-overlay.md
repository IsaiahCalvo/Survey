# P2-34 leftover — shortcuts overlay `B`

Worker: p2-34-overlay · 2026-08-20
Do not edit ISSUE-INVENTORY / FEATURE-MATRIX / FIX-LOG from this worker.

---

### P2-34 leftover — overlay `B`
- Date: 2026-08-20
- Status: **closed** (added)
- Files changed: `src/components/KeyboardShortcutsOverlay.jsx`
- Intended behavior confirmed: Interface section now lists `B` → Toggle sidebar, matching the live viewer handler (`e.key === 'b' || e.key === 'B'` → `pdfSidebarRef.current?.toggleCollapse?.()`). Overlay is a standalone component, not a static list inside `PDFViewer.jsx`. Did not touch PDFViewer, PDFSidebar, AppShell, zoomGeneration, canvas sizing, SVG viewBox, or CORS.
- Break / adversarial attempts: listing is documentation only — modifiers, form-field swallow, and missing-ref no-op stay in the live handler. Overlay still does not claim Cmd/Ctrl/Alt/Shift+B.
- Edges covered: `B` sits in Interface next to `?` / Esc (chrome toggles), not Tools. Description is "Toggle sidebar" so it matches the leftover ask and the sidebar handle, not "bookmarks" (P2-34 had stripped the unimplemented listing).
- Test command + result: no overlay test exists; allowlist forbids creating one. Did not re-run `tests/sidebarToggleHotkey.test.mjs` (handler already closed in `p2-34-sidebar.md`).
- Remaining risk: overlay is a hardcoded array, not derived from the viewer listener, so it can drift again. No source-assert gates the listing. Live `B` still no-ops when the left-rail ref is missing (loading / inactive tab); overlay does not mention that.

Did **not** edit: ISSUE-INVENTORY, FEATURE-MATRIX, FIX-LOG, `PDFViewer.jsx`, `PDFSidebar.jsx`. No commit.
