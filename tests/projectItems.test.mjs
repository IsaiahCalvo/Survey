// Projects Issues and Tasks (flag project-issues): the pure rules in
// src/projectItems/projectItems.js and the database rules in
// supabase/migrations/20261110172000_project_items.sql.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ITEM_STATUSES, STATUS_GROUPS, statusesFor, isDone, REGISTER_COLUMNS, itemCode, filterItems, sortItems, isOverdue, isDueSoon,
  itemsCsv, registerFileName, describeEvent, duplicateFields, groupCounts, parseItemTags, allItemTags,
  formatDue, timeAgo, localDay,
} from '../src/projectItems/projectItems.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const ME = 'u-me';
const OTHER = 'u-other';
const TODAY = '2026-11-10';
const item = (over) => ({
  id: `i${over.number}`, kind: 'issue', number: 1, title: '', status: 'draft', tags: [], links: [],
  created_by: ME, assignee_id: null, due_date: null, archived_at: null, ...over,
});

test('IDs read ISS-n and TSK-n', () => {
  assert.equal(itemCode('issue', 12), 'ISS-12');
  assert.equal(itemCode('task', 3), 'TSK-3');
});

test('statuses in three groups, Draft first, each kind with its own list, as in Drawboard', () => {
  assert.deepEqual(statusesFor('issue').map((s) => s.label), ['Draft', 'Open', 'Pending', 'In Review', 'Closed', 'Approved', 'Rejected']);
  assert.deepEqual(statusesFor('task').map((s) => s.label), ['Draft', 'Open', 'Pending', 'In Review', 'On Hold', 'Closed']);
  assert.deepEqual(STATUS_GROUPS.map((g) => g.label), ['Unstarted', 'Started', 'Done']);
  assert.deepEqual(ITEM_STATUSES.filter((s) => s.group === 'done').map((s) => s.key), ['closed', 'approved', 'rejected']);
  // On Hold is a started status, so a held task is not done.
  assert.equal(isDone({ kind: 'task', status: 'on_hold' }), false);
  assert.equal(isDone({ kind: 'task', status: 'closed' }), true);
});

test('due soon is the next 7 days; overdue is past; done items are neither', () => {
  assert.equal(isOverdue(item({ due_date: '2026-11-09' }), TODAY), true);
  assert.equal(isOverdue(item({ due_date: '2026-11-10' }), TODAY), false);
  assert.equal(isDueSoon(item({ due_date: '2026-11-10' }), TODAY), true);
  assert.equal(isDueSoon(item({ due_date: '2026-11-17' }), TODAY), true);
  assert.equal(isDueSoon(item({ due_date: '2026-11-18' }), TODAY), false);
  assert.equal(isOverdue(item({ due_date: '2026-11-01', status: 'closed' }), TODAY), false);
  assert.equal(isDueSoon(item({ due_date: '2026-11-11', status: 'approved' }), TODAY), false);
});

test('filters: search by summary or ID, quick filters, groups, tags, assignee, archived', () => {
  const items = [
    item({ number: 1, title: 'Door 3 hinge', status: 'open', assignee_id: ME, tags: ['Fire'] }),
    item({ number: 12, title: 'Ceiling tile', status: 'closed', created_by: OTHER, due_date: '2026-11-01' }),
    item({ number: 3, title: 'Leak', status: 'pending', due_date: '2026-11-01', assignee_id: OTHER }),
    item({ number: 4, title: 'Old', archived_at: '2026-11-01T00:00:00Z' }),
  ];
  const ids = (opts) => filterItems(items, { userId: ME, today: TODAY, ...opts }).map((i) => i.number);
  assert.deepEqual(ids({}), [1, 12, 3]);
  assert.deepEqual(ids({ q: 'HINGE' }), [1]);
  assert.deepEqual(ids({ q: 'iss-12' }), [12]);
  assert.deepEqual(ids({ q: '1' }), [1, 12]);
  assert.deepEqual(ids({ quick: new Set(['created']) }), [1, 3]);
  assert.deepEqual(ids({ quick: new Set(['assigned']) }), [1]);
  assert.deepEqual(ids({ quick: new Set(['overdue']) }), [3]);
  assert.deepEqual(ids({ groups: new Set(['started']) }), [1, 3]);
  assert.deepEqual(ids({ groups: new Set(['done', 'unstarted']) }), [12]);
  assert.deepEqual(ids({ tags: new Set(['fire']) }), [1]);
  assert.deepEqual(ids({ assignees: new Set(['none']) }), [12]);
  assert.deepEqual(ids({ assignees: new Set([OTHER]) }), [3]);
  assert.deepEqual(ids({ archived: true }), [4]);
});

