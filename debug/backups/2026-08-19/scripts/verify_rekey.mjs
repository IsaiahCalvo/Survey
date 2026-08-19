// READ-ONLY: for every planned rekey move, download the SOURCE object and check
// its real sha256 equals the row's content_sha256. Catches KAL-443 fake fingerprints.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadEnv } from './agent-cli/lib/env.mjs';
loadEnv();
const url = (process.env.SUPABASE_MAINT_URL || process.env.VITE_SUPABASE_URL).replace(/\/+$/, '');
const key = process.env.SUPABASE_MAINT_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}` };
const plan = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const moves = plan.moved || plan.rekeyMoves || [];
const out = { checked: 0, match: [], mismatch: [], missing: [], destExists: [] };
for (const m of moves) {
  const res = await fetch(`${url}/storage/v1/object/documents/${m.from}`, { headers: H });
  if (!res.ok) { out.missing.push(m.from); continue; }
  const sha = createHash('sha256').update(new Uint8Array(await res.arrayBuffer())).digest('hex');
  out.checked++;
  (sha === m.sha ? out.match : out.mismatch).push({ id: m.id, from: m.from, recorded: m.sha, actual: sha });
  const d = await fetch(`${url}/storage/v1/object/documents/${m.to}?cb=${Date.now()}`, { headers: { ...H, Range: 'bytes=0-0' } });
  if (d.status === 200 || d.status === 206) out.destExists.push(m.to);
}
writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
console.log(`checked=${out.checked} match=${out.match.length} MISMATCH=${out.mismatch.length} missingSource=${out.missing.length} destinationAlreadyExists=${out.destExists.length}`);
if (out.mismatch.length) console.log(JSON.stringify(out.mismatch, null, 1));
