// inviteFix (2026-10-07): Manage Access listed an invitee as BOTH Active and
// Pending (with Resend) after their invite email failed - the collaborator row
// and the still-open invite row were drawn side by side. One person, one row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accessInviteRows, openInvites, visibleOpenInvites } from '../src/home/accessRows.js';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const FUTURE = '2026-10-14T12:00:00Z';
const PAST = '2026-10-01T12:00:00Z';

const members = [
  { user_id: 'u-owner', email: 'owner@example.com', role: 'owner', status: 'active' },
  { user_id: 'u-b', email: 'B@Example.com', role: 'editor', status: 'active' },
];
const invites = [
  { id: 'i-b', target_email: 'b@example.com', expires_at: FUTURE, intended_role: 'editor' }, // failed-email invite for an existing member
  { id: 'i-c', target_email: 'c@example.com', expires_at: FUTURE, intended_role: 'viewer' }, // real pending invite
  { id: 'i-link', target_email: null, expires_at: FUTURE, intended_role: 'viewer' },
  { id: 'i-old', target_email: 'd@example.com', expires_at: PAST },
  { id: 'i-acc', target_email: 'e@example.com', expires_at: FUTURE, accepted_at: '2026-10-06T00:00:00Z' },
  { id: 'i-rev', target_email: 'f@example.com', expires_at: FUTURE, revoked_at: '2026-10-06T00:00:00Z' },
];

test('open invites: not accepted, revoked or expired', () => {
  assert.deepEqual(openInvites(invites, NOW).map((i) => i.id), ['i-b', 'i-c', 'i-link']);
});

test('an active member is not also listed as a pending invite (case-insensitive email)', () => {
  const { emails, links } = accessInviteRows(invites, members, NOW);
  assert.deepEqual(emails.map((i) => i.id), ['i-c']);
  assert.deepEqual(links.map((i) => i.id), ['i-link']);
});

test('members carrying the address under user.email are matched too', () => {
  const rows = accessInviteRows(invites, [{ user_id: 'u-b', user: { email: 'b@example.com' } }], NOW);
  assert.deepEqual(rows.emails.map((i) => i.id), ['i-c']);
});

test('no members: every open email invite stays; order is kept', () => {
  assert.deepEqual(visibleOpenInvites(invites, [], NOW).map((i) => i.id), ['i-b', 'i-c', 'i-link']);
  assert.deepEqual(visibleOpenInvites(null, null, NOW), []);
});

test('Manage Access and Manage Team both build their pending rows through accessRows', () => {
  const access = readFileSync(new URL('../src/home/AccessManagementModal.jsx', import.meta.url), 'utf8');
  assert.match(access, /accessInviteRows\(invites, members\)/);
  assert.doesNotMatch(access, /invites\.filter\(\(i\) => !i\.accepted_at/);
  const team = readFileSync(new URL('../src/home/ManageTeamModal.jsx', import.meta.url), 'utf8');
  assert.match(team, /visibleOpenInvites\(invites, memberList\)/);
});
