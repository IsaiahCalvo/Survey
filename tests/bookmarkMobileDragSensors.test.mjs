/*
 * bookmarkMobileDragSensors.test.mjs — source-assertion guard for the bookmarks
 * drag-and-drop sensors (phone sheet + desktop tree).
 *
 * UX 2026-09-30 — owner: on the phone a bookmark "won't even pick up" when he
 * drags it; drag must work everywhere like Projects / Templates (grab the grip
 * and drag right away). That explicitly replaces the 2026-09-17 long-press rule
 * this file used to pin (TouchSensor, 250ms still hold): a grab-then-move
 * within the hold scrolled the sheet instead of dragging. The new contract is
 * the reference lists' (SortableRearrangeList + DragRearrangeHandle):
 *   - one PointerSensor for mouse AND touch with a small distance constraint
 *     (no delay) — the drag starts on the first few px of movement, and a plain
 *     click on a desktop folder's grip no longer starts a drag (fold flicker);
 *   - the phone grip is `touch-action: none`, so the browser never claims a
 *     touch that starts on it for scrolling; only the grip is locked, so a
 *     swipe anywhere else on the sheet still scrolls;
 *   - phone and desktop share the same sensor set;
 *   - the phone rows are real @dnd-kit sortables sharing the desktop
 *     projection, not the old up/down-button-only list.
 *
 * There is no React render harness for BookmarksPanel in this repo, so these
 * read the panel source as TEXT.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Node cannot parse JSX, so the panel is read as text (same approach as the
// PDFViewer source-assertion tests).
const PANEL_PATH = fileURLToPath(new URL('../src/sidebar/BookmarksPanel.jsx', import.meta.url));
const source = readFileSync(PANEL_PATH, 'utf8');

test('bookmark drag activates on a small movement, with no hold delay', () => {
  const declaration = source.match(
    /export const BOOKMARK_DRAG_ACTIVATION = \{([^}]*)\};/,
  );
  assert.ok(declaration, 'BOOKMARK_DRAG_ACTIVATION must be exported from BookmarksPanel');
  const activation = Object.fromEntries(
    declaration[1]
      .split(',')
      .map((entry) => entry.split(':').map((part) => part.trim()))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, Number(value)]),
  );
  assert.equal(activation.delay, undefined, 'no long-press delay: the grip drags right away');
  assert.ok(
    activation.distance > 0 && activation.distance <= 10,
    `a few px of movement separates a click/tap from a drag, got ${activation.distance}`,
  );
  // The long-press constant and touch-only sensors are gone.
  assert.doesNotMatch(source, /MOBILE_BOOKMARK_DRAG_ACTIVATION/);
  assert.doesNotMatch(source, /useSensor\(TouchSensor/);
  assert.doesNotMatch(source, /useSensor\(MouseSensor/);
});

test('one PointerSensor with the distance constraint drives phone and desktop', () => {
  assert.match(
    source,
    /const sensors = useSensors\(\s*useSensor\(PointerSensor, \{ activationConstraint: BOOKMARK_DRAG_ACTIVATION \}\),\s*useSensor\(KeyboardSensor, \{\}\),\s*\);/,
  );
  assert.doesNotMatch(source, /mobileSensors/);
  const desktopDndBlock = source.slice(source.lastIndexOf('<DndContext'));
  assert.match(desktopDndBlock, /sensors=\{sensors\}/);
});

test('phone rows are dnd-kit sortables sharing the desktop projection', () => {
  const mobileBranch = source.slice(
    source.indexOf('if (mobileMode) {'),
    source.lastIndexOf('<DndContext'),
  );
  assert.ok(mobileBranch.length > 0, 'mobileMode branch should precede the desktop DndContext');
  assert.match(mobileBranch, /sensors=\{sensors\}/);
  // Same collision detection, same drag-clamp modifier, same measuring, and the
  // same drag handlers as desktop, so the reorder / reparent result is identical.
  assert.match(mobileBranch, /collisionDetection=\{closestCenter\}/);
  assert.match(mobileBranch, /modifiers=\{\[restrictBookmarkTreeDrag\]\}/);
  assert.match(mobileBranch, /measuring=\{bookmarkTreeMeasuring\}/);
  for (const handler of ['handleDragStart', 'handleDragMove', 'handleDragOver', 'handleDragEnd', 'handleDragCancel']) {
    assert.match(mobileBranch, new RegExp(`\\{${handler}\\}`), `mobile DndContext should reuse ${handler}`);
  }
  assert.match(mobileBranch, /<SortableContext items=\{sortedIds\}/);
  // The projected depth drives the live reparent feedback on the phone too.
  assert.match(mobileBranch, /projectedDepth=\{item\.id === activeId && projected \? projected\.depth : null\}/);
});

test('the phone row exposes a drag grip that is always touch-action: none', () => {
  const rowComponent = source.slice(
    source.indexOf('const MobileBookmarkRow = ('),
    source.indexOf('const BookmarksPanel = ('),
  );
  assert.ok(rowComponent.length > 0, 'MobileBookmarkRow should be defined before BookmarksPanel');
  assert.match(rowComponent, /useSortable\(\{/);
  assert.match(rowComponent, /className="mobile-bookmark-grip"/);
  // Like DragRearrangeHandle: the grip never lets the browser pan, so a touch
  // on it goes to the PointerSensor and the drag starts at once.
  assert.match(rowComponent, /style=\{\{ touchAction: 'none' \}\}/);
  // droppable node carries the row id the projection + drag clamp query by.
  assert.match(rowComponent, /data-bookmark-row-id=\{item\.id\}/);
});

/*
 * Owner ruling 2026-09-22 — phone bookmark rows carry NO up/down reorder
 * buttons. Dragging the grip is the only reorder path; the grip keeps @dnd-kit's
 * `attributes` so the KeyboardSensor still reorders for accessibility.
 */
