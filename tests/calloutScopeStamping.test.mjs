// Decision 11 companion — callout creation must stamp the active survey/region
// scope exactly like pen strokes do.
//
// The stamping call sites live inside JSX components that cannot be imported in
// node --test, so this suite follows the repo's source-assertion pattern (see
// the PDFViewer source-assertion tests): it reads the component sources as TEXT
// and locks in the wiring. The behavioral half (the region-stamp rule itself)
// is covered by real unit tests in annotationVisibilityRules.test.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

describe('callout creation scope stamping (SVGAnnotationLayer)', () => {
  const src = read('src/components/SVGAnnotationLayer.jsx');

  it('imports the shared region-stamp rule', () => {
    assert.match(src, /shouldStampActiveRegionId/);
  });

  it('stamps moduleId from selectedModuleId on the new callout', () => {
    assert.match(
      src,
      /if \(selectedModuleId\) \{\s*newCallout\.moduleId = selectedModuleId;/
    );
  });

  it('stamps regionId via shouldStampActiveRegionId on the new callout', () => {
    assert.match(
      src,
      /shouldStampActiveRegionId\(\{\s*regionId: activeRegionId,\s*spaceId: selectedSpaceId,\s*pageNumber,\s*spaces,\s*isRegionOverlayEnabled,\s*\}\)/
    );
    assert.match(src, /newCallout\.regionId = activeRegionId;/);
  });
});

// Unified renderer (FabricDrawingCanvas retired): pen/shape creation commits
// through SVGAnnotationLayer.commitShapeCreation → annotationCreationCommit.js.
// The stamps must survive on that LIVE path: the layer decides via the shared
// shouldStampActiveRegionId rule, and every commit builder stamps the JSON via
// the shared applyScope helper (the successor of the fabric-era
// toObject(CUSTOM_PROPS) guarantee that id/moduleId/regionId reach the save).
describe('pen-stroke scope stamping stays on the shared rule (SVG creation commit)', () => {
  const layerSrc = read('src/components/SVGAnnotationLayer.jsx');
  const commitSrc = read('src/utils/annotationCreationCommit.js');

  it('delegates the creation-commit region stamp to shouldStampActiveRegionId', () => {
    assert.match(
      layerSrc,
      /const stampRegionId = shouldStampActiveRegionId\(\{/
    );
  });

  it('stamps moduleId/regionId onto every creation commit JSON via applyScope', () => {
    assert.match(commitSrc, /if \(selectedModuleId\) json\.moduleId = selectedModuleId;/);
    assert.match(commitSrc, /if \(stampRegionId\) json\.regionId = activeRegionId;/);
    // All three builders (boundary shape, line/arrow, freehand) must route
    // through the shared stamp — dropping one silently unscopes that tool.
    const applyScopeCalls = commitSrc.match(
      /applyScope\(json, \{ selectedModuleId, stampRegionId, activeRegionId \}\);/g
    ) || [];
    assert.ok(
      applyScopeCalls.length >= 3,
      `expected every commit builder to call applyScope (saw ${applyScopeCalls.length})`
    );
  });
});

describe('annotation metadata preservation guards (eraser canvas)', () => {
  it('FabricEraserCanvas edits the latest page JSON without Fabric serialization', () => {
    const src = read('src/components/FabricEraserCanvas.jsx');
    assert.doesNotMatch(src, /toJSON\(CUSTOM_PROPS\)/);
    assert.doesNotMatch(src, /toObject\(CUSTOM_PROPS\)/);
    assert.doesNotMatch(src, /canvas\.getObjects\(\)/);
    assert.match(src, /erasePageAnnotations/);
    assert.match(src, /annotationsRef\.current/);
  });
});

// Behavioral: the shared-store projection must carry the scope stamps both ways.
describe('callout bridge carries scope stamps (calloutAnnotationBridge)', () => {
  it('calloutToAnnotationObject copies moduleId/regionId onto the projected object and legacyCallout, and annotationObjectToCallout recovers them', async () => {
    const { calloutToAnnotationObject, annotationObjectToCallout } = await import(
      '../src/utils/calloutAnnotationBridge.js'
    );
    const pageSize = { width: 612, height: 792 };
    const callout = {
      id: 'callout-scope-1',
      pageNumber: 2,
      moduleId: 'module-9',
      regionId: 'region-4',
      arrowTip: { x: 0.2, y: 0.3 },
      knee: { x: 0.3, y: 0.25 },
      textBoxPosition: { x: 0.4, y: 0.2 },
      textBoxWidth: 0.2,
      textBoxHeight: 0.05,
      text: 'scoped',
      style: {},
    };

    const obj = calloutToAnnotationObject(callout, pageSize);
    assert.equal(obj.moduleId, 'module-9');
    assert.equal(obj.regionId, 'region-4');
    assert.equal(obj.data.legacyCallout.moduleId, 'module-9');
    assert.equal(obj.data.legacyCallout.regionId, 'region-4');

    const roundTripped = annotationObjectToCallout({ ...obj, pageNumber: 2 }, pageSize);
    assert.equal(roundTripped.moduleId, 'module-9');
    assert.equal(roundTripped.regionId, 'region-4');
  });

  it('leaves unscoped callouts flagless (no moduleId/regionId keys added)', async () => {
    const { calloutToAnnotationObject } = await import(
      '../src/utils/calloutAnnotationBridge.js'
    );
    const obj = calloutToAnnotationObject({
      id: 'callout-scope-2',
      pageNumber: 1,
      arrowTip: { x: 0.2, y: 0.3 },
      knee: { x: 0.3, y: 0.25 },
      textBoxPosition: { x: 0.4, y: 0.2 },
      textBoxWidth: 0.2,
      textBoxHeight: 0.05,
      text: '',
      style: {},
    }, { width: 612, height: 792 });
    assert.equal('moduleId' in obj, false);
    assert.equal('regionId' in obj, false);
  });
});
