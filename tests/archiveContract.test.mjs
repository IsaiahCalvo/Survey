// KAL-426 — the normalized Archive item contract every later ticket reads.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARCHIVE_RETENTION_DAYS,
  DELETE_FOREVER_COPY,
  archiveConfirmCopy,
  buildArchiveItems,
  daysRemaining,
  expiryFromArchivedAt,
  isUserArchived,
  normalizeDocumentItem,
  normalizeProjectItem,
  normalizeTemplateItem,
} from '../src/services/archiveContract.js';
import { runArchiveBulk } from '../src/services/archiveBulk.js';

const NOW = Date.parse('2026-08-02T12:00:00.000Z');
const day = (n) => new Date(NOW + n * 24 * 60 * 60 * 1000).toISOString();

const archivedDoc = (overrides = {}) => ({
  id: 'doc-1',
  user_id: 'owner-1',
  name: 'Site plan',
  project_id: null,
  user_archived_at: day(-1),
  user_archive_expires_at: day(29),
  archive_group_id: null,
  ...overrides,
});

test('retention is exactly 30 days and expiry derives from the archive moment', () => {
  assert.equal(ARCHIVE_RETENTION_DAYS, 30);
  assert.equal(
    expiryFromArchivedAt('2026-08-02T12:00:00.000Z'),
    '2026-09-01T12:00:00.000Z',
  );
  assert.equal(expiryFromArchivedAt(null), null);
});

test('days remaining rounds up, clamps at zero, and never goes negative', () => {
  assert.equal(daysRemaining(day(30), NOW), 30);
  assert.equal(daysRemaining(day(0.5), NOW), 1, 'a partial day still reads as a day left');
  assert.equal(daysRemaining(day(0), NOW), 0);
  assert.equal(daysRemaining(day(-5), NOW), 0, 'overdue rows wait for the purge job at 0');
  assert.equal(daysRemaining(null, NOW), 0);
});

test('the plan-limit archived flag never counts as user-archived', () => {
  // documents.archived is the Free-tier downgrade flag (20241226000002). Those
  // rows must never enter the Archive or be deleted after 30 days.
  assert.equal(isUserArchived({ archived: true, user_archived_at: null }), false);
  assert.equal(isUserArchived({ archived: false, user_archived_at: day(-1) }), true);
  assert.equal(isUserArchived(null), false);
});

test('a normalized document item carries its original project for restore', () => {
  const item = normalizeDocumentItem(
    archivedDoc({ project_id: 'proj-9' }),
    { projectName: 'Harbour works', now: NOW },
  );
  assert.equal(item.type, 'document');
  assert.equal(item.id, 'doc-1');
  assert.equal(item.name, 'Site plan');
  assert.equal(item.ownerId, 'owner-1');
  assert.equal(item.projectId, 'proj-9');
  assert.equal(item.projectName, 'Harbour works');
  assert.equal(item.daysRemaining, 29);
  assert.equal(item.childCount, 0);
});

test('an unnamed row still renders', () => {
  assert.equal(normalizeDocumentItem(archivedDoc({ name: null }), { now: NOW }).name, 'Untitled');
  assert.equal(normalizeTemplateItem({ id: 't', name: '' }, { now: NOW }).name, 'Untitled');
});

test('a project item exposes its children as descriptive rows only', () => {
  const item = normalizeProjectItem(
    { id: 'proj-1', user_id: 'owner-1', name: 'Harbour works', user_archived_at: day(-2), user_archive_expires_at: day(28), archive_group_id: 'grp-1' },
    [
      { id: 'doc-a', name: 'Level 1', project_id: 'proj-1', archive_group_id: 'grp-1' },
      { id: 'doc-b', name: 'Level 2', project_id: 'proj-1', archive_group_id: 'grp-1' },
    ],
    { now: NOW },
  );
  assert.equal(item.type, 'project');
  assert.equal(item.childCount, 2);
  assert.deepEqual(item.children.map((c) => c.name), ['Level 1', 'Level 2']);
  // Children are display rows: they carry no expiry and no owner of their own,
  // because they can never be restored or deleted independently.
  assert.equal(item.children[0].archiveGroupId, 'grp-1');
  assert.equal(item.daysRemaining, 28);
});

