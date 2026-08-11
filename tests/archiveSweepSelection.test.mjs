// tests/archiveSweepSelection.test.mjs — KAL-431.
//
// Pins WHICH archived rows the 30-day auto-cleanup is allowed to purge. This is
// the dangerous half of the job (it deletes user data), so the rules are held
// here as pure code rather than only inside the cron SQL.
//
// The SQL side of the same rules is proved against a real database by
// scripts/test-archive-purge-sweep-postgres.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectDueArchiveItems,
  normalizeBatchLimit,
  summarizeSweepSelection,
  SKIP_REASONS,
  DEFAULT_BATCH_LIMIT,
  MAX_BATCH_LIMIT,
  MAX_PURGE_ATTEMPTS,
} from '../src/services/archiveSweepSelection.js';

const NOW = new Date('2026-08-11T12:00:00.000Z');
const daysFromNow = (n) => new Date(NOW.getTime() + n * 86400000).toISOString();

const archived = (over, extra = {}) => ({
  user_archived_at: daysFromNow(-30 - over),
  user_archive_expires_at: daysFromNow(-over),
  user_id: 'owner-a',
  ...extra,
});

const ids = (items) => items.map((i) => i.id).sort();

test('an item past its retention window is due', () => {
  const { due } = selectDueArchiveItems({
    now: NOW,
    documents: [{ id: 'd1', ...archived(1) }],
  });
  assert.deepEqual(ids(due), ['d1']);
  assert.equal(due[0].kind, 'document');
  assert.equal(due[0].ownerId, 'owner-a');
});

test('an item still inside its window is NOT due', () => {
  const { due, skipped } = selectDueArchiveItems({
    now: NOW,
    documents: [{ id: 'd1', ...archived(-5) }], // 5 days left
  });
  assert.deepEqual(due, []);
  assert.deepEqual(skipped, []);
});

test('the expiry boundary is inclusive — expiring exactly now is due', () => {
  const { due } = selectDueArchiveItems({
    now: NOW,
    documents: [{
      id: 'd1',
      user_id: 'owner-a',
      user_archived_at: daysFromNow(-30),
      user_archive_expires_at: NOW.toISOString(),
    }],
  });
  assert.deepEqual(ids(due), ['d1']);
});

test('a row that is not archived is never due, whatever its expiry says', () => {
  const { due } = selectDueArchiveItems({
    now: NOW,
    documents: [{
      id: 'd1',
      user_id: 'owner-a',
      user_archived_at: null,
      user_archive_expires_at: daysFromNow(-99),
    }],
  });
  assert.deepEqual(due, []);
});

test('a missing expiry means never-due, not immediately-due', () => {
  const { due } = selectDueArchiveItems({
    now: NOW,
    documents: [{
      id: 'd1',
      user_id: 'owner-a',
      user_archived_at: daysFromNow(-400),
      user_archive_expires_at: null,
    }],
  });
  assert.deepEqual(due, []);
});

test('projects and templates are swept alongside documents', () => {
  const { due } = selectDueArchiveItems({
    now: NOW,
    projects: [{ id: 'p1', archive_group_id: 'g1', ...archived(1) }],
    templates: [{ id: 't1', ...archived(1) }],
    documents: [{ id: 'd1', ...archived(1) }],
  });
  assert.deepEqual(ids(due), ['d1', 'p1', 't1']);
});

test('a child of an archived project defers to the project group', () => {
  // archive_project stamps parent and children with the same group and expiry,
  // so the child looks due on its own — purging it directly would delete it
  // while leaving the project row behind.
  const { due, skipped } = selectDueArchiveItems({
    now: NOW,
    projects: [{ id: 'p1', archive_group_id: 'g1', ...archived(1) }],
    documents: [{ id: 'd1', project_id: 'p1', archive_group_id: 'g1', ...archived(1) }],
  });
  assert.deepEqual(ids(due), ['p1'], 'only the project is purged; it takes the child');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].id, 'd1');
  assert.equal(skipped[0].reason, SKIP_REASONS.DEFERRED_TO_PROJECT_GROUP);
});

test('a due child waits when its archived project still has time left', () => {
  const { due, skipped } = selectDueArchiveItems({
    now: NOW,
    projects: [{ id: 'p1', archive_group_id: 'g1', ...archived(-5) }], // 5 days left
    documents: [{ id: 'd1', project_id: 'p1', archive_group_id: 'g1', ...archived(1) }],
  });
  assert.deepEqual(due, [], 'nothing is purged out from under the project');
  assert.equal(skipped[0].reason, SKIP_REASONS.DEFERRED_TO_PROJECT_GROUP);
});

