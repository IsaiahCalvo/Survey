import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { PAGE_PRESENTATION_META_KEY, normalizePagePresentations } from '../src/utils/pagePresentation.js';

// Exercise the viewer's actual access rule and mirror wiring without mounting
// its PDF/network lifecycle. A cached mirror must not create a cloud write
// when an editor's rights have become read-only; reading still works.
const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const access = source.slice(source.indexOf('  const canRestoreFromHistory = useMemo'), source.indexOf('  const requireSpaceManagement = useCallback'));
const metadata = source.slice(source.indexOf('  pagePresentationMetaSetRef.current ='), source.indexOf('\n  const deletedPdfAnnotations = useMemo')).split('\n  useLayoutEffect')[0];
const actions = source.slice(source.indexOf('  const handleMirrorPage = useCallback'), source.indexOf('  pageOperationHistoryRef.current ='));
function simulate(overrides = {}) {
  const calls = { writes: [], reads: 0, subscriptions: 0, mirrors: 0, resets: 0, renders: [] };
  const scope = {
    pdfFile: { id: 'doc' }, user: { id: 'editor' }, documentOwnerId: 'owner', yjsDocRole: 'editor', documentLocked: false, yjsAccessRevoked: false,
    normalAnnotationHydration: { ready: true, documentId: 'doc' },
    pagePresentationMetaSetRef: {}, pagePresentationMetaGetRef: {}, pagePresentationStateRef: { current: { 1: { mirrorH: true } } },
    PAGE_PRESENTATION_META_KEY, normalizePagePresentations,
    useMemo: callback => callback(), useRef: current => ({ current }), useCallback: callback => callback,
    useEffect: callback => callback(), showToast: () => {},
    excelSyncMetaGet: () => { calls.reads++; return overrides.saved ?? null; },
    excelSyncMetaSet: (...args) => calls.writes.push(args),
    subscribeDocumentMeta: (_key, listener) => { calls.subscriptions++; scope.listener = listener; return () => {}; },
    setPageTransformations: value => calls.renders.push(value),
    applyMirrorPage: () => { calls.mirrors++; return true; }, applyResetPage: () => { calls.resets++; return true; },
    ...overrides,
  };
  runInNewContext(`${access}\n${metadata}\n${actions}\nthis.mirror = handleMirrorPage; this.reset = handleResetPage; this.accessRef = canRestoreFromHistoryRef;`, scope);
  return { calls, scope };
}
for (const [label, state] of [
  ['viewer', { yjsDocRole: 'viewer' }],
  ['locked editor', { documentLocked: true }],
  ['revoked editor', { yjsAccessRevoked: true }],
]) test(`${label} reads mirrored pages without backfill or Mirror/Reset writes`, () => {
  const { calls, scope } = simulate(state);
  assert.equal(calls.reads, 1); assert.equal(calls.subscriptions, 1); assert.equal(calls.writes.length, 0);
  assert.equal(scope.pagePresentationMetaSetRef.current, null);
  scope.listener({ 1: { mirrorV: true } }); assert.equal(calls.renders[0][1].mirrorV, true);
  assert.equal(scope.mirror(1, 'horizontal'), false); assert.equal(scope.reset(1), false);
  assert.equal(calls.mirrors, 0); assert.equal(calls.resets, 0);
});
test('editable hydrated document backfills its cached presentation and permits Mirror/Reset', () => {
  const { calls, scope } = simulate();
  assert.equal(calls.writes.length, 1); assert.equal(calls.writes[0][0], PAGE_PRESENTATION_META_KEY);
  assert.equal(calls.writes[0][1][1].mirrorH, true);
  assert.equal(scope.mirror(1, 'horizontal'), true); assert.equal(scope.reset(1), true);
  assert.equal(calls.mirrors, 1); assert.equal(calls.resets, 1);
  // A handler retained by a toolbar still sees changed rights immediately.
  scope.accessRef.current = false; assert.equal(scope.mirror(1, 'vertical'), false); assert.equal(calls.mirrors, 1);
});
test('a previous document hydration never writes the new document presentation', () => {
  const { calls, scope } = simulate({ normalAnnotationHydration: { ready: true, documentId: 'previous' } });
  assert.equal(scope.pagePresentationMetaSetRef.current, null); assert.equal(scope.pagePresentationMetaGetRef.current, null); assert.equal(calls.writes.length, 0); assert.equal(calls.subscriptions, 0);
});

test('template binding writes use the same current document authority as mirror writes', () => {
  assert.match(source, /templateBindingAccessRef\.current = \{[\s\S]*?set: \(\.\.\.args\) => canRestoreFromHistory && excelSyncMetaSet\(\.\.\.args\)/);
});
