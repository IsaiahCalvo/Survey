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
  // Same collision detection (the drag-intent resolver, UX 2026-09-30), same
  // drag-clamp modifier, same measuring, same calm auto-scroll and the same
  // drag handlers as desktop, so the reorder / reparent result is identical.
  assert.match(mobileBranch, /collisionDetection=\{bookmarkCollisionDetection\}/);
  assert.match(mobileBranch, /modifiers=\{\[restrictBookmarkTreeDrag\]\}/);
  assert.match(mobileBranch, /measuring=\{bookmarkTreeMeasuring\}/);
  assert.match(mobileBranch, /autoScroll=\{CALM_LIST_AUTO_SCROLL\}/);
  for (const handler of ['handleDragStart', 'handleDragEnd', 'handleDragCancel']) {
    assert.match(mobileBranch, new RegExp(`\\{${handler}\\}`), `mobile DndContext should reuse ${handler}`);
  }
  assert.match(mobileBranch, /<SortableContext items=\{sortedIds\}/);
  // The projected depth drives the live reparent feedback on the phone too,
  // with the same landing slot as desktop. (UX 2026-10-01, owner: no gold
  // glow — the folder drop-target tint the 2026-09-30 round added is gone,
  // so no dropTargetState is passed any more.)
  assert.match(mobileBranch, /projectedDepth=\{item\.id === activeId && projected \? projected\.depth : null\}/);
  assert.doesNotMatch(source, /dropTargetState|data-bookmark-drop-target/);
  assert.match(mobileBranch, /landingSlot=\{item\.id === activeId && projected \?/);
});

/*
 * UX 2026-10-01 — owner: "I don't want the yellow glow". The landing slot is
 * quiet and neutral on both layouts; nothing a drag paints is accent.
 * Second pass the same day ("a uniform colour / uniform style when it gets
 * picked up"): the slot is now the app's ONE drag slot (--drag-slot-*, the
 * dashed outline every vertical list shows), and the lifted row is the app's
 * one lift (data-drag-lifted), not a per-panel surface + shadow.
 */
test('the drag landing slot is the shared neutral slot, never gold', () => {
  const desktopRow = source.slice(source.indexOf('const BookmarkTreeRow = ('), source.indexOf('const MobileBookmarkRow = ('));
  const slot = desktopRow.slice(desktopRow.indexOf('data-bookmark-drop-slot'));
  assert.match(slot.slice(0, 700), /background: 'var\(--drag-slot-bg\)'/);
  assert.match(slot.slice(0, 700), /border: 'var\(--drag-slot-border\)'/);
  assert.doesNotMatch(slot.slice(0, 700), /--accent/);
  const css = readFileSync(fileURLToPath(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url)), 'utf8');
  const rule = css.slice(css.indexOf('.mobile-bookmark-drop-slot {'));
  const body = rule.slice(0, rule.indexOf('}'));
  assert.doesNotMatch(body, /--accent/);
  assert.match(body, /border: var\(--drag-slot-border\)/);
  assert.doesNotMatch(css, /data-bookmark-drop-target/);
});

test('both bookmark layouts lift with the shared picked-up look', () => {
  const desktopRow = source.slice(source.indexOf('const BookmarkTreeRow = ('), source.indexOf('const MobileBookmarkRow = ('));
  const mobileRow = source.slice(source.indexOf('const MobileBookmarkRow = ('), source.indexOf('const BookmarksPanel = ('));
  assert.match(desktopRow, /data-drag-lifted=\{isClone \|\| isActiveRow \? '' : undefined\}/);
  assert.match(mobileRow, /data-drag-lifted=\{isDragging \? '' : undefined\}/);
  const css = readFileSync(fileURLToPath(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url)), 'utf8');
  const lifted = css.slice(css.indexOf('.mobile-bookmark-row.is-dragging {'));
  assert.doesNotMatch(lifted.slice(0, lifted.indexOf('}')), /background|box-shadow/);
  const grip = css.slice(css.indexOf('.mobile-bookmark-row.is-dragging .mobile-bookmark-grip {'));
  assert.doesNotMatch(grip.slice(0, grip.indexOf('}')), /--accent/);
});

/*
 * UX 2026-10-01 — owner: opening a folder was instant but closing it took
 * about a second. A tap now drops the folder from expandedFolders in the same
 * handler (no 240ms fold-up timer first), and a desktop folder row folds on a
 * click anywhere, like the phone row.
 */
