import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import viteConfig from '../vite.config.js';
import { resolveViteConfigEnv } from '../viteEnvConfig.mjs';

test('eraser E2E process credentials reach dev-auth without local env files', async () => {
  const emptyEnvRoot = await mkdtemp(join(tmpdir(), 'survey-vite-env-contract-'));
  try {
    const env = resolveViteConfigEnv('development', emptyEnvRoot, {
      VITE_SUPABASE_URL: 'https://test-project.invalid',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    });
    assert.equal(env.VITE_SUPABASE_URL, 'https://test-project.invalid');
    assert.equal(env.VITE_SUPABASE_ANON_KEY, 'test-anon-key');
    assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, 'test-service-role-key');

    const previous = Object.fromEntries([
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ].map((name) => [name, process.env[name]]));
    Object.assign(process.env, {
      VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    });
    let config;
    try {
      config = await viteConfig({ mode: 'development', command: 'serve' });
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value == null) delete process.env[name];
        else process.env[name] = value;
      }
    }
    const devAuthPlugin = config.plugins
      .flat(Infinity)
      .find((plugin) => plugin?.name === 'dev-auth-bootstrap');
    assert.ok(devAuthPlugin);
    const bootstrapToken = JSON.parse(config.define.__DEV_AUTH_BOOTSTRAP_TOKEN__);

    let route = null;
    let middleware = null;
    devAuthPlugin.configureServer({
      middlewares: {
        use(nextRoute, nextMiddleware) {
          route = nextRoute;
          middleware = nextMiddleware;
        },
      },
    });
    assert.equal(route, '/__dev-auth/session');
    assert.equal(typeof middleware, 'function');

    const request = Readable.from([JSON.stringify({ email: ' ' })]);
    request.method = 'POST';
    request.headers = { 'x-dev-auth-bootstrap': bootstrapToken };
    const response = {
      statusCode: null,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      end(body) {
        this.body = body;
      },
    };

    await middleware(request, response);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), { error: 'email_required' });
  } finally {
    await rm(emptyEnvRoot, { recursive: true, force: true });
  }
});
