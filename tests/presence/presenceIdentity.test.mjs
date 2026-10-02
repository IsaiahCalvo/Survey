import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRESENCE_IDLE_MS,
  PRESENCE_PEER_TINTS,
  PRESENCE_SELF_TINT,
  assignPresenceTints,
  buildFakePresence,
  presenceInitials,
  presenceState,
  readDevFakePeerCount,
} from '../../src/components/presenceIdentity.js';

// Owner 2026-10-02: the people faces in the desktop footer and the phone
// sheet. These pin the parts the owner asked for by name.

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const TEXT_1 = '#dadfe8'; // --text-1, the initials' ink

test('initials on every tint pass 4.5:1', () => {
  for (const tint of [PRESENCE_SELF_TINT, ...PRESENCE_PEER_TINTS]) {
    assert.ok(contrast(TEXT_1, tint) >= 4.5, `${tint} is ${contrast(TEXT_1, tint).toFixed(2)}:1`);
  }
});

test('your own face is grey, not blue, and nobody gets gold or a saturated blue', () => {
  const sat = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  };
  assert.ok(sat(PRESENCE_SELF_TINT) < 0.25, 'you are a calm grey');
  for (const tint of [PRESENCE_SELF_TINT, ...PRESENCE_PEER_TINTS]) {
    assert.ok(sat(tint) < 0.5, `${tint} is too saturated`);
    assert.notEqual(tint.toLowerCase(), '#d8a84e');
  }
  const src = readFileSync(new URL('../../src/components/PresenceAvatars.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /#6c8aff|#4f8cff/i, 'the old blue "you" gradient is gone');
});

test('up to six other people get six different tints; you stay grey', () => {
  const ids = ['me', 'a', 'b', 'c', 'd', 'e', 'f'];
  const tints = assignPresenceTints(ids, 'me');
  assert.equal(tints.get('me'), PRESENCE_SELF_TINT);
  const peers = ids.slice(1).map((id) => tints.get(id));
  assert.equal(new Set(peers).size, 6);
  // Stable: the same roster in another order gives the same tints.
  const again = assignPresenceTints([...ids].reverse(), 'me');
  for (const id of ids) assert.equal(again.get(id), tints.get(id));
});

test('twelve people: each tint is used at most twice', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `user-${i}`);
  const tints = assignPresenceTints(ids, 'user-0');
  const counts = {};
  for (const id of ids.slice(1)) counts[tints.get(id)] = (counts[tints.get(id)] || 0) + 1;
  assert.ok(Object.values(counts).every((n) => n <= 2), JSON.stringify(counts));
  // In display order, each run of six people is six different tints.
  const shown = ids.slice(1).map((id) => tints.get(id));
  assert.equal(new Set(shown.slice(0, 6)).size, 6);
});

test('status: here within a minute of last activity, idle after; you are always here', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const at = (ms) => ({ last_seen: new Date(now - ms).toISOString() });
  assert.equal(presenceState(at(5000), { now }), 'here');
  assert.equal(presenceState(at(PRESENCE_IDLE_MS + 1000), { now }), 'idle');
  assert.equal(presenceState(at(PRESENCE_IDLE_MS + 1000), { now, isCurrent: true }), 'here');
});

test('initials follow first + last', () => {
  assert.equal(presenceInitials('maria.lopez@example.com'), 'ML');
  assert.equal(presenceInitials('Jane Q Doe'), 'JD');
  assert.equal(presenceInitials('isaiah@example.com'), 'IS');
  assert.equal(presenceInitials(''), '?');
});

test('the fake-people flag is dev only and builds N rows with you first', () => {
  assert.equal(readDevFakePeerCount(), null, 'no import.meta.env.DEV outside vite');
  const rows = buildFakePresence(12, Date.parse('2026-10-02T12:00:00Z'));
  assert.equal(rows.length, 12);
  assert.equal(rows[0].user_id, 'dev-fake-you');
  assert.equal(new Set(rows.map((r) => r.user_id)).size, 12);
});

// Owner 2026-10-02 (consistency audit bug): the same user read "DU" on the
// desktop and "DT" on the phone - two initials rules (first + last word vs
// first + second) and two label rules (email first vs name first). Both now
// use presenceLabel / presenceInitials: the person's name, else their email.
test('phone and desktop give one person the same label and initials', async () => {
  const { presenceLabel, presenceRowForUser, presenceSelfRow } = await import('../../src/components/presenceIdentity.js');
  const { normalizeMobilePresence } = await import('../../src/mobile/mobilePdfViewerModel.js');
  const me = { currentUserId: 'me', currentUserEmail: 'dev.user@example.com', currentUserDisplayName: 'Dev Test User' };
  // Before your own row syncs: your name, initials first + last.
  const desktopSelf = presenceLabel(presenceSelfRow(me));
  const [phoneSelf] = normalizeMobilePresence(me);
  assert.equal(desktopSelf, 'Dev Test User');
  assert.equal(phoneSelf.label, desktopSelf);
  assert.equal(phoneSelf.initials, presenceInitials(desktopSelf));
  assert.equal(phoneSelf.initials, 'DU');
  // Once it has synced (display_name holds the email): still your name.
  const row = { user_id: 'me', display_name: 'dev.user@example.com', last_seen: '2026-10-02T12:00:00Z' };
  assert.equal(presenceLabel(presenceRowForUser(row, me)), 'Dev Test User');
  assert.equal(normalizeMobilePresence({ ...me, presence: [row] })[0].label, 'Dev Test User');
  // No name known: the email, on both.
  const noName = { ...me, currentUserDisplayName: null };
  assert.equal(presenceLabel(presenceSelfRow(noName)), 'dev.user@example.com');
  assert.equal(normalizeMobilePresence(noName)[0].initials, 'DU');
  // A peer's row carries only the email: the email, on both.
  const peer = { user_id: 'p', display_name: 'maria.lopez@example.com', last_seen: '2026-10-02T12:00:00Z' };
  assert.equal(presenceLabel(presenceRowForUser(peer, me)), 'maria.lopez@example.com');
  const phonePeer = normalizeMobilePresence({ ...me, presence: [row, peer] }).find((u) => u.id === 'p');
  assert.equal(phonePeer.label, 'maria.lopez@example.com');
  assert.equal(phonePeer.initials, 'ML');
});
