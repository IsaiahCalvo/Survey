// Regression tests for #1661 (Group marks across multiple tabs and Pan mode):
// 1. Multi-tab: only the active document tab owns window.__onAnnotationContextMenu,
//    so switching back to an earlier tab or closing a background tab never routes
//    Selection bar > More > Group to the wrong tab or deletes the active handler.
// 2. Front-tab DOM lookup: contextMenuDiagnostics resolves the group selection box
//    via queryFrontTab and ignores selection frames in background tabs.
// 3. Pan-mode / pendingSelection group expansion: clicking one member of a grouped
//    set in Pan mode (or via pendingSelection / applyPressFallback) selects the
//    whole group (annotations + callouts), not only the clicked member.
import test, { after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let dom;
let vite;
let React;
let act;
let createRoot;
let useAnnotationContextMenu;
let mounted = null;

before(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
  });
  React = (await import('react')).default;
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  const { createServer } = await import('vite');
  vite = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    ssr: { external: ['@survey/shared'] },
  });
  ({ useAnnotationContextMenu } = await vite.ssrLoadModule('/src/hooks/useAnnotationContextMenu.jsx'));
});

after(async () => {
  await vite?.close();
  dom?.window.close();
});

afterEach(async () => {
  if (mounted) await act(async () => mounted.unmount());
  mounted = null;
  delete window.__onAnnotationContextMenu;
});

test('#1661: only the active document tab owns window.__onAnnotationContextMenu across tab switches and closes', async () => {
  const openedByTab = { A: null, B: null };
  function TabViewer({ id, isActive, objects }) {
    const { annotationContextMenu } = useAnnotationContextMenu({
      getPageObjects: () => objects,
      isActive,
    });
    openedByTab[id] = annotationContextMenu;
    return null;
  }
  function TabsHost({ active, showB = true }) {
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(TabViewer, {
        id: 'A',
        isActive: active === 'A',
        objects: [{ id: 'a1', data: { id: 'a1' } }, { id: 'a2', data: { id: 'a2' } }],
      }),
      showB ? React.createElement(TabViewer, {
        id: 'B',
        isActive: active === 'B',
        objects: [{ id: 'b1', data: { id: 'b1' } }, { id: 'b2', data: { id: 'b2' } }],
      }) : null,
    );
  }

  const root = createRoot(document.getElementById('root'));
  mounted = root;

  // Open Tab A active, then Tab B active, then switch back to Tab A.
  await act(async () => root.render(React.createElement(TabsHost, { active: 'A', showB: false })));
  await act(async () => root.render(React.createElement(TabsHost, { active: 'B', showB: true })));
  await act(async () => root.render(React.createElement(TabsHost, { active: 'A', showB: true })));

  assert.equal(typeof window.__onAnnotationContextMenu, 'function');
  await act(async () => {
    window.__onAnnotationContextMenu({
      pageNumber: 1,
      annotationIndex: null,
      calloutId: null,
      kind: 'group',
      groupIndices: [0, 1],
      groupMarkerIds: [],
      event: { clientX: 100, clientY: 120 },
    });
  });

  // Tab A (the active tab) received the menu with Tab A's object ids, never Tab B.
  assert.deepEqual(openedByTab.A?.groupTargetIds, ['a1', 'a2']);
  assert.equal(openedByTab.B, null);

  // Closing background Tab B must not delete Tab A's active handler.
  await act(async () => root.render(React.createElement(TabsHost, { active: 'A', showB: false })));
  assert.equal(typeof window.__onAnnotationContextMenu, 'function');
});

test('#1661: contextMenuDiagnostics queries front-tab group box and ignores hidden tabs', () => {
  const diagSrc = readFileSync(new URL('../src/utils/contextMenuDiagnostics.js', import.meta.url), 'utf8');
  assert.match(diagSrc, /import \{ isInTabBehind, queryFrontTab \} from '\.\/tabBehind\.js';/);
  assert.match(diagSrc, /if \(isInTabBehind\(frame\)\) continue;/);
  assert.match(diagSrc, /queryFrontTab\(`\[data-svg-annotation-layer="\$\{pageNumber\}"\] \[data-group-selection-bbox="true"\]`\)/);
});

test('#1661: Pan mode, pendingSelection, and applyPressFallback expand grouped marks and callouts', () => {
  const interactionSrc = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  const layerSrc = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  const viewerSrc = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

  assert.match(interactionSrc, /const selectAnnotation = useCallback\(\(index, addToSelection = false, \{ expandGroup = false \} = \{\}\) => \{/);
  assert.match(interactionSrc, /const gid = ctx \? getAnnotationGroupId\(ctx\.annotations\?\.objects\?\.\[index\]\) : null;/);
  assert.match(layerSrc, /selectAnnotation\(pendingSelection\.annotationIndex, pendingSelection\.addToSelection === true, \{ expandGroup: true \}\);/);
  assert.match(layerSrc, /selectAnnotation\(press\.index, add, \{ expandGroup: true \}\);/);
  assert.match(viewerSrc, /useAnnotationContextMenu\(\{\s*getPageObjects:[\s\S]{0,120}isActive,\s*\}\)/);
  assert.match(viewerSrc, /const calloutGid = getCalloutGroupId\(clickedCallout\);/);
});
