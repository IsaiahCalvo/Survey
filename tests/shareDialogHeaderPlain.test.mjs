// KAL-652 batch 33: the Share and Document access dialogs lose the old gold
// stripe beside their title, like Export PDF, PDF tools and every other dialog.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

for (const file of ['src/home/ShareModal.jsx', 'src/home/AccessManagementModal.jsx']) {
  test(`${file} has no accent stripe before its title`, () => {
    const jsx = read(file);
    assert.doesNotMatch(jsx, /width: 3, height: 30, background: C\.(gold|accent)/);
    assert.match(jsx, /letterSpacing: '-0\.015em', marginTop: 4/);
  });
}

test('Guest links lines up with the people list above it', () => {
  const css = read('src/guest/guestLinks.css').match(/\.guest-links \{([^}]*)\}/)[1];
  assert.match(css, /padding: 12px 4px;/);
});
