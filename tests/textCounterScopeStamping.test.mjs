// KAL-88 residual — Text and Counter creation must stamp the active
// survey/region scope exactly like pen strokes, shapes, and callouts do
// (Decision 11 companion; see calloutScopeStamping.test.mjs for the callout
// half of this contract).
//
// The text half is behavioral: buildNewTextCommitJSON is pure JS and routes
// through the SAME applyScope helper the shape/line/freehand builders use.
// The wiring half (TextEditOverlay commit inputs, PDFViewer counter drop)
// lives inside JSX components that cannot be imported in node --test, so it
// follows the repo's source-assertion pattern and locks in the wiring.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const baseNewTextInput = {
  text: 'scoped text',
  left: 100,
  top: 120,
  innerWrapWidth: 180,
  maxLineWidth: 92,
  lineCount: 1,
  naturalInnerHeight: 20,
};

describe('new-text commit scope stamping (buildNewTextCommitJSON)', () => {
  it('stamps moduleId when survey mode has a selected module', async () => {
    const { buildNewTextCommitJSON } = await import('../src/utils/textEditCommit.js');
    const json = buildNewTextCommitJSON({
      ...baseNewTextInput,
      selectedModuleId: 'module-7',
    });
    assert.equal(json.moduleId, 'module-7');
    assert.equal('regionId' in json, false);
  });

  it('stamps regionId only when the shared region-stamp rule says so', async () => {
    const { buildNewTextCommitJSON } = await import('../src/utils/textEditCommit.js');
    const stamped = buildNewTextCommitJSON({
      ...baseNewTextInput,
      stampRegionId: true,
      activeRegionId: 'region-3',
    });
    assert.equal(stamped.regionId, 'region-3');
    assert.equal('moduleId' in stamped, false);

    const unstamped = buildNewTextCommitJSON({
      ...baseNewTextInput,
      stampRegionId: false,
      activeRegionId: 'region-3',
    });
    assert.equal('regionId' in unstamped, false);
  });

  it('stamps both for survey-region scope, and neither by default', async () => {
    const { buildNewTextCommitJSON } = await import('../src/utils/textEditCommit.js');
    const both = buildNewTextCommitJSON({
      ...baseNewTextInput,
      selectedModuleId: 'module-7',
      stampRegionId: true,
      activeRegionId: 'region-3',
    });
    assert.equal(both.moduleId, 'module-7');
    assert.equal(both.regionId, 'region-3');

    const plain = buildNewTextCommitJSON(baseNewTextInput);
    assert.equal('moduleId' in plain, false);
    assert.equal('regionId' in plain, false);
  });

  it('routes through the shared applyScope helper (not a private copy)', () => {
    const src = read('src/utils/textEditCommit.js');
    assert.match(src, /import \{ applyScope \} from '\.\/annotationCreationCommit\.js';/);
    assert.match(src, /applyScope\(json, \{ selectedModuleId, stampRegionId, activeRegionId \}\);/);
  });
});

describe('text overlay wiring (TextEditOverlay commit inputs)', () => {
  const src = read('src/components/TextEditOverlay.jsx');

  it('imports the shared region-stamp rule', () => {
    assert.match(src, /shouldStampActiveRegionId/);
  });

  it('passes survey scope + the region-stamp decision into buildNewTextCommitJSON', () => {
    assert.match(
      src,
      /selectedModuleId,\s*stampRegionId: shouldStampActiveRegionId\(\{\s*regionId: activeRegionId,\s*spaceId: selectedSpaceId,\s*pageNumber,\s*spaces,\s*isRegionOverlayEnabled,\s*\}\),\s*activeRegionId,/
    );
  });
});

describe('PDFViewer wiring (edit host scope props + counter drop stamping)', () => {
  const src = read('src/PDFViewer.jsx');

  it('feeds the text edit host the same scope sources as SVGAnnotationLayer', () => {
    assert.match(
      src,
      /selectedModuleId=\{selectedModuleId\}\s*selectedSpaceId=\{annotationSpaceId\}\s*activeRegionId=\{activeRegionId\}\s*spaces=\{spaces\}\s*isRegionOverlayEnabled=\{isRegionOverlayEnabled\}/
    );
  });

  it('stamps the dropped counter via the shared applyScope + shouldStampActiveRegionId', () => {
    assert.match(
      src,
      /applyAnnotationCreationScope\(counter, \{\s*selectedModuleId,\s*stampRegionId: shouldStampActiveRegionId\(\{\s*regionId: activeRegionId,\s*spaceId: annotationSpaceId,\s*pageNumber,\s*spaces,\s*isRegionOverlayEnabled,\s*\}\),\s*activeRegionId,\s*\}\);/
    );
  });

  it('stamps scope before the drag state snapshots the counter', () => {
    // The commit path saves drag.counter (seeded from this object at
    // pointerdown), so the stamp must land before the dragState capture.
    const stampIndex = src.indexOf('applyAnnotationCreationScope(counter, {');
    const dragStateIndex = src.indexOf('counter,', src.indexOf('const dragState = {'));
    assert.ok(stampIndex > 0, 'counter scope stamp present');
    assert.ok(dragStateIndex > stampIndex, 'stamp lands before dragState capture');
  });
});
