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
  // The prompt sits on DialogCard (design review 2026-10-27): its x is the
  // shell's hub-icon-btn "Close", which hub.css pads to 44px on touch.
  assert.match(prompt, /className="hub-btn dialog-touch-pad" onClick=\{onCancel\}>Cancel/);
  assert.match(prompt, /className="hub-btn hub-btn--primary dialog-touch-pad" onClick=\{submit\}/);
  assert.match(read('src/components/DialogCard.jsx'), /aria-label="Close" \{\.\.\.tip\('Close'\)\} className="hub-icon-btn"/);

  const bulk = read('src/home/BulkModals.jsx');
  const confirm = bulk.slice(bulk.indexOf('export function ConfirmModal'), bulk.indexOf('export function RenameModal'));
  assert.equal((confirm.match(/dialog-touch-pad/g) || []).length, 3); // Cancel + both primary variants

  const css = read('src/home/hub.css');
  const coarse = css.slice(css.indexOf('@media (pointer: coarse) {\n  .hub-icon-btn:is('));
  assert.match(coarse, /\.dialog-close-touch-pad::after \{\s*inset: -11px;/);
  assert.match(coarse, /\.dialog-touch-pad::after \{\s*content: '';\s*position: absolute;\s*inset: -9px 0;/);
});

test('Settings Delete account button is 44px tall on any touch screen', () => {
  const css = read('src/components/AccountSettings.css');
  assert.match(css, /@media \(pointer: coarse\) \{\s*\.account-btn-danger \{ min-height: 44px; \}/);
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
