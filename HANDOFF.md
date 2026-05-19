# Handoff: Survey-BetaSafeS2 codebase consistency cleanup

**Generated**: 2026-05-19
**Branch**: `survey-marker-rename` (16 commits ahead of `main`, working tree clean)
**Status**: In Progress — rename complete & verified; three follow-up items open

## Goal

Make the Survey-BetaSafeS2 codebase internally consistent and professionally
documented so any engineer or agent can navigate it. Began with a domain-language
audit, locked vocabulary in `CONTEXT.md`, then executed renames. The big rename
(Survey Highlight → Survey Marker) is done. Two planned renames and several
testing-surfaced bugs remain.

## Completed

- [x] Multi-agent codebase audit (handle drawing, terminology, comments, redundancy, organization).
- [x] `CONTEXT.md` rewritten as a real glossary: Template, Module, Category, Checklist Item, Survey Marker, Entity, Survey mode, Base layer, Text Callout, Counter Pin, Counter series, Space, Region.
- [x] **Plan A — Survey Highlight → Survey Marker rename** (full plan in `docs/superpowers/plans/2026-05-18-survey-marker-rename.md`). Code, database, and saved-PDF format. Build passes; 673/680 tests pass (1 pre-existing failure, 6 skipped).
- [x] Leftover `bicName` variable renamed to `entityNameFromExcel`.
- [x] DB migrations applied to **live** Supabase: `20260518000001` (allow both `highlight` and `survey-marker` types), `20260518000002` (backfill rows to `survey-marker`, drop `highlight` from the CHECK), `20260518000003` (rename the `ballInCourtEntities` key inside `templates.config`).
- [x] **Bug fix — Entity step was skipped** (pre-existing, not the rename): templates stored their entity roster under the legacy key `ballInCourtEntities`; survey code only read `entities`. Fixed with a load-time normalizer in `src/App.jsx` (the `templates` useMemo) plus migration `20260518000003`.
- [x] **Bug fix — entity colour did not persist** (pre-existing): editing a Survey Marker's Entity updated `entityColor` but not the saved `color`. Fixed in `src/services/documentSurveyMarkerMapper.js` (`buildSurveyMarkerRow` now persists `entityColor` as `color`; `mapSurveyMarkerRowToLocalAnnotation` mirrors it back). Verified by the user — edits now survive save + refresh.

## Not Yet Done

- [ ] **Orphan Survey Marker bug** (NEW — discovered, not yet investigated). See its own section below.
- [ ] **Plan B — untangle Space vs Module.** A latent data bug: one field on a Survey Marker (`spaceId`) holds *either* a Module ID *or* a real Space ID depending on how the marker was created (the dual-meaning write is at roughly `src/App.jsx:31469`). ~49 `moduleId || spaceId` fallback expressions across `App.jsx`, `pdfAnnotationsPdfLib.js`, `pdfCalloutMetadata.js`, `pdfAppAnnotationMetadata.js`. The DB `document_annotations` table has both `module_id` and `space_id` columns. Fix: split the two meanings into two distinct fields, then migrate/backfill, then remove the fallbacks.
- [ ] **Plan C — universal-ID rename.** `highlightId` (in memory) and `highlight_id` (DB column) are the *universal* identity of EVERY annotation type, not the Survey Marker concept — they are misnamed. The user chose to rename them to `annotationId` / `annotation_id` as its own separate migration. Touches every annotation type and a core DB key.
- [ ] **Double-click on a Survey Marker should expand + focus it in the survey panel.** Currently double-click only navigates to the panel and flashes a blue glow on the marker; it does not expand the panel row. Desired: expand the row and focus that marker.
- [ ] **Needs-entity preview style.** The user says a Survey Marker awaiting an Entity should preview as a blue dashed outline with a clear fill; it currently shows an amber/yellow fill. A prior intended design change appears lost or never applied.
- [ ] **Unverified:** user thought a Survey Marker saved as Entity "100% Complete" (green) but it showed "GC" (purple). Could not confirm without DB read access — may be a mix-up or related to the orphan bug.
- [ ] **Merge `survey-marker-rename` into `main`** once the user signs off (see Warnings — main is currently DB-incompatible).