test('a child of a LIVE project is never purged', () => {
  const { due, skipped } = selectDueArchiveItems({
    now: NOW,
    projects: [{ id: 'p1', user_id: 'owner-a', user_archived_at: null }],
    documents: [{ id: 'd1', project_id: 'p1', ...archived(1) }],
  });
  assert.deepEqual(due, []);
  assert.equal(skipped[0].reason, SKIP_REASONS.PARENT_PROJECT_SURVIVES);
});

test('ANY surviving parent protects a child, even one with no archive group', () => {
  // Guards against a hand-run backfill on the hand-managed production DB
  // clearing archive_group_id: the child would otherwise purge individually and
  // leave the project standing empty.
  const { due, skipped } = selectDueArchiveItems({
    now: NOW,
    projects: [{ id: 'p1', archive_group_id: null, ...archived(1) }],
    documents: [{ id: 'd1', project_id: 'p1', archive_group_id: null, ...archived(1) }],
  });
  assert.deepEqual(due.map((d) => d.id), ['p1'], 'the project still purges, taking the child');
  assert.equal(skipped[0].reason, SKIP_REASONS.PARENT_PROJECT_SURVIVES);
});

test('a project still holding a LIVE document is refused', () => {
  // KAL-426's purge_archived_project deletes children by project_id with no
  // owner or archived filter, so purging would destroy a live document that may
  // belong to a collaborator.
  const { due, skipped } = selectDueArchiveItems({
    now: NOW,
    projects: [{ id: 'p1', archive_group_id: 'g1', ...archived(1) }],
    documents: [{ id: 'd-live', project_id: 'p1', user_id: 'owner-b', user_archived_at: null }],
  });
  assert.deepEqual(due, [], 'the project is held back rather than risked');
  assert.equal(skipped[0].id, 'p1');
  assert.equal(skipped[0].reason, SKIP_REASONS.PROJECT_HOLDS_LIVE_DOCUMENT);
});

test('the project purges once nothing live remains inside it', () => {
  const { due } = selectDueArchiveItems({
    now: NOW,
    projects: [{ id: 'p1', archive_group_id: 'g1', ...archived(1) }],
    documents: [{ id: 'd1', project_id: 'p1', archive_group_id: 'g1', ...archived(1) }],
  });
  assert.deepEqual(due.map((d) => d.id), ['p1']);
});

test('an item that keeps failing is quarantined so it cannot wedge the job', () => {
  // Selection is oldest-first, so without quarantine a permanently-failing row
  // is re-selected first every run and starves everything behind it.
  const documents = [
    { id: 'poison', ...archived(9) },
    { id: 'healthy', ...archived(1) },
  ];
  const failures = [{ kind: 'document', item_id: 'poison', attempts: MAX_PURGE_ATTEMPTS }];

  const blocked = selectDueArchiveItems({ now: NOW, documents, limit: 1 });
  assert.equal(blocked.due[0].id, 'poison', 'without quarantine it takes the slot');

  const { due, skipped } = selectDueArchiveItems({ now: NOW, documents, failures, limit: 1 });
  assert.deepEqual(due.map((d) => d.id), ['healthy'], 'the healthy row is reached');
  assert.ok(skipped.some((s) => s.id === 'poison' && s.reason === SKIP_REASONS.QUARANTINED));
});

test('an item below the attempt threshold is still retried', () => {
  const { due } = selectDueArchiveItems({
    now: NOW,
    documents: [{ id: 'flaky', ...archived(1) }],
    failures: [{ kind: 'document', item_id: 'flaky', attempts: MAX_PURGE_ATTEMPTS - 1 }],
  });
  assert.deepEqual(due.map((d) => d.id), ['flaky']);
});

test('quarantine is scoped by kind, not id alone', () => {
  const { due } = selectDueArchiveItems({
    now: NOW,
    templates: [{ id: 'shared-id', ...archived(1) }],
    failures: [{ kind: 'document', item_id: 'shared-id', attempts: MAX_PURGE_ATTEMPTS }],
  });
  assert.deepEqual(due.map((d) => d.id), ['shared-id'], 'a document failure must not quarantine a template');
});

