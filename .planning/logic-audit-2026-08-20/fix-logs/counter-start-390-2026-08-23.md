# Product bug: 390 Counter missing Start — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip:** `03f5f2b4` (fix). Live proof follows.  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

Search / DismissBarrier first-tap is exhausted this campaign (Manage Team Invite, 390 Templates Save, Documents sort, Documents/Projects Search→Upload/New, Archive filter, CompactColorPicker Width/Style, 390 Style/Arrowhead). Access / Share / Settings / entity picker / History / Bookmarks / Spaces have no focused Search + sibling primary of this class.

Switched class: **390 vs desktop missing control**. The Counter Start Escape inspect parked `Start **0**` on 390 (Size only). Desktop Start was already live. Distinct from leftover-18 / X-01 / Escape skip-commit replay. Did **not** invent flatten / stamp / Forms.

## Product

Min-viable:

- Extract `CounterStartNumberField` (`src/components/CounterStartNumberField.jsx`) — same Enter/blur commit + Escape skip-commit
- `src/mobile/MobilePdfViewerChrome.jsx` — mount Start when a lone series is selected (`selectedCounterSeriesSize !== 1` locks)
- `src/AppShell.jsx` — import the shared field (no behavior change)

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-counter-start-escape.spec.mjs` **2 / 2 (7.9s)** on Vite `http://127.0.0.1:5255`. Focused Node `counterSizeStartNumber` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

390 selected pin `cb8dff89-…` reveals Start + Size. Type **10** + Escape: field **1**. Type **10** + Enter: `displayNumber` **10**. Desktop Escape/Enter still pass (`3f6607e3-…`).

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Over-range | 99 + Escape | restore **10** |
| Letters | `abc` + Escape | restore **10** |
| Second pin | drop after Start 10 | labels **10 / 11**; Start disabled |

### Edge

| Slice | Evidence |
|---|---|
| 390 Pen | hides Start |
| hubPreview | Start **0**; Draw **0** |
| viewBox | `0 0 612 792` |
| `file.id` | null |

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
