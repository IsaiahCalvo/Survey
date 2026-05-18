# Survey Marker Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the "Survey Highlight" concept to "Survey Marker" everywhere it genuinely means the survey concept — in code, in the Supabase database, and in the saved-PDF format — without breaking existing saved data or live collaboration. Also clean up the leftover "ball in court" variable name.

**Architecture:** Staged, reversible-where-possible rename. (1) Trivial ball-in-court variable cleanup. (2) Database migration in two safe steps — first widen the allowed-types list to accept BOTH old and new strings, then after code ships, backfill rows and narrow it. (3) Code reads treat old and new strings as equivalent via one shared helper; writes use the new string. (4) PDF import keeps backward-compatible readers for the old key names permanently. (5) Mechanical rename of in-memory survey-specific identifiers, done in waves by file group, each verified by the test suite and a clean build.

**Tech Stack:** React 18 + Vite, Fabric.js, Supabase (Postgres), `node:test`.

---

## Scope

### In scope — these genuinely mean the survey concept

| Old name | New name |
|---|---|
| `annotation_type` column value `'highlight'` | `'survey-marker'` |
| draw-tool name `'highlight'` | `'survey-marker'` |
| `highlightAnnotations` (state, refs, params, override params) | `surveyMarkers` |
| `highlightAnnotationsRef` | `surveyMarkersRef` |
| `surveyHighlights` (prop) | `surveyMarkers` |
| `selectedSurveyHighlightId` | `selectedSurveyMarkerId` |
| `hoveredSurveyHighlightId` | `hoveredSurveyMarkerId` |
| `surveyHighlightPreviewBounds` | `surveyMarkerPreviewBounds` |
| `surveyHighlightDragRef` | `surveyMarkerDragRef` |
| `surveyHighlightClickRef` | `surveyMarkerClickRef` |
| `isSurveyHighlightRotating` | `isSurveyMarkerRotating` |
| `normalizeSurveyHighlightBoundsValue` | `normalizeSurveyMarkerBoundsValue` |
| `onUpdateSurveyHighlightBounds` | `onUpdateSurveyMarkerBounds` |
| `onDeleteSurveyHighlight` | `onDeleteSurveyMarker` |
| `onSurveyHighlightDoubleClick` | `onSurveyMarkerDoubleClick` |
| `pendingSurveyHighlightSelection` | `pendingSurveyMarkerSelection` |
| `onPendingSurveyHighlightSelectionConsumed` | `onPendingSurveyMarkerSelectionConsumed` |
| `getSurveyHighlightIdAtPointer` | `getSurveyMarkerIdAtPointer` |
| `isSurveyHighlight` (PDF metadata flag) | `isSurveyMarker` |
| `data-survey-highlight-id` (DOM attribute) | `data-survey-marker-id` |
| source/action strings `'survey-highlight'`, `'survey-highlight:create'`, `'survey-highlight-draw'`, `'survey-highlight-export-excluded'`, `'legacy-survey-highlight-rendered-from-highlight-state'` | same with `survey-marker` |
| `expandedHighlights` | `expandedSurveyMarkers` |
| `pendingHighlightName` | `pendingSurveyMarkerName` |
| `highlightNameInput` | `surveyMarkerNameInput` |
| `highlightsToRemoveByPage` | `surveyMarkersToRemoveByPage` |
| `generateDefaultHighlightName` | `generateDefaultSurveyMarkerName` |
| `saveHighlightAnnotations` (+ its load counterpart) | `saveSurveyMarkers` / `loadSurveyMarkers` |
| `highlightToFabricRect` | `surveyMarkerToFabricRect` |
| `normalizeHighlightBounds` | `normalizeSurveyMarkerBounds` |
| `buildHighlightRow` | `buildSurveyMarkerRow` |
| `mapHighlightRowToLocalAnnotation` | `mapSurveyMarkerRowToLocalAnnotation` |
| `getSurveyHighlightScope` | `getSurveyMarkerScope` |
| `diffDeletedHighlightIds` | `diffDeletedSurveyMarkerIds` |
| file `src/services/documentHighlightMapper.js` | `src/services/documentSurveyMarkerMapper.js` |
| file `src/services/highlightSyncDiag.js` | `src/services/surveyMarkerSyncDiag.js` |
| file `src/services/highlightSyncDiff.js` | `src/services/surveyMarkerSyncDiff.js` |
| localStorage key prefix `highlightAnnotations_` | `surveyMarkers_` |
| PDF layer-state key `layers.highlightAnnotations` | `layers.surveyMarkers` |
| PDF per-annotation `appType: 'highlight'` | `appType: 'survey-marker'` |
| Excel-sync local variable `bicName` | `entityNameFromExcel` |

