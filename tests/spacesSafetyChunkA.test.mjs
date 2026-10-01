// Spaces audit chunk A (2026-10-01): safety and correctness.
//   1. A space with no pages can't be turned on, and an active space that
//      lost its pages shows a "No pages in <space>" card (not a black viewer).
//   2. Removing a page from a space / deleting a space asks first, with the
//      real counts of what the cascade deletes, and is one Undo step.
//   3. Phone: Edit areas moves the Spaces sheet out of the way.
//   4. Phone: region rename reaches the shared keyboard lift.
//   5. The space row counts pages, not drawn areas.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildDeleteSpaceConfirm,
  buildRemovePageConfirm,
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

test('confirm text states the real consequence; a bare page needs no confirm', () => {
  const prompt = buildRemovePageConfirm({ spaceName: 'Space 2', pageId: 3, impact: { marks: 4, surveyMarkers: 0, areas: 1 } });
  assert.equal(prompt.title, 'Remove p.3 from Space 2?');
  assert.match(prompt.message, /^This also deletes 4 marks placed in Space 2 on p\.3\. Its 1 drawn area goes too\./);
  assert.equal(prompt.danger, true);
  assert.equal(prompt.confirmLabel, 'Remove');
  const both = buildRemovePageConfirm({ spaceName: 'S', pageId: 1, impact: { marks: 1, surveyMarkers: 2, areas: 0 } });
  assert.match(both.message, /deletes 1 mark and 2 Survey Markers placed in S on p\.1\./);
  assert.equal(buildRemovePageConfirm({ spaceName: 'S', pageId: 1, impact: { marks: 0, surveyMarkers: 0, areas: 0 } }), null);
  const del = buildDeleteSpaceConfirm({ spaceName: 'Space 2', pageCount: 2, impact: { marks: 3, surveyMarkers: 1 } });
  assert.equal(del.title, 'Delete Space 2?');
  assert.equal(del.message, 'This also deletes 3 marks and 1 Survey Marker placed in Space 2. Its 2 pages stay in the document.');
  assert.doesNotMatch(del.message, /will not delete/i, 'the old misleading text is gone');
  assert.equal(buildDeleteSpaceConfirm({ spaceName: 'E', pageCount: 0, impact: null }).message, 'No marks are deleted.');
});

test('row count label counts pages, areas apart', () => {
  assert.equal(formatSpaceCountLabel(3, 2), '3 pages · 2 areas');
  assert.equal(formatSpaceCountLabel(1, 0), '1 page');
  assert.equal(formatSpaceCountLabel(0, 0), '0 pages');
  const panel = read('src/sidebar/SpacesPanel.jsx');
  // DELIBERATE CHANGE (Spaces chunk B, 2026-10-01): the row shows the whole
  // "3 pages · 2 areas" label as its meta line instead of a bare page number.
  assert.match(panel, /data-space-meta>\s*\{regionCountLabel\}\s*<\/span>/, 'the visible meta is the page / area label');
  assert.match(panel, /formatSpaceCountLabel\(pageCount, regionCount\)/);
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
  const remove = src.slice(src.indexOf('const handleSpaceRemovePage = useCallback'), src.indexOf('const getSpaceRemovalImpact = useCallback'));
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

test('SpacesPanel: themed confirms, blocked switch, region rename reaches the keyboard lift', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  assert.doesNotMatch(panel, /window\.confirm/);
  assert.match(panel, /useConfirmDialog\(\)/);
  assert.match(panel, /buildRemovePageConfirm\(/);
  assert.match(panel, /buildDeleteSpaceConfirm\(/);
  assert.match(panel, /createPortal\(/, 'the confirm renders above the phone sheet');
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
  assert.match(src, /getSpaceRemovalImpact=\{getSpaceRemovalImpact\}/);
});
