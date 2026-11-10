// Share dialog extras (flag share-extras): owner row, sort, last opened,
// personal message on email invites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  withOwnerRow, sortAccessMembers, openedLabel, cleanInviteMessage, ACCESS_SORTS, INVITE_MESSAGE_MAX,
} from '../src/home/accessRows.js';
import { inviteMessage } from '../supabase/functions/_shared/inviteMessage.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const OWNER = 'u-owner';
const ME = { id: 'u-me', email: 'me@example.com' };

test('the owner is added when the document has no collaborator row for them', () => {
  const members = [{ id: 'c1', user_id: 'u-a', role: 'editor', email: 'a@x.com' }];
  const out = withOwnerRow(members, { ownerId: OWNER, ownerProfile: { user_id: OWNER, email: 'o@x.com' } });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: `owner:${OWNER}`, user_id: OWNER, role: 'owner', status: 'active', email: 'o@x.com', standIn: true });
  // Not twice when the owner has a row.
  assert.equal(withOwnerRow([{ user_id: OWNER, role: 'owner' }], { ownerId: OWNER }).length, 1);
  // Your own document: your email.
  assert.equal(withOwnerRow([], { ownerId: ME.id, currentUser: ME })[0].email, 'me@example.com');
  // No owner known: list unchanged.
  assert.equal(withOwnerRow(members, {}), members);
});

test('sorts: owner first always; Role, Name, Activity as in Drawboard', () => {
  assert.deepEqual(ACCESS_SORTS.map((s) => s.label), ['Role', 'Name', 'Activity']);
  const ms = [
    { user_id: 'v', role: 'viewer', email: 'amy@x.com' },
    { user_id: 'e', role: 'editor', email: 'zed@x.com' },
    { user_id: OWNER, role: 'editor', email: 'yan@x.com' },
    { user_id: 'o2', role: 'owner', email: 'bob@x.com' },
  ];
  const ids = (key, activity) => sortAccessMembers(ms, key, { ownerId: OWNER, activity }).map((m) => m.user_id);
  assert.deepEqual(ids(), [OWNER, 'o2', 'e', 'v']);
  assert.deepEqual(ids('name'), [OWNER, 'v', 'o2', 'e']);
  const act = new Map([['e', '2026-11-10T10:00:00Z'], ['v', '2026-11-10T11:00:00Z']]);
  assert.deepEqual(ids('activity', act), [OWNER, 'v', 'e', 'o2']);
});

test('last opened words', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  assert.equal(openedLabel(null, now), 'Not opened yet');
  assert.equal(openedLabel('2026-11-10T11:59:40Z', now), 'Opened just now');
  assert.equal(openedLabel('2026-11-10T11:59:00Z', now), 'Opened 1 min ago');
  assert.equal(openedLabel('2026-11-10T09:00:00Z', now), 'Opened 3 hours ago');
  assert.equal(openedLabel('2026-11-09T09:00:00Z', now), 'Opened yesterday');
  assert.equal(openedLabel('2026-11-01T12:00:00Z', now), 'Opened 9 days ago');
});

test('invite message: plain text, 500 characters, app and server agree', () => {
  const raw = `  Hi\r\nsee\tpage 3\u0007\n\n\n\nthanks ${'x'.repeat(600)}`;
  const clean = cleanInviteMessage(raw);
  assert.equal(clean, inviteMessage(raw));
  assert.ok(clean.startsWith('Hi\nsee page 3 \n\nthanks '));
  assert.equal(clean.length <= INVITE_MESSAGE_MAX, true);
  assert.equal(inviteMessage(42), '');
  assert.equal(inviteMessage('   '), '');
});

test('server: a message is escaped, quoted and never Survey\'s own words', () => {
  const email = readFileSync(new URL('../supabase/functions/send-email/index.ts', import.meta.url), 'utf8');
  assert.match(email, /if \(k === 'message'\) \{ safeData\[k\] = escapeHtml\(inviteMessage\(val\)\); continue; \}/);
  assert.equal((email.match(/emailQuote\(/g) || []).length, 2);
  const layout = readFileSync(new URL('../supabase/functions/_shared/emailLayout.ts', import.meta.url), 'utf8');
  assert.match(layout, /Message from \$\{escapedName\}/);
  const fn = readFileSync(new URL('../supabase/functions/send-invite-email/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /message: s\.string\(\{ max: 4000, optional: true \}\)/);
});

test('migration: activity only for members, never guests; flag row off', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261110173000_share_extras.sql', import.meta.url), 'utf8');
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(sql, /public\.is_guest_session\(\)/);
  assert.match(sql, /user_can_access_document\(doc_id, 'viewer'\)/);
  assert.match(sql, /c\.status = 'active'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_document_member_activity\(uuid\) FROM PUBLIC, anon;/);
  assert.match(sql, /\('share-extras', 'off'/);
});

test('flag is a Nightly beta', () => {
  assert.equal(FEATURE_FLAGS['share-extras']?.stage, 'beta');
});
