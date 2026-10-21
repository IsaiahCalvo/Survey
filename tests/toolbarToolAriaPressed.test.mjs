// Viewer tool bar: tool buttons say which tool is armed (aria-pressed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isToolGroupPressed } from '../src/utils/toolbarToolPressed.js';

const DRAW = ['pen', 'highlighter', 'text-highlight', 'eraser'];

test('group is pressed when one of its tools is armed or its row is open', () => {
  assert.equal(isToolGroupPressed({ activeTool: 'pen', activeCategoryDropdown: null, group: 'draw', toolIds: DRAW }), true);
  assert.equal(isToolGroupPressed({ activeTool: 'rect', activeCategoryDropdown: 'draw', group: 'draw', toolIds: DRAW }), true);
  assert.equal(isToolGroupPressed({ activeTool: 'rect', activeCategoryDropdown: 'shape', group: 'draw', toolIds: DRAW }), false);
});

test('no group is pressed while Pan or Select is armed', () => {
  for (const activeTool of ['pan', 'select']) {
    assert.equal(isToolGroupPressed({ activeTool, activeCategoryDropdown: 'draw', group: 'draw', toolIds: DRAW }), false);
  }
});

test('tool bar buttons render aria-pressed', () => {
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  for (const label of ['Draw', 'Shapes', 'Text']) {
    const at = shell.indexOf(`aria-label="${label}"`);
    assert.ok(at > 0, label);
    const block = shell.slice(shell.lastIndexOf('<button', at), at);
    assert.match(block, /aria-pressed=\{isToolGroupPressed\(/, `${label} button sets aria-pressed`);
  }
  assert.match(shell, /className=\{`btn chrome-control \$\{isActive \? 'btn-active' : 'btn-default'\}`\}\s*aria-pressed=\{isActive\}/);
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const subrow = viewer.match(/className=\{`btn chrome-subcontrol \$\{(isActive|activeTool === t\.id) \? 'btn-active' : 'btn-ghost'\}`\}\s*\n\s*aria-pressed=\{\1\}/g) || [];
  assert.equal(subrow.length, 3, 'Draw, Shapes and Text sub-row tools set aria-pressed');
});
