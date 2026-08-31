import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const mobileChrome = read('../src/mobile/MobilePdfViewerChrome.jsx');
const syncStatus = read('../src/components/SyncStatusChip.jsx');
const colorPicker = read('../src/components/CompactColorPicker.jsx');
const bookmarks = read('../src/sidebar/BookmarksPanel.jsx');
const printPanel = read('../src/components/PrintPanel.jsx');
const dashboard = read('../src/Dashboard.jsx');

const componentSlice = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing component start: ${start}`);
  assert.notEqual(endIndex, -1, `missing component end: ${end}`);
  return source.slice(startIndex, endIndex);
};

test('mobile viewer popovers consume the first outside gesture through the shared barrier', () => {
  const styledSelect = componentSlice(mobileChrome, 'function MobileStyledSelect', 'const categoryGlyph');
  const header = componentSlice(mobileChrome, 'export function MobilePdfViewerHeader', 'function MobileToolProperties');
  const toolProperties = componentSlice(mobileChrome, 'function MobileToolProperties', 'export function MobilePdfViewerToolRail');
  const toolRail = componentSlice(mobileChrome, 'export function MobilePdfViewerToolRail', 'export function MobilePdfViewerDock');

  assert.match(mobileChrome, /import DismissBarrier from '\.\.\/components\/DismissBarrier'/);
  assert.match(styledSelect, /active=\{open\}[\s\S]*insideRefs=\{dismissInsideRefs\}/);
  assert.match(header, /active=\{pageEditing \|\| zoomOpen\}[\s\S]*insideRefs=\{dismissInsideRefs\}/);
  assert.match(toolProperties, /ariaLabel="Counter set"/);
  assert.match(toolRail, /active=\{syncDetailsOpen\}[\s\S]*insideRefs=\{popoverInsideRefs\}/);

  for (const source of [styledSelect, header, toolProperties, toolRail]) {
    assert.doesNotMatch(source, /document\.addEventListener\(['"](?:pointerdown|mousedown|click)/);
  }
});

test('desktop sync details dismiss without moving or activating the surface underneath', () => {
  assert.match(syncStatus, /import DismissBarrier from '\.\/DismissBarrier'/);
  assert.match(syncStatus, /active=\{detailsOpen\}[\s\S]*insideRefs=\{dismissInsideRefs\}/);
  assert.doesNotMatch(syncStatus, /document\.addEventListener\(['"](?:pointerdown|mousedown|click)/);
});

test('legacy color, bookmark, and print picker popovers use the same first-tap barrier', () => {
  assert.match(colorPicker, /active=\{typeof onClose === 'function'\}[\s\S]*insideRefs=\{dismissInsideRefs\}/);
  assert.match(bookmarks, /active=\{showCreateMenu\}[\s\S]*insideRefs=\{createMenuInsideRefs\}/);
  assert.match(printPanel, /active=\{menuOpen\}[\s\S]*insideRefs=\{dismissInsideRefs\}/);

  assert.doesNotMatch(colorPicker, /document\.addEventListener\(['"]mousedown/);
  assert.doesNotMatch(bookmarks, /document\.addEventListener\(['"]mousedown/);
  assert.doesNotMatch(
    componentSlice(printPanel, 'function PagePicker', 'function Dropdown'),
    /document\.addEventListener\(['"]mousedown/,
  );
});

test('legacy Dashboard dropdowns retain the first-tap contract if re-enabled', () => {
  assert.match(dashboard, /active=\{showUserDropdown\}[\s\S]*insideRefs=\{userDropdownInsideRefs\}/);
  assert.match(dashboard, /active=\{isViewDropdownOpen\}[\s\S]*insideRefs=\{viewDropdownInsideRefs\}/);
  assert.doesNotMatch(dashboard, /document\.addEventListener\(['"]mousedown/);
});

test('modal and direct-manipulation behavior remain outside this popover contract', () => {
  assert.match(printPanel, /className="pp-backdrop"[\s\S]*onClick=\{\(\) => handleCancel\('backdrop click'\)\}/);
  assert.doesNotMatch(mobileChrome, /annotation[^\n]{0,80}DismissBarrier/i);
});
