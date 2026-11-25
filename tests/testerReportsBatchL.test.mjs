// Tester reports, batch L (Nov 25 evening).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('#1716: Enter saves a Survey Marker note; Shift+Enter is a new line; leaving the page keeps it', () => {
  const src = read('src/components/SurveyMarkerNotes.jsx');
  assert.match(src, /event\.key === 'Enter' && !event\.shiftKey && !event\.nativeEvent\?\.isComposing && !readOnly\) \{\n\s*event\.preventDefault\(\);\n\s*event\.currentTarget\.blur\(\);/);
  // The blur is what saves (and shows "Saved"), the same as clicking away.
  assert.match(src, /onBlur=\{\(\) => \{\n\s*focusedRef\.current = false;\n\s*if \(commit\(\)\)/);
  assert.match(src, /window\.addEventListener\('pagehide', onLeave\);/);
  assert.match(src, /window\.removeEventListener\('pagehide', onLeave\);/);
});
