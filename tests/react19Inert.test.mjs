// React 19 reads `inert` as a boolean: inert="" (an empty string) is FALSE and
// leaves the element clickable and focusable. React 18 only passed the string
// through, so older code spelled it `inert=""`. Closing dialogs, folded
// Expanders and lifted drag copies all rely on inert, so spell it as a
// boolean (`inert`, `inert={!shown}`, `inert: true`) everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
    return /\.(jsx|js)$/.test(name) ? [full] : [];
  });
}

test('no React prop spells inert as an empty string', () => {
  const bad = [];
  for (const file of sourceFiles('src')) {
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      // Also `inert={open ? '' : undefined}`: the '' may sit on either side
      // of the colon (two such spots outlived the React 19 switch).
      if (/\binert=(""|''|\{''\}|\{""\})|\binert:\s*(''|"")|\binert=\{[^}]*[?:]\s*(''|"")/.test(line)) {
        bad.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(bad, []);
});
