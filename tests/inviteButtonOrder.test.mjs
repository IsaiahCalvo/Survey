// Invite page (Nov 17 walk): Skip sat on its own row under Save, and the main
// button came before the plain one. Plain button first, main button last, in
// one row, as in every other dialog.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../src/home/InviteAcceptPage.jsx', import.meta.url), 'utf8');
const card = readFileSync(new URL('../src/home/FinishAccountCard.jsx', import.meta.url), 'utf8');

test('Skip for now sits beside Save and continue, before it', () => {
  assert.ok(card.indexOf('{skip}') > -1 && card.indexOf('{skip}') < card.indexOf('type="submit"'));
  assert.match(page, /skip=\{<button type="button" onClick=\{openTarget\} style=\{btnGhost\(\)\}>Skip for now<\/button>\}/);
});

test('the plain button comes before the main one', () => {
  assert.ok(page.indexOf('>Sign in to continue<') < page.indexOf('>Create free account<'));
  assert.ok(page.indexOf('>Back to Survey<') < page.indexOf('{openLabel}'));
});