test('sorts: newest ID first by default; no due date or assignee always last', () => {
  const items = [
    item({ number: 1, title: 'b', due_date: '2026-12-01', status: 'closed', assignee_id: 'a' }),
    item({ number: 2, title: 'a', status: 'open' }),
    item({ number: 3, title: 'c', due_date: '2026-11-11', status: 'draft', assignee_id: 'b' }),
  ];
  const names = { a: 'Zed', b: 'Amy' };
  const order = (key, dir) => sortItems(items, key, dir, { memberName: (id) => names[id] }).map((i) => i.number);
  assert.deepEqual(order(), [3, 2, 1]);
  assert.deepEqual(order('number', 'asc'), [1, 2, 3]);
  assert.deepEqual(order('title', 'asc'), [2, 1, 3]);
  assert.deepEqual(order('due', 'asc'), [3, 1, 2]);
  assert.deepEqual(order('due', 'desc'), [1, 3, 2]);
  assert.deepEqual(order('status', 'asc'), [3, 2, 1]);
  assert.deepEqual(order('assignee', 'asc'), [3, 1, 2]);
  assert.deepEqual(order('assignee', 'desc'), [1, 3, 2]);
});

test('register CSV: Drawboard file name and its 14 columns, every field quoted', () => {
  const at = new Date(2026, 10, 10, 5, 33);
  assert.equal(registerFileName('Tower A / L2', 'issue', at), 'Tower A L2 - Issues Register - 2026-11-10 05-33.csv');
  assert.equal(registerFileName('Site', 'task', at), 'Site - Tasks Register - 2026-11-10 05-33.csv');
  assert.deepEqual(REGISTER_COLUMNS, ['ID', 'AssetLinks', 'Summary', 'Description', 'Due date', 'Created at (UTC)', 'Last updated at (UTC)', 'Status', 'Drawings', 'Documents', 'Assigned to', 'Created by', 'Most recent comment', 'Tags']);
  const csv = itemsCsv([
    item({
      number: 7, title: '=HYPERLINK("x")', description: 'line 1\nline, 2', status: 'in_review', assignee_id: OTHER,
      due_date: '2026-11-01', tags: ['A', 'B'], links: [{ document_id: 'd1' }],
      created_at: '2026-11-10T01:08:09.123Z', updated_at: '2026-11-10T01:12:00Z',
    }),
  ], { memberName: (id) => (id === OTHER ? 'Sam' : 'Me'), docName: () => 'A-101.pdf', lastComment: () => 'See photo' });
  assert.ok(csv.startsWith('\ufeff'));
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines[0], REGISTER_COLUMNS.map((c) => `"${c}"`).join(','));
  assert.equal(lines[1], '"ISS-7","","\'=HYPERLINK(""x"")","line 1\nline, 2","2026-11-01","2026-11-10T01:08","2026-11-10T01:12","In Review","A-101.pdf","","Sam","Me","See photo","A, B"');
});

test('activity lines use Drawboard words', () => {
  const name = (id) => ({ [OTHER]: 'Sam' })[id];
  assert.equal(describeEvent({ action: 'status', from_value: 'draft', to_value: 'open' }), "changed the status from 'Draft' to 'Open'");
  assert.equal(describeEvent({ action: 'description' }), 'edited the description');
  assert.equal(describeEvent({ action: 'assignee', to_value: OTHER }, { memberName: name }), 'assigned it to Sam');
  assert.equal(describeEvent({ action: 'due', from_value: null, to_value: '2026-11-20' }), "set the due date to 'Nov 20'");
  assert.equal(describeEvent({ action: 'created' }, { kind: 'task' }), 'created the task');
  assert.equal(describeEvent({ action: 'links', from_value: '0', to_value: '1' }), 'linked a document');
  assert.equal(describeEvent({ action: 'archived' }), 'archived the issue');
});

