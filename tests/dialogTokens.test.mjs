import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|css)$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

// 2026-10-04 (polish round 2): every modal backdrop names the one scrim token
// (--overlay-scrim, KAL-62) instead of re-typing rgba(13, 15, 20, 0.55).
// tokens.css is the only place the value may be written out.
test('modal backdrops use the --overlay-scrim token, not a typed colour', () => {
  const offenders = files
    .filter(({ path }) => !path.endsWith(join('styles', 'tokens.css')))
    .filter(({ text }) => /rgba\(\s*13\s*,\s*15\s*,\s*20\s*,\s*0?\.55\s*\)/.test(text))
    .map(({ path }) => path.slice(SRC.length));
  assert.deepEqual(offenders, []);
});
