import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
const reactUrl = pathToFileURL(require.resolve('react')).href;
const jsxUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
let moduleId = 0;

async function executableModule(file, rewrite) {
  const url = new URL(file, import.meta.url);
  const transformed = await transformWithOxc(rewrite(await readFile(url, 'utf8')), fileURLToPath(url), { lang: 'jsx' });
  const code = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxUrl));
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${++moduleId}`);
}

async function loadSidebar() {
  return executableModule('../src/PDFSidebar.jsx', (source) => source
    .replace("from 'react'", `from ${JSON.stringify(reactUrl)}`)
    .replace("import Icon from './Icons';", 'const Icon = () => null;')
    .replace("import PagesPanel from './sidebar/PagesPanel';", 'const PagesPanel = () => null;')
    .replace("const SearchTextPanel = lazy(() => import('./sidebar/SearchTextPanel'));", 'const SearchTextPanel = () => null;')
    .replace("import BookmarksPanel from './sidebar/BookmarksPanel';", 'const BookmarksPanel = () => null;')
    .replace("import SpacesPanel from './sidebar/SpacesPanel';", 'const SpacesPanel = () => null;')
    .replace("import SyncStatusChip from './components/SyncStatusChip';", 'const SyncStatusChip = () => <div data-testid="sync-status-stub" />;')
    .replace("import PresenceAvatars from './components/PresenceAvatars';", 'const PresenceAvatars = () => <div data-testid="presence-stub" />;')
    .replace("import RevisionsPanel from './components/revisions/RevisionsPanel';", 'const RevisionsPanel = (props) => { globalThis.__entryPanelProps = props; return <div data-testid="history-panel-stub" />; };')
    .replace("import { useMobileSheetMotion } from './mobile/useMobileSheetMotion';", 'const useMobileSheetMotion = (close) => ({ motionStyle: {}, dragHandlers: {}, requestClose: close });')
    .replace("import { useTooltip } from './components/Tooltip';", 'const useTooltip = () => () => ({});'));
}

async function loadMobileToolRail() {
  return executableModule('../src/mobile/MobilePdfViewerChrome.jsx', (source) => source
    .replace("from 'react'", `from ${JSON.stringify(reactUrl)}`)
    .replace("import { createPortal } from 'react-dom';", 'const createPortal = (children) => children;')
    .replace("import Icon from '../Icons';", 'const Icon = () => null;')
    .replace("import AnnotationSizeControl, { ANNOTATION_SIZE_PRESETS } from '../components/AnnotationSizeControl';", 'const AnnotationSizeControl = () => null; const ANNOTATION_SIZE_PRESETS = [];')
    .replace("import { COUNTER_SIZE_MAX, COUNTER_SIZE_MIN } from '../utils/annotationSize';", 'const COUNTER_SIZE_MAX = 100; const COUNTER_SIZE_MIN = 1;')
    .replace("import CompactColorPicker from '../components/CompactColorPicker';", 'const CompactColorPicker = () => null;')
    .replace("import DismissBarrier from '../components/DismissBarrier';", 'const DismissBarrier = () => null;')
    .replace("import { ARROWHEAD_STYLE_LABELS } from '../components/Callout/types';", 'const ARROWHEAD_STYLE_LABELS = {};')
    .replace("import { ZOOM_MODE_OPTIONS } from '../viewerShared';", 'const ZOOM_MODE_OPTIONS = [];')
    .replace("import { getMobileSyncPresentation, getMobileTextMarkupPresentation, normalizeMobilePresence } from './mobilePdfViewerModel.js';", "const getMobileSyncPresentation = () => ({ state: 'local', label: 'Local', compactMessage: 'Local', color: '#888' }); const getMobileTextMarkupPresentation = () => ({}); const normalizeMobilePresence = () => [];")
    .replace("import { getSelectFamilyIconName, getSelectFamilyLabel, getSelectModeIconName, getSelectModeMenuFocusIndex, isSelectModeActive, SELECT_MODE_OPTIONS } from '../utils/selectModes.js';", "const getSelectFamilyIconName = () => 'select'; const getSelectFamilyLabel = () => 'Select'; const getSelectModeIconName = () => 'select'; const getSelectModeMenuFocusIndex = () => 0; const isSelectModeActive = () => false; const SELECT_MODE_OPTIONS = [];")
    .replace("import { useMobileSheetMotion } from './useMobileSheetMotion';", 'const useMobileSheetMotion = (close) => ({ motionStyle: {}, dragHandlers: {}, requestClose: close });')
    .replace("import './mobilePdfViewer.css';", ''));
}

async function domHarness(t) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const prior = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  window.requestAnimationFrame = (callback) => { callback(); return 1; };
  window.cancelAnimationFrame = () => {};
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    delete globalThis.__entryPanelProps;
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { root };
}

test('desktop local History opens without cloud sync or presence chrome and closes on invalid scope', async (t) => {
  const { default: PDFSidebar } = await loadSidebar();
  const { root } = await domHarness(t);
  const localProps = { historyDocumentId: 'local:one', historyScope: { guestScopeId: 'device-local' },
    documentId: null, cloudSyncEnabled: false };
  await act(async () => root.render(React.createElement(PDFSidebar, localProps)));
  assert.equal(document.querySelector('[data-testid="sync-status-stub"]'), null);
  assert.equal(document.querySelector('[data-testid="presence-stub"]'), null);
  const history = document.querySelector('[aria-label="Version history"]');
  assert.ok(history);
  await act(async () => history.click());
  assert.equal(globalThis.__entryPanelProps.documentId, 'local:one');
  assert.deepEqual(globalThis.__entryPanelProps.historyScope, { guestScopeId: 'device-local' });
  assert.ok(document.querySelector('[data-testid="history-panel-stub"]'));

  await act(async () => root.render(React.createElement(PDFSidebar, {
    ...localProps, historyDocumentId: 'cloud-one', historyScope: null,
  })));
  assert.equal(document.querySelector('[aria-label="Version history"]'), null);
  assert.equal(document.querySelector('[data-testid="history-panel-stub"]'), null);

  await act(async () => root.render(React.createElement(PDFSidebar, {
    ...localProps, historyDocumentId: 'cloud-one', historyScope: { actorUserId: 'actor-a' },
  })));
  assert.ok(document.querySelector('[aria-label="Version history"]'));
});

test('mobile History uses the explicit scoped identity and opens the existing history sheet path', async (t) => {
  const { MobilePdfViewerToolRail } = await loadMobileToolRail();
  const { root } = await domHarness(t);
  const opened = [];
  const render = async (leftRailApi) => act(async () => root.render(React.createElement(MobilePdfViewerToolRail, {
    bottomToolbarApi: null, leftRailApi, onOpenPanel: (panel) => opened.push(panel),
  })));
  await render({ documentId: null, historyDocumentId: 'local:one',
    historyScope: { guestScopeId: 'device-local' }, cloudSyncEnabled: false });
  let history = document.querySelector('[aria-label="Version history"]');
  assert.equal(history.disabled, false);
  await act(async () => history.click());
  assert.deepEqual(opened, ['history']);

  await render({ documentId: 'cloud-one', historyDocumentId: 'cloud-one', historyScope: null });
  history = document.querySelector('[aria-label="Version history"]');
  assert.equal(history.disabled, true);
  await act(async () => history.click());
  assert.deepEqual(opened, ['history']);

  await render({ documentId: 'cloud-one', historyDocumentId: 'cloud-one',
    historyScope: { actorUserId: 'actor-a' } });
  assert.equal(document.querySelector('[aria-label="Version history"]').disabled, false);
});
