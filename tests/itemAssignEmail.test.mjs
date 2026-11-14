// "Assigned to you" email (flag item-assign-email): the server rules in
// supabase/functions/_shared/itemAssignEmail.js, the link reader in
// src/projectItems/itemLink.js and the migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ITEM_ASSIGN_WINDOW_MS, assignEmailRefusal, itemCodeOf, itemLink, prepareItemAssignEmail,
} from '../supabase/functions/_shared/itemAssignEmail.js';
import { readItemLink, withoutItemLink, requestItemLink, takePendingItemLink } from '../src/projectItems/itemLink.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import { itemCode } from '../src/projectItems/projectItems.js';

const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const NOW = Date.parse('2026-11-14T12:00:00Z');
const item = { id: ITEM, project_id: PROJECT, kind: 'issue', number: 7, title: 'Hinge', assignee_id: THEM, archived_at: null };
const event = { actor_id: ME, to_value: THEM, created_at: '2026-11-14T11:58:00Z' };

test('only the person who just assigned someone else may ask', () => {
  assert.equal(assignEmailRefusal({ item, event, callerId: ME, nowMs: NOW }), null);
  assert.equal(assignEmailRefusal({ item: null, event, callerId: ME, nowMs: NOW }), 'not-found');
  assert.equal(assignEmailRefusal({ item: { ...item, archived_at: 'x' }, event, callerId: ME, nowMs: NOW }), 'archived');
  assert.equal(assignEmailRefusal({ item: { ...item, assignee_id: null }, event, callerId: ME, nowMs: NOW }), 'unassigned');
  assert.equal(assignEmailRefusal({ item: { ...item, assignee_id: ME }, event: { ...event, to_value: ME }, callerId: ME, nowMs: NOW }), 'self');
  assert.equal(assignEmailRefusal({ item, event: null, callerId: ME, nowMs: NOW }), 'no-change');
  assert.equal(assignEmailRefusal({ item, event: { ...event, to_value: ME }, callerId: ME, nowMs: NOW }), 'no-change');
  assert.equal(assignEmailRefusal({ item, event: { ...event, actor_id: THEM }, callerId: ME, nowMs: NOW }), 'not-actor');
  const other = '55555555-5555-4555-8555-555555555555';
  assert.equal(assignEmailRefusal({ item, event: { ...event, actor_id: other }, callerId: ME, nowMs: NOW }), 'not-actor');
  const late = new Date(NOW - ITEM_ASSIGN_WINDOW_MS - 1000).toISOString();
  assert.equal(assignEmailRefusal({ item, event: { ...event, created_at: late }, callerId: ME, nowMs: NOW }), 'too-late');
});

test('codes match the app; links go to a known site only', () => {
  assert.equal(itemCodeOf(item), itemCode('issue', 7));
  assert.equal(itemCodeOf({ kind: 'task', number: 3 }), itemCode('task', 3));
  const link = itemLink('https://evil.example', item);
  assert.equal(link, `https://surveytool.app/?project=${PROJECT}&item=${ITEM}&kind=issue`);
  assert.match(itemLink('https://surveytool-nightly.vercel.app', { ...item, kind: 'task' }), /^https:\/\/surveytool-nightly\.vercel\.app\/\?.*kind=task$/);
});

test('the app reads the link back and drops it from the address', () => {
  const href = `https://surveytool.app/?mobileNav=tabs&project=${PROJECT}&item=${ITEM}&kind=task#x`;
  assert.deepEqual(readItemLink(href), { projectId: PROJECT, itemId: ITEM, kind: 'task' });
  assert.equal(readItemLink('https://surveytool.app/?project=nope&item=x'), null);
  assert.equal(withoutItemLink(href), '/?mobileNav=tabs#x');
  requestItemLink({ projectId: PROJECT, itemId: ITEM, kind: 'issue' });
  assert.equal(takePendingItemLink(['other']), null);
  assert.deepEqual(takePendingItemLink([PROJECT]), { projectId: PROJECT, itemId: ITEM, kind: 'issue' });
  assert.equal(takePendingItemLink([PROJECT]), null);
});

test('bad ids are refused before any read', async () => {
  const admin = { from() { throw new Error('should not read'); } };
  assert.deepEqual(await prepareItemAssignEmail({ admin, callerId: ME, itemId: 'nope' }), { refusal: 'bad-request' });
});

test('flag is a Nightly beta flag; the claim table is for the server only', () => {
  assert.equal(FEATURE_FLAGS['item-assign-email']?.stage, 'beta');
  const sql = readFileSync(new URL('../supabase/migrations/20261114150000_item_assign_email.sql', import.meta.url), 'utf8');
  assert.match(sql, /'item-assign-email',\s*'off'/);
  assert.match(sql, /PRIMARY KEY \(item_id, assignee_id, assigned_at\)/);
  assert.match(sql, /REVOKE ALL ON public\.project_item_assign_emails FROM PUBLIC, anon, authenticated/);
  const fn = readFileSync(new URL('../supabase/functions/notify-comment-mentions/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /prepareItemAssignEmail/);
  assert.match(fn, /'Access-Control-Allow-Origin': '\*'/);
});
