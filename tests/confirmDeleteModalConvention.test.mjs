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
  assert.match(styles, /background:\s*rgba\(13,\s*15,\s*20,\s*0\.55\)/);
  assert.match(styles, /backdrop-filter:\s*blur\(8px\)/);

  assert.match(styles, /width:\s*380px/);
  assert.match(styles, /max-width:\s*92vw/);
  assert.match(styles, /background:\s*#181c24/);
  assert.match(styles, /border-radius:\s*10px/);
  assert.match(styles, /box-shadow:\s*0 24px 60px rgba\(0,\s*0,\s*0,\s*0\.55\)/);
  assert.match(styles, /overflow:\s*hidden/);

  assert.match(styles, /confirm-delete-modal__content[\s\S]*padding:\s*18px 18px 14px/);
  assert.match(styles, /confirm-delete-modal__actions[\s\S]*padding:\s*12px 16px/);
  assert.match(styles, /confirm-delete-modal__actions[\s\S]*border-top:\s*1px solid #2a3140/);
  assert.match(styles, /confirm-delete-modal__actions[\s\S]*background:\s*#12151c/);
});

test('delete confirmation typography and actions match the shared compact treatment', () => {
  assert.match(styles, /confirm-delete-modal__heading[\s\S]*font-size:\s*16px/);
  assert.match(styles, /confirm-delete-modal__heading[\s\S]*font-weight:\s*700/);
  assert.match(styles, /confirm-delete-modal__heading[\s\S]*color:\s*#f4f1ea/);
  assert.match(styles, /confirm-delete-modal__body[\s\S]*font-size:\s*12px/);
  assert.match(styles, /confirm-delete-modal__body[\s\S]*color:\s*#8d96a6/);
  assert.match(styles, /confirm-delete-modal__btn--cancel[\s\S]*border:\s*0/);
  assert.match(styles, /confirm-delete-modal__btn--danger[\s\S]*height:\s*28px/);
});
