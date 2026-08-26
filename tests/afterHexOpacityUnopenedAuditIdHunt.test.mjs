// Genuine hunt of remaining unopened 2026-08-20 audit IDs after P1-39
// hex leftover sibling (6c1ab2cd). No unique LIVE leftover proved.
// Do not invent leftover-18, Line /AP, callout Rotation, user-settable
// callout verticalAlign, a richTextEditor, eraser-cut Width restroke,
// imported-outline Width restroke, or a name/type/row leftover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('P1-17 / P1-18 page-op merge + clipboard remap stay aligned', () => {
  const reindex = read('src/utils/pageAnnotationReindex.js');
  assert.match(reindex, /export function remapClipboardPage/);
  assert.match(reindex, /export function mergeLivePagePresentation/);
  const ops = read('src/hooks/usePageOperations.js');
  assert.match(ops, /mergeLivePagePresentation\(state, live, op/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /setClipboardPage\(\(prev\) => remapClipboardPage\(prev, operation\)\)/);
});

test('P1-19 still raises DocumentVersionConflictError', () => {
  const check = read('src/utils/documentVersionCheck.js');
  assert.match(check, /export class DocumentVersionConflictError/);
});

test('P1-22 erase approval still plans page-object and text-markup deletes', () => {
  const candidates = read('src/utils/eraseApprovalCandidates.js');
  assert.match(candidates, /'page-object'/);
  assert.match(candidates, /'text-markup'/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /target\.domain === 'page-object'/);
  assert.match(viewer, /target\.domain === 'text-markup'/);
});

test('P1-23 imported markups still receive an author stamp', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /export function stampImportedAnnotationAuthor/);
  assert.match(importer, /stampImportedAnnotationAuthor\(/);
});

test('P1-24 survey-marker move still fail-closes through canModifySurveyMarker', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /!canModifySurveyMarker\(\{ surveyMarker: existingSurveyMarker, viewerId, documentOwnerId \}\)/);
  const scope = read('src/lib/collab/permissionScope.js');
  assert.match(scope, /export function canModifySurveyMarker/);
});

test('P1-30 / P2-16 remote-delete Restore still unions live selection ids', () => {
  const remote = read('src/components/collab/remoteDeleteInteraction.js');
  assert.match(remote, /windowLike\.__selectedAnnotationIds/);
  const svg = read('src/hooks/useSVGInteraction.js');
  assert.match(svg, /window\.__selectedAnnotationIds = ids/);
});

test('P1-36 own-annotation undo gate still lives on isOwnAnnotation', () => {
  const history = read('src/utils/annotationLocalHistory.js');
  assert.match(history, /function isOwnAnnotation\(annotation, userId, documentOwnerId = null\)/);
});

test('P1-38 Match Fill selected ring still compares opacity, not leftover >= 99', () => {
  const picker = read('src/components/CompactColorPicker.jsx');
  assert.match(picker, /Math\.abs\(localOpacity - matchOpacityPct\) <= 1/);
  assert.doesNotMatch(picker, /localOpacity >= 99/);
});

test('P1-45 / P1-47 bookmark delete count + batched reorder stay aligned', () => {
  const edit = read('src/sidebar/bookmarkEditUtils.js');
  assert.match(edit, /countBookmarkDescendants/);
  assert.match(edit, /describeBookmarkDeleteConfirm/);
  assert.match(edit, /planBookmarkDelete/);
  const reorder = read('src/sidebar/bookmarkReorderUtils.js');
  assert.match(reorder, /collectBookmarkTreePersistUpdates/);
});

test('P1-46 guest sidebar write stays localStorage-only (accepted leftover, not taken)', () => {
  const persist = read('src/utils/sidebarPersistence.js');
  assert.match(persist, /mergeSidebarWrite/);
});

test('P1-50 / P1-52 spaces keyed map + orphan unscope stay aligned', () => {
  const store = read('src/services/annotationDocStore.js');
  assert.match(store, /export const SPACES_MAP = 'spacesById'/);
  const orphans = read('src/utils/spaceRegionOrphans.js');
  assert.match(orphans, /export function unscopeOrphanedRegionAnnotations/);
});

test('P1-53 / P1-54 / P1-55 sync pill, black-thumb, dual-write stay aligned', () => {
  const sync = read('src/utils/syncStatusViewModel.js');
  assert.match(sync, /if \(stage === 'pending'\)/);
  const pages = read('src/sidebar/pagesPanelUtils.js');
  assert.match(pages, /export function isLikelyBlackThumbnailPixels/);
  const cloud = read('src/services/annotationCloudSync.js');
  assert.match(cloud, /DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE = false/);
});

test('remaining P2 symbols that can be source-probed stay aligned', () => {
  const account = read('src/utils/accountPlatform.js');
  assert.match(account, /ACCOUNT_DELETION_CONFIRMATION = 'DELETE'/);
  assert.match(account, /export const describeProfileSaveOutcome/);
  assert.match(account, /export const canUnlinkProvider/);
  const billing = read('src/utils/billingReturn.js');
  assert.match(billing, /export function consumeBillingQueryOnBoot/);
  const presence = read('src/hooks/presenceRoster.js');
  assert.match(presence, /PRESENCE_STALE_MS = 10 \* 60 \* 1000/);
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /\{ keys: \['Home'\], description: 'First page' \}/);
  assert.match(overlay, /\{ keys: \['B'\], description: 'Toggle sidebar' \}/);
  assert.doesNotMatch(overlay, /Ctrl\+W|Ctrl\+Tab/);
  const sheet = read('src/mobile/useMobileSheetMotion.js');
  assert.match(sheet, /onTouchCancel/);
  const electronMain = read('src/electron-main.js');
  assert.match(electronMain, /createQuitCoordinator/);
  assert.match(electronMain, /app\.requestSingleInstanceLock\(\)/);
  assert.doesNotMatch(electronMain, /setTimeout\(checkAndQuit, 5000\)/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
