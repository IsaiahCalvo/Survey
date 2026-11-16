// Workspaces (Nightly 'toolbar-settings'; Drawboard Projects "Workspaces").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const memory = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
globalThis.localStorage = memory();

const ws = await import('../src/utils/workspaces.js');
const bar = await import('../src/utils/toolBarVisibility.js');
const lw = await import('../src/utils/pdfLineWeight.js');
const thin = await import('../src/utils/thinLines.js');
const dock = await import('../src/utils/selectionBarDock.js');
const props = await import('../src/utils/propertiesPanelStore.js');
const { createPinnedToolsStore } = await import('../src/pinnedTools/pinnedTools.js');

test('only known parts are kept; names are cleaned', () => {
  assert.deepEqual(ws.normalizeLayout({ toolBarHidden: true, evil: 1, leftPanel: { open: 1, panel: 'search' } }), { toolBarHidden: true, leftPanel: { open: true, panel: 'search' } });
  assert.equal(ws.cleanWorkspaceName('  Field   walk  '), 'Field walk');
  assert.equal(ws.cleanWorkspaceName('x'.repeat(80)).length, ws.WORKSPACE_NAME_MAX);
  assert.deepEqual(ws.loadWorkspaces({ getItem() { throw new Error('blocked'); } }), []);
  assert.deepEqual(ws.loadWorkspaces({ getItem: () => '{not json' }), []);
});

test('save, replace by name, delete', () => {
  const s = memory();
  const a = ws.saveWorkspace('Review', { toolBarCompact: true }, { storage: s, now: 1 });
  assert.ok(a.id);
  assert.equal(ws.saveWorkspace('   ', {}, { storage: s }), null);
  const b = ws.saveWorkspace('review', { toolBarCompact: false }, { storage: s, now: 2 });
  assert.equal(b.id, a.id);
  let list = ws.loadWorkspaces(s);
  assert.equal(list.length, 1);
  assert.equal(list[0].layout.toolBarCompact, false);
  ws.saveWorkspace('Markup', {}, { storage: s });
  assert.equal(ws.loadWorkspaces(s).length, 2);
  ws.deleteWorkspace(a.id, { storage: s });
  list = ws.loadWorkspaces(s);
  assert.deepEqual(list.map((w) => w.name), ['Markup']);
});

test('capture, change everything, apply: the screen comes back', () => {
  const pinnedStore = createPinnedToolsStore({ storage: memory() });
  pinnedStore.importLayout({ visible: true, placement: 'left', compact: false, pins: [{ id: 'p1', kind: 'pen', style: {} }] });
  bar.setToolBarHidden(false); bar.setToolBarCompact(true);
  thin.setThinLines('medium'); lw.setIgnoreLineWeight(true);
  dock.setSelectionBarDocked(true); props.setPropertiesPanelPinned(false);
  const layout = ws.captureLayout({ panel: { open: true, panel: 'layers' }, pinnedStore });
  assert.equal(layout.toolBarCompact, true);
  assert.equal(layout.pinnedTools.placement, 'left');

  bar.setToolBarCompact(false); thin.setThinLines('off'); lw.setIgnoreLineWeight(false);
  dock.setSelectionBarDocked(false); props.setPropertiesPanelPinned(true);
  pinnedStore.importLayout({ visible: false, placement: 'bottom', pins: [] });

  let panel = null;
  ws.applyLayout(layout, { applyPanel: (p) => { panel = p; }, pinnedStore });
  assert.equal(bar.loadToolBarCompact(), true);
  assert.equal(thin.loadThinLines(), 'medium');
  assert.equal(lw.isIgnoreLineWeightOn(), true);
  assert.equal(dock.isSelectionBarDocked(), true);
  assert.equal(props.isPropertiesPanelPinned(), false);
  assert.equal(pinnedStore.getState().placement, 'left');
  assert.deepEqual(pinnedStore.getState().pins.map((p) => p.id), ['p1']);
  assert.deepEqual(panel, { open: true, panel: 'layers' });
  lw.setIgnoreLineWeight(false);
});

test('the Toolbars card shows Workspaces and the rail passes its panel', () => {
  const card = readFileSync(new URL('../src/components/ToolbarsMenu.jsx', import.meta.url), 'utf8');
  assert.match(card, /<WorkspacesSection panelState=\{panelState\} onApplyPanel=\{onApplyPanel\} \/>/);
  const rail = readFileSync(new URL('../src/PDFSidebar.jsx', import.meta.url), 'utf8');
  assert.match(rail, /panelState=\{\{ open: !isCollapsed, panel: activeTab \}\}/);
});
