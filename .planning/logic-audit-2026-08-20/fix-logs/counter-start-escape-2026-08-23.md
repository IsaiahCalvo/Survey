# Product bug: Counter Start Escape skip-commit — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip:** `f93e902b` (fix + live proof).  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

The Width/Size Escape inspect (`43cefd4f` / `b8d6ae55`) missed this sibling. Counter Start already had draft-in-the-input + Enter/blur persist (`onSelectedCounterSeriesStartChange`). Zoom % / page # / rotation / Width / Size restore on Escape. Start did not, so a typed draft stayed in the field and click-away persisted it. Distinct from Size catalog, leftover-18 / X-01. Did **not** invent flatten / stamp / Forms.

Inspected and **not** the same hole (live-apply, no blur-commit draft):

- CompactColorPicker opacity % + hex — `onChange` applies immediately
- Cloud bump — `setCloudIntensity` on every keystroke
- Unused `annotationOpacityInputValue` state in PDFViewer — no live field
- Bookmark rename / page — already skip-commit
- Project hub rename — blur-commit text, not annotation chrome (left parked)

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

Min-viable in `src/AppShell.jsx` (`CounterStartNumberField`):

- Focus snapshots the committed start.
- Escape restores that value, sets a skip-commit flag, and blurs.
- The following blur does **not** call `onSelectedCounterSeriesStartChange`.
- Enter still blurs and commits (clamp ≥ 1).

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-counter-start-escape.spec.mjs` **2 / 2 (7.5s)** on Vite `http://127.0.0.1:5196`. Focused Node `counterSizeStartNumber` + `annotationSizeControlList` + leftover18 **20 / 20**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop Counter pin `49977e84-…` Start **1**. Type **10** + Escape: field **1**; `displayNumber` **1**. Type **10** + Enter: `displayNumber` **10**.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Over-range | 99 + Escape | restore **10**; pin stays 10 |
| Empty | clear + Escape | restore **10** |
| Letters | `abc` strips then Escape | restore **10** |
| Click-away | 8 + Escape then blur | pin stays **10** |

### Edge

| Slice | Evidence |
|---|---|
| 390 | Start **0** (mobile chrome has Size, no Start field) |
| hubPreview | Start **0**; Draw **0** |
| viewBox | `0 0 612 792` |
| `file.id` | null |

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
