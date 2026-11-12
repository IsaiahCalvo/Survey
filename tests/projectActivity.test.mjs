// Project Activity (Nightly flag project-activity), copied from Drawboard
// Projects' Activity page: server-written events, 15-minute groups, plain
// lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTIVITY_BUCKET_MS, activityBucket, bucketLabel, describeProjectEvent, eventDocumentId, groupActivity,
} from '../src/projectItems/projectActivity.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const sql = readFileSync(new URL('../supabase/migrations/20261110180000_project_activity.sql', import.meta.url), 'utf8');

test('the flag is a Nightly beta flag with its row', () => {
  assert.equal(FEATURE_FLAGS['project-activity']?.stage, 'beta');
  assert.match(sql, /'project-activity', 'off'/);
});

test('the log is written by triggers only and read by project members', () => {
  assert.match(sql, /GRANT SELECT ON public\.project_events TO authenticated;/);
  assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE)[^;]*project_events/);
  assert.match(sql, /user_can_access_project\(project_id, 'viewer'\)/);
  // Busy columns (page, zoom, save stamps) never fire the documents trigger.
  assert.match(sql, /AFTER INSERT OR DELETE OR UPDATE OF project_id, name, user_archived_at, superseded_by, sheet_revision ON public\.documents/);
  // A project being deleted takes its rows with it; nothing is written for it.
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM public\.projects WHERE id = p_project_id\)/);
  assert.match(sql, /REFERENCES public\.projects\(id\) ON DELETE CASCADE/);
});

test('each kind of event reads as one plain line', () => {
  const names = { u2: 'Eddie' };
  const line = (e) => describeProjectEvent(e, { memberName: (id) => names[id] || '' });
  assert.equal(line({ action: 'project_created' }), 'created the project');
  assert.equal(line({ action: 'project_renamed', from_value: 'A', to_value: 'B' }), "renamed the project from 'A' to 'B'");
  assert.equal(line({ action: 'document_added', subject_name: 'M-101.pdf' }), 'added M-101.pdf');
  assert.equal(line({ action: 'document_renamed', from_value: 'a.pdf', to_value: 'b.pdf' }), "renamed 'a.pdf' to 'b.pdf'");
  assert.equal(line({ action: 'document_archived', subject_name: 'x.pdf' }), 'archived x.pdf');
  assert.equal(line({ action: 'document_revision', subject_name: 'x.pdf', from_value: 'A', to_value: 'B' }), "changed the revision of x.pdf from 'A' to 'B'");
  assert.equal(line({ action: 'document_revision', subject_name: 'x.pdf', to_value: 'A' }), "set the revision of x.pdf to 'A'");
  assert.equal(line({ action: 'document_revised', subject_name: 'x v2.pdf', from_value: 'x.pdf' }), 'added x v2.pdf as a new version of x.pdf');
  assert.equal(line({ action: 'issue_created', subject_name: 'ISS-1 Leak' }), 'created the issue ISS-1 Leak');
  assert.equal(line({ action: 'task_status', subject_name: 'TSK-2 Paint', from_value: 'draft', to_value: 'open' }), "changed the status of TSK-2 Paint from 'Draft' to 'Open'");
  assert.equal(line({ action: 'issue_assignee', subject_name: 'ISS-1 Leak', to_value: 'u2' }), 'assigned ISS-1 Leak to Eddie');
  assert.equal(line({ action: 'issue_assignee', subject_name: 'ISS-1 Leak', to_value: null }), 'removed the assignee of ISS-1 Leak');
  assert.equal(line({ action: 'issue_deleted', subject_name: 'ISS-1 Leak' }), 'deleted the issue ISS-1 Leak');
  assert.equal(line({ action: 'member_added', subject_name: 'e@x.com', to_value: 'editor' }), 'added e@x.com as editor');
  assert.equal(line({ action: 'member_role', subject_name: 'e@x.com', from_value: 'viewer', to_value: 'editor' }), 'changed e@x.com from viewer to editor');
  assert.equal(line({ action: 'member_removed', subject_name: 'e@x.com' }), 'removed e@x.com');
  assert.equal(line({ action: 'something_new' }), 'made a change');
});

test('15-minute groups, newest first, with Today / Yesterday headings', () => {
  const base = Date.UTC(2026, 10, 10, 15, 0, 0);
  const at = (mins) => new Date(base + mins * 60_000).toISOString();
  const events = [{ id: 4, created_at: at(29) }, { id: 3, created_at: at(16) }, { id: 2, created_at: at(14) }, { id: 1, created_at: at(1) }];
  const groups = groupActivity(events);
  assert.deepEqual(groups.map((g) => g.events.map((e) => e.id)), [[4, 3], [2, 1]]);
  assert.equal(activityBucket(at(14)) % ACTIVITY_BUCKET_MS, 0);
  const now = new Date(2026, 10, 10, 18, 0).getTime();
  assert.match(bucketLabel(new Date(2026, 10, 10, 15, 30).getTime(), now, 'en-US'), /^Today, 3:30\sPM$/);
  assert.match(bucketLabel(new Date(2026, 10, 9, 9, 0).getTime(), now, 'en-US'), /^Yesterday, 9:00\sAM$/);
  assert.match(bucketLabel(new Date(2026, 10, 3, 14, 15).getTime(), now, 'en-US'), /^Nov 3, 2:15\sPM$/);
});

test('a document line opens the document unless it left the project', () => {
  assert.equal(eventDocumentId({ action: 'document_added', subject_id: 'd1' }), 'd1');
  assert.equal(eventDocumentId({ action: 'document_deleted', subject_id: 'd1' }), null);
  assert.equal(eventDocumentId({ action: 'document_moved_out', subject_id: 'd1' }), null);
  assert.equal(eventDocumentId({ action: 'issue_created', subject_id: 'i1' }), null);
});
