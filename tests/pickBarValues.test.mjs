// Owner Test 45 (2026-10-06): "When I select callouts, they don't reflect what
// they're set to ... if it's a solid line type and I click it ... sometimes it
// says Cloud because the last thing I selected was cloud."
//
// Root cause (reproduced in Chromium, scratchpad pickFidelity/pick.mjs): a pick
// switch from a shape to a callout passes through one render holding BOTH
// picks; the multi-pick loader loaded that two-mark "group" (first member =
// the old shape) after the callout's own loader ran, and nothing reloaded
// once the old pick cleared. One resolver (utils/pickBarValues.js) now gives
// the bar's values for the pick as it is now, keyed so any change reloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePickBarValues } from '../src/utils/pickBarValues.js';
import { summarizeSelectionRestyle } from '../src/utils/selectionRestyle.js';

const MARKS = {
  cloudRect: {
    type: 'rect', left: 0, top: 0, width: 100, height: 60, stroke: '#c42747', strokeWidth: 2.5,
    fill: 'transparent', data: { id: 'r1', pdfCloudIntensity: 3 },
  },
  dashedEllipse: {
    type: 'ellipse', rx: 20, ry: 10, stroke: 'rgba(0, 0, 255, 0.5)', strokeWidth: 4,
    fill: '#00ff00', strokeDashArray: [6, 4], data: { id: 'e1' },
  },
  dottedPolygon: {
    type: 'polygon', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 9 }], stroke: '#111111',
    strokeWidth: 1, fill: 'rgba(255, 0, 0, 0.25)', strokeDashArray: [2, 4], data: { id: 'p1' },
  },
  solidPolyline: {
    type: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 5 }], stroke: '#ff8800', strokeWidth: 6,
    fill: 'transparent', data: { id: 'pl1' },
  },
  arrow: {
    type: 'line', x1: 0, y1: 0, x2: 50, y2: 0, stroke: '#123456', strokeWidth: 3, tool: 'arrow',
    data: { id: 'a1', arrowheadStyle: 'openArrow', startArrowheadStyle: 'openArrow' },
  },
  plainLine: {
    type: 'line', x1: 0, y1: 0, x2: 50, y2: 0, stroke: '#654321', strokeWidth: 7, data: { id: 'l1' },
  },
  cloudTextbox: {
    type: 'textbox', text: 'Hi', left: 0, top: 0, width: 80, height: 20, stroke: '#ff0000', strokeWidth: 1,
    fill: '#000000', backgroundColor: '#ffff00', data: { id: 't1', pdfCloudIntensity: 2 },
  },
  plainTextbox: {
    type: 'textbox', text: 'Hi', left: 0, top: 0, width: 80, height: 20, stroke: '#0000ff', strokeWidth: 5,
    fill: '#000000', backgroundColor: 'transparent', strokeDashArray: [6, 4], data: { id: 't2' },
  },
  penStroke: {
    type: 'path', path: [['M', 0, 0], ['L', 10, 0]], stroke: '#336699', strokeWidth: 3, fill: null, data: { id: 'pen1' },
  },
  counter: {
    type: 'circle', radius: 12, fill: '#ef4444', data: { id: 'c1', type: 'counter', numberColor: '#ffffff' },
  },
};

const CALLOUTS = {
  cloudCallout: { id: 'co1', style: { borderColor: '#ff0000', borderOpacity: 1, lineThickness: 2, lineStyle: 'cloud', cloudIntensity: 4, arrowheadStyle: 'solidTriangle', fillColor: '#ffffff', fillOpacity: 0.9 } },
  plainCallout: { id: 'co2', style: { borderColor: '#0000ff', borderOpacity: 0.5, lineThickness: 5, lineStyle: 'solid', arrowheadStyle: 'openArrow', fillColor: 'transparent' } },
  legacyCallout: { id: 'co3', style: { lineColor: '#00aa00', lineThickness: 1 } },
};

// Expected bar values per mark: [width, lineStyle, cloudIntensity, strokeColor, strokeOpacity, fillColor, fillOpacity, arrowhead, bothEnds]
const EXPECT = {
  cloudRect: [2.5, 'cloud', 3, '#c42747', 100, null, 0, null, null],
  dashedEllipse: [4, 'dashed', null, '#0000ff', 50, '#00ff00', 100, null, null],
  dottedPolygon: [1, 'dotted', null, '#111111', 100, '#ff0000', 25, null, null],
  solidPolyline: [6, 'solid', null, '#ff8800', 100, null, null, null, null],
  arrow: [3, 'solid', null, '#123456', 100, null, null, 'openArrow', true],
  plainLine: [7, 'solid', null, '#654321', 100, null, null, null, null],
  cloudTextbox: [1, 'cloud', 2, '#ff0000', 100, '#ffff00', 100, null, null],
  plainTextbox: [5, 'dashed', null, '#0000ff', 100, null, 0, null, null],
  penStroke: [3, null, null, '#336699', 100, null, null, null, null],
  counter: [12, null, null, '#ffffff', 100, '#ef4444', 100, null, null],
  cloudCallout: [2, 'cloud', 4, '#ff0000', 100, '#ffffff', 90, 'solidTriangle', null],
  plainCallout: [5, 'solid', null, '#0000ff', 50, null, 0, 'openArrow', null],
  legacyCallout: [1, 'solid', null, '#00aa00', 100, null, 0, null, null],
};
const FIELDS = ['width', 'lineStyle', 'cloudIntensity', 'strokeColor', 'strokeOpacity', 'fillColor', 'fillOpacity', 'arrowheadStyle', 'arrowBothEnds'];

