// KAL-652 polish, batch 5 (2026-11-17): faults found by looking at each screen, light and dark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Library panel: the Personal / Project / Stamps switch spans the panel, like the search field under it', () => {
  const css = read('src/markLibrary/MarkLibraryPanel.css');
  const rule = (sel) => new RegExp(`${sel.replace(/[.-]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] || '';
  assert.doesNotMatch(rule('.mark-library__tabs'), /max-width/);
  assert.doesNotMatch(rule('.mark-library__tabs--3'), /max-width/);
});

test('Guest link fields (password, link, guest name) carry the edge colour, not the faint divider', () => {
  const css = read('src/guest/guestLinks.css');
  for (const sel of ['.guest-links__password', '.guest-links__url', '.guest-join__field input[type="text"]']) {
    const body = new RegExp(`${sel.replace(/[.\-[\]"=]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] || '';
    assert.match(body, /border: 1px solid var\(--border-strong\);/, sel);
  }
});
