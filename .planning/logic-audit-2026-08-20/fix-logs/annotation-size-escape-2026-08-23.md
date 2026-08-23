# Product bug: Width / Size Escape skip-commit — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip:** `9054d23e` (fix + live proof).  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

The `43cefd4f` inspect missed this. `AnnotationSizeControl` already had draft-while-typing + blur persist (next-draw live; selected-patch on commit). Zoom % / page # / rotation restore on Escape. Width / Size did not, so a typed draft stayed live and click-away persisted it. Distinct from D-05 every-preset catalogs, leftover-18 / X-01. Did **not** invent flatten / stamp / Forms.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity.

## Product

Min-viable in `src/components/AnnotationSizeControl.jsx`:

- Focus snapshots the committed value.
- Escape restores that value via `onValueChange`, sets a skip-commit flag, and blurs.
- The following blur does **not** call `onValueCommit` (no persist / no selected patch).
- Enter still blurs and commits.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-annotation-size-escape.spec.mjs` **2 / 2 (10.0s)** on Vite `http://127.0.0.1:5195`. Focused Node `annotationSizeControlList` + leftover18 **17 / 17**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop Pen default **3**. Type **32** + Escape: field **3**; next ink `83c7b6c7-…` `sourceWidth` **3**. Type **32** + Enter: ink `07331d0a-…` `sourceWidth` **32**.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Over-max | 999 + Escape | restore **32**; ink `9a640403-…` stays 32 (not clamp-commit 50) |
| Empty | clear + Escape | restore **32** |
| Click-away | 8 + Escape then blur | ink `3824a02d-…` stays **32** |
| Selected rect | `e6bc085b-…` type 16 + Escape | `strokeWidth` **2** |
| Selected rect | then 16 + Enter | `strokeWidth` **16** |
| Eraser Size | 80 + Escape | restore **20** (not Pen 32); Enter 24 commits Size |

### Edge

| Slice | Evidence |
|---|---|
| 390 | baseline 3; 32 + Escape ink `d44df471-…` width 3; 12 + Enter `c4e9b08f-…` width 12; 999 + Escape restores 12 |
| hubPreview | Width **0**; Draw **0** |
| viewBox | `0 0 612 792` |
| `file.id` | null |

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
