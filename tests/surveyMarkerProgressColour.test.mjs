import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Owner 2026-10-01: the "answered/total" count is green (with a check) only
// when every item is a done answer (good / neutral), red as soon as any
// item is a bad-tone answer, grey otherwise. Both the phone row and the
// desktop rail use one renderer.
const rail = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');

test('count colour follows the Complete rule, not "all answered"', () => {
  assert.match(rail, /const set = answerSetFor\(selectedTemplate\);/);
  assert.match(rail, /const no = active\.filter\(\(item\) => answerTone\(set, responses\[item\.id\]\?\.selection\) === 'bad'\)\.length;/);
  assert.match(rail, /const done = total > 0 && answered === total && no === 0;/);
  assert.match(rail, /const state = no > 0 \? ' is-no' : done \? ' is-done' : '';/);
  assert.doesNotMatch(rail, /answered === total \? ' is-done'/);
  assert.doesNotMatch(rail, /selection === 'N'/);
  assert.equal(rail.match(/renderSurveyMarkerProgress\(progress\)/g)?.length, 2);
});

test('both stylesheets colour a No count red', () => {
  for (const path of ['../src/mobile/mobileSurveyPanel.css', '../src/surveyRailPanel.css']) {
    const css = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(css, /\.survey-marker-progress\.is-no \{\n  color: var\(--danger-text\);/);
    assert.match(css, /\.survey-marker-progress\.is-done \{\n  color: var\(--success-text\);/);
  }
});
