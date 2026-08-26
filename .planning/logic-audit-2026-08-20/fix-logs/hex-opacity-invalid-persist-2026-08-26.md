# P1-39 hex leftover sibling — Opacity persists `#zzzzzz` — 2026-08-26

## Leftover taken

**P1-39** (not leftover-18). Live Color Hex already skipped `applyHex('zzzzzz')` so the field-only path kept last valid black, but Opacity still `onChange(localHex)` so first-create leftover-stamped fill **`#zzzzzz`** until Color was re-touched. Distinct from leftover-18, C-01 swatch apply, C-02 hex-field-only lengths, and inventing 390 Color chrome. Did **not** replay the seven exhausted hunts.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

## Hunt (unprobed audit IDs)

`ca258573` only probed P1-21 / P1-27 / P1-20 / P1-28 / P1-16 / P1-25/26 / P1-32 / KB-1 / KB-2. This pass walked remaining unprobed IDs that can still be live on `?testPdf=` / `?hubPreview=1` / 390:

| Candidate | Live / source probe | Verdict |
|---|---|---|
| P1-29 Shift+marquee | `useSVGInteraction.js` `unionIdSet` / `subtractIdSet` | **already aligned** |
| P1-31 SHX handles | `SELECT_DELETE_ONLY` includes AutoCAD SHX Text | **already aligned** |
| P1-33 context z-order | `handleReorderAnnotation` `resolveAnnotationIndexById` | **already aligned** |
| P1-34 Cmd+C/X | multi `selectedIndexes` + PDFViewer callout clipboard | **already aligned** |
| P1-35 paste offset | `pageSizesRef` with 612/792 fallback only | **already aligned** |
| P1-37 font opacity | `AppShell` `showOpacity={false}` | **already aligned** |
| **P1-39 hex + Opacity** | `?testPdf=` Rectangle Color Fill | **LIVE leftover** — `zzzzzz` then Opacity 40 stamped `#zzzzzz` |
| P1-40 / P1-41 zoom fit | `handleZoomModeSelectRef` | **already aligned** |
| P1-42–P1-44 / P1-48 / P1-49 / P1-51 | thumbnailStore / reorder / nextBookmarkOrder / revert / `pageMutationRevision` / empty-space toast | **already aligned** |
| P2-34 shortcuts | overlay Home/End/B + handlers | **already aligned** |
| leftover-18 | — | **not taken** |

Pre-fix live probe: `pressSequentially('zzzzzz')` + Opacity **40** first Rect fill **`#zzzzzz`**. After fix: fill **`rgba(0, 0, 0, 0.4)`**.

Did **not** invent envelope extras. Did **not** take leftover-18. Did **not** invent Color chrome on 390. Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, or a richTextEditor.

## Product

`src/components/CompactColorPicker.jsx` (not high-risk):

- Opacity slider / % field use `commitRememberedOpacity`
- Commits `normalizeHexColor(localHex) || normalizeHexColor(color)`
- Invalid leftover `#zzzzzz` no longer reaches `composeColorForPatch`

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-hex-opacity-invalid-persist.spec.mjs` **2 / 2 (7.0s)**.

- Intended: `?testPdf=clickable-link-test.pdf` at 1440 — Rectangle Color Fill `#000000` + `zzzzzz` + Opacity **40** first box fill **`rgba(0, 0, 0, 0.4)`** (not leftover `#zzzzzz`); later `f00` + Opacity **20** writes `#FF0000` @ **0.2**
- Break: empty reload invents **0**; hubPreview Color / Hex **0**
- Edge: 390 viewBox / `file.id` / hex chrome **0** (do not invent)

Focused Node `pdfHexOpacityInvalidPersist` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Overlay still lists no clipboard shortcuts — remaining, not taken (P1-34 handlers already live)
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- Eraser-cut paper-ink Width still patches `sourceWidth` only — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
