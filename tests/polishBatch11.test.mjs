import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the open project header keeps room for the name; its buttons wrap to their own row', () => {
  const css = read('src/home/hub.css');
  assert.match(css, /\.projects-open-head \{ flex-wrap: wrap; row-gap: 10px; \}\n\.projects-open-head > :has\(> \.hub-title-field\) \{ flex: 1 1 240px !important; \}/);
  assert.match(css, /\.projects-open-head > \.projects-open-actions \{ flex: 0 1 auto !important; flex-wrap: wrap; min-width: 0; row-gap: 8px; \}/);
});
