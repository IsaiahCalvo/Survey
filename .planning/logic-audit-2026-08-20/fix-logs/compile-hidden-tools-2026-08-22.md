# Compile-hidden tools hunt — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

Host probe: leftover-18 / X-01 hosts **absent**. Print fail-closed blob/OS path already dedicated (`print-panel-failclosed-2026-08-22.md`). Did **not** replay Print. Did **not** flip compile flags. Did **not** invent stamp / measure / Group / Extract / Note-Link / Forms backends. Did **not** invent `.env.local` / Stripe / MSAL / Turnstile / accounts.

## Question

Print’s custom panel is compile-hidden (`PRINT_PANEL_ENABLED = false`) but Cmd/Ctrl+P is still **reachable fail-closed** chrome. Do stamp, measurement, Group / Ungroup, Extract Pages, Note/Link create, or Forms have the same leftover?

## Method

Source-search vs last receipts + FEATURE-MATRIX / E2E-UNLISTED. Live chrome-absence on reused Vite `http://localhost:5173`: `?testPdf=clickable-link-test.pdf` + hubPreview contrast + 390. Did **not** press Ctrl+P. Did **not** press Ctrl+Shift+V / `?renderer=canvas`.

## Classification

| Surface | Class | Why | Live |
|---|---|---|---|
| Stamp renderer / create | **Compile-hidden / zero callers** | No toolbar id, no `setActiveTool('stamp')`, no shortcut. Native `/Stamp` is unsupported-import preserve (`UnsupportedAnnotationsNotice`; X-04). Not a `?testPdf=` writer. | Stamp **0** |
| Measurement / dimension | **Zero callers** | No user tool. Internal Electron-factor calibration only. `Cmd/Ctrl+M` is zoom `MANUAL` (V-04), not a measure arm. Overlay does not list Measure. | Measure **0** |
| Group / Ungroup | **Compile-hidden** | SVG `Cmd+G` / `Cmd+Shift+G` useEffect **early-returns** (listener never attaches). `useAnnotationContextMenu` omits items until matrix-per-shape rewrite. Handlers stay intact. PAL context Group exists only on hidden-dev canvas (`?renderer=canvas` / Ctrl+Shift+V) — **not flipped**. | Group / Ungroup **0**; Ctrl+G / Ctrl+Shift+G → no `[Group]` / `onGroupSelected` logs; Draw stays |
| Extract Pages | **Zero callers** | No handler (`pageContextOps.js`: do not invent). Pages panel has no Extract. UL-32 already **missing-handler**. leftover18-save-export already asserted button **0**. | Extract Pages **0** |
| Note create | **Compile-hidden** | Commented `TODO: Revisit the user-created Note tool`. `REVIEW_TOOL_IDS = ['text', 'callout']`. No `setActiveTool('note')`. PAL `tool === 'note'` has zero toolbar callers. | Text dropdown: Text + Callout; Note **0**; `N` does not mint a Note tool |
| Link create | **Compile-hidden / zero callers** | No writer / no `setActiveTool('link')`. Importer lists Link as unsupported. Native **click-existing** links stay E2E-LINK-01 (not replayed). | Link **0** |
| Forms category + 4 designer tools | **Compile-hidden** | `{false && (` in `AppShell.jsx`. Only that hidden button sets `activeCategoryDropdown === 'forms'`. Subtoolbar is dead without it. No form-tool key. UL-37 already **pass (hidden live)**. Not Print-class: no shortcut intercept. | Forms **0**; `[data-form-tool]` **0**; Text field **0** |

None of these is leftover-18. None is Print-class (flag-off path that still intercepts a shortcut / shows a disabled item / toast / flag-off panel).

Hidden-dev **Ctrl+Shift+V** still toggles SVG↔canvas and would expose PAL Group. That is a flag-equivalent, not fail-closed chrome. Not used.

## Live

Playwright `debug/scenarios/e2e-compile-hidden-tools-unreachable.spec.mjs` **1 / 1 (2.8s)** on reused Vite `http://localhost:5173`.

| Check | Result |
|---|---|
| Intended (`?testPdf=`) | Named buttons **0**. Text category = Text + Callout only (no Note / Link / Underline). `?` overlay lists Select / Pen / … / Counter; no Stamp / Measure / Ungroup / Extract / Forms. |
| Break | Ctrl+G / Ctrl+Shift+G / `N` leave Draw; no group / form / extract console. |
| Edge | Fresh hubPreview Documents: same buttons **0**. 390 Draw sheet: Pen visible; Forms / Stamp / Note **0**. |

Node `tests/compileHiddenToolsUnreachable.test.mjs` **7 / 7**. Did **not** re-run leftover18FailClosed or Print.

## Product

No min-viable product diff. Flags stay off. CORS `*` unchanged. No high-risk file edit. 8448 not loosened.

## Next leftover

Leftover-18 live hosts. First named: **X-01** identity-churn / signed-in cloud save (needs `.env.local` auto-login — still missing; do not invent).

Goal stays open.
