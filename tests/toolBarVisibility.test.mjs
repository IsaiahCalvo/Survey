// Nightly 'toolbar-settings' (Drawboard Projects VT-33): Show/hide toolbars.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TOOL_BAR_ATTR,
  TOOL_BAR_HIDDEN_KEY,
  applyToolBarHidden,
  loadToolBarHidden,
  setToolBarHidden,
} from '../src/utils/toolBarVisibility.js';

test('the choice is saved on this device; blocked storage reads as shown', () => {
  const m = new Map();
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  assert.equal(loadToolBarHidden(storage), false);
  assert.equal(setToolBarHidden(true, { storage }), true);
  assert.equal(m.get(TOOL_BAR_HIDDEN_KEY), '1');
  assert.equal(loadToolBarHidden(storage), true);
  assert.equal(loadToolBarHidden({ getItem() { throw new Error('blocked'); } }), false);
});

test('applied on <html>, and only the shell applies it (desktop only)', () => {
  const attrs = new Map();
  const root = { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) };
  applyToolBarHidden(true, root);
  assert.equal(attrs.get(TOOL_BAR_ATTR), 'hidden');
  applyToolBarHidden(false, root);
  assert.equal(attrs.size, 0);
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /applyToolBarHidden\(toolBarSettingsEnabled && toolBarHidden && !isNarrowShell\)/);
  const css = readFileSync(new URL('../src/styles/toolBarVisibility.css', import.meta.url), 'utf8');
  for (const sel of ['#chrome-top-host', '#chrome-sub-toolbar-host', '[data-viewer-top-reserve]']) {
    assert.ok(css.includes(`html[data-tool-bar="hidden"] ${sel}`), sel);
  }
  const rail = readFileSync(new URL('../src/PDFSidebar.jsx', import.meta.url), 'utf8');
  assert.match(rail, /useState\(\(\) => isFeatureOn\('toolbar-settings'\)\)/);
});