## Failed Approaches (Don't Repeat These)

- The name audit estimated ~600 rename occurrences. Reality was far larger — the word "highlight" pervaded compound identifiers and bare local variables. It took ~6 sweep passes to reach a clean grep. **Lesson: treat an audit's occurrence count as a floor, not a ceiling; always finish with an exhaustive `[Hh]ighlight`-style grep against an explicit keep-list.**
- `supabase db push` pushes ALL pending migrations at once. Migration `20260518000002` (the backfill) was meant to wait until after merge but got pushed alongside `20260518000003`. It is harmless for the new code but made `main` DB-incompatible (see Warnings).
- An initial proposed fix added a permanent legacy-name fallback (`entities || ballInCourtEntities`) in the survey code. The user rejected it — they want the data itself on the new name. The shipped fix converts the data instead (normalizer drops the old key; migration heals storage).

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| "Survey Highlight" → "Survey Marker" | The Base layer has a separate plain highlighter pen tool; the two concepts cannot share the word "highlight". |
| `highlightId`/`highlight_id` NOT renamed in Plan A | It is the universal annotation ID, not the Survey Marker concept. Renaming it to `annotationId` is Plan C. |
| DB type rename in two migrations | Lets old and new code coexist during deploy without breaking sync. |
| `highlightColor` prop left as-is | Genuinely shared between the highlighter pen and Survey Markers; untangling it is its own task. |
| Apply migrations to live Supabase directly | User is the sole user and explicitly authorized it. |

## Current State

**Working**: The rename. Builds clean. 673/680 tests pass (the 1 failure, `annotationInitialHydrationSource.test.mjs`, is pre-existing — confirmed against a pre-rename backup). Entity assignment works; entity colour now persists across save + refresh.

**Broken**: Orphan Survey Markers (panel entries that locate to an empty spot). Double-click does not expand the panel row. Possibly the needs-entity preview style.

**Uncommitted Changes**: None — working tree clean.

## The Orphan Survey Marker Bug (next priority)

**Symptom**: In the survey panel, some Survey Markers that have an Entity show a blue locate ("search") icon. Clicking it navigates/zooms to the location but nothing is there — no Survey Marker renders on that page. The panel/list still lists it.

**User's hypothesis**: a Survey Marker was deleted from the page but its panel entry (and possibly its Excel row) survived.

**Desired behavior** (user request): if a Survey Marker is deleted from the page it should lose its stored location; if it still exists in the Excel export it should be shown in an orange "needs a new location" state so the user can re-place it.

**Evidence gathered so far**: the log shows `survey_locate_start` / `survey_locate_direct_center` events firing with valid `highlightId` + page + bounds, so the locate target data is intact in the `surveyMarkers` state. The render of the rect on the canvas is what is missing. Not yet investigated: whether a deleted Survey Marker leaves a dangling entry in `surveyMarkers` / the survey panel, or whether a visibility-scope / region filter is hiding it (Survey Markers can be scoped to a Region via `regionId`; if the Region was deleted the marker may be filtered out of rendering but still listed).

