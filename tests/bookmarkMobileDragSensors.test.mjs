/*
 * bookmarkMobileDragSensors.test.mjs — source-assertion guard for the phone
 * bookmarks drag-and-drop parity work (owner ruling 2026-09-17: "The bookmarks
 * section on the phone is not like it is in the web version, where you can drag
 * and drop").
 *
 * There is no React render harness for BookmarksPanel in this repo, so these
 * read the panel source as TEXT and pin the sensor contract:
 *   - the phone sheet's DndContext uses a TouchSensor with a long-press
 *     activation constraint (otherwise a plain vertical swipe would be eaten by
 *     the drag and the list could not be scrolled);
 *   - the desktop DndContext still uses the bare, immediate PointerSensor;
 *   - the phone rows are real @dnd-kit sortables sharing the desktop
 *     projection, not the old up/down-button-only list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Node cannot parse JSX, so the panel is read as text (same approach as the
// PDFViewer source-assertion tests).
const PANEL_PATH = fileURLToPath(new URL('../src/sidebar/BookmarksPanel.jsx', import.meta.url));
const source = readFileSync(PANEL_PATH, 'utf8');

test('phone bookmark drag activates on a long press, not on touch-down', () => {
  const declaration = source.match(
    /export const MOBILE_BOOKMARK_DRAG_ACTIVATION = \{([^}]*)\};/,
  );
  assert.ok(declaration, 'MOBILE_BOOKMARK_DRAG_ACTIVATION must be exported from BookmarksPanel');
  const activation = Object.fromEntries(
    declaration[1]
      .split(',')
      .map((entry) => entry.split(':').map((part) => part.trim()))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, Number(value)]),
  );
  assert.ok(
    activation.delay >= 200 && activation.delay <= 400,
    `long-press delay should read as a deliberate hold, got ${activation.delay}`,
  );
  assert.ok(
    activation.tolerance > 0 && activation.tolerance <= 10,
    `a few px of tolerance lets a scroll swipe cancel the hold, got ${activation.tolerance}`,
  );
});

test('mobile sensor set wires the long-press constraint onto the TouchSensor', () => {
  assert.match(
    source,
    /useSensor\(\s*TouchSensor,\s*\{\s*activationConstraint:\s*MOBILE_BOOKMARK_DRAG_ACTIVATION\s*\}\s*\)/,
    'mobile sensors must pass MOBILE_BOOKMARK_DRAG_ACTIVATION to the TouchSensor',
  );
  // Mouse stays immediate so a desktop browser sitting in the phone layout
  // still drags on mousedown.
  assert.match(source, /useSensor\(MouseSensor,\s*\{\}\)/);
  assert.match(source, /const mobileSensors = useSensors\(/);
});

test('desktop sensors are untouched — immediate PointerSensor, no constraint', () => {
  assert.match(
    source,
    /const sensors = useSensors\(useSensor\(PointerSensor, \{\}\), useSensor\(KeyboardSensor, \{\}\)\);/,
    'the desktop sensor line must stay an immediate PointerSensor with no activation constraint',
  );
  // The desktop tree must not gain a TouchSensor / delay of its own.
  const desktopDndBlock = source.slice(source.lastIndexOf('<DndContext'));
  assert.match(desktopDndBlock, /sensors=\{sensors\}/);
  assert.doesNotMatch(desktopDndBlock, /mobileSensors/);
});

test('phone rows are dnd-kit sortables sharing the desktop projection', () => {
  const mobileBranch = source.slice(
    source.indexOf('if (mobileMode) {'),
    source.lastIndexOf('<DndContext'),
  );
  assert.ok(mobileBranch.length > 0, 'mobileMode branch should precede the desktop DndContext');
  assert.match(mobileBranch, /sensors=\{mobileSensors\}/);
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

test('the phone row exposes a drag grip whose touch-action locks during a drag', () => {
  const rowComponent = source.slice(
    source.indexOf('const MobileBookmarkRow = ('),
    source.indexOf('const BookmarksPanel = ('),
  );
  assert.ok(rowComponent.length > 0, 'MobileBookmarkRow should be defined before BookmarksPanel');
  assert.match(rowComponent, /useSortable\(\{/);
  assert.match(rowComponent, /className="mobile-bookmark-grip"/);
  assert.match(rowComponent, /touchAction: isDraggingAny \? 'none' : 'manipulation'/);
  // droppable node carries the row id the projection + drag clamp query by.
  assert.match(rowComponent, /data-bookmark-row-id=\{item\.id\}/);
});

/*
 * Owner ruling 2026-09-22 — phone bookmark rows carry NO up/down reorder
 * buttons. Long-press drag is the only reorder path; the grip keeps @dnd-kit's
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
