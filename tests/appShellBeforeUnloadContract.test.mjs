import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { shouldWarnBeforeUnloadForTab } from '../src/utils/beforeUnloadGuard.js';

test('saved local PDF with annotations does not warn on reload', () => {
  assert.equal(shouldWarnBeforeUnloadForTab({
    isHome: false,
    file: { name: 'local.pdf' },
    hasAnyAnnotations: true,
    hasUnsavedAnnotations: false,
  }), false);
});

test('unsaved local PDF edit warns on reload', () => {
  assert.equal(shouldWarnBeforeUnloadForTab({
    isHome: false,
    file: { name: 'local.pdf' },
    hasAnyAnnotations: true,
    hasUnsavedAnnotations: true,
  }), true);
});

test('home, missing, and cloud-backed tabs do not warn', () => {
  assert.equal(shouldWarnBeforeUnloadForTab(null), false);
  assert.equal(shouldWarnBeforeUnloadForTab({ isHome: true }), false);
  assert.equal(shouldWarnBeforeUnloadForTab({ file: null, hasUnsavedAnnotations: true }), false);
  assert.equal(shouldWarnBeforeUnloadForTab({
    file: { id: 'cloud-doc' },
    hasUnsavedAnnotations: true,
  }), false);
});

test('closing the window warns for an unsaved inactive local tab', () => {
  const source = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  const marker = source.indexOf('// Warn only for unsaved local edits.');
  const start = source.indexOf('useEffect(() => {', marker);
  const end = source.indexOf('\n  }, [', start);
  assert.ok(marker >= 0 && start > marker && end > start);
  const effect = source.slice(start + 'useEffect('.length, end + '\n  }'.length);
  const dom = new JSDOM('', { url: 'https://survey.test' });
  const tabs = [
    { id: 'home', isHome: true },
    { id: 'local', file: { name: 'local.pdf' }, hasUnsavedAnnotations: true },
  ];
  const nativeExitConfirmedRef = { current: false };
  const install = new Function('window', 'tabs', 'activeTabId', 'shouldWarnBeforeUnloadForTab', 'nativeExitConfirmedRef',
    `return (${effect});`)(dom.window, tabs, 'home', shouldWarnBeforeUnloadForTab, nativeExitConfirmedRef);
  const cleanup = install();
  try {
    const event = new dom.window.Event('beforeunload', { cancelable: true });
    dom.window.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    nativeExitConfirmedRef.current = true;
    const confirmedEvent = new dom.window.Event('beforeunload', { cancelable: true });
    dom.window.dispatchEvent(confirmedEvent);
    assert.equal(confirmedEvent.defaultPrevented, false, 'a confirmed native exit does not raise a second prompt');
    nativeExitConfirmedRef.current = false;
    const canceledEvent = new dom.window.Event('beforeunload', { cancelable: true });
    dom.window.dispatchEvent(canceledEvent);
    assert.equal(canceledEvent.defaultPrevented, true, 'canceling native exit restores the unsaved warning');
    tabs[1].hasUnsavedAnnotations = false;
    const savedEvent = new dom.window.Event('beforeunload', { cancelable: true });
    dom.window.dispatchEvent(savedEvent);
    assert.equal(savedEvent.defaultPrevented, false, 'saving the inactive tab removes its warning');
    cleanup();
    tabs[1].hasUnsavedAnnotations = true;
    const removedEvent = new dom.window.Event('beforeunload', { cancelable: true });
    dom.window.dispatchEvent(removedEvent);
    assert.equal(removedEvent.defaultPrevented, false, 'unmount removes the window listener');
  } finally {
    cleanup();
    dom.window.close();
  }
});
