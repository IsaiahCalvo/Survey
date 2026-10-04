import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OPENER_OR_FIELD_SELECTOR } from '../src/components/dismissRules.js';

// Found by the click-every-control walkthrough (polish round 6): with the
// cursor in a Home search box, the first click on a row's "More" (⋮) did
// nothing — the typing barrier (dismiss rule R3) ate it, because the button
// did not say it opens a menu. R3 lets popover openers work at once, and it
// knows them by aria-haspopup. Every Home "More" button now carries it.
const FILES = [
  'src/home/DocumentsLedger.jsx',
  'src/home/ProjectsFolderTree.jsx',
  'src/home/TemplatesEditor.jsx',
  'src/home/ManageTeamModal.jsx',
];

test('R3 treats aria-haspopup controls as openers that work while typing', () => {
  assert.match(OPENER_OR_FIELD_SELECTOR, /\[aria-haspopup\]/);
});

for (const file of FILES) {
  test(`${file}: every "More" (⋮) button declares aria-haspopup="menu"`, () => {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const icons = [...src.matchAll(/<Icon name="more" size=\{14\} \/><\/button>/g)];
    assert.ok(icons.length > 0);
    for (const m of icons) {
      const button = src.slice(src.lastIndexOf('<button', m.index), m.index);
      assert.match(button, /aria-haspopup="menu"/, `${file} @${m.index}`);
    }
  });
}
