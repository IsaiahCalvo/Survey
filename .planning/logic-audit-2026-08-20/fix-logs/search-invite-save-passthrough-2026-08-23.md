# Product bug: Search dismiss ate Invite / Save — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip:** `7245df14` (fix + live proof).  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

The Documents sort inspect (`d9cb10b7` / `77bf0187`) parked remaining click-eat dismiss. This pass found the complementary Search sibling holes: Manage Team Search had no Invite / Edit passthrough, so the first Invite tap only blurred the field; 390 Templates content Search had no Save-row passthrough, so the first Save tap only blurred. Archive already wraps Search in `insideRefs` and passthroughed its filter button; Projects has no sort/filter sibling of this class. Distinct from leftover-18 / X-01. Did **not** invent flatten / stamp / Forms.

Inspected and **not** the same hole:

- Archive 390 / desktop — Search is inside the filter `insideRefs`; focused Search → filter already passthrough
- Projects — no sort/filter control; Search → New project already passthrough
- Spaces — no Search + DismissBarrier pair
- Templates New template — already in `dismissActionSelector`
- Hub More / member-row dismiss — first outside click is consumed on purpose

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

- `src/home/ManageTeamModal.jsx` — `MANAGE_TEAM_SEARCH_SIBLING_PASSTHROUGH` (Invite / Edit) on the Search `DismissBarrier`
- `src/home/TemplatesEditor.jsx` — mobile drill Search `dismissActionSelector` also includes `.templates-mobile-save-row button`

Member-row clicks stay consumed. Canvas / Hub More consume stays intentional.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-dismiss-sibling-passthrough.spec.mjs` **4 / 4 (15.4s)** on Vite `http://127.0.0.1:5245`. Focused Node `mobileSelectSiblingPassthrough` + `hubDismissBarrierContracts` + `viewerDismissBarrierContracts` + `leftover18FailClosed` + `templatesSearch` + `archiveSearch` **32 / 32**.

`?testPdf=clickable-link-test.pdf`. `file.id` null.

### Intended — **pass**

Manage Team: focused Search + first Invite click opens Invite User. Focused Search + first Edit tap enters edit mode. 390 Templates: dirty via New category + focused content Search + first Save tap clears the save row.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Member row | Search focused, click a teammate row | field blurs; More menu does not open |
| Document row / canvas | prior suite | still consume-only |

### Edge

| Slice | Evidence |
|---|---|
| desktop Manage Team | first Invite / Edit while Search is focused |
| 390 Templates | first Save while content Search is focused |
| testPdf | Draw visible; `file.id` null |

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
