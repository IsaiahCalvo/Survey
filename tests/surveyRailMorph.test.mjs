// Survey panel polish after bf3888e (owner 2026-10-02):
//   1. picking / switching a template is a MORPH (each old row turns into a
//      new one), not a fade - src/surveyRailMorph.js;
//   2. the Categories head line's buttons are two bare ICONS, Select and Add;
//   3. an open Survey Marker's lines start under its entity dot;
//   4. the armed category has no fill / bar / ring at rest - its press plays
//      when armed and plays backwards when disarmed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { alignIn, easeInOutCubic, morphFrame, planMorph, MORPH_DURATION_MS } from '../src/surveyRailMorph.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const rail = read('src/SurveySpacesRail.jsx');
const morph = read('src/surveyRailMorph.js');
const desk = read('src/surveyRailPanel.css');
const phone = read('src/mobile/mobileSurveyPanel.css');

const box = (y, h, x = 0, w = 320) => ({ x, y, w, h });
const item = (y, h) => ({ rect: box(y, h), vis: box(y, h), radii: [0, 0, 0, 0] });

test('pairs rows in reading order; extra rows grow out of the last pair, surplus rows fold into the row above', () => {
  const before = { head: item(35, 40), rows: [item(75, 44), item(119, 44), item(163, 44), item(207, 44)], foot: null };
  const after = { head: item(35, 40), rows: [item(75, 40), item(115, 36)], foot: item(400, 48) };
  const moves = planMorph(before, after);
  // head + 2 pairs + 2 collapsing + the footer growing in
  assert.equal(moves.length, 6);
  assert.deepEqual(moves[0].to, after.head.vis);
  assert.deepEqual([moves[1].from, moves[1].to], [before.rows[0].vis, after.rows[0].vis]);
  assert.deepEqual([moves[2].from, moves[2].to], [before.rows[1].vis, after.rows[1].vis]);
  // Surplus old rows end as 0-high boxes at the bottom of where the last
  // paired row ends up (115 + 36).
  for (const m of moves.slice(3, 5)) {
    assert.equal(m.newItem, null);
    assert.equal(m.to.h, 0);
    assert.equal(m.to.y, 151);
  }
  // The footer grows up out of the panel's bottom edge.
  assert.equal(moves[5].oldItem, null);
  assert.deepEqual(moves[5].from, { x: 0, y: 448, w: 320, h: 0 });

  // And back: the new rows grow out of the last paired OLD row's bottom.
  const back = planMorph(after, before);
  const grown = back.filter((m) => !m.oldItem && m.newItem && m.newItem !== before.head);
  assert.equal(grown.length, 2);
  grown.forEach((m) => { assert.equal(m.from.h, 0); assert.equal(m.from.y, 151); });
  const sunk = back.find((m) => m.oldItem === after.foot);
  assert.equal(sunk.to.h, 0);
});

test('a frame moves and scales the box, and counter-scales the words so they keep their size', () => {
  const move = { from: box(67, 44), to: box(65, 40), oldItem: item(67, 44), newItem: item(65, 40) };
  const base = move.to;
  const start = morphFrame(move, base, 0);
  assert.equal(start.box, 'translate(0px, 2px) scale(1, 1.1)');
  // the old copy sits exactly where the old row was drawn
  assert.match(start.oldCopy, /^scale\(1, 0\.909\) translate\(0px, 0px\)$/);
  const end = morphFrame(move, base, 1);
  assert.equal(end.box, 'translate(0px, 0px) scale(1, 1)');
  assert.equal(end.newCopy, 'scale(1, 1) translate(0px, 0px)');
  assert.equal(end.radius, '0px');
  // corners turn into the new corners, compensated for the scale
  const rounded = { ...move, newItem: { ...move.newItem, radii: [8, 8, 8, 8] } };
  assert.match(morphFrame(rounded, base, 0.5).radius, /^4px 4px 4px 4px \/ 3\.81px/);
});

test('one ease-in-out curve, 260-320ms; copies centre in a like box and top-align in a tall one', () => {
  assert.ok(MORPH_DURATION_MS >= 260 && MORPH_DURATION_MS <= 320);
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(1), 1);
  assert.ok(easeInOutCubic(0.1) < 0.1 && easeInOutCubic(0.9) > 0.9);
  assert.equal(alignIn(44, 40), 2);
  assert.equal(alignIn(272, 32), 0);
  assert.equal(alignIn(32, 272), 0);
  assert.equal(alignIn(0, 32), 0);
});

