// Company workspace (Enterprise, beta 'company-admin'): log wording, CSV
// download, the Manage team activity grouping, and the migration's guard
// rails (RLS on, no write policies, beta flag seeded).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMPANY_FLAG, activitySentence, activityToCsv, describeActivity, formatBytesShort,
} from '../src/services/companyService.js';
import { groupEditsByFile } from '../src/services/memberActivity.js';
import { FEATURE_FLAGS, isFeatureOn } from '../src/featureFlags.js';

const MIGRATION = readFileSync(new URL('../supabase/migrations/20261028025000_company_workspace.sql', import.meta.url), 'utf8');

test('log rows read as plain sentences', () => {
  assert.equal(activitySentence({ actor_email: 'olive@acme.com', action: 'project.renamed', target_label: 'Tower B', details: { from: 'Tower A', to: 'Tower B' } }),
    'olive@acme.com renamed project Tower B from Tower A');
  assert.equal(activitySentence({ actor_email: 'olive@acme.com', action: 'document.shared', target_label: 'A-201.pdf', details: { person: 'sam@x.com', role: 'viewer' } }),
    'olive@acme.com shared A-201.pdf with sam@x.com as viewer');
  assert.equal(activitySentence({ actor_email: 'eddie@acme.com', action: 'member.joined', target_label: 'eddie@acme.com', details: { role: 'admin' } }),
    'eddie@acme.com joined the company');
  assert.equal(activitySentence({ actor_email: 'olive@acme.com', action: 'member.role_changed', target_label: 'eddie@acme.com', details: { from: 'member', to: 'admin' } }),
    'olive@acme.com changed the role of eddie@acme.com Member to Admin');
  assert.equal(describeActivity({ action: 'member.removed', target_label: 'p@acme.com', details: { projects_handed_off: 2, handoff_to: 'o@acme.com' } }).extra,
    '2 projects handed to o@acme.com');
  // An action the app does not know yet still reads as words.
  assert.equal(activitySentence({ action: 'document.printed', target_label: 'X' }), 'Someone document printed X');
});

test('CSV quotes commas and cannot run formulas in Excel', () => {
  const csv = activityToCsv([
    { created_at: '2026-10-28T01:00:00Z', actor_email: 'a@b.com', action: 'project.created', target_label: '=HYPERLINK("x")', details: {} },
    { created_at: '2026-10-28T02:00:00Z', actor_email: 'a@b.com', action: 'document.uploaded', target_label: 'Plan, rev 2.pdf', details: {} },
  ]);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'When (UTC),Person,Action,What,Details');
  assert.ok(lines[1].includes(`"'=HYPERLINK(""x"")"`), lines[1]);
  assert.ok(lines[2].includes('"Plan, rev 2.pdf"'));
});

test('storage sizes read short', () => {
  assert.equal(formatBytesShort(0), '0 B');
  assert.equal(formatBytesShort(46366), '45 KB');
  assert.equal(formatBytesShort(1099511627776), '1 TB');
  assert.equal(formatBytesShort(1.5 * 1024 ** 3), '1.5 GB');
});

test('Manage team activity: one row per file, newest edit first', () => {
  const names = new Map([['d1', 'A-101.pdf'], ['d2', 'A-102.pdf']]);
  const out = groupEditsByFile([
    { document_id: 'd1', occurred_at: '2026-10-27T10:00:00Z' },
    { document_id: 'd2', occurred_at: '2026-10-27T12:00:00Z' },
    { document_id: 'd1', occurred_at: '2026-10-27T13:00:00Z' },
    { document_id: 'd3', occurred_at: 'not a date' },
  ], names);
  assert.deepEqual(out.map((r) => [r.file, r.count]), [['A-101.pdf', 2], ['A-102.pdf', 1]]);
  assert.equal(out[0].at, Date.parse('2026-10-27T13:00:00Z'));
});

test('company-admin is a beta flag: Nightly only', () => {
  assert.equal(FEATURE_FLAGS[COMPANY_FLAG].stage, 'beta');
  assert.equal(isFeatureOn(COMPANY_FLAG, { storage: { getItem: () => null }, env: { VITE_RELEASE_CHANNEL: 'nightly' } }), true);
  assert.equal(isFeatureOn(COMPANY_FLAG, { storage: { getItem: () => '1' }, env: {} }), false);
  assert.match(MIGRATION, /insert into public\.feature_flags[^;]*'company-admin', 'off'/);
});

test('migration: RLS on every table, reads only, writes through checked functions', () => {
  const tables = [...MIGRATION.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(tables.sort(), ['organization_activity', 'organization_invites', 'organization_members', 'organizations']);
  for (const t of tables) assert.match(MIGRATION, new RegExp(`alter table public\\.${t}\\s+enable row level security`));
  const policies = [...MIGRATION.matchAll(/create policy \w+ on public\.\w+\s+for (\w+)/g)].map((m) => m[1]);
  assert.ok(policies.length >= 4);
  assert.deepEqual([...new Set(policies)], ['select']);
  assert.match(MIGRATION, /revoke insert, update, delete, truncate on public\.organizations/);
  // Every SECURITY DEFINER function pins search_path.
  const definers = MIGRATION.split(/create or replace function/).slice(1).filter((f) => /security definer/.test(f));
  assert.ok(definers.length >= 15);
  for (const f of definers) assert.match(f, /set search_path = ''/, f.slice(0, 80));
  // Nothing here may set seat_limit or billing_status from the app.
  assert.doesNotMatch(MIGRATION, /update public\.organizations set (seat_limit|billing_status)/);
});
