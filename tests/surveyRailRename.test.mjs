import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Survey-rail Rename leftover after rail Delete selected items.
// Live proof: debug/scenarios/e2e-survey-rail-rename.spec.mjs
// Not overlay Delete, not rail Delete, not E-04, not counter-series Delete.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('commitSurveyMarkerName trims, falls back on empty, and no-ops same name', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const start = rail.indexOf('const commitSurveyMarkerName = (annotationId, categoryId, previousName, nextRawName, fallbackName) => {');
  assert.ok(start > 0, 'commitSurveyMarkerName');
  const block = rail.slice(start, rail.indexOf('// ——— Shared Survey Marker mutation helpers', start));
  assert.match(block, /const nextName = \(nextRawName \|\| ''\)\.trim\(\) \|\| fallbackName;/);
  assert.match(block, /const oldName = \(previousName \|\| ''\)\.trim\(\) \|\| fallbackName;/);
  assert.match(block, /if \(!annotationId \|\| nextName === oldName\) return;/);
  assert.match(block, /name: nextName/);
  assert.doesNotMatch(block, /duplicate|already exists|unique/i);
  assert.match(block, /addHistoryCheckpoint\('survey-marker:rename'/);
  assert.doesNotMatch(block, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(block, /data-counter-nubbin-handle/);
});

test('desktop rail Rename field commits on blur\/Enter and cancels on Escape', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const headerStart = rail.indexOf('{/* SurveyMarker header - clickable to expand */}');
  const inputStart = rail.indexOf('className="survey-marker-name-inline"', headerStart);
  assert.ok(headerStart > 0 && inputStart > headerStart, 'desktop Rename input');
  const header = rail.slice(headerStart, inputStart);
  assert.match(header, /!mobileMode && \(/);
  const end = rail.indexOf('</span>', inputStart);
  const field = rail.slice(inputStart, end);
  assert.match(field, /aria-label=\{`Rename \$\{surveyMarkerName\}`\}/);
  assert.match(field, /key=\{`\$\{annotationId\}:\$\{surveyMarkerName\}`\}/);
  assert.match(field, /commitSurveyMarkerName\(annotationId, category\.id, surveyMarkerName, nextName, fallbackName\)/);
  assert.match(field, /if \(e\.key === 'Enter'\) \{\s*e\.currentTarget\.blur\(\);/);
  assert.match(field, /\} else if \(e\.key === 'Escape'\) \{\s*e\.currentTarget\.value = surveyMarkerName;/);
  assert.doesNotMatch(field, /itemSelectedCount/);
});

test('390 list hides the desktop field; mobile detail keeps its own Rename input', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /aria-label=\{`Rename \$\{detailMarkerName\}`\}/);
  assert.match(rail, /className="mobile-survey-detail-name"/);
  const desktopHeader = rail.slice(
    rail.indexOf('{/* SurveyMarker header - clickable to expand */}'),
    rail.indexOf('aria-label={`Rename ${surveyMarkerName}`}') + 80,
  );
  assert.match(desktopHeader, /!mobileMode && \(/);
  assert.match(desktopHeader, /aria-label=\{`Rename \$\{surveyMarkerName\}`\}/);
});
