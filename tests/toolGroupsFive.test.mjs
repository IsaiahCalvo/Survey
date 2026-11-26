import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  FIVE_GROUP_INSERT_IDS,
  FIVE_GROUP_SHAPE_IDS,
  FIVE_GROUP_TEXT_IDS,
  TOOL_BAR_GROUPS,
  fiveGroupRowForTool,
  resolveToolBarGroup,
} from '../src/utils/toolbarRows.js';

// Nightly 'tool-groups-five' (owner 2026-11-26): the top bar in Drawboard's
// five groups. Draw, Shapes, Text, Measure, Insert.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const five = (args) => resolveToolBarGroup({ toolGroupsFive: true, ...args });

test('five groups: Measure and Insert are tool-bar rows', () => {
  assert.ok(TOOL_BAR_GROUPS.includes('measure'));
  assert.ok(TOOL_BAR_GROUPS.includes('insert'));
  // No tool sits in two rows.
  const all = [...FIVE_GROUP_SHAPE_IDS, ...FIVE_GROUP_TEXT_IDS, ...FIVE_GROUP_INSERT_IDS];
  assert.equal(new Set(all).size, all.length);
  assert.ok(!FIVE_GROUP_SHAPE_IDS.includes('counter'));
});

test('five groups: an armed measure shows Measure, a plain line shows Shapes', () => {
  assert.equal(five({ activeTool: 'line', activeCategoryDropdown: 'shape', measureMode: 'length' }), 'measure');
  assert.equal(five({ activeTool: 'polygon', activeCategoryDropdown: 'shape', measureMode: 'area' }), 'measure');
  assert.equal(five({ activeTool: 'polyline', measureMode: 'polylength' }), 'measure');
  assert.equal(five({ activeTool: 'line', activeCategoryDropdown: 'shape' }), 'shape');
  assert.equal(five({ activeTool: 'counter', activeCategoryDropdown: 'shape' }), 'measure');
});

test('five groups: Insert tools that stay armed show Insert', () => {
  for (const tool of ['sticky-note', 'pin', 'hyperlink', 'snapshot']) {
    assert.equal(fiveGroupRowForTool(tool), 'insert', tool);
    assert.equal(five({ activeTool: tool, activeCategoryDropdown: 'review' }), 'insert', tool);
  }
  assert.equal(five({ activeTool: 'pen', activeCategoryDropdown: 'insert' }), 'insert');
});

test('five groups: a picked measurement or counter brings up Measure', () => {
  assert.equal(five({ activeTool: 'select', contextTool: 'line', pickedMeasureKind: 'length' }), 'measure');
  assert.equal(five({ activeTool: 'pan', contextTool: 'rect', pickedMeasureKind: 'area' }), 'measure');
  assert.equal(five({ activeTool: 'select', contextTool: 'counter' }), 'measure');
  assert.equal(five({ activeTool: 'select', contextTool: 'line' }), 'shape');
  assert.equal(five({ activeTool: 'select', contextTool: 'select', pickedMeasureKind: 'length' }), 'select');
});

test('five groups: everything else is as before, and the flag off changes nothing', () => {
  assert.equal(five({ activeTool: 'pen' }), 'draw');
  assert.equal(five({ activeTool: 'text' }), 'review');
  assert.equal(five({ activeTool: 'text-select', textHighlightMode: true }), 'review');
  assert.equal(five({ activeTool: 'survey-marker' }), null);
  assert.equal(five({ activeTool: 'region-edit' }), null);
  assert.equal(resolveToolBarGroup({ activeTool: 'line', measureMode: 'length' }), 'shape');
  assert.equal(resolveToolBarGroup({ activeTool: 'counter' }), 'shape');
  assert.equal(resolveToolBarGroup({ activeTool: 'sticky-note' }), 'review');
});

test('five groups: the flag is beta, seeded, and the bar draws both new groups', () => {
  assert.match(read('src/featureFlags.js'), /'tool-groups-five': Object\.freeze\(\{[^}]*stage: 'beta'/);
  assert.match(read('supabase/migrations/20261126020000_tool_groups_five_flag.sql'), /'tool-groups-five', 'off'/);
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /aria-label="Measure"/);
  assert.match(shell, /aria-label="Insert"/);
  assert.match(shell, /<Icon name="insertGroup"/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /subRowCategory === 'measure' && \(/);
  assert.match(viewer, /\(subRowCategory === 'review' \|\| subRowCategory === 'insert'\) && \(/);
});

test('icons: one icon per tool in the bar (Page scale is not the Ruler, Polylength is not Polyline)', () => {
  const icons = read('src/Icons.jsx');
  const body = (name) => {
    const m = icons.match(new RegExp(`\\n    ${name}: \\(size, color, style, className\\) => strokeGlyph\\(size, color, style, className, \\[([\\s\\S]*?)\\]\\),`));
    assert.ok(m, name);
    return m[1].replace(/\s+/g, '');
  };
  assert.notEqual(body('measureScale'), body('ruler'));
  for (const name of ['measurePolylength', 'insertGroup']) body(name);
  assert.match(read('src/PDFViewer.jsx'), /label: 'Polylength', iconName: 'measurePolylength'/);
  assert.match(read('src/mobile/mobileShapeRail.js'), /label: 'Polylength', icon: 'measurePolylength'/);
});
