// Browsers compile an input's pattern attribute with the RegExp `v` flag,
// where a bare "-" in a character class is a syntax error (and a console error).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(jsx?|tsx?)$/.test(name)) yield p;
  }
}

test('every pattern attribute compiles with the v flag', () => {
  const bad = [];
  for (const file of walk(new URL('../src', import.meta.url).pathname)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\bpattern="([^"]*)"/g)) {
      try { new RegExp(`^(?:${m[1]})$`, 'v'); } catch { bad.push(`${file}: ${m[1]}`); }
    }
  }
  assert.deepEqual(bad, []);
});