test('a standalone archived document is still purged when other projects exist', () => {
  const { due } = selectDueArchiveItems({
    now: NOW,
    projects: [{ id: 'p1', user_id: 'owner-a', user_archived_at: null }],
    documents: [{ id: 'd1', project_id: null, archive_group_id: null, ...archived(1) }],
  });
  assert.deepEqual(ids(due), ['d1']);
});

test('the batch is bounded and the overflow is reported, not dropped', () => {
  const documents = Array.from({ length: 10 }, (_, i) => ({
    id: `d${i}`,
    ...archived(i + 1),
  }));
  const { due, skipped, limit } = selectDueArchiveItems({ now: NOW, documents, limit: 3 });

  assert.equal(limit, 3);
  assert.equal(due.length, 3);
  const overflow = skipped.filter((s) => s.reason === SKIP_REASONS.OVER_BATCH_LIMIT);
  assert.equal(overflow.length, 7, 'the rest are explicitly deferred to the next run');
});

test('the oldest expiry drains first so a backlog cannot starve a row', () => {
  const documents = [
    { id: 'newest', ...archived(1) },
    { id: 'oldest', ...archived(9) },
    { id: 'middle', ...archived(5) },
  ];
  const { due } = selectDueArchiveItems({ now: NOW, documents, limit: 2 });
  assert.deepEqual(due.map((d) => d.id), ['oldest', 'middle']);
});

test('projects sort before documents on an expiry tie', () => {
  const { due } = selectDueArchiveItems({
    now: NOW,
    projects: [{ id: 'p1', archive_group_id: 'gx', ...archived(3) }],
    documents: [{ id: 'd1', ...archived(3) }],
    templates: [{ id: 't1', ...archived(3) }],
  });
  assert.deepEqual(due.map((d) => d.kind), ['project', 'document', 'template']);
});

test('an empty archive yields an empty, no-op run', () => {
  const result = selectDueArchiveItems({ now: NOW });
  assert.deepEqual(result.due, []);
  assert.deepEqual(result.skipped, []);
});

test('selection is a pure function — repeated calls agree (re-runnable)', () => {
  const input = {
    now: NOW,
    projects: [{ id: 'p1', archive_group_id: 'g1', ...archived(2) }],
    documents: [
      { id: 'd1', project_id: 'p1', archive_group_id: 'g1', ...archived(2) },
      { id: 'd2', ...archived(4) },
    ],
    templates: [{ id: 't1', ...archived(1) }],
  };
  const first = selectDueArchiveItems(input);
  const second = selectDueArchiveItems(input);
  assert.deepEqual(first, second);
});

test('once purged rows disappear from the input, the next run is a no-op', () => {
  // Simulates the real re-run: the purged ids are simply gone from the tables.
  const documents = [{ id: 'd1', ...archived(1) }, { id: 'd2', ...archived(2) }];
  const first = selectDueArchiveItems({ now: NOW, documents });
  assert.equal(first.due.length, 2);

  const purgedIds = new Set(first.due.map((d) => d.id));
  const second = selectDueArchiveItems({
    now: NOW,
    documents: documents.filter((d) => !purgedIds.has(d.id)),
  });
  assert.deepEqual(second.due, []);
});

test('batch limits are clamped rather than trusted', () => {
  assert.equal(normalizeBatchLimit(undefined), DEFAULT_BATCH_LIMIT);
  assert.equal(normalizeBatchLimit(null), DEFAULT_BATCH_LIMIT);
  assert.equal(normalizeBatchLimit(0), DEFAULT_BATCH_LIMIT);
  assert.equal(normalizeBatchLimit(-10), DEFAULT_BATCH_LIMIT, 'negative never means unbounded');
  assert.equal(normalizeBatchLimit('abc'), DEFAULT_BATCH_LIMIT);
  assert.equal(normalizeBatchLimit(10), 10);
  assert.equal(normalizeBatchLimit(10.9), 10);
  assert.equal(normalizeBatchLimit(99999), MAX_BATCH_LIMIT, 'a huge batch is capped');
});

test('the run summary names what it did', () => {
  const selection = selectDueArchiveItems({
    now: NOW,
    projects: [{ id: 'p1', archive_group_id: 'g1', ...archived(1) }],
    documents: [{ id: 'd1', project_id: 'p1', archive_group_id: 'g1', ...archived(1) }],
  });
  const summary = summarizeSweepSelection(selection);
  assert.match(summary, /projects=1/);
  assert.match(summary, /skipped=1/);
});