**Where to look**: the Survey Marker delete path (does it clean `surveyMarkers`, the panel, and Excel together?); the rendering filter / visibility-scope logic (`src/utils/annotationVisibilityRules.js`, the `surveyMarkers` → rendered-rects merge in `src/App.jsx` around line 32058, and the per-page render in `src/PageAnnotationLayer.jsx`'s survey-marker loop ~8443).

## Files to Know

| File | Why It Matters |
|------|----------------|
| `CONTEXT.md` | Canonical domain glossary — terminology source of truth. |
| `docs/superpowers/plans/2026-05-18-survey-marker-rename.md` | Full Plan A spec. |
| `src/utils/surveyMarkerType.js` | `SURVEY_MARKER_TYPE`, `SURVEY_MARKER_TYPE_VALUES`, `isSurveyMarkerType` — the type helper all type checks route through. |
| `src/services/documentSurveyMarkerMapper.js` | Survey Marker ⇄ Supabase row mapping (`buildSurveyMarkerRow`, `mapSurveyMarkerRowToLocalAnnotation`). |
| `src/App.jsx` | ~45.8k lines. Survey panel ~40700–43000; Survey Marker create + category/entity/name dialogs ~41700–42600; cloud-sync effect ~24220; `templates` normalizer useMemo ~3178. |
| `src/PageAnnotationLayer.jsx` | Per-page canvas overlay; renders Survey Marker rects (~8443). |
| `src/components/SVGAnnotationLayer.jsx` | SVG annotation + Survey Marker rendering. |
| `supabase/migrations/2026051800000{1,2,3}_*.sql` | The three live-applied migrations from this session. |

## Code Context

Type helper — route every `annotation_type` check through this:
```js
// src/utils/surveyMarkerType.js
export const SURVEY_MARKER_TYPE = 'survey-marker';
export const SURVEY_MARKER_TYPE_VALUES = ['survey-marker', 'highlight']; // for Supabase .in() filters
export function isSurveyMarkerType(t) { /* true for either value */ }
```

A Survey Marker object (in the `surveyMarkers` state map, keyed by `highlightId`):
```
{ highlightId, pageNumber, bounds, categoryId, moduleId, spaceId, regionId,
  name, notes, entityId, entityName, entityColor, color, checklistResponses, ... }
```
Note the two colour fields: `color` (persisted) and `entityColor` (set by the
entity-edit paths). Plan A's fix made `buildSurveyMarkerRow` persist
`entityColor` into `color`. A future cleanup should collapse these to one field.

Survey Marker `annotation_type` in `document_annotations` is now `'survey-marker'`
for all rows (post-backfill). The CHECK constraint no longer allows `'highlight'`.

## Resume Instructions

1. `git checkout survey-marker-rename` (if not already on it).
2. `npm install` if needed, then `npm run build` — expect success.
3. `npm test` — expect `# pass 673 / # fail 1 / # skipped 6`. The single failure is pre-existing; any *other* failure is a regression.
4. To reproduce the orphan bug: open the app (`npm run dev`), open the document `SE-011 Security Shop Drawing Rev2`, enter Survey mode with the Security template, look in the survey panel for a Survey Marker with a blue locate icon, click it — it navigates but renders nothing on the page.
   - Expected (once fixed): either the Survey Marker renders at that spot, or it is clearly flagged as having lost its location.

## Warnings

- **`main` is currently DB-incompatible.** The backfill migration converted every survey row's `annotation_type` from `highlight` to `survey-marker` and the CHECK constraint now forbids `highlight`. The old code on `main` filters for `highlight` and would show zero Survey Markers. Stay on `survey-marker-rename`, or merge it, before running the app. A reverse migration (set rows back to `highlight`, re-widen the CHECK) would restore `main` compatibility if ever needed.
- **Do NOT rename `highlightId` / `highlight_id`** as part of other work — that is Plan C and must be done deliberately as its own migration.
- **Do NOT touch** the Base-layer `'highlighter'` pen tool, Syncfusion `'text-highlight'` / text-markup, search-result highlighting, or `highlightColor` — these legitimately keep the word "highlight" and were deliberately excluded from the rename.
- High-risk files per `CLAUDE.md`: `src/App.jsx`, `src/PageAnnotationLayer.jsx`, the Fabric canvases, `src/components/SVGAnnotationLayer.jsx`. Minimum viable diffs; run `npm test` after touching them.
- Communication preference: the user is non-technical. Always write "Survey Marker" in full (never "marker"); explain in plain English, not code terms. (See `memory/feedback_survey_marker_full_name.md`.)
