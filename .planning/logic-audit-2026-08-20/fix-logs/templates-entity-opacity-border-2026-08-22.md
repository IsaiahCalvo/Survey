# Templates editor entity opacity + independent Border tab — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Templates archived hard-delete, the hunt named remaining thinner chrome: entity opacity / Border tabs vs fill-only entity color. Distinct from viewer every-swatch (C-01…C-06) and leftover-18 Space CSV / PDF Pages. Live-proved on `/?hubPreview=1&tab=templates`. Did **not** invent Extract / Note-Link / Print / stamp / measure / Group / Copy-to-Spaces / category Move/Copy. Did **not** invent `.env.local`. Did **not** replay leftover-18, the Templates CRUD/reorder/search/More/delete family, Spaces, survey-rail, or PDF waves. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not fill-only entity color)

| Prior claim | What was actually asserted |
|---|---|
| U-03 entity color **pass** | Fill preset `#d8a84e` → `#ff0000` + Match-fill lock. Opacity slider and independent Border color/opacity never written. |
| Viewer every-swatch | Fill/border/pen/counter/font sites on `?testPdf=`. Not the Templates roster picker tabs. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| leftover-18 Space CSV / PDF Pages | **Parked.** Do not invent `.env.local`. |
| Templates create/rename/delete / fill-only color / Add module / Dup / Add item / More / archive hard-delete | **Proven.** Do not replay. |
| Templates category / module / entity Move/Copy | **Dead stub.** Copy/Move only `closeMoveModal`. Not invented. |
| `OPACITY` field + Fill/Border layer tabs on `data-entity-color-panel` | **GAP.** Named leftover after fill-only color. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- Desktop + 390 `aria-label="Edit color"` opens `data-entity-color-panel` with Fill/Border + CompactColorPicker (`showOpacity` default true).
- Fill `applyColor` writes `roleColors` `{ color, opacity }` + `setEntityColor` (hex only). Border writes `borderColors`.
- Seed opacity is `0.35` when the HubPreview entity has only `rgba(...,0.5)` (alpha is not `entity.opacity`).
- `richToTemplate` persists `opacity` / `borderColor` / `borderOpacity` / `matchFill`.
- Swatch chip stays full-strength; opacity is the picker field, not the dot.

## Product fix

Switching Fill ↔ Border reused one CompactColorPicker instance. Local hex/opacity stayed on the previous tab until effects flushed (Fill showed Border `#0000FF` / 50%). Min-viable: `key={`${r.id}-${layer}`}` on both CompactColorPicker mounts so each tab remounts as its own settings page. Did not touch `zoomGeneration`, SVG viewBox zoom, or canvas sizing. 8448 not loosened.

## Live-proved

Playwright `debug/scenarios/e2e-templates-entity-opacity-border.spec.mjs` **1 / 1 (with Lock persist: 2 / 2 in 5.5s)** on Vite `http://localhost:5173` + `/?hubPreview=1&tab=templates`. Node `templatesEntityOpacityBorder.test.mjs` **3 / 3**. No high-risk file.

Receipt log: `TEMPLATES_ENTITY_OPACITY_BORDER_PROOF` `emptyZero: true`, `seedOpacity35: true`, `cancelRestored: true`, `fillOpacitySaved: 80`, `borderHexSaved: "#0000ff"`, `borderOpacitySaved: 50`, `isolation: true`, `mobileEdit: 3`, `mobileOpacity: 25`, `mobileBorderHex: "ff0000"`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Seed opacity | **pass** | Fill field **35**. |
| Fill opacity | **pass** | 35 → 80; swatch fill stays `#d8a84e`. |
| Independent Border | **pass** | Border `#0000FF` @ 50; fill stays gold. |
| Save persists | **pass** | After Save, MEP then Security: Fill 80 + Border `#0000ff` @ 50. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Cancel | **pass** | Dirty 80 / blue@50 then Cancel restored gold/gold + 35. |
| Empty templates | **pass** | `/?hubPreview=1&empty=1&tab=templates` Edit color **0**. |
| Tab isolation | **pass** | After Border 50, Fill still 80 / `#d8a84e`. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Isolation | **pass** | Subcontractor fill/border unchanged. |
| 390 | **pass** | Entities dialog Edit color **3**; Fill 25; Border `#ff0000`. |

No error boundary.

## Classification after this pass

- **GAP found and proven:** Templates editor entity opacity + independent Border tab (desktop + 390).
- **Product bugs fixed:** 1 — Fill/Border remounts the shared picker.
- **Omitted (not invented):** Move/Copy stub, checklist Y/N/N-A, leftover-18 export.
- **leftover-18:** still **18**, parked.
- **compile-hidden:** unchanged.

## Files

- `src/home/TemplatesEditor.jsx`
- `debug/scenarios/e2e-templates-entity-opacity-border.spec.mjs`
- `tests/templatesEntityOpacityBorder.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
