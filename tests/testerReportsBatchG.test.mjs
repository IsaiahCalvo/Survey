import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('#1644, #1643: saved Thin PDF lines and Dark pages apply when the app opens', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /if \(thinLinesEnabled\) \{\s*applyThinLines\(loadThinLines\(\)\);\s*ensureThinLinesFilters\(\);/);
  assert.match(shell, /if \(isFeatureOn\('dark-pages'\)\) applyDarkPages\(loadDarkPages\(\)\);/);
  assert.match(shell, /import '\.\/styles\/thinLines\.css';/);
  assert.match(shell, /import '\.\/styles\/darkPages\.css';/);
});

test('#1643: Dark pages and Thin PDF lines share one filter, thicken then invert', () => {
  const css = read('src/styles/darkPages.css');
  for (const level of ['thin', 'medium', 'thick']) {
    const rule = new RegExp(`html\\[data-dark-pages="on"\\]\\[data-thin-lines="${level}"\\][^{]*\\{\\s*filter: url\\(#survey-thin-lines-${level}\\) invert\\(0\\.9\\) hue-rotate\\(180deg\\);`);
    assert.match(css, rule);
  }
  assert.match(css, /@media print \{[^}]*\[data-thin-lines\][^{]*\{ filter: none; \}/s);
});
