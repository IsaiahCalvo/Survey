// Spaces audit chunk A (2026-10-01): safety and correctness.
//   1. A space with no pages can't be turned on, and an active space that
//      lost its pages shows a "No pages in <space>" card (not a black viewer).
//   2. Removing a page from a space / deleting a space happens at once (owner
//      rule 2026-10-27: act first, Undo, never a confirm), is one Undo step,
//      and its Undo toast names the real counts of what the cascade took.
//   3. Phone: Edit areas moves the Spaces sheet out of the way.
//   4. Phone: region rename reaches the shared keyboard lift.
//   5. The space row counts pages, not drawn areas.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildRemovePageToast,
  buildSpaceDeleteToast,
  countSpaceCascadeImpact,
  formatSpaceCountLabel,
  isSpaceScopedEntry,
  resolveSpaceCascadeScope,
} from '../src/utils/spaceCascadeImpact.js';
import { scopeLegacyRestoreToOwnSlices } from '../src/utils/historyStacks.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const space = {
  id: 'sp',
  name: 'Space 2',
  assignedPages: [
    { pageId: 3, wholePageIncluded: false, regions: [{ regionId: 'r3a' }, { regionId: 'r3b' }] },
    { pageId: 5, wholePageIncluded: true, regions: [] },
  ],
};
const annotationsByPage = {
  3: { objects: [
    { data: { id: 'in-area' }, regionId: 'r3a' },
    { data: { id: 'in-area-2' }, regionId: 'r3b' },
    { data: { id: 'plain' } }, // drawn with the space on but not in an area: not cascaded
    { data: { id: 'other-space' }, regionId: 'zz' },
  ] },
  5: { objects: [{ data: { id: 'p5-tagged' }, spaceId: 'sp' }] },
};
const callouts = [
  { id: 'callout-in', pageNumber: 3, regionId: 'r3a' },
  { id: 'in-area', pageNumber: 3, regionId: 'r3a' }, // also on the canvas: counted once
  { id: 'callout-out', pageNumber: 3 },
];
const surveyMarkers = {
  smIn: { pageNumber: 3, spaceId: 'sp' },
  smOther: { pageNumber: 3, spaceId: 'other' },
  smP5: { pageNumber: 5, spaceId: 'sp' },
};

test('impact count = what the cascade rule deletes, per page and per space', () => {
  const onPage3 = countSpaceCascadeImpact({ spaceId: 'sp', space, pageIds: [3], annotationsByPage, callouts, surveyMarkers });
  assert.deepEqual(onPage3, { marks: 3, surveyMarkers: 1, areas: 2, total: 4 });
  const whole = countSpaceCascadeImpact({ spaceId: 'sp', space, pageIds: null, annotationsByPage, callouts, surveyMarkers });
  assert.deepEqual(whole, { marks: 4, surveyMarkers: 2, areas: 2, total: 6 });
  const page5 = countSpaceCascadeImpact({ spaceId: 'sp', space, pageIds: [5], annotationsByPage, callouts, surveyMarkers });
  assert.deepEqual(page5, { marks: 1, surveyMarkers: 1, areas: 0, total: 2 });
  // The rule itself (shared with PDFViewer.cascadeDeleteScopedAppState).
  const scope = resolveSpaceCascadeScope({ spaceId: 'sp', space, pageIds: [3] });
  assert.equal(isSpaceScopedEntry({ pageNumber: 3, regionId: 'r3b' }, scope), true);
  assert.equal(isSpaceScopedEntry({ pageNumber: 5, spaceId: 'sp' }, scope), false, 'another page');
  assert.equal(isSpaceScopedEntry({ pageNumber: 3 }, scope), false, 'unscoped mark');
  const explicit = resolveSpaceCascadeScope({ spaceId: 'sp', space, pageIds: [3], regionIds: ['r3a'] });
  assert.equal(isSpaceScopedEntry({ pageNumber: 3, regionId: 'r3b' }, explicit), false);
  assert.equal(isSpaceScopedEntry({ pageNumber: 3, spaceId: 'sp' }, explicit), false, 'explicit regions only');
});

