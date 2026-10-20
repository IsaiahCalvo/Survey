#!/usr/bin/env node
// Fails a pull request that adds a migration numbered at or before the newest
// migration already on the base branch. `supabase db push` refuses such a file
// ("Found local migration files to be inserted before the last migration on
// remote database"), which stops every production deploy at the migration
// step. That happened on 2026-10-20 (#879 vs #877). Fix: rename the new file
// to a timestamp later than the one this check names.
//
//   node scripts/check-migration-order.mjs [baseRef]   (default origin/main)
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const MIGRATION = /^(\d{14})_[^/]+\.sql$/;

export function findOutOfOrderMigrations(baseFiles, addedFiles) {
  const versions = (files) => files.map((f) => basename(f)).filter((n) => MIGRATION.test(n)).sort();
  const base = versions(baseFiles);
  const newest = base[base.length - 1] || '';
  const newestVersion = newest.slice(0, 14);
  const late = versions(addedFiles).filter((n) => !base.includes(n) && n.slice(0, 14) <= newestVersion);
  return { newest, late };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const baseRef = process.argv[2] || 'origin/main';
  const dir = 'supabase/migrations/';
  const baseFiles = git(['ls-tree', '--name-only', baseRef, dir]);
  const added = git(['diff', '--name-only', '--diff-filter=A', baseRef, 'HEAD', '--', dir]);
  const { newest, late } = findOutOfOrderMigrations(baseFiles, added);
  if (late.length) {
    console.error(`These new migrations sort at or before ${newest}, the newest on ${baseRef}:`);
    for (const name of late) console.error(`  ${name}`);
    console.error('supabase db push would refuse them and block production deploys. Rename each to a later timestamp.');
    process.exit(1);
  }
  console.log(`Migration order OK (${added.length} new; newest on ${baseRef} is ${newest || 'none'}).`);
}
