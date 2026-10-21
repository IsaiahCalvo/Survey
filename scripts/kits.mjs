#!/usr/bin/env node
/**
 * Publish a kit and give it to a customer account (custom builds library).
 * Runs with the service-role key, so nothing in the browser can write kits.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/kits.mjs <command>
 *
 *   publish <kit.json>                  add a kit version (kits never change; bump the version)
 *   assign <email> <kit-id> <version>   give that version to the account (replaces its older one)
 *   unassign <email> <kit-id>           take the kit away from the account
 *   list                                every assignment, by email
 *
 * A kit file is the same JSON shape as src/services/exportFormats/kits/*.js.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { validateExportKit, BUILT_IN_EXPORT_KIT_IDS } from '../src/services/exportFormats/registry.js';
import { validateAnswerSet } from '../src/services/answerSets.js';

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function userIdByEmail(admin, email) {
  const wanted = String(email).trim().toLowerCase();
  for (let page = 1; ; page += 1) {
    const { users } = await must('list users', admin.auth.admin.listUsers({ page, perPage: 1000 }));
    const hit = users.find((u) => (u.email || '').toLowerCase() === wanted);
    if (hit) return hit.id;
    if (users.length < 1000) throw new Error(`no account with email ${email}`);
  }
}

export async function publishKit(admin, kit) {
  const errors = validateExportKit(kit);
  if (kit.answerSet !== undefined) errors.push(...validateAnswerSet(kit.answerSet));
  if (errors.length) throw new Error(`kit is not valid: ${errors.join('; ')}`);
  if (BUILT_IN_EXPORT_KIT_IDS.includes(kit.id)) throw new Error(`${kit.id} is built into the app; pick another id`);
  const { id, version, kind, label = '', ...rest } = kit;
  await must('publish', admin.from('kits').insert({ id, version, kind, label, definition: { ...rest, label } }));
  return { id, version };
}

export async function assignKit(admin, email, kitId, version) {
  const userId = await userIdByEmail(admin, email);
  await must('assign', admin.from('account_kits').upsert({ user_id: userId, kit_id: kitId, kit_version: version }));
  return { userId };
}

export async function unassignKit(admin, email, kitId) {
  const userId = await userIdByEmail(admin, email);
  await must('unassign', admin.from('account_kits').delete().eq('user_id', userId).eq('kit_id', kitId));
}

export async function listAssignments(admin) {
  const rows = await must('list', admin.from('account_kits').select('user_id, kit_id, kit_version').order('kit_id'));
  const emails = new Map();
  for (let page = 1; ; page += 1) {
    const { users } = await must('list users', admin.auth.admin.listUsers({ page, perPage: 1000 }));
    users.forEach((u) => emails.set(u.id, u.email));
    if (users.length < 1000) break;
  }
  return rows.map((r) => ({ email: emails.get(r.user_id) || r.user_id, kit: `${r.kit_id}@${r.kit_version}` }));
}

async function main([command, ...args]) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  if (command === 'publish' && args[0]) {
    const kit = await publishKit(admin, JSON.parse(readFileSync(args[0], 'utf8')));
    console.log(`published ${kit.id}@${kit.version}`);
  } else if (command === 'assign' && args.length === 3) {
    await assignKit(admin, ...args);
    console.log(`gave ${args[1]}@${args[2]} to ${args[0]}`);
  } else if (command === 'unassign' && args.length === 2) {
    await unassignKit(admin, ...args);
    console.log(`took ${args[1]} from ${args[0]}`);
  } else if (command === 'list') {
    (await listAssignments(admin)).forEach((r) => console.log(`${r.email}\t${r.kit}`));
  } else {
    throw new Error('usage: publish <kit.json> | assign <email> <kit-id> <version> | unassign <email> <kit-id> | list');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });
}
