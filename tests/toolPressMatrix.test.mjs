// Owner 2026-10-04 — "own tool group only": what a click on an existing mark
// does under every tool, desktop and phone alike (one rule table:
// src/utils/selectModes.js + src/utils/markToolGroup.js).
//   Select / Text Select / Pan — pick any mark.
//   Draw group (pen, highlighter, eraser, text highlight) — always use the tool.
//   Shapes group — pick Shapes marks; any other mark is ignored (tool works).
//   Text group (text box, callout) — pick text boxes and callouts only.
//   Survey Marker — picks Survey Markers only.
import test from 'node:test';
import assert from 'node:assert/strict';

const rules = await import('../src/utils/selectModes.js');
const groups = await import('../src/utils/markToolGroup.js');
const routing = await import('../src/utils/toolPressRouting.js');
const restyle = await import('../src/utils/selectionRestyle.js');
const bar = await import('../src/utils/toolbarRows.js');

// Every kind of mark on a page, as stored (fabric 7 saves capitalised types).
const MARKS = {
  rect: { type: 'rect' },
  cloud: { type: 'rect', data: { lineBorderStyle: 'cloud' } },
  ellipse: { type: 'ellipse' },
  circle: { type: 'circle' },
  polygon: { type: 'polygon' },
  polyline: { type: 'polyline' },
  line: { type: 'line' },
  arrow: { type: 'line', data: { arrowheadStyle: 'open' } },
  legacyArrow: { type: 'group', objects: [{ type: 'line' }, { type: 'path' }] },
  counter: { type: 'circle', data: { type: 'counter' } },
  pen: { type: 'path' },
  highlighter: { type: 'path', data: { tool: 'highlighter' } },
  textbox: { type: 'Textbox' },
  callout: { kind: 'callout' },
  textHighlight: { type: 'rect', data: { type: 'text-markup' } },
  image: { type: 'image' },
  surveyMarker: { kind: 'survey-marker' },
};
const SHAPES = ['rect', 'cloud', 'ellipse', 'circle', 'polygon', 'polyline', 'line', 'arrow', 'legacyArrow', 'counter'];
const TEXTS = ['textbox', 'callout'];
const ALL = Object.keys(MARKS);

// Expected outcome of a plain click on each mark, by tool: the marks it picks.
// Every other mark: the tool is used as if the mark were not there.
const PICKS = {
  select: ALL,
  'text-select': ALL,
  pan: ALL,
  pen: [],
  highlighter: [],
  eraser: [],
  'text-highlight': [],
  rect: SHAPES,
  ellipse: SHAPES,
  line: SHAPES,
  arrow: SHAPES,
  polygon: SHAPES,
  polyline: SHAPES,
  counter: SHAPES,
  text: TEXTS,
  callout: TEXTS,
  'survey-marker': ['surveyMarker'],
};

const targetFor = (name) => (TEXTS.includes(name) ? 'text' : 'mark');
const outcome = (press) => (press.click === 'select' || press.click === 'add' ? 'select' : 'use tool');

test('every tool x mark: a click picks the mark only when the tool may (owner 2026-10-04)', () => {
  const rows = [];
  for (const [tool, picks] of Object.entries(PICKS)) {
    for (const name of ALL) {
      const markGroup = groups.getMarkGroup(MARKS[name]);
      const expected = picks.includes(name) ? 'select' : 'use tool';
      for (const hasSelection of [false, true]) {
        const got = outcome(rules.resolveToolPress({ tool, target: targetFor(name), markGroup, hasSelection }));
        rows.push(`${tool} on ${name}${hasSelection ? ' (something picked)' : ''}: ${got}`);
        assert.equal(got, expected, `${tool} on ${name}${hasSelection ? ' with a pick' : ''}`);
      }
      // The hover halo shows exactly where a click would pick (Pan, and the
      // tools that pick their own group's marks).
      assert.equal(rules.shouldShowHoverHalo(tool, markGroup), expected === 'select', `halo: ${tool} over ${name}`);
    }
  }
  assert.equal(rows.length, Object.keys(PICKS).length * ALL.length * 2);
});

test('a mark the tool may not pick is empty page for it: a drag still draws, a click is the tool\'s own', () => {
  const asEmpty = (tool, name, hasSelection) => {
    const onMark = rules.resolveToolPress({ tool, target: targetFor(name), markGroup: groups.getMarkGroup(MARKS[name]), hasSelection });
    const onEmpty = rules.resolveToolPress({ tool, target: 'empty', hasSelection });
    assert.deepEqual(onMark, onEmpty, `${tool} on ${name}${hasSelection ? ' with a pick' : ''}`);
  };
  for (const [tool, picks] of Object.entries(PICKS)) {
    for (const name of ALL) {
      if (picks.includes(name)) continue;
      asEmpty(tool, name, false);
      asEmpty(tool, name, true);
    }
  }
  // rect-on-pen draws a rectangle; text-on-rect makes a text box; pen-on-rect draws
  assert.equal(rules.resolveToolPress({ tool: 'rect', target: 'mark', markGroup: 'draw' }).drag, 'draw');
  assert.equal(rules.resolveToolPress({ tool: 'text', target: 'mark', markGroup: 'shape' }).click, 'new-text');
  assert.equal(rules.resolveToolPress({ tool: 'pen', target: 'mark', markGroup: 'shape' }).click, 'tool');
});

