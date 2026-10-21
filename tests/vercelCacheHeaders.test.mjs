// Hashed build files may be cached for a year; the app shell must not be, or
// a deploy would not reach people until the cache ran out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const cacheRules = config.headers
  .map((rule) => ({ source: rule.source, value: rule.headers.find((h) => h.key.toLowerCase() === 'cache-control')?.value }))
  .filter((rule) => rule.value);

test('only hashed assets are cached as immutable', () => {
  const immutable = cacheRules.filter((rule) => /immutable/.test(rule.value)).map((rule) => rule.source);
  assert.deepEqual(immutable, ['/assets/(.*)']);
});

test('no cache rule matches the app shell or marketing pages', () => {
  for (const { source } of cacheRules) {
    const pattern = new RegExp(`^${source}$`);
    for (const path of ['/', '/index.html', '/welcome', '/release.json', '/sw.js']) {
      assert.ok(!pattern.test(path), `${source} must not match ${path}`);
    }
  }
});
