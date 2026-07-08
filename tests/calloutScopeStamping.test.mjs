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

describe('pen-stroke scope stamping stays on the shared rule (FabricDrawingCanvas)', () => {
  const src = read('src/components/FabricDrawingCanvas.jsx');

  it('delegates shouldAssignRegionId to shouldStampActiveRegionId', () => {
    assert.match(
      src,
      /const shouldAssignRegionId = \(\) => shouldStampActiveRegionId\(\{/
    );
  });

  it('serializes strokes/shapes with toObject(CUSTOM_PROPS), never toJSON(CUSTOM_PROPS)', () => {
    // fabric 7's toJSON() takes no arguments and silently DROPS
    // propertiesToInclude — using it loses id/moduleId/regionId on commit.
    assert.doesNotMatch(src, /toJSON\(CUSTOM_PROPS\)/);
    assert.match(src, /e\.path\.toObject\(CUSTOM_PROPS\)/);
    assert.match(src, /shape\.toObject\(CUSTOM_PROPS\)/);
  });
});

describe('fabric 7 custom-prop serialization guard (eraser + edit canvases)', () => {
  it('FabricEraserCanvas serializes with toObject(CUSTOM_PROPS)', () => {
    const src = read('src/components/FabricEraserCanvas.jsx');
    assert.doesNotMatch(src, /toJSON\(CUSTOM_PROPS\)/);
    assert.match(src, /toObject\(CUSTOM_PROPS\)/);
  });

  it('FabricEditCanvas serializes with toObject(CUSTOM_PROPS) and never passes `type` into a Textbox constructor', () => {
    const src = read('src/components/FabricEditCanvas.jsx');
    assert.doesNotMatch(src, /toJSON\(CUSTOM_PROPS\)/);
    // fabric 7: `type` is a getter-only accessor; passing it in constructor
    // options throws and crashed callout auto-edit (blank-commit rollback ate
    // the brand-new callout).
    assert.doesNotMatch(
      src,
      /new fabric\.Textbox\([^)]*\{[^}]*\btype:\s*'textbox'/s
    );
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
