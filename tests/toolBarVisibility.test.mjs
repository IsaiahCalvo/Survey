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

// VT-34: compact tool bar, same card, same flag.
test('compact tool bar: saved on this device, applied on <html>, tokens only inside the two bars', async () => {
  const mod = await import('../src/utils/toolBarVisibility.js');
  const m = new Map();
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  assert.equal(mod.loadToolBarCompact(storage), false);
  assert.equal(mod.setToolBarCompact(true, { storage }), true);
  assert.equal(m.get(mod.TOOL_BAR_COMPACT_KEY), '1');
  assert.equal(mod.loadToolBarCompact(storage), true);
  assert.equal(mod.loadToolBarCompact({ getItem() { throw new Error('blocked'); } }), false);
  const attrs = new Map();
  const root = { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) };
  mod.applyToolBarCompact(true, root);
  assert.equal(attrs.get(mod.TOOL_BAR_SIZE_ATTR), 'compact');
  mod.applyToolBarCompact(false, root);
  assert.equal(attrs.size, 0);
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /applyToolBarCompact\(toolBarSettingsEnabled && toolBarCompact && !isNarrowShell\)/);
  const css = readFileSync(new URL('../src/styles/toolBarVisibility.css', import.meta.url), 'utf8');
  assert.ok(css.includes('html[data-tool-bar-size="compact"] :is(#chrome-top-host, #chrome-sub-toolbar-host) {'));
  assert.match(css, /--chrome-bar-h: 28px/);
  const card = readFileSync(new URL('../src/components/ToolbarsMenu.jsx', import.meta.url), 'utf8');
  assert.match(card, /label="Compact tool bar"/);
  assert.match(card, /\{!hidden && \(/);
});