test('buildArchiveItems folds project children in and keeps standalone docs top level', () => {
  const items = buildArchiveItems({
    documents: [
      archivedDoc({ id: 'doc-child', name: 'Level 1', project_id: 'proj-1', archive_group_id: 'grp-1' }),
      archivedDoc({ id: 'doc-solo', name: 'Site plan', project_id: 'proj-2' }),
      // A Free-tier downgrade row must be ignored entirely.
      { id: 'doc-plan', user_id: 'owner-1', name: 'Old survey', archived: true, user_archived_at: null },
    ],
    projects: [
      { id: 'proj-1', user_id: 'owner-1', name: 'Harbour works', user_archived_at: day(-2), user_archive_expires_at: day(28), archive_group_id: 'grp-1' },
    ],
    templates: [
      { id: 'tpl-1', user_id: 'owner-1', name: 'Fire doors', user_archived_at: day(-3), user_archive_expires_at: day(27) },
    ],
    projectNamesById: { 'proj-2': 'Depot' },
    now: NOW,
  });

  assert.equal(items.length, 3, 'project + standalone document + template');
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));

  assert.equal(byId['proj-1'].childCount, 1);
  assert.equal(byId['proj-1'].children[0].id, 'doc-child');
  assert.ok(!byId['doc-child'], 'a project child never also appears at top level');
  assert.equal(byId['doc-solo'].projectName, 'Depot');
  assert.equal(byId['tpl-1'].type, 'template');
  assert.ok(!byId['doc-plan'], 'plan-limit archived rows stay out of the Archive');
});

test('a document whose group has no archived project stays top level', () => {
  // Defensive: a stale group id must not make an item disappear from the screen.
  const items = buildArchiveItems({
    documents: [archivedDoc({ archive_group_id: 'grp-orphan' })],
    projects: [],
    now: NOW,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'document');
});

test('confirmation copy matches the locked KAL-280 wording', () => {
  const project = archiveConfirmCopy({ type: 'project', name: 'Harbour works', childCount: 3 });
  assert.equal(project.title, 'Archive this project?');
  assert.equal(project.confirmLabel, 'Archive project');
  assert.match(project.message, /Harbour works and its 3 documents will move to Archive and remain recoverable for 30 days\./);

  const single = archiveConfirmCopy({ type: 'project', name: 'Depot', childCount: 1 });
  assert.match(single.message, /its 1 document will/, 'singular is not pluralized');

  const doc = archiveConfirmCopy({ type: 'document', name: 'Site plan' });
  assert.equal(doc.title, 'Archive this document?');
  assert.equal(doc.confirmLabel, 'Archive document');

  const tpl = archiveConfirmCopy({ type: 'template', name: 'Fire doors' });
  assert.equal(tpl.title, 'Archive this template?');
  assert.equal(tpl.confirmLabel, 'Archive template');

  assert.equal(DELETE_FOREVER_COPY.title, 'Delete forever?');
  assert.equal(DELETE_FOREVER_COPY.confirmLabel, 'Delete forever');
  assert.match(DELETE_FOREVER_COPY.message, /^This cannot be undone\./);
});

test('bulk fan-out attempts every item and reports each outcome', async () => {
  const calls = [];
  const dispatch = {
    document: async (id) => { calls.push(id); return { success: true }; },
    project: async (id) => { calls.push(id); return { success: false, error: 'Only the owner of this project can do that.' }; },
    template: async (id) => { calls.push(id); throw new Error('network down'); },
  };

  const result = await runArchiveBulk(
    [
      { type: 'document', id: 'doc-1', name: 'Site plan' },
      { type: 'project', id: 'proj-1', name: 'Harbour works' },
      { type: 'template', id: 'tpl-1', name: 'Fire doors' },
    ],
    dispatch,
    'restored',
  );

  assert.deepEqual(calls, ['doc-1', 'proj-1', 'tpl-1'], 'a failure does not stop the rest');
  assert.deepEqual(result.succeeded.map((i) => i.id), ['doc-1']);
  assert.equal(result.failed.length, 2);
  assert.equal(result.failed[0].error, 'Only the owner of this project can do that.');
  assert.equal(result.failed[1].error, 'network down');
});

test('bulk fan-out rejects an unknown item type instead of throwing', async () => {
  const result = await runArchiveBulk([{ type: 'mystery', id: 'x', name: 'Thing' }], {}, 'restored');
  assert.equal(result.succeeded.length, 0);
  assert.equal(result.failed[0].error, 'Thing cannot be restored.');
});

test('bulk fan-out tolerates an empty or missing selection', async () => {
  assert.deepEqual(await runArchiveBulk([], {}, 'restored'), { succeeded: [], failed: [] });
  assert.deepEqual(await runArchiveBulk(null, {}, 'restored'), { succeeded: [], failed: [] });
});
