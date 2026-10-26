import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertNoProdEnv,
  guardContext,
  isLoopbackUrl,
} from '../agent-cli/lib/blockNonLoopback.mjs';

function listMjs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listMjs(full);
    return entry.name.endsWith('.mjs') ? [full] : [];
  });
}

test('every agent-cli harness that creates a browser context guards it', () => {
  const offenders = [];
  for (const file of listMjs('agent-cli')) {
    if (file.endsWith(path.join('lib', 'blockNonLoopback.mjs'))) continue;
    const source = fs.readFileSync(file, 'utf8');
    const creates = (source.match(/\.(?:newContext|launchPersistentContext)\(/g) || []).length;
    if (!creates) continue;
    const imports = /import\s*\{[^}]*\bguardContext\b[^}]*\}\s*from\s*['"][./]+(?:[\w-]+\/)*lib\/blockNonLoopback\.mjs['"]/.test(source);
    const wrapped = (source.match(/guardContext\(\s*[\w.]+\.(?:newContext|launchPersistentContext)\(/g) || []).length;
    if (!imports || wrapped < creates) offenders.push(`${file} (creates ${creates}, guarded ${wrapped}, import ${imports})`);
  }
  assert.deepEqual(offenders, []);
});

test('isLoopbackUrl allows loopback and rejects other hosts', () => {
  for (const url of ['http://127.0.0.1:5173/x', 'http://localhost/', 'http://[::1]:3000/', 'data:text/plain,hi']) {
    assert.equal(isLoopbackUrl(url), true, url);
  }
  for (const url of ['https://cvamwtpsuvxvjdnotbeg.supabase.co/rest/v1/x', 'https://claude.com/', 'http://127.0.0.2/', 'http://localhost.evil.com/', 'not a url']) {
    assert.equal(isLoopbackUrl(url), false, url);
  }
});

test('guardContext registers a route that aborts non-loopback and passes loopback through', async () => {
  const routes = [];
  const context = { route: async (matcher, handler) => routes.push({ matcher, handler }) };
  assert.equal(await guardContext(Promise.resolve(context)), context);
  assert.equal(await guardContext(null), null);
  assert.equal(routes.length, 1);
  const [{ matcher, handler }] = routes;
  assert.equal(matcher(new URL('http://127.0.0.1:4000/src/entry.jsx')), false);
  assert.equal(matcher(new URL('http://localhost:4000/')), false);
  assert.equal(matcher(new URL('https://cvamwtpsuvxvjdnotbeg.supabase.co/auth/v1/user')), true);
  let aborted = null;
  await handler({ abort: async (reason) => { aborted = reason; } });
  assert.equal(aborted, 'blockedbyclient');
});

test('assertNoProdEnv throws on a prod or remote Supabase URL and passes loopback/absent', () => {
  const noFiles = { files: [] };
  assert.throws(() => assertNoProdEnv({ ...noFiles, env: { VITE_SUPABASE_URL: 'https://cvamwtpsuvxvjdnotbeg.supabase.co' } }), /not loopback/);
  assert.throws(() => assertNoProdEnv({ ...noFiles, env: { VITE_SUPABASE_URL: 'https://other.supabase.co' } }), /not loopback/);
  assert.doesNotThrow(() => assertNoProdEnv({ ...noFiles, env: {} }));
  assert.doesNotThrow(() => assertNoProdEnv({ ...noFiles, env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54321' } }));

  const files = { '/repo/.env': 'FOO=1\nVITE_SUPABASE_URL="https://cvamwtpsuvxvjdnotbeg.supabase.co"\n' };
  const readFile = (file) => {
    if (file in files) return files[file];
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  };
  assert.throws(() => assertNoProdEnv({ env: {}, files: ['/repo/.env', '/repo/.env.local'], readFile }), /\/repo\/\.env/);
  assert.doesNotThrow(() => assertNoProdEnv({ env: {}, files: ['/repo/.env.local'], readFile }));
});
