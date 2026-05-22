// Insert / upsert user_subscriptions rows for the four disposable users.
import { admin } from './admin-client.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const users = JSON.parse(
  readFileSync(new URL('../logs/area-02-users.json', import.meta.url), 'utf8')
).users;

// Inspect the table once
const probe = await admin.from('user_subscriptions').select('*').limit(1);
console.log('probe columns sample:', probe.data?.[0] ? Object.keys(probe.data[0]) : '(empty)', 'err=', probe.error?.message);

const out = [];
for (const u of users) {
  // Upsert
  const row = {
    user_id: u.userId,
    tier: u.role,
    status: 'active'
  };
  const { data, error } = await admin
    .from('user_subscriptions')
    .upsert(row, { onConflict: 'user_id' })
    .select();
  out.push({ ...u, upsert: error ? { error: error.message } : { ok: true, row: data?.[0] } });
}

writeFileSync(new URL('../logs/area-02-tiers.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