test('tapping an open folder closes it in the same frame', () => {
  const toggle = source.slice(source.indexOf('const toggleExpand = useCallback('), source.indexOf('const persistBookmarkTree = useCallback('));
  const closeBranch = toggle.slice(0, toggle.indexOf('return;'));
  assert.match(closeBranch, /setExpandedFolders\(/);
  assert.doesNotMatch(closeBranch, /animateCollapseFolders\(|setTimeout/);
  const desktopRow = source.slice(source.indexOf('const BookmarkTreeRow = ('), source.indexOf('const MobileBookmarkRow = ('));
  assert.match(desktopRow, /if \(isFolder\) \{\s*if \(item\.children\?\.length\) onToggle\?\.\(item\.id\);\s*\} else \{\s*onNavigate\?\.\(item\);/);
});

/*
 * UX 2026-09-30 — owner: moving a bookmark into / out of a folder was jumpy
 * ("it has to get paused a little bit"). Both layouts resolve the landing spot
 * through resolveBookmarkDragIntent (hysteresis + dwell, unit-tested in
 * bookmarkReorderUtils.test.mjs), never the raw per-frame projection, and the
 * drop commits exactly the resolved spot.
 */
test('both trees use the drag-intent resolver and drop on the committed spot', () => {
  const dndBlocks = source.split('<DndContext').slice(1);
  assert.equal(dndBlocks.length, 2, 'phone + desktop DndContext');
  for (const block of dndBlocks) {
    assert.match(block.slice(0, 600), /collisionDetection=\{bookmarkCollisionDetection\}/);
    assert.match(block.slice(0, 600), /autoScroll=\{CALM_LIST_AUTO_SCROLL\}/);
  }
  assert.match(source, /resolveBookmarkDragIntent\(intent, \{/);
  assert.match(source, /dragIntentRef\.current = createBookmarkDragIntent\(flattenedItems, active\.id\)/);
  const dragEnd = source.slice(source.indexOf('const handleDragEnd = useCallback('), source.indexOf('const handleDragCancel = useCallback('));
  assert.match(dragEnd, /applyBookmarkTreeProjection\(bookmarkTree, active\.id, intent\.overId, intent\)/);
  assert.doesNotMatch(source, /getBookmarkProjection\(/, 'the raw per-frame projection no longer drives the panel');
});

test('every bookmark grip carries the shared data-drag-handle marker', () => {
  const desktopRow = source.slice(source.indexOf('const BookmarkTreeRow = ('), source.indexOf('const MobileBookmarkRow = ('));
  const phoneRow = source.slice(source.indexOf('const MobileBookmarkRow = ('), source.indexOf('const BookmarksPanel = ('));
  assert.match(desktopRow, /\{\.\.\.mergeDragHandleProps\([\s\S]{0,80}?\)\}\s*data-drag-handle=""/);
  assert.match(phoneRow, /className="mobile-bookmark-grip"[\s\S]{0,300}data-drag-handle=""/);
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

/*
 * UX 2026-10-01 — owner (iPhone): "still a little jitteriness … moving in and
 * out of bookmark groups … super smooth". Measured per frame: the lifted row
 * trailed the finger by a frame (more while auto-scrolling), a folder opening
 * mid-drag shoved the rows under it a whole row per child in one frame (and on
 * desktop stripped every row's offset), and rows / slot / indent used three
 * clocks. Pin the fixes.
 */
test('bookmark drags stay smooth: finger-locked row, gliding layout, one clock', () => {
  // The lifted row is placed from the finger every animation frame.
  assert.match(source, /const placeLiftedBookmarkRow = \(list, live\) =>/);
  assert.match(source, /requestAnimationFrame\(function placeEachFrame\(\)/);
  assert.match(source, /window\.addEventListener\('pointermove', onPointerMove, \{ capture: true, passive: true \}\)/);
  // Mid-drag layout shifts glide (and new rows fade in) instead of jumping.
  assert.match(source, /const glideBookmarkLayoutShift = \(row, shift\) =>/);
  assert.match(source, /if \(shift\) glideBookmarkLayoutShift\(row, shift\);/);
  // A drag-opened folder no longer runs the fold-down keyframes mid-drag.
  const autoExpand = source.slice(
    source.indexOf('autoExpandTimerRef.current = setTimeout(() => {'),
    source.indexOf('// The lifted row follows the finger'),
  );
  assert.ok(autoExpand.length > 0);
  assert.doesNotMatch(autoExpand, /setExpandingFolderIds/);
  // A fold animation never strips the parted rows' offsets during a drag.
  assert.match(source, /isGroupAnimationActive && !isDraggingAny/);
  // One glide for rows (both layouts), slot and indent.
  assert.match(source, /export const BOOKMARK_SORT_TRANSITION = \{ duration: BOOKMARK_DRAG_GLIDE_MS, easing: BOOKMARK_DRAG_GLIDE_EASING \};/);
  assert.equal(source.match(/transition: BOOKMARK_SORT_TRANSITION,/g)?.length, 2);
  const glide = /const BOOKMARK_DRAG_GLIDE_MS = (\d+);\s*const BOOKMARK_DRAG_GLIDE_EASING = '([^']+)';/.exec(source);
  assert.ok(glide, 'the drag glide constants');
  const css = readFileSync(fileURLToPath(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url)), 'utf8');
  const ruleOf = (selector) => { const rule = css.slice(css.indexOf(`${selector} {`)); return rule.slice(0, rule.indexOf('}')); };
  assert.ok(ruleOf('.mobile-bookmark-drop-slot').includes(`top ${glide[1]}ms ${glide[2]}, left ${glide[1]}ms ${glide[2]}`));
  assert.ok(ruleOf('.mobile-bookmark-row').includes(`padding-left ${glide[1]}ms ${glide[2]}`));
});
