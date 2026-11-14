// Team page extras (flag team-plus): the CSV rules in src/teamPlus/teamCsv.js
// and the flag row in supabase/migrations/20261114140000_team_plus_flag.sql.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  csvCells, parseInviteCsv, csvRoleSummary, teamCsv, teamCsvFileName, INVITE_CSV_EXAMPLE, INVITE_CSV_MAX,
} from '../src/teamPlus/teamCsv.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test('cells split on commas, semicolons and tabs, and keep quoted commas', () => {
  assert.deepEqual(csvCells('a@b.co, Editor'), ['a@b.co', 'Editor']);
  assert.deepEqual(csvCells('"Lee, Sam";viewer'), ['Lee, Sam', 'viewer']);
  assert.deepEqual(csvCells('"say ""hi"""\tx'), ['say "hi"', 'x']);
});

test('the example file reads back as two people', () => {
  const { rows, problems } = parseInviteCsv(INVITE_CSV_EXAMPLE);
  assert.deepEqual(rows, [{ email: 'alex@example.com', role: 'Editor' }, { email: 'sam@example.com', role: 'Viewer' }]);
  assert.deepEqual(problems, []);
});

test('columns are found by header in any order; Drawboard role words map over', () => {
  const text = '﻿Name,Role,E-mail address\r\nAl,Collaborator,AL@Example.com\r\nBo,Reader,bo@example.com\r\nCy,Super collaborator,cy@example.com\r\n';
  assert.deepEqual(parseInviteCsv(text).rows, [
    { email: 'al@example.com', role: 'Editor' },
    { email: 'bo@example.com', role: 'Viewer' },
    { email: 'cy@example.com', role: 'Editor' },
  ]);
});

test('no header: first column email, second role; missing role takes the fallback', () => {
  const { rows } = parseInviteCsv('a@x.io\nb@x.io,viewer\n', { fallbackRole: 'Viewer' });
  assert.deepEqual(rows, [{ email: 'a@x.io', role: 'Viewer' }, { email: 'b@x.io', role: 'Viewer' }]);
});

test('bad lines are named, repeats dropped, unknown roles fall back with a note', () => {
  const { rows, problems } = parseInviteCsv('Email,Role\nnot-an-email,Editor\na@x.io,Owner\nA@x.io,Viewer\n');
  assert.deepEqual(rows, [{ email: 'a@x.io', role: 'Editor' }]);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /^Line 2: "not-an-email" is not an email address\.$/);
  assert.match(problems[1], /role "Owner" is not Viewer or Editor, so a@x.io gets Editor/);
  assert.deepEqual(parseInviteCsv('  \n').problems, ['The file is empty.']);
});

test('at most INVITE_CSV_MAX people at once', () => {
  const lines = Array.from({ length: INVITE_CSV_MAX + 5 }, (_, i) => `p${i}@x.io`).join('\n');
  const { rows, problems } = parseInviteCsv(lines);
  assert.equal(rows.length, INVITE_CSV_MAX);
  assert.match(problems.at(-1), /Only the first 200/);
});

test('role summary reads plainly', () => {
  assert.equal(csvRoleSummary([{ role: 'Editor' }, { role: 'Viewer' }, { role: 'Viewer' }]), '1 Editor and 2 Viewers');
  assert.equal(csvRoleSummary([]), 'nobody');
});

test('team list CSV quotes what needs it; file name is safe and dated', () => {
  const out = teamCsv([{ name: 'Lee, Sam', email: 's@x.io', role: 'Editor', status: 'Active', access: 'Company', added: 'Nov 14' }]);
  assert.equal(out, 'Name,Email,Role,Status,Access,Added\r\n"Lee, Sam",s@x.io,Editor,Active,Company,Nov 14\r\n');
  assert.equal(teamCsvFileName('Tower: A/B', new Date(2026, 10, 4)), 'Tower A B team 2026-11-04.csv');
  assert.equal(teamCsvFileName('', new Date(2026, 0, 9)), 'Project team 2026-01-09.csv');
});

test('flag is a Nightly beta flag with a starting-off row', () => {
  assert.equal(FEATURE_FLAGS['team-plus']?.stage, 'beta');
  const sql = readFileSync(new URL('../supabase/migrations/20261114140000_team_plus_flag.sql', import.meta.url), 'utf8');
  assert.match(sql, /'team-plus',\s*'off'/);
});
