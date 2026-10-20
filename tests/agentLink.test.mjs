import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('agent link waits for the session before Allow', () => {
  const src = read('src/home/AgentLinkPage.jsx');
  assert.match(src, /if \(auth\.loading \|\| !user\) return;/);
  assert.match(src, /if \(auth\.loading\) \{/);
  assert.doesNotMatch(src, /if \(!auth\.loading && !user\)/);
  assert.ok(src.indexOf('if (auth.loading) {') < src.indexOf('>Allow<'), 'settle before the Allow form');
});

test('agent code input keeps 8 upper-case letters and numbers', async () => {
  const src = read('src/home/AgentLinkPage.jsx');
  const body = src.match(/export function normalizeAgentCode\(value\) \{([\s\S]*?)\n\}/)[1];
  const normalizeAgentCode = new Function('value', body);
  assert.equal(normalizeAgentCode('abcd-2345'), 'ABCD2345');
  assert.equal(normalizeAgentCode(' ab cd 23 45 67 '), 'ABCD2345');
  assert.equal(normalizeAgentCode(null), '');
});

test('migration keeps agent secrets private', () => {
  const sql = read('supabase/migrations/20261020200000_agent_links.sql');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.agent_links from public, anon, authenticated/);
  const grant = sql.match(/grant select \(([^)]*)\)\s+on public\.agent_links to authenticated/);
  assert.ok(grant, 'column-limited select grant');
  for (const secret of ['device_code_hash', 'token_hash', 'user_code']) {
    assert.ok(!grant[1].includes(secret), `${secret} is not readable by users`);
  }
  assert.match(sql, /code_expires_at > now\(\)/);
  assert.match(sql, /user_id = auth\.uid\(\)/);
});

test('agent-auth stores only hashes and is wired to deploy', () => {
  const fn = read('supabase/functions/agent-auth/index.ts');
  assert.match(fn, /device_code_hash: await sha256\(deviceCode\)/);
  assert.match(fn, /token_hash: await sha256\(token\)/);
  assert.ok(!/device_code: deviceCode,\s*\n\s*user_code: userCode,\s*\n\s*device_code_hash/.test(fn));
  assert.match(read('supabase/config.toml'), /\[functions\.agent-auth\]\nverify_jwt = false/);
  assert.match(read('.github/workflows/deploy-production.yml'), /\n\s+agent-auth\n/);
  assert.match(read('src/main.jsx'), /\/agent-link/);
  assert.match(read('public/auth.md'), /functions\/v1\/agent-auth/);
  assert.match(read('supabase/functions/agent-auth/index.ts'), /agent-link\?user_code=/);
});

test('refresh keys: hashed, one use, cleared on remove', () => {
  const fn = read('supabase/functions/agent-auth/index.ts');
  assert.match(fn, /refresh_token_hash: await sha256\(refresh\)/);
  assert.match(fn, /\.eq\('refresh_token_hash', oldHash\)\s*\n\s*\.select\('id'\)/, 'swap only if the old key is still current');
  assert.match(fn, /REFRESH_TTL_SECONDS = 30 \* 24 \* 3600/);
  const sql = read('supabase/migrations/20261020220000_agent_link_refresh.sql');
  assert.match(sql, /refresh_token_hash = null/);
  assert.ok(!/grant select[^;]*refresh_token_hash/.test(sql), 'users never read refresh hashes');
});
