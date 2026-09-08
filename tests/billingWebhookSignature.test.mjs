import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

test('actual endpoint verifies raw signed events with the pinned Stripe SDK (offline Deno)', {
    skip: process.env.SURVEY_DENO_INTEGRATION !== '1', timeout: 60_000,
}, () => {
    // Dependencies must already be cached by a separate explicit Deno check.
    // Stripe probes process.env at import. The child gets no inherited secrets;
    // env permission exposes only these explicit cache/runtime paths. No network
    // or filesystem permissions and no project npm/lockfile changes.
    const result = spawnSync('deno', ['run', '--allow-env', '--no-config', '--node-modules-dir=none', '--no-lock', '--cached-only',
        'scripts/test-billing-webhook-signature-deno.ts'], {
        cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 45_000,
        env: { PATH: process.env.PATH, DENO_DIR: process.env.DENO_DIR ||
            (process.platform === 'darwin' ? resolve(homedir(), 'Library/Caches/deno') : resolve(homedir(), '.cache/deno')) },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /PASS 7 actual endpoint/);
});
