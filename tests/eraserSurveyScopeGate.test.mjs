// KAL-89 residual — the eraser's classify path (getEraseBlockReason) gated
// spaceId/regionId/locked/permission but had NO survey-mode gate, so a
// canvas-scoped mark hidden by survey mode stayed erasable while the eraser
// was active in survey mode (and a survey-scoped mark hidden in standard mode
// stayed erasable there). The gate reuses the shared visibility decision
// (isAnnotationVisibleInSurveyMode) so the eraser can never disagree with the
// renderer about what survey mode hides.
//
// Wiring lives in JSX (FabricEraserCanvas + the PDFViewer mount), so this
// suite follows the repo's source-assertion pattern (see
// eraserPresentation.test.mjs); the behavioral half re-asserts the exact
// visibility cases the gate now relies on against the real shared rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ERASER_SOURCE = readFileSync(
  new URL('../src/components/FabricEraserCanvas.jsx', import.meta.url),
  'utf8',
);
const VIEWER_SOURCE = readFileSync(
  new URL('../src/PDFViewer.jsx', import.meta.url),
  'utf8',
);

const blockStart = ERASER_SOURCE.indexOf('const getEraseBlockReason');
const blockEnd = ERASER_SOURCE.indexOf('\n  const ghostAtomicHits', blockStart);
const blockSource = ERASER_SOURCE.slice(blockStart, blockEnd);

test('classify path reuses the shared survey visibility rule (no duplicated logic)', () => {
  assert.match(
    ERASER_SOURCE,
    /import \{ isAnnotationVisibleInSurveyMode \} from '\.\.\/utils\/annotationVisibilityRules\.js';/,
  );
  assert.match(blockSource, /isAnnotationVisibleInSurveyMode\(\{/);
  assert.match(blockSource, /return 'survey-scope'/);
  // The gate must read the object's own scope stamps, not a cached copy.
  assert.match(blockSource, /moduleId: object\?\.moduleId \?\? null/);
  assert.match(blockSource, /regionId: object\?\.regionId \?\? null/);
});

test('survey gate runs inside the ONE shared block-reason choke point (covers live preview and commit)', () => {
  // canErase (commit) and ghostAtomicHits (preview) are both built from
  // getEraseBlockReason — asserting the gate lives inside that function is
  // what guarantees preview and commit cannot disagree.
  assert.match(ERASER_SOURCE, /const reason = getEraseBlockReason\(object\);/);
  const surveyGateIndex = blockSource.indexOf('isAnnotationVisibleInSurveyMode({');
  const spaceScopeIndex = blockSource.indexOf("return 'space-scope'");
  assert.ok(surveyGateIndex > -1, 'survey gate present in getEraseBlockReason');
  assert.ok(spaceScopeIndex > -1, 'space-scope rule still present');
});

test('callout lane honors the same survey gate (review residual)', () => {
  // getCalloutHitIds tests raw geometry and calloutBoundsAllow passes
  // callouts with no DOM bounds, so the permitted-hits filter — the ONE
  // helper both preview and commit call — must apply the survey rule.
  const calloutStart = ERASER_SOURCE.indexOf('const getPermittedCalloutHitIds');
  const calloutEnd = ERASER_SOURCE.indexOf('\n  // Survey markers live outside', calloutStart);
  const calloutSource = ERASER_SOURCE.slice(calloutStart, calloutEnd);

  assert.match(calloutSource, /isAnnotationVisibleInSurveyMode\(\{/);
  assert.match(calloutSource, /moduleId: callout\?\.moduleId \?\? null/);
  assert.match(calloutSource, /regionId: callout\?\.regionId \?\? null/);

  // The gate must run BEFORE the local-only early return, or unauthenticated
  // and local documents (no viewerId/ownerId) bypass it entirely.
  const gateIndex = calloutSource.indexOf('isAnnotationVisibleInSurveyMode({');
  const localOnlyIndex = calloutSource.indexOf('return isLocalOnlyDocumentRef.current');
  assert.ok(gateIndex > -1, 'survey gate present in getPermittedCalloutHitIds');
  assert.ok(localOnlyIndex > gateIndex, 'survey gate runs before the local-only early return');
});

test('eraser receives live survey-mode context from PDFViewer', () => {
  assert.match(ERASER_SOURCE, /showSurveyPanelRef\.current/);
  assert.match(ERASER_SOURCE, /selectedModuleIdRef\.current/);
  assert.match(
    VIEWER_SOURCE,
    /showSurveyPanel=\{showSurveyPanel\}\s*selectedModuleId=\{selectedModuleId\}/,
  );
});

test('the shared rule hides exactly what the gate must protect', async () => {
  const { isAnnotationVisibleInSurveyMode } = await import(
    '../src/utils/annotationVisibilityRules.js'
  );
  const surveyContext = { showSurveyPanel: true, selectedModuleId: 'module-1' };

  // Canvas-scoped mark hidden by survey mode → the gate must block its erase.
  assert.equal(
    isAnnotationVisibleInSurveyMode({ moduleId: null, regionId: null, ...surveyContext }),
    false,
  );
  // Mark scoped to a DIFFERENT module → hidden → blocked.
  assert.equal(
    isAnnotationVisibleInSurveyMode({ moduleId: 'module-2', regionId: null, ...surveyContext }),
    false,
  );
  // Mark scoped to the ACTIVE module → visible → erasable.
  assert.equal(
    isAnnotationVisibleInSurveyMode({ moduleId: 'module-1', regionId: null, ...surveyContext }),
    true,
  );
  // Survey-scoped mark in STANDARD mode → hidden → blocked.
  assert.equal(
    isAnnotationVisibleInSurveyMode({
      moduleId: 'module-1',
      regionId: null,
      showSurveyPanel: false,
      selectedModuleId: null,
    }),
    false,
  );
  // Region-scoped marks stay governed by the space/region rules, not survey.
  assert.equal(
    isAnnotationVisibleInSurveyMode({ moduleId: null, regionId: 'region-1', ...surveyContext }),
    true,
  );
  // Canvas mark in standard mode → visible → erasable.
  assert.equal(
    isAnnotationVisibleInSurveyMode({
      moduleId: null,
      regionId: null,
      showSurveyPanel: false,
      selectedModuleId: null,
    }),
    true,
  );
});