test('the phone row has no up/down reorder buttons', () => {
  const rowComponent = source.slice(
    source.indexOf('const MobileBookmarkRow = ('),
    source.indexOf('const BookmarksPanel = ('),
  );
  assert.doesNotMatch(rowComponent, /Move bookmark up/);
  assert.doesNotMatch(rowComponent, /Move bookmark down/);
  assert.doesNotMatch(rowComponent, /chevronUp|chevronDown/);
  // and the sibling-swap handler they drove is gone from the whole panel.
  assert.doesNotMatch(source, /handleMobileMoveBookmark/);
  // The grip still spreads the sortable attributes that make it keyboard
  // reachable (role=button / tabIndex 0 come from `attributes`).
  assert.match(rowComponent, /className="mobile-bookmark-grip"[\s\S]*?\{\.\.\.attributes\}[\s\S]*?\{\.\.\.listeners\}/);
});

test('the desktop tree row never had up/down arrows either — parity holds', () => {
  const desktopRow = source.slice(
    source.indexOf('const BookmarkTreeRow = ('),
    source.indexOf('const MobileBookmarkRow = ('),
  );
  assert.doesNotMatch(desktopRow, /chevronUp|chevronDown|Move bookmark/);
});

test('the phone panel offers New folder, creating an empty folder in the shared store', () => {
  const mobileBranch = source.slice(
    source.indexOf('if (mobileMode) {'),
    source.lastIndexOf('<DndContext'),
  );
  // The control lives in the panel's existing action row.
  assert.match(mobileBranch, /className="mobile-bookmark-toolbar"/);
  assert.match(mobileBranch, /mobile-bookmark-newfolder/);
  assert.match(mobileBranch, /aria-label=\{showMobileFolderEditor \? 'Cancel new folder' : 'New folder'\}/);
  // Inline rename-on-create, not a modal.
  assert.match(mobileBranch, /aria-label="Folder name"/);
  assert.match(mobileBranch, /onClick=\{handleCreateMobileFolder\}/);

  // The handler writes the SAME record shape the desktop modal writes for a
  // folder, through the same onBookmarkCreate prop — no second store.
  const handler = source.slice(
    source.indexOf('const handleCreateMobileFolder = useCallback('),
    source.indexOf('// Existing create/modal handlers remain the same'),
  );
  assert.ok(handler.length > 0, 'handleCreateMobileFolder should be defined');
  assert.match(handler, /onBookmarkCreate\(\{/);
  assert.match(handler, /type: 'folder'/);
  assert.match(handler, /children: \[\]/);
  assert.match(handler, /parentId: null/);
  // Empty folder: it must NOT require or create child bookmarks.
  assert.doesNotMatch(handler, /groupBookmarks/);
});
