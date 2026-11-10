// Tape (beta 'tape-tool', Drawboard PDF Free-form > Tape).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFreehandCommitJSON, isTapeMark } from '../src/utils/annotationCreationCommit.js';
import { getEraserOperation, isPartialEraseEligible } from '../src/utils/eraserPolicy.js';
import { markToolForAnnotation, TOOL_GROUP_BY_TOOL } from '../src/utils/markToolGroup.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import { getToolSelectionClass } from '../src/utils/selectModes.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const points = [{ x: 10, y: 50 }, { x: 60, y: 51 }, { x: 140, y: 50 }];

test('a tape stroke is pen ink in its own colour and width, marked as tape', () => {
  const json = buildFreehandCommitJSON({ tool: 'tape', id: 't1', points, strokeColor: '#c9b6ec', highlightColor: '#ff0', strokeWidth: 20 });
  assert.equal(json.type, 'path');
  assert.equal(json.tool, 'pen');
  assert.equal(json.data.tape, true);
  assert.equal(json.fill, '#c9b6ec');
  assert.equal(json.globalCompositeOperation, undefined, 'opaque, never multiply');
  assert.ok(json.height >= 19 && json.height <= 21, `band ${json.height} pt`);
  assert.equal(isTapeMark(json), true);
  const pen = buildFreehandCommitJSON({ tool: 'pen', id: 'p1', points, strokeColor: '#f00', highlightColor: '#ff0', strokeWidth: 3 });
  assert.equal(pen.data.tape, undefined);
  assert.equal(isTapeMark(pen), false);
});

test('the eraser takes a tape whole, never a bite', () => {
  const tape = buildFreehandCommitJSON({ tool: 'tape', id: 't2', points, strokeColor: '#c9b6ec', highlightColor: '#ff0', strokeWidth: 20 });
  assert.equal(isPartialEraseEligible(tape), false);
  assert.equal(getEraserOperation(tape, 'partial'), 'entire');
  const pen = buildFreehandCommitJSON({ tool: 'pen', id: 'p2', points, strokeColor: '#f00', highlightColor: '#ff0', strokeWidth: 3 });
  assert.equal(getEraserOperation(pen, 'partial'), 'partial');
});

test('tape is a Draw tool with its own bar, an ink tool for presses, and a beta flag', () => {
  assert.equal(TOOL_GROUP_BY_TOOL.tape, 'draw');
  assert.equal(markToolForAnnotation({ type: 'path', data: { tape: true } }), 'tape');
  assert.equal(markToolForAnnotation({ type: 'path', data: {} }), 'pen');
  assert.equal(getToolSelectionClass('tape'), 'ink');
  assert.equal(FEATURE_FLAGS['tape-tool']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261110142000_tape_tool_flag.sql'), /\('tape-tool', 'off'/);
  assert.match(read('src/hooks/useDatabase.js'), /tape: \{ strokeColor: '#c9b6ec', strokeWidth: 20, strokeOpacity: 100 \}/);
});

test('render, reveal and tool rows are wired', () => {
  const renderers = read('src/utils/svgAnnotationRenderers.jsx');
  assert.match(renderers, /if \(obj\?\.data\?\.tape === true\) \{[\s\S]{0,400}const revealed = obj\.__tapeRevealed === true;/);
  assert.match(renderers, /fill=\{revealed \? 'none' : fill\}/);
  assert.match(renderers, /style=\{revealed \? undefined : \{ filter: TAPE_SHADOW_FILTER \}\}/);
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /const FREEHAND_CREATION_TOOLS = \['pen', 'highlighter', 'tape', 'survey-marker-freehand'\];/);
  assert.match(layer, /revealedTapeIds\?\.has\(getAnnotationRenderIdentity\(obj\)\.annotationId\)/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const \[tapeToolEnabled\] = useState\(\(\) => isFeatureOn\('tape-tool'\)\);/);
  assert.match(viewer, /\.\.\.\(tapeToolEnabled \? \[\{ id: 'tape', label: 'Tape', iconName: 'tape' \}\] : \[\]\)/);
  assert.match(viewer, /if \(isTapeMark\(tapped\)\) \{[\s\S]{0,400}setRevealedTapeIds/);
  assert.match(viewer, /revealedTapeIds=\{revealedTapeIds\}/);
  assert.match(read('src/mobile/MobilePdfViewerChrome.jsx'), /\{ id: 'tape', label: 'Tape', icon: 'tape', flag: 'tape-tool' \}/);
});