## DO NOT CHANGE — out of scope for this plan

- `highlightId` property and `highlight_id` DB column — this is the **universal annotation ID** carried by every annotation type (pen, callout, counter). Renaming it to `annotationId` / `annotation_id` is **Plan C**, a separate migration. Leave every occurrence untouched in this plan.
- Base-layer `'highlighter'` tool — genuinely a highlighter pen, not a survey marker. Includes `highlightColor` prop, `isHighlighterSplitMenu`, `highlighterCaretPopupOpen`, `data-highlighter-caret-button`, `DRAWING_TOOLS` set, `public/highlighter-icon.png`, the `highlighter` icon in `src/Icons.jsx`.
- Syncfusion native text-markup highlight — `'text-highlight'`, `NATIVE_TEXT_MARKUP_TOOLS`, `TEXT_MARKUP_ANNOTATION_TYPES`, `TEXT_SEARCH_NATIVE_HIGHLIGHT_COLOR`, `viewer.highlightSettings`, `isNativeHighlight`, `getToolFromSyncfusionMarkupType`.
- Search-result highlighting in `src/sidebar/SearchTextPanel.jsx` — `highlightMatch`, `highlightOffset`, `highlightAll`.
- `moduleId` / `spaceId` on annotations — the space/module tangle is **Plan B**.
- `src/App.jsx` zoom logic, portal host resolution, render loop — only touch the survey-marker identifiers listed above; do not refactor surrounding code (high-risk file per CLAUDE.md).

## Acceptance Criteria

- **Given** a PDF saved by the current app before the rename, **when** it is opened after the rename, **then** all its survey markers load and render correctly (backward-compat readers).
- **Given** an existing Supabase row with `annotation_type='highlight'`, **when** the migrated app loads that document, **then** the marker appears (reads accept both strings).
- **Given** a new survey marker drawn after the rename, **when** it syncs to Supabase, **then** its row has `annotation_type='survey-marker'`.
- **Given** the full rename is complete, **when** `npm test` and `npm run build` run, **then** both pass with no new failures versus the pre-rename baseline.
- **Given** the rename is complete, **when** the codebase is searched for survey-concept "highlight" identifiers, **then** none remain except the DO-NOT-CHANGE items.

---

## Pre-flight

- [ ] **Step 0a: Create a branch**

```bash
cd /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2
git checkout -b survey-marker-rename
```

- [ ] **Step 0b: Capture the test baseline**

Run: `npm test`
Record the count of passing/failing tests. Every later "tests pass" check means "no NEW failures versus this baseline" — some tests may already be failing or skipped.

Run: `npm run build`
Expected: build succeeds. If it already fails, stop and report.

---

### Task 1: Ball-in-court variable cleanup

**Files:**
- Modify: `src/App.jsx` (4 sites — the Excel-sync read-back path; search for `bicName`)

- [ ] **Step 1: Rename the variable**

In `src/App.jsx`, find every occurrence of `bicName` (there are 4 logical blocks; the identifier appears ~10 times). Each is a local variable assigned from an Excel row's `'Entity'` column. Rename `bicName` → `entityNameFromExcel` at every occurrence. This is a pure local-variable rename — no behavior change, the variable never leaves its block.

