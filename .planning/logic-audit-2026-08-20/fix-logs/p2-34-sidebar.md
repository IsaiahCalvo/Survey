# P2-34 leftover — `B` sidebar toggle

Worker: p2-34-sidebar · 2026-08-20
Do not edit ISSUE-INVENTORY / FEATURE-MATRIX / FIX-LOG from this worker.

---

### P2-34 leftover — `B` sidebar
- Date: 2026-08-20
- Status: **closed**
- Files changed: `src/PDFSidebar.jsx` (public `toggleCollapse` on the imperative handle + testable flip/gate helpers), `src/PDFViewer.jsx` (plain `B` in the existing keyboard handler), `tests/sidebarToggleHotkey.test.mjs`
- Intended behavior confirmed: `B` / `b` with no modifiers calls `pdfSidebarRef.current.toggleCollapse()`. Already-closed opens; already-open closes. Input / textarea / contenteditable swallow the key (same `isFormField` gate as V/P/H). Did not touch AppShell, zoomGeneration, canvas sizing, SVG viewBox, or CORS.
- Break / adversarial attempts: Cmd/Ctrl/Alt/Shift+B stay inert. Missing sidebar ref is a no-op (`?.`). Read-only docs still toggle (collapse is not a mutation).
- Edges covered: open→closed, closed→open, form-field ignore, modifier ignore, viewer source-assert that `B` calls `toggleCollapse`.
- Test command + result: `node --test tests/sidebarToggleHotkey.test.mjs` → **5/5 pass**. `npm test` after the PDFViewer touch → **exit 0**.
- Remaining risk: `KeyboardShortcutsOverlay` still omits `B` (P2-34 removed the unimplemented listing; overlay is outside this allowlist). Mobile already-open goes through `closePanel` (animated dismiss) instead of the desktop flip. If the left-rail ref is not attached (loading / inactive tab), `B` no-ops. Tests prove the gate + handle wiring, not a mounted rail click.

Did **not** edit: ISSUE-INVENTORY, FEATURE-MATRIX, FIX-LOG, `KeyboardShortcutsOverlay.jsx`, `AppShell.jsx`. No commit.
