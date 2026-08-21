import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const SIDEBAR_SOURCE = readFileSync(new URL('../src/PDFSidebar.jsx', import.meta.url), 'utf8');
const VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

function loadSidebarHelpers() {
  const start = SIDEBAR_SOURCE.indexOf('export function shouldToggleSidebarOnKey');
  const end = SIDEBAR_SOURCE.indexOf('// Module scope so it keeps a stable component identity', start);
  assert.ok(start > -1 && end > start, 'sidebar toggle helpers are present');
  const body = SIDEBAR_SOURCE.slice(start, end).replaceAll('export ', '');
  const exports = {};
  // eslint-disable-next-line no-new-func
  new Function('exports', `${body}\nexports.shouldToggleSidebarOnKey = shouldToggleSidebarOnKey;\nexports.nextSidebarCollapsed = nextSidebarCollapsed;`)(exports);
  return exports;
}

const { shouldToggleSidebarOnKey, nextSidebarCollapsed } = loadSidebarHelpers();

function keyEvent(key, extras = {}) {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...extras,
  };
}

function applyBToggle(event, { isFormField, collapsed }) {
  if (!shouldToggleSidebarOnKey(event, isFormField)) return { toggled: false, collapsed };
  return { toggled: true, collapsed: nextSidebarCollapsed(collapsed) };
}

test('P2-34 leftover: B toggles the rail open then closed', () => {
  let collapsed = true;
  const first = applyBToggle(keyEvent('b'), { isFormField: false, collapsed });
  assert.equal(first.toggled, true);
  assert.equal(first.collapsed, false);
  collapsed = first.collapsed;
  const second = applyBToggle(keyEvent('B'), { isFormField: false, collapsed });
  assert.equal(second.toggled, true);
  assert.equal(second.collapsed, true);
});

test('P2-34 leftover: already-closed B opens; already-open B closes', () => {
  assert.equal(nextSidebarCollapsed(true), false);
  assert.equal(nextSidebarCollapsed(false), true);
  const fromClosed = applyBToggle(keyEvent('b'), { isFormField: false, collapsed: true });
  assert.deepEqual(fromClosed, { toggled: true, collapsed: false });
  const fromOpen = applyBToggle(keyEvent('b'), { isFormField: false, collapsed: false });
  assert.deepEqual(fromOpen, { toggled: true, collapsed: true });
});

test('P2-34 leftover: ignore B while typing in input / textarea / contenteditable', () => {
  for (const key of ['b', 'B']) {
    const ignored = applyBToggle(keyEvent(key), { isFormField: true, collapsed: true });
    assert.deepEqual(ignored, { toggled: false, collapsed: true }, `${key} must stay inert in a form field`);
    assert.equal(shouldToggleSidebarOnKey(keyEvent(key), true), false);
  }
  assert.match(VIEWER_SOURCE, /activeElement\.tagName === 'INPUT'/);
  assert.match(VIEWER_SOURCE, /activeElement\.tagName === 'TEXTAREA'/);
  assert.match(VIEWER_SOURCE, /activeElement\.isContentEditable/);
  const bSlice = VIEWER_SOURCE.slice(
    VIEWER_SOURCE.indexOf("e.key === 'b' || e.key === 'B'"),
    VIEWER_SOURCE.indexOf("e.key === 'b' || e.key === 'B'") + 280,
  );
  assert.match(bSlice, /if \(isFormField\) \{\s*return;/);
});

test('P2-34 leftover: modifiers and non-B keys do not toggle', () => {
  assert.equal(shouldToggleSidebarOnKey(keyEvent('b', { metaKey: true }), false), false);
  assert.equal(shouldToggleSidebarOnKey(keyEvent('b', { ctrlKey: true }), false), false);
  assert.equal(shouldToggleSidebarOnKey(keyEvent('b', { altKey: true }), false), false);
  assert.equal(shouldToggleSidebarOnKey(keyEvent('b', { shiftKey: true }), false), false);
  assert.equal(shouldToggleSidebarOnKey(keyEvent('v'), false), false);
  assert.equal(shouldToggleSidebarOnKey(null, false), false);
});

test('P2-34 leftover: viewer B calls the public sidebar toggleCollapse', () => {
  const start = VIEWER_SOURCE.indexOf("e.key === 'b' || e.key === 'B'");
  assert.ok(start > -1, 'viewer listens for B');
  const slice = VIEWER_SOURCE.slice(start, start + 360);
  assert.match(slice, /pdfSidebarRef\.current\?\.toggleCollapse\?\.\(\)/);
  assert.match(slice, /e\.preventDefault\(\)/);
  assert.match(SIDEBAR_SOURCE, /toggleCollapse,/);
  assert.match(SIDEBAR_SOURCE, /setIsCollapsed\(\(prev\) => nextSidebarCollapsed\(prev\)\)/);
});
