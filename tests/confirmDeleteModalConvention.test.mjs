import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../src/components/collab/ConfirmDeleteModal.jsx', import.meta.url),
  'utf8',
);
const styles = await readFile(
  new URL('../src/components/collab/ConfirmDeleteModal.css', import.meta.url),
  'utf8',
);

test('delete confirmation uses the shared app modal shell', () => {
  assert.match(source, /useFocusTrap\(cardRef, Boolean\(plan\), \{ onEscape: onCancel \}\)/);
  assert.match(source, /className="confirm-delete-modal__content"/);
  assert.match(source, /aria-label="Close"/);
  assert.match(source, /data-autofocus/);

  assert.match(styles, /z-index:\s*1300/);
  // 2026-10-04: the scrim names the one modal-scrim token (same value,
  // rgba(13, 15, 20, 0.55)) instead of re-typing it.
  assert.match(styles, /background:\s*var\(--overlay-scrim\)/);
  assert.match(styles, /backdrop-filter:\s*blur\(8px\)/);

  assert.match(styles, /width:\s*380px/);
  assert.match(styles, /max-width:\s*92vw/);
  // DELIBERATE ASSERTION CHANGE (2026-09-17, revision-2 palette approved by the
  // owner): the literal hex is the shared token now. Pinning the token is what
  // makes the two places this test compares unable to drift apart; a literal
  // here would pass while the rest of the app moved.
  assert.match(styles, /background:\s*var\(--surface-2\)/);
  assert.match(styles, /border-radius:\s*10px/);
  assert.match(styles, /box-shadow:\s*0 24px 60px rgba\(0,\s*0,\s*0,\s*0\.55\)/);
  assert.match(styles, /overflow:\s*hidden/);

  assert.match(styles, /confirm-delete-modal__content[\s\S]*padding:\s*18px 18px 14px/);
  assert.match(styles, /confirm-delete-modal__actions[\s\S]*padding:\s*12px 16px/);
  assert.match(styles, /confirm-delete-modal__actions[\s\S]*border-top:\s*1px solid var\(--border\)/);
  assert.match(styles, /confirm-delete-modal__actions[\s\S]*background:\s*var\(--surface-1\)/);
});

test('delete confirmation typography and actions match the shared compact treatment', () => {
  assert.match(styles, /confirm-delete-modal__heading[\s\S]*font-size:\s*16px/);
  assert.match(styles, /confirm-delete-modal__heading[\s\S]*font-weight:\s*700/);
  assert.match(styles, /confirm-delete-modal__heading[\s\S]*color:\s*var\(--text-1\)/);
  assert.match(styles, /confirm-delete-modal__body[\s\S]*font-size:\s*12px/);
  assert.match(styles, /confirm-delete-modal__body[\s\S]*color:\s*var\(--text-3\)/);
  assert.match(styles, /confirm-delete-modal__btn--cancel[\s\S]*border:\s*0/);
  assert.match(styles, /confirm-delete-modal__btn--danger[\s\S]*height:\s*28px/);
});
