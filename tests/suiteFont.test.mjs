// The suite's one font (docs/suite/SUITE-RULES.md, "One font"; KAL-663):
// Geist for every word in the chrome, Geist Mono for numbers, bundled so it
// works offline. In Survey it rides the Nightly suite look (data-look="suite").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const tokens = read('src/styles/tokens.css');
const styles = read('src/styles.css');

test('Geist is bundled with its licence, not fetched from a font service', () => {
  for (const f of ['Geist-Variable.woff2', 'GeistMono-Variable.woff2', 'Geist-OFL.txt']) {
    const u = new URL(`../src/styles/fonts/${f}`, import.meta.url);
    assert.ok(existsSync(u) && statSync(u).size > 1000, `${f} is in the repo`);
  }
  assert.match(tokens, /@font-face\s*\{\s*font-family: "Geist";\s*src: url\("\.\/fonts\/Geist-Variable\.woff2"\)/);
  assert.match(tokens, /@font-face\s*\{\s*font-family: "Geist Mono";\s*src: url\("\.\/fonts\/GeistMono-Variable\.woff2"\)/);
  assert.doesNotMatch(tokens, /fonts\.googleapis|fonts\.gstatic/);
});

test('the suite look sets Geist as the chrome font; the old look keeps the system font', () => {
  const suite = tokens.slice(tokens.indexOf('html[data-look="suite"] {'));
  assert.match(suite.slice(0, 400), /--font-ui: "Geist", -apple-system/);
  assert.match(suite.slice(0, 400), /--font-mono: "Geist Mono"/);
  assert.match(tokens, /^\s*--font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;/m);
  assert.match(styles, /html\[data-look="suite"\] body,\s*html\[data-look="suite"\] \.btn \{\s*font-family: var\(--font-ui\);/);
});