test('the Draw group never grabs the selection; a group tool grabs only an all-own-group selection', () => {
  for (const tool of ['pen', 'highlighter', 'eraser', 'text-highlight']) {
    assert.equal(rules.canToolGrabSelection(tool, ['draw']), false, tool);
    assert.equal(rules.canToolGrabSelection(tool, ['shape']), false, tool);
  }
  for (const tool of ['select', 'pan']) assert.equal(rules.canToolGrabSelection(tool, ['draw', 'shape', 'review', null]), true, tool);
  assert.equal(rules.canToolGrabSelection('ellipse', ['shape']), true);
  assert.equal(rules.canToolGrabSelection('ellipse', ['shape', 'review']), false);
  assert.equal(rules.canToolGrabSelection('text', ['review']), true);
  assert.equal(rules.canToolGrabSelection('text', ['shape']), false);
  const picked = routing.pageSelectionMarkGroups({
    selectedIds: new Set([0, 1]),
    objects: [MARKS.rect, MARKS.pen],
    calloutSelected: true,
  });
  assert.deepEqual([...picked].sort(), ['draw', 'review', 'shape']);
});

test('one mark -> group answer: the tool bar, the restyle bar and the press rules share it', () => {
  assert.equal(bar.TOOL_GROUP_BY_TOOL, groups.TOOL_GROUP_BY_TOOL);
  assert.equal(restyle.selectionToolForAnnotation, groups.markToolForAnnotation);
  const expectedGroup = {
    rect: 'shape', cloud: 'shape', ellipse: 'shape', circle: 'shape', polygon: 'shape', polyline: 'shape', line: 'shape',
    arrow: 'shape', legacyArrow: 'shape', counter: 'shape', pen: 'draw', highlighter: 'draw', textbox: 'review',
    callout: 'review', textHighlight: null, image: null, surveyMarker: 'survey-marker',
  };
  for (const [name, group] of Object.entries(expectedGroup)) assert.equal(groups.getMarkGroup(MARKS[name]), group, name);
  for (const tool of Object.keys(PICKS)) {
    const own = groups.getToolGroup(tool);
    if (['select', 'text-select', 'pan'].includes(tool)) assert.equal(own, null, tool);
  }
});

test('a switch to any drawing / shape / text / eraser tool drops the pick, whatever asked for it (owner 2026-10-04)', () => {
  // "Switching tools clears the selection, EXCEPT switching between Select and
  // Pan": a switch INTO Pan / Select / Text Select keeps it (leaving Text
  // Select still clears, as before).
  const tools = Object.keys(PICKS);
  for (const from of tools) {
    for (const to of tools) {
      const keeps = from === to || (from !== 'text-select' && ['select', 'pan', 'text-select'].includes(to));
      for (const source of ['toolbar', 'shortcut-key', 'category-tab', 'pan-button']) {
        assert.equal(rules.getToolSwitchSelectionClearReason(from, to, { source }) === null, keeps, `${from} -> ${to} (${source})`);
      }
    }
  }
});

test('a click on empty page or the grey area drops the pick under every tool that holds one', () => {
  // On the page: a press drops it (Draw group: and draws / erases), a click
  // under a picking tool only deselects.
  for (const tool of Object.keys(PICKS)) {
    const press = rules.resolveToolPress({ tool, target: 'empty', hasSelection: true });
    if (['pen', 'highlighter', 'eraser'].includes(tool)) assert.equal(press.clearsSelection, true, tool);
    else if (['select', 'text-select', 'pan', 'rect', 'ellipse', 'line', 'arrow', 'callout', 'polygon', 'polyline', 'text'].includes(tool)) {
      assert.ok(press.click === 'deselect' || press.clearsSelection, tool);
    }
  }
  // The grey area: Select family on the press, Shapes / Text tools on a click;
  // Pan keeps it while it pans (its own quick-click drops it).
  for (const tool of ['select', 'text-select', 'rect', 'ellipse', 'line', 'arrow', 'polygon', 'polyline', 'text', 'callout', 'counter']) {
    assert.equal(rules.shouldBackdropPressDeselect(tool), true, tool);
  }
  for (const tool of ['pan', 'pen', 'highlighter', 'eraser']) assert.equal(rules.shouldBackdropPressDeselect(tool), false, tool);
});
