# Hunt P1-46 guest localStorage — 2026-08-26

## Leftover taken

**None.** Genuine hunt of P1-46 guest localStorage (leak / persist / wipe) after tip `c6f1c1dd` / product `6c1ab2cd`. Persist works. Guest / no-Y.Doc stays localStorage-only — accepted product default, not taken. Goal stays OPEN.

Did **not** replay the eight exhausted hunts. Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, Color chrome on 390, eraser-cut Width restroke, imported-outline Width restroke, page-name chrome, guest Y.Doc, or a name/`type`/row leftover. HIGH-RISK files not touched. Did **not** stamp `file.id`. Did **not** take leftover-18.

## Why P1-46 is not a leftover

| Probe | Evidence | Verdict |
|---|---|---|
| **Guest / no-Y.Doc localStorage-only** | `mergeSidebarWrite` + Y.Doc meta only when `yjsDoc` exists; `if (!yjsDoc) return` | **accepted default** — promoting guests to Y.Doc invents a product default |
| **Wrong persist** | Live `/?testPdf=` Add bookmark `KeepMe` + Current page writes `pdfSidebar_*`; one key | **already aligned** |
| **Wrong wipe** | Reload without clearing `pdfSidebar_*` keeps `KeepMe` visible | **already aligned** — not a wipe |
| **Leak across pdfIds** | Reload keeps a single `pdfSidebar_` key | **already aligned** |
| **AppShell guest wipe** | Wipes `dashboardViewMode` / `projects` / `templates` / `pdfViewerZoomPreference` only; comment keeps `pdfSidebar_*` | **accepted default** — inventing a `pdfSidebar_*` wipe is a guest-mode product default |
| **True guest PDF** | Guest mode blocks uploads; `?testPdf=` is mock developer | **cannot prove leak without leftover-18 hosts / inventing guest defaults** |
| **handleRenamePage** | Extracted but never passed as `onRenamePage` | **no live page-name chrome** — do not invent |

Live `/?testPdf=clickable-link-test.pdf` at 1440 — Bookmarks `KeepMe` persists across reload; empty first load invents 0; hubPreview Color / Hex **0**; `file.id` null; viewBox **`0 0 612 792`**. 390 edge: viewBox / `file.id` / hex chrome **0**.

## Files

- `tests/afterP146GuestLsHunt.test.mjs`
- `debug/scenarios/e2e-after-p146-guest-ls-hunt.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/after-p146-guest-ls-hunt-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-after-p146-guest-ls-hunt.spec.mjs` **2 / 2 (6.6s)**.

- Intended: Bookmarks `KeepMe` persist + reload; viewBox / `file.id`
- Break: empty first load invents 0; hubPreview Color / Hex **0**
- Edge: 390 viewBox / `file.id` / hex chrome **0**

Focused Node `afterP146GuestLsHunt` + leftover18FailClosed **15 / 15**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI not required (no product edit).

## Hunt remaining unique leftovers (NOT leftover-18)

- Overlay still lists no clipboard shortcuts — remaining, not taken (P1-34 handlers already live)
- Overlay lists Ctrl+O Open document — Electron File menu only; web viewer has no handler — not taken (do not invent Open file / UL-03)
- Overlay omits Shift+E Partial erase — remaining, not taken
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- Eraser-cut paper-ink Width still patches `sourceWidth` only — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
