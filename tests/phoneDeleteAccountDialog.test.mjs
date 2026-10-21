// Delete account on a phone (iPhone SE 320px / iPhone 13, measured 2026-10-21):
// the prompt and confirm dialogs' Cancel / Continue / Delete account painted
// 27px tall and their × 24px; Settings' Delete account button 34px. A finger
// needs 44. A blocked request showed supabase-js's raw "Failed to send a
// request to the Edge Function".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestAccountDeletion } from '../src/utils/accountPlatform.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('shared prompt and confirm dialog buttons get 44px touch pads', () => {
  const prompt = read('src/components/dialogPrompts.jsx');
  assert.match(prompt, /className="dialog-touch-pad" style=\{cancelButtonStyle\}>Cancel/);
  assert.match(prompt, /className="dialog-touch-pad"\s+onClick=\{submit\}/);
  assert.match(prompt, /aria-label="Close" className="dialog-close-touch-pad"/);

  const bulk = read('src/home/BulkModals.jsx');
  const confirm = bulk.slice(bulk.indexOf('export function ConfirmModal'), bulk.indexOf('export function RenameModal'));
  assert.equal((confirm.match(/dialog-touch-pad/g) || []).length, 3); // Cancel + both primary variants

  const css = read('src/home/hub.css');
  const coarse = css.slice(css.indexOf('@media (pointer: coarse) {\n  .hub-icon-btn:is('));
  assert.match(coarse, /\.dialog-close-touch-pad::after \{\s*content: '';\s*position: absolute;\s*inset: -10px;/);
  assert.match(coarse, /\.dialog-touch-pad::after \{\s*content: '';\s*position: absolute;\s*inset: -9px 0;/);
});

test('Settings Delete account button is 44px tall on a phone', () => {
  const css = read('src/components/AccountSettings.css');
  const mobile = css.slice(css.indexOf('@media (max-width: 768px)'));
  assert.match(mobile.slice(0, mobile.indexOf('\n}\n')), /\.account-btn-danger \{\s*min-height: 44px;/);
});

test('a delete request that never reaches the server fails in plain words', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    await assert.rejects(
      requestAccountDeletion({ invoke: async () => ({ data: null, error: new Error('Failed to send a request to the Edge Function') }) }),
      (err) => err.message === "We couldn't reach the server, so nothing was deleted. Check your connection and try again.",
    );
  } finally { console.warn = warn; }
});
