// KAL-580: Plot jobs in a Survey Project. The rules live in the migration;
// these checks keep the parts Plot leans on from being dropped by accident.
// The rules themselves were run as owner, editor, viewer, stranger and anon
// against Postgres 16 with this repo's user_can_access_project (see the PR).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261117224500_plot_kal_580_jobs.sql', import.meta.url), 'utf8');

test('plot.jobs keeps its row rules on, keyed to the Project roles', () => {
  assert.match(sql, /alter table plot\.jobs enable row level security/);
  assert.match(sql, /plot_jobs_select[\s\S]*?user_can_access_project\(project_id, 'viewer'\)/);
  assert.match(sql, /plot_jobs_insert[\s\S]*?user_can_access_project\(project_id, 'editor'\)/);
  assert.match(sql, /plot_jobs_update[\s\S]*?using \(public\.user_can_access_project\(project_id, 'editor'\)\)[\s\S]*?with check \(public\.user_can_access_project\(project_id, 'editor'\)\)/);
});

test('a resend lands on the same row: the job id is the key', () => {
  assert.match(sql, /id uuid primary key/);
  assert.match(sql, /on conflict \(id\) do update/);
});

test('the job functions run as the caller, so the row rules apply', () => {
  for (const name of ['plot_list_jobs', 'plot_save_job', 'plot_remove_job']) {
    const body = sql.slice(sql.indexOf(`function public.${name}(`));
    assert.match(body.slice(0, 900), /security invoker/, `${name} must be security invoker`);
  }
});

test('nobody signed out can reach Plot jobs', () => {
  assert.match(sql, /revoke all on plot\.jobs from anon/);
  for (const name of ['plot_my_projects', 'plot_list_jobs', 'plot_save_job', 'plot_remove_job']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated`));
  }
});

test('the migration only adds things', () => {
  assert.doesNotMatch(sql, /\bdrop (table|schema|column)\b/i);
  assert.doesNotMatch(sql, /\bdelete from\b/i);
});
