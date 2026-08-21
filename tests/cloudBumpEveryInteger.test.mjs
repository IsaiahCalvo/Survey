import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for the local Cloud bump 1–20 field (UL-34).
// Not leftover-18 persist. Live proof is debug/scenarios/e2e-cloud-bump-1-20.spec.mjs.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('AppShell Cloud bump field clamps 1–20 and rejects non-digits', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /aria-label="Cloud bump size"/);
  assert.match(shell, /contextTool === 'rect' && bottomToolbarApi\.lineBorderStyle === 'cloud'/);
  assert.match(shell, /const next = raw === '' \? 1 : Math\.max\(1, Math\.min\(20, parseInt\(raw, 10\)\)\)/);
  assert.match(shell, /if \(raw === '' \|\| \/\^\\d\+\$\/\.test\(raw\)\)/);
  assert.doesNotMatch(shell, /file\.id/);
});

test('viewer patches selected rect pdfCloudIntensity; mobile uses the same 1–20 clamp', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const handleCloudIntensityChange = useCallback\(\(next\) => \{/);
  assert.match(viewer, /pdfCloudIntensity: Math\.max\(1, Number\(next\) \|\| 2\)/);
  assert.match(viewer, /setCloudIntensity: handleCloudIntensityChange/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /aria-label="Cloud bump size"/);
  assert.match(mobile, /Math\.max\(1, Math\.min\(20, value\)\)/);
});
