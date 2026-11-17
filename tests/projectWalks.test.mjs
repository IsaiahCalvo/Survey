// KAL-595: the Walkthru tab in a Survey Project (Nightly 'suite').
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatDuration, listProjectWalks, projectWalkFolders, projectWalkUrl, readProjectWalk, recordProjectWalk,
} from '../src/suite/projectWalks.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the walk is sorted into photos, audio, video, notes and next actions', () => {
  const folders = projectWalkFolders({
    walkthrough: { id: 'w1', name: 'Collier' },
    nodes: [{ id: 'n1', title: 'Camera C-1' }, { id: 'n2', title: '  ' }],
    media_assets: [
      { id: 'p1', kind: 'photo', node_id: 'n1', captured_at_ms: 10 },
      { id: 'p2', kind: 'photo', node_id: 'n2', captured_at_ms: 20 },
      { id: 'v1', kind: 'video', node_id: null, captured_at_ms: 30 },
    ],
    audio_recordings: [
      { id: 'a2', started_at: '2026-11-17T10:00:00Z', duration_ms: 185000 },
      { id: 'a1', started_at: '2026-11-16T10:00:00Z', duration_ms: 1000 },
    ],
    notes: [
      { id: 't1', text: ' Door sticks ', node_id: 'n1' },
      { id: 't2', text: '   ', node_id: null },
    ],
    action_items: [{ id: 'x1', title: 'Order a lift', status: 'open' }, { id: 'x2', title: '', status: 'open' }],
  });
  assert.deepEqual(folders.photos.map((p) => [p.id, p.node]), [['p1', 'Camera C-1'], ['p2', null]]);
  assert.deepEqual(folders.video.map((v) => v.id), ['v1']);
  assert.deepEqual(folders.audio.map((a) => a.label), ['Recording 2', 'Recording 1']);
  assert.deepEqual(folders.notes, [{ id: 't1', text: 'Door sticks', node: 'Camera C-1', updatedAt: null }]);
  assert.deepEqual(folders.nextActions, [{ id: 'x1', title: 'Order a lift', done: false }]);
});

test('an empty or missing bundle gives empty folders', () => {
  const folders = projectWalkFolders(null);
  for (const key of ['photos', 'video', 'audio', 'notes', 'nextActions']) assert.deepEqual(folders[key], []);
});

test('the walk opens in Walkthru: Nightly opens Walkthru Nightly', () => {
  assert.equal(
    projectWalkUrl('nightly', 'p 1', 'w1'),
    'https://walkthu-nightly.vercel.app/survey-projects/p%201/walks/w1',
  );
  assert.match(projectWalkUrl('stable', 'p', 'w'), /^https:\/\/walkthru\.tools\/survey-projects\/p\/walks\/w$/);
});

test('durations read as minutes and seconds', () => {
  assert.equal(formatDuration(185000), '3:05');
  assert.equal(formatDuration(3_725_000), '1:02:05');
  assert.equal(formatDuration(0), '');
  assert.equal(formatDuration(null), '');
});

test('recording a walk upserts one row per Project and walk', async () => {
  const calls = [];
  const client = {
    from: (table) => ({
      upsert: async (row, opts) => { calls.push({ table, row, opts }); return { error: null }; },
    }),
  };
  assert.equal(await recordProjectWalk(client, 'p1', 'w1', '2026-11-17T00:00:00Z'), true);
  assert.deepEqual(calls, [{
    table: 'project_walkthroughs',
    row: { project_id: 'p1', walkthrough_id: 'w1', updated_at: '2026-11-17T00:00:00Z' },
    opts: { onConflict: 'project_id,walkthrough_id' },
  }]);
  assert.equal(await recordProjectWalk(client, null, 'w1'), false);
});

test('listing maps the database rows; reading goes through the walkthru schema', async () => {
  const client = {
    rpc: async (name, args) => {
      assert.equal(name, 'list_project_walkthroughs');
      assert.deepEqual(args, { p_project_id: 'p1' });
      return { data: [{ walkthrough_id: 'w1', name: null, floors: 2, nodes: 5, plain_nodes: 1, photos: 3 }], error: null };
    },
    schema: (name) => {
      assert.equal(name, 'walkthru');
      return {
        rpc: async (fn, args) => {
          assert.equal(fn, 'get_project_walkthrough');
          assert.deepEqual(args, { p_project_id: 'p1', p_walkthrough_id: 'w1' });
          return { data: [{ walkthrough: { id: 'w1' }, nodes: [] }], error: null };
        },
      };
    },
  };
  const [walk] = await listProjectWalks(client, 'p1');
  assert.equal(walk.id, 'w1');
  assert.equal(walk.name, 'Walkthru walk');
  assert.deepEqual(walk.counts, { floors: 2, nodes: 5, plainNodes: 1, photos: 3, videos: 0, audio: 0, notes: 0, nextActions: 0 });
  const bundle = await readProjectWalk(client, 'p1', 'w1');
  assert.equal(bundle.walkthrough.id, 'w1');
});

test('wired in: the hand-off records the walk, the project shows the tab behind suite', () => {
  const dash = read('src/Dashboard.jsx');
  assert.match(dash, /recordProjectWalk\(supabase, project\.id, walk\.walk\.id\)/);
  assert.match(dash, /walkthruTabOn=\{suiteOn && Boolean\(user\)\}/);
  const tree = read('src/home/ProjectsFolderTree.jsx');
  assert.match(tree, /useProjectWalks\(\{ projectId: open\?\.id, enabled: walkthruTabOn \}\)/);
  assert.equal((tree.match(/listTab !== 'files' && listTab !== 'walkthru'/g) || []).length, 2);
  assert.match(read('src/projectItems/ProjectItemsPanel.jsx'), /walkthru \? \[\{ key: 'walkthru', label: 'Walkthru' \}\]/);
});

test('the database gate is the Project: only members read, only editors who can open the walk add it', () => {
  const sql = read('supabase/migrations/20261117150000_kal_595_project_walkthroughs.sql');
  assert.match(sql, /create table if not exists public\.project_walkthroughs/);
  assert.match(sql, /using \(public\.user_can_access_project\(project_id, 'viewer'\)\)/);
  assert.match(sql, /public\.user_can_access_project\(project_id, 'editor'\)\s+and exists \(\s+select 1 from walkthru\.walkthroughs w/);
  assert.equal((sql.match(/if not public\.user_can_access_project\(p_project_id, 'viewer'\) then/g) || []).length, 2);
  assert.match(sql, /revoke all on function walkthru\.get_project_walkthrough\(uuid, uuid\) from public, anon;/);
  assert.doesNotMatch(sql, /\bdrop table\b|\bdelete from\b|\btruncate\b/i);
});
