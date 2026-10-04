import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { schedulePdfViewerPrefetch } from '../src/utils/pdfViewerPrefetch.js';

const appShellSource = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');

test('AppShell shares one viewer loader between React lazy and idle prefetch', () => {
  // The viewer loader also brings the two document rails (PDFSidebar,
  // SurveySpacesRail), which only appear once the viewer is up, so the home
  // screen no longer downloads them.
  assert.match(appShellSource, /const loadPDFViewerModule = \(\) => Promise\.all\(\[\s*import\('\.\/PDFViewer'\),\s*PDFSidebarChunk\.load\(\),\s*SurveySpacesRailChunk\.load\(\),\s*\]\)/);
  assert.match(appShellSource, /lazy\(\(\) => loadPDFViewerModule\(\)/);
  assert.match(appShellSource, /schedulePdfViewerPrefetch\(loadPDFViewerModule\)/);
});

test('PDF viewer prefetch waits for page load, a short delay, and browser idle time', () => {
  const listeners = new Map();
  const timers = new Map();
  const idleCallbacks = new Map();
  let timerId = 0;
  let idleId = 0;
  let loads = 0;
  const fakeWindow = {
    document: { readyState: 'loading' },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) {
      if (listeners.get(type) === callback) listeners.delete(type);
    },
    setTimeout(callback, delay) {
      timerId += 1;
      timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(id) { timers.delete(id); },
    requestIdleCallback(callback, options) {
      idleId += 1;
      idleCallbacks.set(idleId, { callback, options });
      return idleId;
    },
    cancelIdleCallback(id) { idleCallbacks.delete(id); },
  };

  const cancel = schedulePdfViewerPrefetch(() => { loads += 1; }, { windowObject: fakeWindow });
  assert.equal(loads, 0);
  assert.equal(listeners.has('load'), true);

  listeners.get('load')();
  const scheduledTimer = [...timers.values()][0];
  assert.equal(scheduledTimer.delay, 1200);
  scheduledTimer.callback();
  const scheduledIdle = [...idleCallbacks.values()][0];
  assert.equal(scheduledIdle.options.timeout, 2500);
  scheduledIdle.callback();
  assert.equal(loads, 1);

  cancel();
  assert.equal(listeners.has('load'), false);
});

test('PDF viewer prefetch cleanup prevents a delayed import', () => {
  const timers = new Map();
  let timerId = 0;
  let loads = 0;
  const fakeWindow = {
    document: { readyState: 'complete' },
    addEventListener() {},
    removeEventListener() {},
    setTimeout(callback) {
      timerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
    clearTimeout(id) { timers.delete(id); },
  };

  const cancel = schedulePdfViewerPrefetch(() => { loads += 1; }, { windowObject: fakeWindow });
  cancel();
  assert.equal(timers.size, 0);
  assert.equal(loads, 0);
});
