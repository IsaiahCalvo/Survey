import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { countCopyRows, drillConfig, restorableRoles, withoutEmptyCopies } from '../scripts/backup-drill.mjs';

test('countCopyRows counts lines between COPY and \\.', () => {
  const sql = [
    'COPY "public"."projects" ("id", "name") FROM stdin;',
    '1\ta',
    '2\tb',
    '\\.',
    'COPY auth.users (id) FROM stdin;',
    '\\.',
  ].join('\n');
  assert.deepEqual([...countCopyRows(sql)], [['public.projects', 2], ['auth.users', 0]]);
});

test('withoutEmptyCopies drops only COPY blocks with no rows', () => {
  const sql = 'COPY storage.buckets_vectors (id) FROM stdin;\n\\.\nCOPY public.a (id) FROM stdin;\n1\n\\.\n';
  assert.equal(withoutEmptyCopies(sql), 'COPY public.a (id) FROM stdin;\n1\n\\.\n');
});

test('restorableRoles drops superuser-only parameter grants', () => {
  const sql = 'ALTER ROLE "anon" SET "statement_timeout" TO \'3s\';\nGRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";\n';
  assert.equal(restorableRoles(sql), 'ALTER ROLE "anon" SET "statement_timeout" TO \'3s\';\n');
});

test('drillConfig moves the stack off the dev and E2E ports and project id', () => {
  const out = drillConfig(fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8'));
  assert.match(out, /^project_id = "survey-backup-drill"$/m);
  assert.doesNotMatch(out, /^(shadow_)?port\s*=\s*543\d\d/m);
  assert.match(out, /^port = 54522$/m);
  const section = (name) => out.split(`[${name}]`)[1].split(/\n\[/)[0];
  assert.match(section('studio'), /^enabled = false$/m);
  assert.match(section('db.seed'), /^enabled = false$/m);
});

test('backup drill workflow never uploads the dump', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/backup-drill.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(yml, /upload-artifact/);
  assert.match(yml, /backup-drill\.mjs --linked/);
});
