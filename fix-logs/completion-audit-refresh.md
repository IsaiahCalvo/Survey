# Completion-audit refresh — 2026-08-21

**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.**

Did **not** replay wave7/8/9, leftover 18, or official `npm test`.  
No prod SQL. No budget loosen (8448 / 75/250). No secrets. No `.bot-credentials.json` / `.env*`.

## What this pass did

Re-cited every unique inventory ID (**96** = KB-1 + KB-2 + P1-01…P1-55 + P2-01…P2-39) against current `file:line` and on-disk receipts. Folded flatten/export/import leftovers that later waves already proved. Headline **103** vs unique **96** counting note kept (`COMPLETION-AUDIT.md` §7).

Import/wave receipts `fix-logs/e2e-testpdf-import.md` and `fix-logs/e2e-import-roundtrip.md` were already clean on HEAD (`3a8b09a1` / `0afa3687`) — nothing dirty to add besides this refresh + the audit file.

## Counts

| Bucket | Count | Notes |
|---|---|---|
| **proven** (original 96) | **96** | 0 weak / 0 missing / 0 host-blocked as vanished IDs |
| **host-blocked** (E2E remaining paths) | **18** | unchanged; not retried |
| **leftover** (not unique IDs) | **18** host paths + crossing-cuts cap + 5 SQL apply | see below |

### Proven 96

All §1 IDs **proven**. Citations refreshed this pass for drifted flatten writers (P1-01 `:3353-3356` / `:2362` / `:3144`; P1-02 `:2515`; P1-04 `:3367-3370`) and for remaining file:line gaps.

Folded leftovers now proven (still the same 96 IDs, not new ones):

- P1-01 export+print `getLineEndpoints` (wave8) + `legacyArrowGroupToLine` sibling
- P1-04 family: polygon/polyline vertices, circle `/Rect`, ink print affine (`aa0f0964`), FreeText scale (`99478f57`)
- Wave9 drawable export+flatten **10 / 10**
- `?testPdf=kal412-mixed-import-e2e.pdf` import **1 / 1**
- Stamp/image: not a `?testPdf=` tool; no writer invented

### Host-blocked 18 — unchanged

`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe click, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Hub web file-control import of an annotated export stays in this 18 (`A-01` / `X-05`) — `fix-logs/e2e-import-roundtrip.md`.

### Leftover (not unique IDs)

- Crossing-cuts allocation: latest official `npm test` **exit 1** — `500 crossing cuts` **11960.66 MiB > 8448.00 MiB** (`fix-logs/stamp-export-and-npm-test.md`). Cap **not** loosened. Timing **75 / 250** held. This pass did not re-run the suite.
- SQL apply (do not apply to prod Survey): P2-01, P2-03, P2-05, P2-10, P2-21, P2-23, P2-28, P2-29 / E2E-CHROME-01
- P1-45: no 30-day trash row (session undo is the close)
- P1-46: guest / no-Y.Doc still localStorage-only

## 103 vs 96

Unchanged. Headline 103 = 96 unique + 1 folded z-order + 4 merged-sub extras (P2-34 / P2-35) + 2 undocumented rollup. See `COMPLETION-AUDIT.md` §7.

## Goal

Stays **open**.
