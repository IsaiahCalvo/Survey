import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  USER_COLORS,
  USER_INACTIVE_FILL,
  USER_INACTIVE_INK,
  USER_INITIALS_INK,
  assignUserColors,
  hashUserId,
  userColor,
  userColorFill,
  userColorIndex,
} from '../src/utils/userColors.js';

// Owner 2026-10-07: "the user glyph ... shouldn't be gray. Gray indicates
// inactivity ... if other users come onto a PDF, it uses different pastel
// colors for each user." One pastel per person, from their user id.

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const hsl = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s, l };
};
// The app's chrome surfaces (tokens.css) and a light-theme page.
const DARK_SURFACES = ['#0d0f14', '#171a21', '#21252e', '#2b303b'];
const WHITE = '#ffffff';

const uuid = (i) => {
  // Deterministic uuid-shaped ids (real ids are Supabase uuids).
  let x = (i + 1) * 2654435761 >>> 0;
  const hex = () => { x = (Math.imul(x ^ (x >>> 15), 2246822519) + 0x9e3779b9) >>> 0; return x.toString(16).padStart(8, '0'); };
  const a = hex() + hex() + hex() + hex();
  return `${a.slice(0, 8)}-${a.slice(8, 12)}-4${a.slice(13, 16)}-a${a.slice(17, 20)}-${a.slice(20, 32)}`;
};

test('eight soft pastels, all different, none grey and none gold', () => {
  assert.equal(USER_COLORS.length, 8);
  assert.equal(new Set(USER_COLORS.map((c) => c.fill)).size, 8);
  for (const { name, fill } of USER_COLORS) {
    const { h, s, l } = hsl(fill);
    assert.ok(l >= 0.7 && l <= 0.9, `${name} ${fill} is a pastel (lightness ${l.toFixed(2)})`);
    assert.ok(s >= 0.25, `${name} ${fill} reads as a colour, not grey (saturation ${s.toFixed(2)})`);
    assert.ok(s <= 0.75, `${name} ${fill} stays soft (saturation ${s.toFixed(2)})`);
    // The yellow / amber band is the app's gold (#d8a84e, hue ~39-40 deg
    // is orange-gold; the gold family runs ~35-60). Keep every face out of it.
    assert.ok(!(h >= 35 && h <= 65), `${name} ${fill} (hue ${h.toFixed(0)}) is too close to the gold`);
  }
  assert.ok(hsl(USER_INACTIVE_FILL).s < 0.2, 'inactive is grey');
});

test('dark initials on every pastel pass WCAG AA (4.5:1), in both themes', () => {
  for (const { name, fill } of USER_COLORS) {
    const c = contrast(USER_INITIALS_INK, fill);
    assert.ok(c >= 4.5, `${name}: ${c.toFixed(2)}:1`);
    assert.ok(c >= 7, `${name}: ${c.toFixed(2)}:1 - comfortably past AA`);
  }
  // The inactive face keeps light initials at AA too.
  assert.ok(contrast(USER_INACTIVE_INK, USER_INACTIVE_FILL) >= 4.5);
});

test('every face stands out from the dark chrome (3:1 for a graphic)', () => {
  for (const { name, fill } of USER_COLORS) {
    for (const surface of DARK_SURFACES) {
      const c = contrast(fill, surface);
      assert.ok(c >= 3, `${name} on ${surface}: ${c.toFixed(2)}:1`);
    }
  }
});

test('the line twin shows on white paper and on the dark panel (3:1)', () => {
  for (const { name, line } of USER_COLORS) {
    assert.ok(contrast(line, WHITE) >= 3, `${name} line on white: ${contrast(line, WHITE).toFixed(2)}:1`);
    assert.ok(contrast(line, '#21252e') >= 3, `${name} line on the panel: ${contrast(line, '#21252e').toFixed(2)}:1`);
  }
});

