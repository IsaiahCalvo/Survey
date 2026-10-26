import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../agent-cli/${p}`, import.meta.url), 'utf8');
const SELECT_MODES = fs.readFileSync(new URL('../src/utils/selectModes.js', import.meta.url), 'utf8');

test('phone harness finds the select tool by its mode name', () => {
  assert.match(SELECT_MODES, /label: 'Rectangle Select'/);
  const constants = read('mobile-annotations/constants.mjs');
  assert.match(constants, /export const SELECT_TOOL_NAME = \/\^\(\?:\(\?:Rectangle\|Lasso\|Text\) \)\?Select\$\//);
  for (const file of ['lifecycle', 'advanced', 'advanced-entities', 'survey-region']) {
    const source = read(`mobile-annotations/${file}.mjs`);
    assert.doesNotMatch(source, /getByRole\('button', \{ name: 'Select', exact: true \}\)/, `${file} still looks for a bare "Select"`);
    assert.match(source, /SELECT_TOOL_NAME/);
  }
});

test('phone lifecycle edits through the current properties strip', () => {
  const lifecycle = read('mobile-annotations/lifecycle.mjs');
  assert.match(lifecycle, /for \(const name of \['Blue', 'Black', 'Red'\]\)/);
  assert.match(lifecycle, /Line width\|Counter size/);
  assert.match(lifecycle, /\[aria-label="callout settings"\]/);
});

test('phone viewer harness opens the zoom menu before Zoom in; hub chevron is 18px', () => {
  const viewer = read('mobile-workflows/viewer-auxiliary-e2e.mjs');
  assert.match(viewer, /mobile reopen zoom options[\s\S]{0,200}name: 'Zoom in'/);
  const hub = read('mobile-workflows/hub-resilience-e2e.mjs');
  assert.match(hub, /glyphWidth, 18/);
});

test('phone annotation runner is hermetic (loopback only)', () => {
  const runner = read('mobile-annotations-e2e.mjs');
  assert.match(runner, /route\.abort\('blockedbyclient'\)/);
});
