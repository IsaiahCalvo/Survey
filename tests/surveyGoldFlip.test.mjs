// The one-step switch that turns Survey's public face gold when the suite
// look leaves Nightly (scripts/survey-gold-flip.mjs,
// docs/suite/survey-gold-flip.md). Until then nothing here is in use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CORAL_TO_GOLD, SOURCES, ICONS, TEXT_EDITS, toGold, coralIn } from '../scripts/survey-gold-flip.mjs';

// The switch removes public/brand-gold once its icons are copied over.
const FLIPPED = !existsSync(new URL('../public/brand-gold', import.meta.url));

const rules = readFileSync(new URL('../docs/suite/SUITE-RULES.md', import.meta.url), 'utf8');

function accentRow(app, mode) {
  const row = rules.split('\n').find((line) => line.startsWith(`| ${app} `) && line.includes(`| ${mode} |`));
  assert.ok(row, `${app} ${mode} row in the accents table`);
  return row.match(/#[0-9a-f]{6}/gi).slice(0, 3).map((h) => h.toLowerCase());
}

test('gold flip: every coral tone maps to the matching gold one in the suite rules', () => {
  for (const mode of ['Dark', 'Light']) {
    const coral = accentRow('Walkthru (coral)', mode);
    const gold = accentRow('Survey (gold)', mode);
    coral.forEach((hex, i) => assert.equal(CORAL_TO_GOLD[hex], gold[i], `${mode} step ${i}`));
  }
  assert.equal(Object.keys(CORAL_TO_GOLD).length, 6);
});

test('gold flip: swaps whole hex values only, and keeps their case', () => {
  assert.equal(toGold('a{color:#e07a5e}b{color:#BA4F2C}'), 'a{color:#d8a84e}b{color:#8B6500}');
  assert.equal(toGold('#e07a5e26'), '#e07a5e26', 'an eight-digit tint is not a plain accent');
  assert.equal(coralIn('#e07a5e #c7634a #123456'), 2);
});

test('gold flip: every source still exists and still wears coral', { skip: FLIPPED && 'the switch is done' }, () => {
  for (const rel of SOURCES) {
    const url = new URL(`../${rel}`, import.meta.url);
    assert.ok(existsSync(url), `${rel} exists`);
    assert.ok(coralIn(readFileSync(url, 'utf8')) > 0, `${rel} has coral to turn gold`);
  }
});

test('gold flip: the gold icons are ready', { skip: FLIPPED && 'the switch is done' }, () => {
  for (const name of ICONS) {
    assert.ok(existsSync(new URL(`../public/brand-gold/${name}`, import.meta.url)), name);
  }
  const svg = readFileSync(new URL('../public/brand-gold/favicon.svg', import.meta.url), 'utf8');
  assert.ok(svg.includes('.m { stroke: #8b6500; }'), 'deep gold on a light tab strip');
  assert.ok(svg.includes('{ .m { stroke: #d8a84e; } }'), 'bright gold on a dark tab strip');
});

test('gold flip: the guards that keep gold out are still where the switch expects them', { skip: FLIPPED && 'the switch is done' }, () => {
  for (const [rel, from] of TEXT_EDITS) {
    assert.ok(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').includes(from), `${rel} still has ${from}`);
  }
});
