// jszip stays out of the first load (size budget, KAL-652): Settings and the
// Walkthru hand-off are part of it, and they only need jszip once an export
// or a job file starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const rel of ['src/services/accountExport.js', 'src/suite/jobPackage.js']) {
  test(`${rel} loads jszip when it is used, not with the app`, () => {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /^import\s+JSZip\s+from\s+'jszip';/m);
    assert.match(src, /import\('jszip'\)/);
  });
}
