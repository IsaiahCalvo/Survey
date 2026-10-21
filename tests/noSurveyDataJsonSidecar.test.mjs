import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The documents bucket accepts PDF/Excel only, so a <doc>_data.json upload is
// always refused (400). Survey data persists via the Y.Doc + documents row.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(jsx?|mjs|tsx?)$/.test(name)) yield p;
  }
}

test('no app code uploads or reads a <doc>_data.json storage sidecar', () => {
  for (const file of walk(join(ROOT, 'src'))) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /_data\.json`/, `${file} builds a _data.json storage path`);
    assert.doesNotMatch(src, /uploadDataFile|loadSurveyDataFromSupabase/, `${file} uploads JSON to storage`);
  }
});
