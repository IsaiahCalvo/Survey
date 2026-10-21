#!/usr/bin/env node
// Weekly backup of stored files into the private storage-backup bucket
// (supabase/migrations/20261022060000_storage_backup_bucket.sql). Copies are
// server side, so no file leaves Supabase.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/storage-backup.mjs [--dry-run]
//   ... node scripts/storage-backup.mjs --restore documents/<user id>/   # put files back
//
// Each object lands at <bucket>/<path>. New and changed objects are copied; a
// backup whose source is gone moves to _removed/<YYYY-MM-DD>/<bucket>/<path>
// and is purged after RETAIN_DAYS. The repo is public and the workflow log is
// too, so this prints counts only, never paths.
import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';

export const BACKUP_BUCKET = 'storage-backup';
export const RETAIN_DAYS = 30;
const REMOVED = '_removed/';
// A refreshed copy lands here first, so a failed copy never costs the old one.
const STAGING = '_staging/';
const PAGE = 1000;
const BATCH = 100;

/** What to copy, retire and purge, from one inventory of every bucket. */
export function planBackup(inventory, today = new Date()) {
  const sources = inventory.filter((o) => o.bucket_id !== BACKUP_BUCKET);
  const backups = new Map(inventory.filter((o) => o.bucket_id === BACKUP_BUCKET).map((o) => [o.name, o]));

  const copy = [];
  const wanted = new Set();
  for (const src of sources) {
    const key = `${src.bucket_id}/${src.name}`;
    wanted.add(key);
    const kept = backups.get(key);
    const stale = !kept || Number(kept.size) !== Number(src.size) || new Date(kept.updated_at) < new Date(src.updated_at);
    if (stale) copy.push({ bucket: src.bucket_id, name: src.name, key, replace: Boolean(kept) });
  }

  const day = today.toISOString().slice(0, 10);
  const cutoff = new Date(today.getTime() - RETAIN_DAYS * 86_400_000).toISOString().slice(0, 10);
  const retire = [];
  const purge = [];
  for (const name of backups.keys()) {
    // Leftover from a run that stopped mid-refresh; that file is refreshed again.
    if (name.startsWith(STAGING)) {
      purge.push(name);
    } else if (name.startsWith(REMOVED)) {
      const removedOn = name.slice(REMOVED.length, REMOVED.length + 10);
      if (removedOn < cutoff) purge.push(name);
    } else if (!wanted.has(name)) {
      retire.push({ from: name, to: `${REMOVED}${day}/${name}` });
    }
  }
  return { copy, retire, purge };
}

async function readInventory(admin) {
  const rows = [];
  for (;;) {
    const { data, error } = await admin.rpc('storage_backup_inventory').range(rows.length, rows.length + PAGE - 1);
    if (error) throw new Error(`inventory: ${error.message}`);
    if (!data?.length) return rows;
    rows.push(...data);
  }
}

async function removeAll(backup, names) {
  let failed = 0;
  for (let i = 0; i < names.length; i += BATCH) {
    const { error } = await backup.remove(names.slice(i, i + BATCH));
    if (error) failed += Math.min(BATCH, names.length - i);
  }
  return failed;
}

export async function runBackup(admin, { dryRun = false, today = new Date(), log = console.log } = {}) {
  const inventory = await readInventory(admin);
  const plan = planBackup(inventory, today);
  log(`[storage-backup] ${inventory.length} objects; copy ${plan.copy.length}, retire ${plan.retire.length}, purge ${plan.purge.length}${dryRun ? ' (dry run)' : ''}`);
  if (dryRun) return { ...plan, failed: 0 };

  const backup = admin.storage.from(BACKUP_BUCKET);
  let failed = 0;
  for (const item of plan.copy) {
    const target = item.replace ? `${STAGING}${item.key}` : item.key;
    if (item.replace) await backup.remove([target]);
    const { error } = await admin.storage.from(item.bucket).copy(item.name, target, { destinationBucket: BACKUP_BUCKET });
    if (error) {
      failed += 1;
      continue;
    }
    if (item.replace) {
      await backup.remove([item.key]);
      const { error: moveError } = await backup.move(target, item.key);
      if (moveError) failed += 1;
    }
  }
  for (const { from, to } of plan.retire) {
    // A file removed twice in one day: the newer copy wins.
    await backup.remove([to]);
    const { error } = await backup.move(from, to);
    if (error) failed += 1;
  }
  failed += await removeAll(backup, plan.purge);
  log(`[storage-backup] done; ${failed} failed`);
  return { ...plan, failed };
}

/**
 * Copy backups whose key starts with `prefix` (<bucket>/<path>, or
 * _removed/<date>/<bucket>/<path>) back to their bucket. Files that exist
 * there now are left alone.
 */
export async function restoreBackup(admin, prefix, { log = console.log } = {}) {
  // An empty or bucket-only prefix would bring back every deleted account's files.
  if (!/^(_removed\/\d{4}-\d{2}-\d{2}\/)?[^/_][^/]*\/[^/]+/.test(String(prefix || ''))) {
    throw new Error('--restore needs <bucket>/<folder or file>, e.g. documents/<user id>/');
  }
  const inventory = await readInventory(admin);
  const present = new Set(inventory.filter((o) => o.bucket_id !== BACKUP_BUCKET).map((o) => `${o.bucket_id}/${o.name}`));
  let restored = 0;
  let failed = 0;
  for (const { name } of inventory.filter((o) => o.bucket_id === BACKUP_BUCKET && o.name.startsWith(prefix))) {
    const key = name.startsWith(REMOVED) ? name.slice(REMOVED.length + 11) : name;
    if (present.has(key)) continue;
    const slash = key.indexOf('/');
    const { error } = await admin.storage.from(BACKUP_BUCKET)
      .copy(name, key.slice(slash + 1), { destinationBucket: key.slice(0, slash) });
    if (error) failed += 1;
    else restored += 1;
  }
  log(`[storage-backup] restored ${restored}; ${failed} failed`);
  return { restored, failed };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[storage-backup] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    process.exit(2);
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const restoreAt = process.argv.indexOf('--restore');
  const job = restoreAt > 0
    ? restoreBackup(admin, process.argv[restoreAt + 1] || '')
    : runBackup(admin, { dryRun: process.argv.includes('--dry-run') });
  job
    .then(({ failed }) => process.exit(failed ? 1 : 0))
    .catch((err) => {
      console.error(`[storage-backup] ${err.message}`);
      process.exit(1);
    });
}