const pickOf = (name) => (CALLOUTS[name]
  ? { pickBarTool: 'select', callout: { id: CALLOUTS[name].id, callout: CALLOUTS[name] } }
  : { pickBarTool: 'select', annotation: MARKS[name], annotationKey: `1:0:${MARKS[name].data.id}` });

test('every mark type x every bar property: the bar reads the picked mark itself', () => {
  for (const [name, expected] of Object.entries(EXPECT)) {
    const { values } = resolvePickBarValues(pickOf(name));
    FIELDS.forEach((field, index) => {
      assert.equal(values[field], expected[index], `${name}.${field}`);
    });
  }
});

// The bar as the viewer drives it: load whenever the resolver's key changes.
function driveBar(renders) {
  const bar = {};
  let lastKey = '';
  for (const render of renders) {
    const load = resolvePickBarValues(render);
    const key = load ? load.key : '';
    if (key !== lastKey && load) {
      for (const [field, value] of Object.entries(load.values)) {
        if (value == null) continue;
        if (field === 'width' && !(value > 0)) continue;
        if ((field === 'strokeColor' || field === 'fillColor' || field === 'lineStyle' || field === 'arrowheadStyle') && !value) continue;
        bar[field] = value;
      }
    }
    lastKey = key;
  }
  return bar;
}

const transientGroup = (from, to) => {
  const member = (name) => (CALLOUTS[name] ? { kind: 'callout', callout: CALLOUTS[name] } : { kind: 'annotation', annotation: MARKS[name] });
  return { key: `${from}+${to}`, summary: summarizeSelectionRestyle([member(from), member(to)]) };
};

test('picking A then B (through the render holding both) always ends on B\'s values, for every pair', () => {
  const names = Object.keys(EXPECT);
  for (const from of names) {
    for (const to of names) {
      if (from === to) continue;
      const bar = driveBar([
        pickOf(from),
        // The pick switch: old and new pick held for one render.
        { ...pickOf(to), ...pickOf(from), group: transientGroup(from, to) },
        pickOf(to),
      ]);
      const expected = EXPECT[to];
      FIELDS.forEach((field, index) => {
        const want = expected[index];
        if (want == null || (field === 'fillOpacity' && want == null)) return;
        assert.equal(bar[field], want, `${from} -> ${to}: ${field}`);
      });
    }
  }
});

test('re-picking the same mark after an edit reloads its new value', () => {
  const before = resolvePickBarValues(pickOf('cloudRect'));
  const edited = { ...MARKS.cloudRect, strokeDashArray: [6, 4], data: { ...MARKS.cloudRect.data, pdfCloudIntensity: null } };
  const after = resolvePickBarValues({ pickBarTool: 'select', annotation: edited, annotationKey: '1:0:r1' });
  assert.notEqual(before.key, after.key);
  assert.equal(after.values.lineStyle, 'dashed');
});

test('nothing loads while the bar is the armed tool\'s settings', () => {
  assert.equal(resolvePickBarValues({ ...pickOf('cloudRect'), pickBarTool: 'rect' }), null);
  assert.equal(resolvePickBarValues({ pickBarTool: 'select' }), null);
});

test('a group wins over a single pick, and loads its first-member values', () => {
  const group = transientGroup('plainCallout', 'cloudRect');
  const { values } = resolvePickBarValues({ ...pickOf('cloudRect'), group });
  assert.equal(values.width, 5);
  assert.equal(values.lineStyle, 'solid');
});

test('PDFViewer loads the bar from the one resolver (no per-type loaders left)', () => {
  const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(source, /resolvePickBarValues\(/);
  assert.match(source, /\}, \[pickBarLoadKey\]\);/);
  assert.doesNotMatch(source, /\}, \[restyleGroupLoadKey\]\);/);
  assert.doesNotMatch(source, /const sel = selectedToolbarCallout;\n\s+if \(!sel \|\| !sel\.callout\) return;/);
});
