# Product bug: Documents sort dismiss ate Search / Upload — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip:** `d9cb10b7` (fix + live proof).  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

The Style/Search inspect (`09a0aca9` / `be57e5b9`) parked remaining click-eat dismiss. This pass found the complementary Documents header hole: 390 sort `DismissBarrier` had no Search/Upload passthrough, so the first Upload tap only closed the menu; focused Search also ate the first sort tap (Archive already passthroughed its filter button). Distinct from leftover-18 / X-01. Did **not** invent flatten / stamp / Forms.

Inspected and **not** the same hole:

- Settings / Account — ProfileMenu full-viewport scrim (intentional consume); AccountSettings is a modal overlay
- History sidebar — no DismissBarrier / sibling popover of this class
- Bookmarks create — first outside click is consumed on purpose
- Spaces / Templates search — already passthrough / Archive wraps Search in `insideRefs`
- 390 Style / Arrowhead / Font — already `MOBILE_SELECT_SIBLING_PASSTHROUGH`
- Desktop CompactColorPicker / Highlighter / Match Fill / C-04 — already `COLOR_PICKER_SIBLING_PASSTHROUGH`
- 390 color takeover — modal backdrop; strip chrome stays underneath
- Hub More / document-row dismiss — first outside click is consumed on purpose
- Canvas dismiss — still consumed

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.bot-credentials.json` / `.env.test` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another X-01 receipt.

## Product

Min-viable:

- `src/home/DocumentsLedger.jsx` — `DOCUMENTS_SORT_SIBLING_PASSTHROUGH` (Search / Upload) on the mobile sort `DismissBarrier`
- Same file — Search `dismissActionSelector` also includes `.documents-mobile-filter`

Document-row clicks stay consumed. Canvas / Hub More consume stays intentional.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-dismiss-sibling-passthrough.spec.mjs` **3 / 3 (11.6s)** on Vite `http://127.0.0.1:5234`. Focused Node `mobileSelectSiblingPassthrough` + `hubDismissBarrierContracts` + `viewerDismissBarrierContracts` + `leftover18FailClosed` **25 / 25**.

`?testPdf=clickable-link-test.pdf`. `file.id` null.

### Intended — **pass**

390 Documents: open sort + first Upload click logs `[hub preview] upload` and closes the menu. Open sort + first Search click focuses the field. Focused Search + first sort tap opens the menu.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Document row | sort open, click a ledger row | menu closes; editor does not open |
| Canvas / Style | 390 Style open, tap page with Pen available | menu closes; ink count unchanged (prior test) |

### Edge

| Slice | Evidence |
|---|---|
| 390 | first Upload / Search / sort while the other is open |
| desktop | sort filter hidden; Search → Upload still lands |
| testPdf | Draw visible; `file.id` null |

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