test('a duplicate keeps title, status and content (Drawboard), not the ID or archive', () => {
  const copy = duplicateFields(item({ number: 9, title: 'X', status: 'closed', tags: ['a'], links: [{ document_id: 'd', extra: 1 }], archived_at: 'now' }));
  assert.deepEqual(copy, { kind: 'issue', status: 'closed', title: 'X', description: '', assignee_id: null, due_date: null, tags: ['a'], links: [{ document_id: 'd' }] });
});

test('small helpers', () => {
  assert.deepEqual(parseItemTags(' Fire, fire , Level 2,,'), ['Fire', 'Level 2']);
  assert.deepEqual(allItemTags([item({ tags: ['b', 'A'] }), item({ tags: ['a'] })]), ['A', 'b']);
  assert.deepEqual(groupCounts([item({ status: 'open' }), item({ status: 'draft' }), item({ status: 'closed', archived_at: 'x' })]), { unstarted: 1, started: 1, done: 0 });
  assert.equal(formatDue('2026-11-12', TODAY), 'Nov 12');
  assert.equal(formatDue('2027-01-02', TODAY), 'Jan 2, 2027');
  const now = Date.parse('2026-11-10T12:00:00Z');
  assert.equal(timeAgo('2026-11-10T11:59:40Z', now), 'Just now');
  assert.equal(timeAgo('2026-11-10T11:55:00Z', now), '5 mins ago');
  assert.equal(timeAgo('2026-11-10T09:00:00Z', now), '3 hours ago');
  assert.match(localDay(new Date(2026, 0, 5)), /^2026-01-05$/);
});

test('flag is a Nightly beta', () => {
  assert.equal(FEATURE_FLAGS['project-issues']?.stage, 'beta');
});

test('migration: numbers never reused, server writes the log, owner deletes only archived', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261110172000_project_items.sql', import.meta.url), 'utf8');
  assert.match(sql, /project_item_counters/);
  assert.match(sql, /ON CONFLICT \(project_id, kind\) DO UPDATE SET last_number = c\.last_number \+ 1/);
  assert.match(sql, /UNIQUE \(project_id, kind, number\)/);
  assert.match(sql, /REVOKE ALL ON public\.project_item_counters FROM anon, authenticated/);
  // The log is written by a trigger; no client grant can insert into it.
  assert.match(sql, /AFTER INSERT OR UPDATE ON public\.project_items/);
  assert.match(sql, /GRANT SELECT ON public\.project_item_events TO authenticated;/);
  assert.doesNotMatch(sql, /GRANT[^;]*INSERT[^;]*ON public\.project_item_events/);
  // IDs and authorship cannot be rewritten.
  assert.match(sql, /NEW\.number := OLD\.number;/);
  assert.match(sql, /NEW\.created_by := OLD\.created_by;/);
  // Delete: archived only, project owner only.
  assert.match(sql, /FOR DELETE TO authenticated\s+USING \(\s+archived_at IS NOT NULL[\s\S]*?user_can_access_project\(project_id, 'owner'\)/);
  // Guest-link and agent sessions never write.
  assert.equal((sql.match(/NOT public\.is_guest_session\(\)/g) || []).length >= 5, true);
  // Archive is the owner's; a viewer cannot comment.
  assert.match(sql, /only the project owner can archive/);
  assert.match(sql, /project_item_comments_insert[\s\S]*?user_can_access_project\(project_id, 'editor'\)/);
  // Deleting your own comment needs the same: no guest or agent session, still on the project.
  assert.match(sql, /project_item_comments_delete_own[\s\S]*?NOT public\.is_guest_session\(\)[\s\S]*?NOT public\.is_agent_session\(\)[\s\S]*?user_can_access_project\(project_id, 'editor'\)\s*\);/);
  assert.match(sql, /\('project-issues', 'off'/);
});

test('a slow, older save never rewinds updated_at; an old Activity read never replaces a newer one', () => {
  const data = readFileSync(new URL('../src/projectItems/projectItemsData.js', import.meta.url), 'utf8');
  assert.match(data, /Date\.parse\(data\.updated_at\) > Date\.parse\(i\.updated_at\)/);
  assert.match(data, /updated_at: newer \? data\.updated_at : i\.updated_at/);
  const panel = readFileSync(new URL('../src/projectItems/ProjectItemsPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /if \(read === eventsReadRef\.current\) setEvents\(res\.events\)/);
});
