// The one-step switch that turns Survey's public face green when the suite
// look leaves Nightly (scripts/survey-green-flip.mjs,
// docs/suite/survey-green-flip.md). Until then nothing here is in use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CORAL_TO_GREEN, SOURCES, ICONS, toGreen, coralIn } from '../scripts/survey-green-flip.mjs';

const rules = readFileSync(new URL('../docs/suite/SUITE-RULES.md', import.meta.url), 'utf8');

function accentRow(app, mode) {
  const row = rules.split('\n').find((line) => line.startsWith(`| ${app} `) && line.includes(`| ${mode} |`));
  assert.ok(row, `${app} ${mode} row in the accents table`);
  return row.match(/#[0-9a-f]{6}/gi).slice(0, 3).map((h) => h.toLowerCase());
}

test('green flip: every coral tone maps to the matching green one in the suite rules', () => {
  for (const mode of ['Dark', 'Light']) {
    const coral = accentRow('Walkthru (coral)', mode);
    const green = accentRow('Survey (green)', mode);
    coral.forEach((hex, i) => assert.equal(CORAL_TO_GREEN[hex], green[i], `${mode} step ${i}`));
  }
  assert.equal(Object.keys(CORAL_TO_GREEN).length, 6);
});

test('green flip: swaps whole hex values only, and keeps their case', () => {
  assert.equal(toGreen('a{color:#e07a5e}b{color:#BA4F2C}'), 'a{color:#3dc98a}b{color:#157F55}');
  assert.equal(toGreen('#e07a5e26'), '#e07a5e26', 'an eight-digit tint is not a plain accent');
  assert.equal(coralIn('#e07a5e #c7634a #123456'), 2);
});

test('green flip: every source still exists and still wears coral', () => {
  for (const rel of SOURCES) {
    const url = new URL(`../${rel}`, import.meta.url);
    assert.ok(existsSync(url), `${rel} exists`);
    assert.ok(coralIn(readFileSync(url, 'utf8')) > 0, `${rel} has coral to turn green`);
  }
});

test('green flip: the green icons are ready', () => {
  for (const name of ICONS) {
    assert.ok(existsSync(new URL(`../public/brand-green/${name}`, import.meta.url)), name);
  }
  const svg = readFileSync(new URL('../public/brand-green/favicon.svg', import.meta.url), 'utf8');
  assert.ok(svg.includes('.m { stroke: #157f55; }'), 'deep green on a light tab strip');
  assert.ok(svg.includes('{ .m { stroke: #3dc98a; } }'), 'bright green on a dark tab strip');
});
