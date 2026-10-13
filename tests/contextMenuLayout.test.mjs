// Drawboard canvas audit chunk 7: the mark menu's layout (icon row + Arrange ▸).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  layoutContextMenuItems,
  moveMenuFocus,
  submenuSide,
  QUICK_ACTION_KEYS,
  ARRANGE_KEYS,
} from '../src/utils/contextMenuLayout.js';

const it = (key, label = key, disabled = false) => ({ key, label, disabled, onClick: () => key });
const sep = (n) => ({ separator: true, key: `sep-${n}` });
const shapeMenu = (opts = {}) => [
  it('cut', 'Cut'), it('copy', 'Copy'), it('paste', 'Paste', opts.pasteOff ?? true), it('duplicate', 'Duplicate'), it('delete', 'Delete'),
  it('lock', 'Lock'), sep(0),
  it('bringToFront', 'Bring to front', opts.orderOff ?? false), it('bringForward', 'Bring forward', opts.orderOff ?? false),
  it('sendBackward', 'Send backward', opts.orderOff ?? false), it('sendToBack', 'Send to back', opts.orderOff ?? false),
];

test('a mark menu becomes icon row + Lock + Arrange', () => {
  const layout = layoutContextMenuItems(shapeMenu());
  assert.deepEqual(layout.quick.map((q) => q.key), ['duplicate', 'cut', 'copy', 'paste', 'delete']);
  assert.deepEqual(layout.rows.map((r) => r.key), ['lock', 'arrange']);
  const arrange = layout.rows[1];
  assert.equal(arrange.label, 'Arrange');
  assert.deepEqual(arrange.submenu.map((s) => s.label), ['Bring to front', 'Bring forward', 'Send backward', 'Send to back']);
  assert.equal(arrange.disabled, false);
  // The items keep their own state and handlers.
  assert.equal(layout.quick.find((q) => q.key === 'paste').disabled, true);
  assert.equal(layout.quick.find((q) => q.key === 'cut').onClick(), 'cut');
});

test('Arrange is off only when all four order items are off', () => {
  assert.equal(layoutContextMenuItems(shapeMenu({ orderOff: true })).rows.find((r) => r.key === 'arrange').disabled, true);
  const some = shapeMenu();
  some[7].disabled = true; // Bring to front off (already on top)
  assert.equal(layoutContextMenuItems(some).rows.find((r) => r.key === 'arrange').disabled, false);
});

test('no lock item: just Arrange', () => {
  const items = shapeMenu().filter((x) => x.key !== 'lock');
  assert.deepEqual(layoutContextMenuItems(items).rows.map((r) => r.key), ['arrange']);
});

test('short menus keep their plain list', () => {
  assert.equal(layoutContextMenuItems([it('paste', 'Paste')]), null);
  assert.equal(layoutContextMenuItems([it('delete', 'Delete')]), null);
  assert.equal(layoutContextMenuItems([]), null);
  assert.equal(layoutContextMenuItems(null), null);
});

test('keys are the audit set', () => {
  assert.deepEqual([...QUICK_ACTION_KEYS], ['duplicate', 'cut', 'copy', 'paste', 'delete']);
  assert.deepEqual([...ARRANGE_KEYS], ['bringToFront', 'bringForward', 'sendBackward', 'sendToBack']);
});

test('keyboard: up/down between rows, left/right along the icon row, wrapping', () => {
  const stops = [['duplicate', 'cut', 'copy', 'delete'], ['lock'], ['arrange']];
  assert.deepEqual(moveMenuFocus(stops, null, 'ArrowDown'), { row: 0, col: 0 });
  assert.deepEqual(moveMenuFocus(stops, null, 'ArrowUp'), { row: 2, col: 0 });
  assert.deepEqual(moveMenuFocus(stops, { row: 0, col: 1 }, 'ArrowRight'), { row: 0, col: 2 });
  assert.deepEqual(moveMenuFocus(stops, { row: 0, col: 3 }, 'ArrowRight'), { row: 0, col: 0 });
  assert.deepEqual(moveMenuFocus(stops, { row: 0, col: 0 }, 'ArrowLeft'), { row: 0, col: 3 });
  assert.deepEqual(moveMenuFocus(stops, { row: 0, col: 2 }, 'ArrowDown'), { row: 1, col: 0 });
  assert.deepEqual(moveMenuFocus(stops, { row: 2, col: 0 }, 'ArrowDown'), { row: 0, col: 0 });
  assert.deepEqual(moveMenuFocus(stops, { row: 0, col: 0 }, 'ArrowUp'), { row: 2, col: 0 });
  assert.deepEqual(moveMenuFocus(stops, { row: 1, col: 0 }, 'Home'), { row: 0, col: 0 });
  assert.deepEqual(moveMenuFocus(stops, { row: 0, col: 2 }, 'End'), { row: 2, col: 0 });
  assert.equal(moveMenuFocus(stops, { row: 1, col: 0 }, 'ArrowRight'), null, 'a one-item row does not move sideways');
  assert.equal(moveMenuFocus([[], []], null, 'ArrowDown'), null);
});

test('keyboard: empty rows (all off) are skipped', () => {
  const stops = [['copy'], [], ['arrange']];
  assert.deepEqual(moveMenuFocus(stops, { row: 0, col: 0 }, 'ArrowDown'), { row: 1, col: 0 });
});

test('submenu opens right, or left when the right has no room', () => {
  assert.equal(submenuSide({ menuLeft: 400, menuRight: 560, submenuWidth: 150, boundRight: 1400 }), 'right');
  assert.equal(submenuSide({ menuLeft: 1200, menuRight: 1360, submenuWidth: 150, boundRight: 1400 }), 'left');
  assert.equal(submenuSide({ menuLeft: 20, menuRight: 180, submenuWidth: 400, boundLeft: 8, boundRight: 300 }), 'right', 'no room either side: right');
});

test('wiring: the menu draws the layout, animates with the menu tokens, keeps touch rows', () => {
  const menu = readFileSync(new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url), 'utf8');
  assert.match(menu, /const markLayout = !isMobileMenu && !pageMenuItems \? layoutContextMenuItems\(items\) : null;/);
  assert.match(menu, /className="annotation-context-menu"/);
  assert.match(menu, /el\.dataset\.side = position\.top < ctx\.y - 0\.5 \? 'top' : 'bottom';/);
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /window\.addEventListener\('keydown', onKeyDown, true\)/);
  const css = readFileSync(new URL('../src/styles/annotationContextMenu.css', import.meta.url), 'utf8');
  assert.match(css, /animation: annotation-menu-in-down var\(--motion-menu, 100ms\) var\(--ease-out, cubic-bezier\(0\.33, 1, 0\.68, 1\)\)/);
  assert.match(css, /translate: 0 calc\(var\(--motion-menu-shift, 8px\) \* -1\)/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
  assert.match(css, /\[data-touch-rows='true'\] \.annotation-menu-icon \{[^}]*width: 44px;/);
});
