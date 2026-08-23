import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for Survey export named menus (desktop Excel
// actions + 390 Export survey data). Live proof:
// debug/scenarios/e2e-survey-export-menuitem.spec.mjs
// Distinct from leftover-18 Survey EXPORT / Push / Sync apply /
// Space CSV / PDF Pages apply / X-01 persist / Excel actions
// fail-closed apply / Survey/Spaces menu dismiss / Spaces export
// menuitem / nameless-menu hosts already proved.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Survey export menus are role=menu with names; items stay menuitems; isolated 8448 standing', () => {
  const src = read('src/SurveySpacesRail.jsx');
  const desktopStart = src.indexOf('className="survey-marker-export-compact-cluster"');
  const desktopEnd = src.indexOf('{/* "Pull from Excel" reads the last SAVED copy');
  assert.ok(desktopStart >= 0 && desktopEnd > desktopStart);
  const desktop = src.slice(desktopStart, desktopEnd);
  assert.match(desktop, /aria-label="Excel actions"/);
  assert.match(desktop, /aria-haspopup="menu"/);
  assert.match(desktop, /role="menu"/);
  assert.match(desktop, /aria-label="Excel actions"/);
  assert.match(desktop, /role="menuitem"/);
  assert.match(desktop, /aria-label="Open linked"/);
  assert.match(desktop, /aria-label="Update existing"/);
  assert.equal((desktop.match(/role="menuitem"/g) || []).length, 2);
  assert.match(src, /if \(!showExportMenu\) return undefined;/);
  assert.match(src, /setShowExportMenu\(false\);/);
  assert.match(src, /if \(!isMobileExportMenuOpen\) return undefined;/);
  assert.match(src, /setIsMobileExportMenuOpen\(false\);/);

  const mobileStart = src.indexOf('className="mobile-survey-sheet-export-wrap"');
  const mobileEnd = src.indexOf('aria-label="Close Survey panel"', mobileStart);
  assert.ok(mobileStart >= 0 && mobileEnd > mobileStart);
  const mobile = src.slice(mobileStart, mobileEnd);
  assert.match(mobile, /aria-label="Export survey data"/);
  assert.match(mobile, /role="menu"/);
  assert.match(mobile, /role="menuitem"/);
  assert.match(mobile, /Export Excel/);
  assert.match(mobile, /Sync Microsoft 365/);
  assert.equal((mobile.match(/role="menuitem"/g) || []).length, 2);

  const spaces = read('src/sidebar/SpacesPanel.jsx');
  const exportStart = spaces.indexOf('className={`spaces-header-export-button');
  const exportEnd = spaces.indexOf('{/* Spaces List */}');
  assert.match(spaces.slice(exportStart, exportEnd), /aria-label=\{`Export \$\{spacesExportTarget\.name \|\| 'space'\}`\}/);
  assert.match(spaces.slice(exportStart, exportEnd), /role="menuitem"/);

  assert.doesNotMatch(desktop, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(src, /pageSize\.width \* .*scale|pageSize \* scale/);

  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('live spec covers named Survey export intended + break + edge; skip leftover-18 apply', () => {
  const spec = read('debug/scenarios/e2e-survey-export-menuitem.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf&surveyTransitionE2E=1/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf&surveyTransitionE2E=1/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /Excel actions/);
  assert.match(spec, /Export survey data/);
  assert.match(spec, /getByRole\('menuitem', \{ name: 'Open linked', exact: true \}\)/);
  assert.match(spec, /getByRole\('menuitem', \{ name: 'Update existing', exact: true \}\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'CSV'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'PDF Pages'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open linked'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Update existing'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Export Excel'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Lock document'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Pin project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
  assert.doesNotMatch(spec, /exportBtn\.click\(\)/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /partial must bite ink/);
});

test('does not replay Spaces export, Excel fail-closed apply, or Survey dismiss', () => {
  const spec = read('debug/scenarios/e2e-survey-export-menuitem.spec.mjs');
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /click-outside must close Spaces export/);
  assert.doesNotMatch(spec, /No Excel file is linked to this survey/);
  const spaces = read('debug/scenarios/e2e-spaces-export-menuitem.spec.mjs');
  assert.match(spaces, /Export Space 1/);
  const failClosed = read('debug/scenarios/e2e-survey-excel-actions-failclosed.spec.mjs');
  assert.match(failClosed, /waitForEvent\('download'/);
  const dismiss = read('debug/scenarios/e2e-survey-spaces-menu-dismiss.spec.mjs');
  assert.match(dismiss, /click-outside must close template picker/);
});
