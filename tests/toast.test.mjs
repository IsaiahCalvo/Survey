import test from 'node:test';
import assert from 'node:assert/strict';

import showToast, { showToast as namedShowToast } from '../src/utils/toast.js';

test('showToast no-ops without window or message', () => {
  const original = globalThis.window;
  delete globalThis.window;
  assert.equal(showToast('hi'), undefined);
  globalThis.window = original;
  assert.equal(namedShowToast(null), undefined);
  assert.equal(namedShowToast(''), undefined);
});

test('showToast dispatches an app-toast CustomEvent', () => {
  const events = [];
  const original = globalThis.window;
  globalThis.window = {
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };
  class FakeCustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  }
  const originalCustomEvent = globalThis.CustomEvent;
  globalThis.CustomEvent = FakeCustomEvent;
  try {
    showToast('Saved', 'success');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'app-toast');
    assert.equal(events[0].detail.message, 'Saved');
    assert.equal(events[0].detail.type, 'success');
    assert.ok(typeof events[0].detail.id === 'string');
  } finally {
    globalThis.window = original;
    globalThis.CustomEvent = originalCustomEvent;
  }
});

test('showToast falls back to console.warn when dispatch throws', () => {
  const warnings = [];
  const originalWindow = globalThis.window;
  const originalWarn = console.warn;
  globalThis.window = {
    dispatchEvent() {
      throw new Error('no events');
    },
  };
  console.warn = (...args) => warnings.push(args);
  try {
    showToast('fallback');
    assert.deepEqual(warnings[0], ['[toast]', 'fallback']);
  } finally {
    globalThis.window = originalWindow;
    console.warn = originalWarn;
  }
});