test('stable: the same id always gives the same colour', () => {
  const id = '6f1c2a90-3b1e-4f7a-9d2c-1a2b3c4d5e6f';
  const first = userColor(id);
  for (let i = 0; i < 5; i += 1) assert.equal(userColor(id), first);
  assert.equal(userColorFill(id), first.fill);
  // Pinned values: a change here re-colours every user on every device, so it
  // must be deliberate.
  assert.equal(hashUserId('a'), 444641715);
  assert.equal(hashUserId(id), 1981633416);
  assert.equal(first.name, 'rose');
  assert.deepEqual(
    ['dev-fake-you', 'dev-fake-peer-1', 'dev-fake-peer-2', 'dev-fake-peer-7'].map((x) => userColor(x).name),
    ['aqua', 'periwinkle', 'rose', 'sky'],
  );
  // Strings and numbers that print the same are the same person.
  assert.equal(userColorIndex(42), userColorIndex('42'));
});

test('spread: 4000 ids land evenly across the eight colours', () => {
  const counts = new Array(8).fill(0);
  const N = 4000;
  for (let i = 0; i < N; i += 1) counts[userColorIndex(uuid(i))] += 1;
  for (const n of counts) {
    assert.ok(Math.abs(n - N / 8) < N / 8 * 0.15, `uneven: ${counts.join(', ')}`);
  }
  // Sequential ids too (e.g. "user-1", "user-2"): no colour starved.
  const seq = new Array(8).fill(0);
  for (let i = 0; i < 800; i += 1) seq[userColorIndex(`user-${i}`)] += 1;
  for (const n of seq) assert.ok(n > 60 && n < 140, `sequential uneven: ${seq.join(', ')}`);
});

test('people seen together get different colours; you never move', () => {
  // Find two ids that hash to the same colour as "me".
  const me = 'me';
  const clash = [];
  for (let i = 0; clash.length < 2; i += 1) if (userColorIndex(`p${i}`) === userColorIndex(me)) clash.push(`p${i}`);
  const map = assignUserColors([clash[1], me, clash[0]], me);
  assert.equal(map.get(me), userColor(me), 'you keep your own colour');
  const fills = [me, ...clash].map((id) => map.get(id).fill);
  assert.equal(new Set(fills).size, 3, 'the clash is resolved');
  // Order-independent: the same people in another order look the same.
  const again = assignUserColors([clash[0], clash[1], me], me);
  for (const id of [me, ...clash]) assert.equal(again.get(id), map.get(id));
  // Someone with no clash keeps their own colour on the document.
  const free = Array.from({ length: 50 }, (_, i) => `q${i}`).find((id) => ![me, ...clash].some((o) => map.get(o) === userColor(id)));
  assert.equal(assignUserColors([me, ...clash, free], me).get(free), userColor(free));
});

test('up to eight people are eight colours; nine reuse one colour once', () => {
  for (let trial = 0; trial < 30; trial += 1) {
    const ids = Array.from({ length: 8 }, (_, i) => uuid(trial * 100 + i));
    const map = assignUserColors(ids, ids[3]);
    assert.equal(new Set(ids.map((id) => map.get(id).fill)).size, 8);
  }
  const nine = Array.from({ length: 9 }, (_, i) => uuid(900 + i));
  const map9 = assignUserColors(nine, nine[0]);
  const counts = {};
  for (const id of nine) counts[map9.get(id).fill] = (counts[map9.get(id).fill] || 0) + 1;
  assert.equal(Object.keys(counts).length, 8);
  assert.ok(Object.values(counts).every((n) => n <= 2));
});

test('no initials circle draws gold, a fixed grey or a by-position colour any more', () => {
  const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const hub = read('home/HubShell.jsx');
  assert.doesNotMatch(hub, /\['var\(--gold\)', 'var\(--blue\)'/, 'AvatarStack no longer colours by position');
  assert.doesNotMatch(hub, /PRESENCE_SELF_TINT/, 'the account glyph is not the old grey');
  assert.match(hub, /userColorFill\(id \?\? initials\)/);
  for (const p of ['home/ManageTeamModal.jsx', 'home/AccessManagementModal.jsx', 'home/ProjectsFolderTree.jsx']) {
    const src = read(p);
    assert.doesNotMatch(src, /COLLAB_COLORS/, `${p} uses the shared palette`);
    assert.match(src, /userColorFill/, `${p} uses the shared palette`);
  }
  assert.doesNotMatch(read('home/AccessManagementModal.jsx'), /rl === 'owner' \? C\.gold/, 'an owner is not gold');
  assert.doesNotMatch(read('home/DocumentsLedger.jsx'), /PRESENCE_SELF_TINT/);
});