- [ ] **Step 2: Verify**

Run: `grep -n "bicName" src/App.jsx`
Expected: no output.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "refactor: rename leftover bicName variable to entityNameFromExcel"
```

---

### Task 2: Database migration — widen the type constraint

This migration ONLY widens the allowed-values list so both `'highlight'` and `'survey-marker'` are legal. It does NOT touch existing rows. This must be applied to Supabase BEFORE the renamed code is deployed, so old code keeps working while new code can write the new value.

**Files:**
- Create: `supabase/migrations/20260518000001_survey_marker_widen_type_check.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Survey Marker rename, step 1 of 2.
-- Widen the annotation_type CHECK constraint so it accepts BOTH the legacy
-- 'highlight' value and the new 'survey-marker' value. Existing rows are not
-- modified here. This lets old and new code coexist during deploy:
--   - old code keeps reading/writing 'highlight'
--   - new code writes 'survey-marker' and reads either
-- Step 2 (a later migration) backfills rows and removes 'highlight'.

ALTER TABLE document_annotations
  DROP CONSTRAINT IF EXISTS document_annotations_annotation_type_check;

ALTER TABLE document_annotations
  ADD CONSTRAINT document_annotations_annotation_type_check
  CHECK (annotation_type IN (
    'highlight',
    'survey-marker',
    'ink',
    'freetext',
    'square',
    'circle',
    'line',
    'polyline',
    'polygon',
    'stamp',
    'sticky_note',
    'callout',
    'counter',
    'eraser'
  ));
```

- [ ] **Step 2: Apply the migration to Supabase**

Apply via the project's normal migration path (Supabase CLI `supabase db push`, or the SQL editor for the linked project). Confirm the constraint is updated by inserting a test value mentally — do not leave test rows behind.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260518000001_survey_marker_widen_type_check.sql
git commit -m "feat(db): allow 'survey-marker' annotation_type alongside 'highlight'"
```

---

### Task 3: Shared type helper + mapper writes the new value

The type string is checked in many files. Introduce ONE helper so reads accept both strings and there is a single source of truth.

**Files:**
- Create: `src/utils/surveyMarkerType.js`
- Test: `tests/surveyMarkerType.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SURVEY_MARKER_TYPE, isSurveyMarkerType } from '../src/utils/surveyMarkerType.js';

test('canonical type is survey-marker', () => {
  assert.equal(SURVEY_MARKER_TYPE, 'survey-marker');
});

test('isSurveyMarkerType accepts the new value', () => {
  assert.equal(isSurveyMarkerType('survey-marker'), true);
});

test('isSurveyMarkerType still accepts the legacy value', () => {
  assert.equal(isSurveyMarkerType('highlight'), true);
});

test('isSurveyMarkerType rejects other types', () => {
  assert.equal(isSurveyMarkerType('callout'), false);
  assert.equal(isSurveyMarkerType('counter'), false);
  assert.equal(isSurveyMarkerType(null), false);
  assert.equal(isSurveyMarkerType(undefined), false);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test tests/surveyMarkerType.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the helper**

```js
// src/utils/surveyMarkerType.js
//
// A Survey Marker is an area drawn in Survey mode over a real element of the
// drawing, tagged with one Category and one Entity (see CONTEXT.md). It was
// previously called a "Survey Highlight". In the database its annotation_type
// is 'survey-marker'; rows created before the rename carry the legacy value
// 'highlight'. Always test the type through isSurveyMarkerType so both are
// recognised.

export const SURVEY_MARKER_TYPE = 'survey-marker';
export const LEGACY_SURVEY_MARKER_TYPE = 'highlight';