test('the morph is transforms only, honours reduced motion, and the bf3888e fade overlay is gone', () => {
  assert.match(morph, /prefers-reduced-motion: reduce/);
  assert.match(morph, /'mix-blend-mode': 'plus-lighter'/);
  // no layout properties animated: the box keyframes are transform + radius
  assert.match(morph, /box\.animate\(frames\.map\(\(\{ t, f \}\) => \(\{ offset: t, transform: f\.box, borderRadius: f\.radius \}\)\)/);
  assert.doesNotMatch(morph, /animate\([^)]*\b(height|width|top|left)\s*:/);
  assert.doesNotMatch(rail, /data-survey-rail-swap-ghost|captureRailSwap|isRailSwapContent/);
  // picked from the list, switched from the menu / phone list, the phone's
  // list opened and closed again
  assert.ok((rail.match(/captureRailMorph\(\);/g) || []).length >= 4);
  assert.match(rail, /import \{ captureMorph, playMorph, prefersReducedMotion \} from '\.\/surveyRailMorph\.js';/);
});

test('Categories head line: two bare icons, Select then Add category, in the shared chrome icon states', () => {
  const head = rail.slice(rail.indexOf('<h3 className="survey-rail__cats-head">'), rail.indexOf('</h3>', rail.indexOf('<h3 className="survey-rail__cats-head">')));
  assert.match(head, /className="survey-rail__cats-actions" data-chrome-rail="true"/);
  const select = head.indexOf('aria-label="Select"');
  const add = head.indexOf('aria-label="Add category"');
  assert.ok(select > 0 && add > select, 'Select comes before Add');
  assert.match(head, /\{\.\.\.tip\('Select', 'below'\)\}/);
  assert.match(head, /\{\.\.\.tip\('Add category', 'below'\)\}/);
  assert.doesNotMatch(head.slice(select - 600, add + 400), />\s*(Select|Category)\s*</, 'no words in the resting pair');
  assert.match(desk, /\.survey-rail__head-btn\.survey-rail__cats-icon \{[^}]*width: 28px;[^}]*height: 28px;/);
  // the app's section header pair: list-checks + plus, 16px in a 28px hit
  assert.match(head, /<Icon name="listChecks" size=\{SURVEY_HEAD_ICON\}/);
  assert.match(head, /<Icon name="plus" size=\{SURVEY_HEAD_ICON\}/);
  const icons = read('src/surveyHeadIcons.jsx');
  assert.match(icons, /export const SURVEY_HEAD_ICON = 16;/);
  // Same glyphs as the shared SectionIconButton pair.
  assert.match(read('src/components/SectionIconButton.jsx'), /select: 'listChecks',\s*add: 'plus',/);
});

test('an open Survey Marker\'s lines start under its entity dot, desktop and phone', () => {
  assert.match(desk, /--sv-entity-x: calc\(var\(--sv-grip-w\) \+ 1px\);/);
  assert.match(desk, /--sv-detail-indent: var\(--sv-entity-x\);/);
  // Owner 2026-10-02: the phone line has the desktop's reorder grip in a
  // 32px gutter, so the dot (and the lines under it) start after it.
  assert.match(phone, /--survey-grip-w: 32px;/);
  assert.match(phone, /--survey-marker-dot-x: calc\(var\(--survey-grip-w\) \+ 4px\);/);
  assert.match(phone, /\.mobile-survey-marker \.mobile-survey-check-item \{\s*padding-left: var\(--survey-marker-dot-x\);/);
  assert.match(phone, /\.mobile-survey-open-notes \.survey-marker-notes \{\s*padding-left: var\(--survey-marker-dot-x\);/);
});

test('the armed category has no resting look; arming presses its row, disarming plays the press backwards', () => {
  assert.doesNotMatch(desk, /\.is-armed[^{]*\{[^}]*(background|box-shadow|outline|border)/);
  assert.doesNotMatch(phone, /\.is-armed[^{]*\{[^}]*(background|box-shadow|outline|border)/);
  assert.match(rail, /if \(previous\) playCategoryArmPress\(root, previous, 'reverse'\);/);
  assert.match(rail, /if \(armedCategoryId\) playCategoryArmPress\(root, armedCategoryId, 'normal'\);/);
  assert.match(rail, /getPropertyValue\('--pressed'\)/);
  // Escape puts the tool down unless something else owns Escape
  assert.match(rail, /event\.key !== 'Escape' \|\| event\.defaultPrevented/);
  assert.match(rail, /setActiveTool\('select'\);\n    \};\n    window\.addEventListener\('keydown', onKeyDown\);/);
});
