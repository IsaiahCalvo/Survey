import test from 'node:test';
import assert from 'node:assert/strict';

import { phase35Diag } from '../src/lib/collab/phase35Diag.js';

test('phase35Diag no-ops without window and when hard-disabled', () => {
  const original = globalThis.window;
  delete globalThis.window;
  assert.doesNotThrow(() => phase35Diag('marquee.filter', { ok: true }));
  globalThis.window = { __phase35Diag: false, __currentPdfName: 'a.pdf' };
  assert.doesNotThrow(() => phase35Diag('click.gate', { ok: true }));
  globalThis.window = original;
});

test('phase35Diag logs with pdf name when enabled', () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args);
  globalThis.window = { __currentPdfName: 'Plan.pdf' };
  try {
    phase35Diag('bulk.confirm', { action: 'ok' });
    assert.equal(logs.length, 1);
    assert.match(String(logs[0][0]), /\[PHASE35\]\[bulk\.confirm\]\[pdf=Plan\.pdf\]/);
    assert.deepEqual(logs[0][1], { action: 'ok' });
  } finally {
    console.log = originalLog;
    delete globalThis.window;
  }
});