export function isSurveyMarkerType(annotationType) {
  return annotationType === SURVEY_MARKER_TYPE
    || annotationType === LEGACY_SURVEY_MARKER_TYPE;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test tests/surveyMarkerType.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Update the mapper to write the new value**

Rename `src/services/documentHighlightMapper.js` → `src/services/documentSurveyMarkerMapper.js`:

```bash
git mv src/services/documentHighlightMapper.js src/services/documentSurveyMarkerMapper.js
```

In the renamed file: rename `buildHighlightRow` → `buildSurveyMarkerRow`, `mapHighlightRowToLocalAnnotation` → `mapSurveyMarkerRowToLocalAnnotation`, `getSurveyHighlightScope` → `getSurveyMarkerScope`. Change the row's `annotation_type` from the literal `'highlight'` to `SURVEY_MARKER_TYPE` (add `import { SURVEY_MARKER_TYPE } from '../utils/surveyMarkerType.js';`). Leave the `highlightId` parameter and `highlight_id:` column key UNCHANGED (Plan C). Leave `module_id` / `space_id` UNCHANGED (Plan B).

- [ ] **Step 6: Update every importer of the mapper**

Find importers: `grep -rln "documentHighlightMapper" src`. In each, update the import path to `documentSurveyMarkerMapper.js` and the imported function names to the new names.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add surveyMarkerType helper, write 'survey-marker' from the mapper"
```

---

### Task 4: Route every annotation_type check through the helper

**Files (each compares `annotation_type` / a `type` field against `'highlight'` for the survey concept):**
- Modify: `src/services/documentAnnotationService.js`
- Modify: `src/services/annotationCloudSync.js`
- Modify: `src/services/annotationTypeSerializers.js`
- Modify: `src/utils/annotationSyncType.js`
- Modify: `src/hooks/useAnnotationCloudSync.js`
- Modify: `src/lib/collab/crdtBackfill.js`

- [ ] **Step 1: Replace the comparisons**

In each file, find comparisons of the form `annotation_type === 'highlight'`, `type === 'highlight'`, `=== 'highlight'`, and the `'highlight'` entry inside `CRDT_FAN_OUT_EXCLUDED_TYPES`. Replace each survey-concept comparison with `isSurveyMarkerType(...)` imported from `src/utils/surveyMarkerType.js`. For the `CRDT_FAN_OUT_EXCLUDED_TYPES` set in `annotationSyncType.js`, add `'survey-marker'` alongside the existing `'highlight'` entry so both are excluded.

CAUTION: only replace comparisons that mean the survey marker. Do NOT touch `'highlighter'`, `'text-highlight'`, or Syncfusion markup types.

- [ ] **Step 2: Verify**

Run: `npm test`
Expected: no new failures versus the Step 0b baseline.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: route annotation_type survey checks through isSurveyMarkerType"
```

---

### Task 5: PDF format backward compatibility

Saved PDFs embed survey markers under `layers.highlightAnnotations` and per-annotation `appType: 'highlight'` / `flags.isSurveyHighlight`. New saves must use the new key names; reads must still accept the old ones forever.

**Files:**
- Modify: `src/utils/pdfAppAnnotationMetadata.js` (writes `appType`, `flags`, the `DATA_ALLOWLIST`)
- Modify: `src/utils/pdfAnnotationImporter.js` (reads `layers.*`, `appType`)
- Modify: `src/utils/pdfAnnotationsPdfLib.js` (writes `layers.*`, the `survey-highlight` source strings, `exportType`)
- Test: `tests/pdfSurveyMarkerCompat.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSurveyMarkerLayer } from '../src/utils/pdfAppAnnotationMetadata.js';

test('reads the new layer key', () => {
  const parsed = { layers: { surveyMarkers: { a: { highlightId: 'a' } } } };
  assert.deepEqual(readSurveyMarkerLayer(parsed), { a: { highlightId: 'a' } });
});

test('falls back to the legacy layer key', () => {
  const parsed = { layers: { highlightAnnotations: { b: { highlightId: 'b' } } } };
  assert.deepEqual(readSurveyMarkerLayer(parsed), { b: { highlightId: 'b' } });
});

test('prefers the new key when both are present', () => {
  const parsed = { layers: { surveyMarkers: { n: 1 }, highlightAnnotations: { o: 1 } } };
  assert.deepEqual(readSurveyMarkerLayer(parsed), { n: 1 });
});

test('returns an empty object when neither key exists', () => {
  assert.deepEqual(readSurveyMarkerLayer({ layers: {} }), {});
  assert.deepEqual(readSurveyMarkerLayer({}), {});
  assert.deepEqual(readSurveyMarkerLayer(null), {});
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test tests/pdfSurveyMarkerCompat.test.mjs`
Expected: FAIL — `readSurveyMarkerLayer` is not exported.

- [ ] **Step 3: Add the compat reader**

In `src/utils/pdfAppAnnotationMetadata.js`, add and export:

```js
// Reads the survey-marker layer out of a parsed SurveyAppLayerState blob.
// New PDFs store it under layers.surveyMarkers; PDFs saved before the
// Survey Marker rename store it under layers.highlightAnnotations.
export function readSurveyMarkerLayer(parsed) {
  const layers = parsed && parsed.layers;
  if (!layers || typeof layers !== 'object') return {};
  if (layers.surveyMarkers && typeof layers.surveyMarkers === 'object') {
    return layers.surveyMarkers;
  }
  if (layers.highlightAnnotations && typeof layers.highlightAnnotations === 'object') {
    return layers.highlightAnnotations;
  }
  return {};
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test tests/pdfSurveyMarkerCompat.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the reader in and update writers**

In `pdfAnnotationImporter.js`, replace the direct `parsed.layers.highlightAnnotations` access with `readSurveyMarkerLayer(parsed)`. When reading per-annotation metadata, accept `appType === 'survey-marker' || appType === 'highlight'`, and read `flags.isSurveyMarker ?? flags.isSurveyHighlight`.

In `pdfAppAnnotationMetadata.js`, change writes: `appType: 'survey-marker'`, `flags.isSurveyMarker`. Add `'isSurveyMarker'` to `DATA_ALLOWLIST` (keep `'isSurveyHighlight'` in the allowlist too so old blobs still parse).

In `pdfAnnotationsPdfLib.js`, change the written layer key to `layers.surveyMarkers`, change `source`/`exportType` survey strings to `survey-marker`, and the skip-reason strings.

- [ ] **Step 6: Verify**

Run: `npm test`
Expected: no new failures versus baseline. The PDF export contract tests (`pdfSaveExportContract.test.mjs`) may need their expected strings updated from `survey-highlight` to `survey-marker` — update them and confirm they still assert the same behavior.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(pdf): write survey-marker keys, read legacy highlight keys for back-compat"
```

---

### Task 6: localStorage key rename with one-time migration

**Files:**
- Modify: `src/App.jsx` (the `highlightAnnotations_${pdfId}` localStorage reads/writes — 4 sites)

- [ ] **Step 1: Rename the key and migrate old cache**

Change the localStorage key template from `` `highlightAnnotations_${pdfId}` `` to `` `surveyMarkers_${pdfId}` ``. At the READ site, if the new key is absent, attempt to read the old key as a fallback and, if found, write it under the new key and delete the old one. This avoids a cold-load for users who have a cached document. Supabase remains the source of truth, so a missed cache is not data loss — the migration is a UX nicety.

- [ ] **Step 2: Verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "refactor: rename survey-marker localStorage key with one-time migration"
```

---

### Task 7: In-memory rename — wave 1 (services + utils)

Mechanical rename of the survey-concept identifiers. Work file by file. For each file, apply the In-scope naming map. NEVER touch a DO-NOT-CHANGE item.

**Files:**
- Modify: `src/services/surveyMarkerSyncDiag.js` (rename from `highlightSyncDiag.js` via `git mv`)
- Modify: `src/services/surveyMarkerSyncDiff.js` (rename from `highlightSyncDiff.js` via `git mv`)
- Modify: `src/utils/excelSyncDirtyState.js`
- Modify: `src/utils/annotationLocalHistory.js`
- Modify: `src/utils/annotationSyncDelta.js`
- Modify: `src/utils/svgAnnotationRenderers.jsx`
- Modify: `src/utils/annotationPreviewDiag.js`

- [ ] **Step 1: Rename the two service files**

```bash
git mv src/services/highlightSyncDiag.js src/services/surveyMarkerSyncDiag.js
git mv src/services/highlightSyncDiff.js src/services/surveyMarkerSyncDiff.js
```

- [ ] **Step 2: Apply the naming map in each file**

In each file above, rename every in-scope identifier per the Scope table — including `diffDeletedHighlightIds` → `diffDeletedSurveyMarkerIds` and the diag function names. Update imports of the renamed service files everywhere (`grep -rln "highlightSyncDiag\|highlightSyncDiff" src`). Leave `highlightId` untouched.

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: no new failures versus baseline.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename survey-highlight identifiers to survey-marker (services + utils)"
```

---

### Task 8: In-memory rename — wave 2 (layer components)

**Files:**
- Modify: `src/components/SVGAnnotationLayer.jsx`
- Modify: `src/components/FabricDrawingCanvas.jsx`
- Modify: `src/components/LightweightAnnotationOverlay.jsx`
- Modify: `src/PageAnnotationLayer.jsx` (high-risk file — minimum viable diff, only the survey-marker identifiers)

- [ ] **Step 1: Apply the naming map**

Rename every in-scope identifier per the Scope table: `surveyHighlights` → `surveyMarkers`, `selectedSurveyHighlightId`, `hoveredSurveyHighlightId`, `surveyHighlightPreviewBounds`, the drag/click refs, `isSurveyHighlightRotating`, `normalizeSurveyHighlightBoundsValue`, the `on*` callback props, `getSurveyHighlightIdAtPointer`, `data-survey-highlight-id`, and the `survey-highlight*` source/action strings. Update the draw-tool comparison: the survey tool string `'highlight'` becomes `'survey-marker'`. Leave `'highlighter'` and `highlightId` untouched.

- [ ] **Step 2: Verify**

Run: `npm test`
Expected: no new failures versus baseline.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: rename survey-highlight identifiers to survey-marker (layer components)"
```

---

### Task 9: In-memory rename — wave 3 (App.jsx)

`src/App.jsx` is the ~45,800-line high-risk file. It holds ~138 `highlightAnnotations` references plus the other survey-marker state. Minimum viable diff — only rename the listed identifiers, do not refactor anything else.

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Apply the naming map**

Rename: `highlightAnnotations` → `surveyMarkers` (state, setter `setHighlightAnnotations` → `setSurveyMarkers`, ref `highlightAnnotationsRef` → `surveyMarkersRef`, and any `*Override` params), `expandedHighlights` → `expandedSurveyMarkers`, `pendingHighlightName` → `pendingSurveyMarkerName`, `highlightNameInput` → `surveyMarkerNameInput`, `highlightsToRemoveByPage` → `surveyMarkersToRemoveByPage`, `generateDefaultHighlightName` → `generateDefaultSurveyMarkerName`, `saveHighlightAnnotations`/load → `saveSurveyMarkers`/`loadSurveyMarkers`, `highlightToFabricRect` → `surveyMarkerToFabricRect`, `normalizeHighlightBounds` → `normalizeSurveyMarkerBounds`, the draw-tool string `'highlight'` → `'survey-marker'` and its `setActiveTool` call sites, the `data-survey-highlight-id` querySelector, and all the `on*SurveyHighlight*` prop names passed down to child components (these must match the new names from Task 8). Update the props passed to `SVGAnnotationLayer` / `PageAnnotationLayer` so they line up with wave 2.

Leave untouched: `highlightId`, `'highlighter'`, the Syncfusion markup mapping in `getToolFromSyncfusionMarkupType`, and `moduleId`/`spaceId`.

- [ ] **Step 2: Verify**

Run: `npm test`
Expected: no new failures versus baseline.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual smoke check**

Start the dev server (`npm run dev`). In a browser: open a PDF, enter Survey mode, draw a survey marker, assign a Category and Entity, reload the page, confirm the marker is still there. Open a PDF that was saved before today and confirm its markers load.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "refactor: rename survey-highlight identifiers to survey-marker (App.jsx)"
```

---

### Task 10: Sweep for stragglers

- [ ] **Step 1: Search for remaining survey-concept "highlight" names**

Run:
```bash
grep -rin "surveyhighlight\|survey-highlight\|highlightannotation" src | grep -vi "highlighter"
```
Expected: no output. Any hit is a missed rename — fix it, rebuild, and amend the relevant commit.

- [ ] **Step 2: Confirm the DO-NOT-CHANGE items survived**

Run: `grep -rcn "highlightId" src | grep -v ':0' | head`
Expected: `highlightId` still present (it is Plan C, intentionally untouched).

Run: `grep -rn "'highlighter'" src/PageAnnotationLayer.jsx | head`
Expected: the base-layer highlighter tool still present.

---

### Task 11: Database migration — backfill rows and narrow the constraint

Run this ONLY after the renamed code from Tasks 3–10 is deployed and confirmed working in production. Until then, old rows must keep `annotation_type='highlight'` so any not-yet-updated client can still read them.

**Files:**
- Create: `supabase/migrations/20260518000002_survey_marker_backfill_and_narrow.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Survey Marker rename, step 2 of 2.
-- The renamed code is now live; it writes 'survey-marker' and reads either
-- value. Backfill every legacy row, then narrow the CHECK constraint to drop
-- the old value.

UPDATE document_annotations
  SET annotation_type = 'survey-marker'
  WHERE annotation_type = 'highlight';

ALTER TABLE document_annotations
  DROP CONSTRAINT IF EXISTS document_annotations_annotation_type_check;

ALTER TABLE document_annotations
  ADD CONSTRAINT document_annotations_annotation_type_check
  CHECK (annotation_type IN (
    'survey-marker',
    'ink',
    'freetext',
    'square',
    'circle',
    'line',
    'polyline',
    'polygon',
    'stamp',
    'sticky_note',
    'callout',
    'counter',
    'eraser'
  ));
```

- [ ] **Step 2: Apply to Supabase and verify**

After applying, run `SELECT DISTINCT annotation_type FROM document_annotations;` and confirm `'highlight'` no longer appears.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260518000002_survey_marker_backfill_and_narrow.sql
git commit -m "feat(db): backfill survey-marker rows and drop legacy 'highlight' type"
```

---

### Task 12: Final verification

- [ ] **Step 1: Full test + build**

Run: `npm test` — no new failures versus the Step 0b baseline.
Run: `npm run build` — succeeds.

- [ ] **Step 2: Acceptance criteria walk-through**

Re-read the Acceptance Criteria section. Confirm each one with concrete evidence (a test, a manual check, a grep). Note any deferred item.

- [ ] **Step 3: Update the glossary note**

In `CONTEXT.md`, the Survey Marker entry already records the rename. Confirm it still reads correctly. No code identifiers belong in `CONTEXT.md`.

- [ ] **Step 4: Final commit if anything changed**

```bash
git add -A
git commit -m "chore: survey-marker rename — final verification"
```

---

## Self-Review Notes

- The universal `highlightId` / `highlight_id` is deliberately excluded — Plan C.
- The space/module tangle is deliberately excluded — Plan B.
- Database changes are split across two migrations with code deployment in between, so old and new clients never break each other.
- PDF backward-compat readers are permanent, not transitional — old saved PDFs must open forever.
- The draw-tool string and the persisted `annotation_type` string are both `'highlight'` today but live in different roles; Tasks 8–9 rename the tool string while Tasks 3–4 + Task 11 handle the persisted value. Do not blind-replace the literal `'highlight'`.
