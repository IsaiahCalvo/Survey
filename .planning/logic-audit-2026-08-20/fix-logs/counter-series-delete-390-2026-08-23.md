# Product bug: 390 Counter series missing Delete — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip:** `37b9a0c2` (fix). Live proof follows.  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

Search / DismissBarrier first-tap is exhausted this campaign. Escape skip-commit / rename / INPUT / color-picker Width/Style are exhausted.

Switched class: **390 vs desktop missing control**. The Counter Start 390 inspect parked series-list **Delete** on 390 (New Count + Continue Count only). Desktop context-menu Delete was already live (UL-35 / `e2e-counter-series-delete`). Distinct from leftover-18 / X-01 / pin Delete / Continue Count switch. Did **not** invent flatten / stamp / Forms.

## Product

Min-viable in `src/mobile/MobilePdfViewerChrome.jsx`:

- Each Continue Count row now mounts `data-counter-series-delete` when `onDeleteCounterSeries` is published
- Same confirm runner + permission toast as AppShell
- CSS row + red Delete chip (`mobilePdfViewer.css`)

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-counter-series-delete-390.spec.mjs` **2 / 2 (8.1s)** on Vite `http://127.0.0.1:5255`. Focused Node `counterSeriesDeleteExecute` + `continueCountToolbar` + leftover18 + `counterSizeStartNumber` **21 / 21**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

390 pins `95a5af0d-…` / `806a71a1-…` / `201338b0-…` series `series-1787453738848`. Count 2 isolate `1cc10006-…` series `series-1787453740037`. Desktop wipe `5aef9f7f-…`.

### Intended — **pass**

390 empty-armed Delete **0**. 3-pin series Delete opens confirm. Cancel keeps pins. Delete count wipes. Desktop context Delete still wipes (`5aef9f7f-…`).

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Cancel | confirm Cancel | 3 pins stay |
| Isolate | Delete Count 1 after New Count | Count 2 pin stays |

### Edge

| Slice | Evidence |
|---|---|
| Undo | restores **1, 2, 3** |
| 390 Pen | hides Delete |
| hubPreview | Delete **0**; Draw **0** |
| viewBox | `0 0 612 792` |
| `file.id` | null |

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