test('the Undo toast states what went with it', () => {
  assert.equal(
    buildRemovePageToast({ spaceName: 'Space 2', pageId: 3, impact: { marks: 4, surveyMarkers: 0, areas: 1 } }),
    'Removed p.3 from Space 2, with 4 marks',
  );
  assert.equal(
    buildRemovePageToast({ spaceName: 'S', pageId: 1, impact: { marks: 1, surveyMarkers: 2, areas: 0 } }),
    'Removed p.1 from S, with 1 mark and 2 Survey Markers',
  );
  assert.equal(buildRemovePageToast({ spaceName: 'S', pageId: 1, impact: null }), 'Removed p.1 from S');
  assert.equal(
    buildSpaceDeleteToast({ spaceName: 'Space 2', impact: { marks: 3, surveyMarkers: 1 } }),
    'Deleted Space 2, with 3 marks and 1 Survey Marker',
  );
  assert.equal(buildSpaceDeleteToast({ spaceName: 'E', impact: null }), 'Deleted E');
});

test('row count is a small region line under the space name', () => {
  // DELIBERATE CHANGE (owner 2026-10-26): the count left the front of the row
  // ("something a little more minimal ... smaller and underneath").
  assert.equal(formatSpaceCountLabel(3), '3 regions');
  assert.equal(formatSpaceCountLabel(1), '1 region');
  assert.equal(formatSpaceCountLabel(0), 'No regions');
  const panel = read('src/sidebar/SpacesPanel.jsx');
  assert.match(panel, /<\/span>\s*<span className="space-card__count" data-space-meta>\{regionCountLabel\}<\/span>\s*<\/span>/, 'the count sits under the name, inside the title');
  assert.match(panel, /formatSpaceCountLabel\(pageCount\)/);
});

test('page removal is one Undo step: Undo puts the page and its cascaded marks back, Redo removes them', () => {
  const before = { annotationsByPage, surveyMarkers, spaces: [space], callouts: [] };
  const after = {
    annotationsByPage: { 3: { objects: [{ data: { id: 'plain' } }, { data: { id: 'other-space' }, regionId: 'zz' }] }, 5: annotationsByPage[5] },
    surveyMarkers: { smOther: surveyMarkers.smOther, smP5: surveyMarkers.smP5 },
    spaces: [{ ...space, assignedPages: [space.assignedPages[1]] }],
    callouts: [],
  };
  const meta = { reason: 'space:remove-page', context: { spaceId: 'sp', pageId: 3, cascadeIds: ['in-area', 'in-area-2', 'callout-in', 'smIn'] } };
  const undone = scopeLegacyRestoreToOwnSlices(meta, after, before, { direction: 'undo' });
  assert.deepEqual(undone.spaces[0].assignedPages.map((p) => p.pageId), [3, 5]);
  assert.deepEqual(undone.annotationsByPage[3].objects.map((o) => o.data.id).sort(), ['in-area', 'in-area-2', 'other-space', 'plain']);
  assert.ok(undone.surveyMarkers.smIn);
  const redone = scopeLegacyRestoreToOwnSlices(meta, undone, after, { direction: 'redo' });
  assert.deepEqual(redone.spaces[0].assignedPages.map((p) => p.pageId), [5]);
  assert.deepEqual(redone.annotationsByPage[3].objects.map((o) => o.data.id).sort(), ['other-space', 'plain']);
  assert.equal(redone.surveyMarkers.smIn, undefined);
});

test('PDFViewer wiring: shared cascade rule, remove-page checkpoint, empty-space guard and card', () => {
  const src = read('src/PDFViewer.jsx');
  const cascade = src.slice(src.indexOf('const cascadeDeleteScopedAppState = useCallback'), src.indexOf('const handleSpaceRemovePage = useCallback'));
  assert.match(cascade, /resolveSpaceCascadeScope\(/);
  assert.match(cascade, /isSpaceScopedEntry\(entry, scope\)/);
  const remove = src.slice(src.indexOf('const handleSpaceRemovePage = useCallback'), src.indexOf('const handleSpaceRenamePage = useCallback'));
  assert.ok(remove.indexOf("addHistoryCheckpoint('space:remove-page'") >= 0, 'page removal records an Undo step');
  assert.ok(remove.indexOf("addHistoryCheckpoint('space:remove-page'") < remove.indexOf('cascadeDeleteScopedAppState({'),
    'the checkpoint is taken before the cascade deletes anything');
  assert.match(remove, /removePageContext\.cascadeIds = cascadeDeleteScopedAppState/);
  const activate = src.slice(src.indexOf('const handleSetActiveSpace = useCallback'), src.indexOf('const handleExitSpaceMode = useCallback'));
  assert.match(activate, /assignedPages \|\| \[\]\)\.length === 0/);
  assert.ok(activate.indexOf('return;') < activate.indexOf('setActiveSpaceId(spaceId)'), 'an empty space is refused before activation');
  assert.match(src, /const activeSpaceHasNoPages = Boolean\(activeSpaceId\) && Array\.isArray\(activeSpacePages\) && activeSpacePages\.length === 0;/);
  assert.match(src, /\{activeSpaceHasNoPages && \(/);
  assert.match(src, /No pages in \{activeSpaceName\}/);
  assert.match(src, /openPanel\?\.\('spaces'\)/);
  // The counters stop claiming a page that is not shown.
  assert.match(read('src/AppShell.jsx'), /api\.activeSpaceHasNoPages \? 0 : api\.pageNum/);
  assert.match(read('src/mobile/MobilePdfViewerChrome.jsx'), /bottomToolbarApi\?\.activeSpaceHasNoPages \? 0 : \(bottomToolbarApi\?\.pageNum \|\| 1\)/);
});

test('SpacesPanel: no confirms (act first + Undo), blocked switch, region rename reaches the keyboard lift', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  assert.doesNotMatch(panel, /window\.confirm/);
  assert.doesNotMatch(panel, /useConfirmDialog\(\)|askConfirm\(/);
  const viewer = read('src/PDFViewer.jsx');
  const remove = viewer.slice(viewer.indexOf('const handleSpaceRemovePage = useCallback('), viewer.indexOf('const handleSpaceRenamePage = useCallback('));
  assert.match(remove, /message: removeToastMessage,\s*onUndo: \(\) => \{ handleUndoRef\.current\?\.\(\); \}/);
  const del = viewer.slice(viewer.indexOf('const handleSpaceDelete = useCallback('), viewer.indexOf('const handleSetActiveSpace = useCallback('));
  assert.match(del, /message: deleteToastMessage,\s*onUndo: \(\) => \{ handleUndoRef\.current\?\.\(\); \}/);
  assert.match(panel, /createPortal\(/, 'the export sheet renders above the phone sheet');
  assert.match(panel, /const isSwitchBlocked = !isActive && pageCount === 0;/);
  assert.match(panel, /aria-disabled=\{isSwitchBlocked \|\| undefined\}/);
  assert.match(panel, /'Add pages first'/);
  const renameInput = panel.slice(panel.indexOf('aria-label="Region name"'), panel.indexOf('className="spaces-region__name-input"'));
  assert.doesNotMatch(renameInput, /onFocus=\{\(e\) => e\.stopPropagation\(\)\}/, 'focusin must reach mobile/keyboardViewport.js');
  const click = panel.slice(panel.indexOf('const handleRegionEditClick'), panel.indexOf('const commitSpaceName'));
  assert.match(click, /flushSync\(/);
  assert.match(click, /editingRegionInputRef\.current\?\.focus\(\)/);
});

test('PDFSidebar (phone): the region tool hides the Spaces sheet and brings it back', () => {
  const src = read('src/PDFSidebar.jsx');
  const effect = src.slice(src.indexOf('const regionEditHidSheetRef'), src.indexOf('useImperativeHandle(ref'));
  assert.match(effect, /if \(isRegionSelectionActive\)/);
  assert.match(effect, /closePanel\(\)/);
  assert.match(effect, /openPanel\('spaces'\)/);
  // The counts are for the viewer's Undo toast now; the panel asks nothing.
  assert.doesNotMatch(src, /getSpaceRemovalImpact/);
});
