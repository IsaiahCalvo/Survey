import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import viteConfig from '../vite.config.js';
import { resolveViteConfigEnv } from '../viteEnvConfig.mjs';

test('dev-auth relay rejects every email except its exact configured owner', async () => {
  const emptyEnvRoot = await mkdtemp(join(tmpdir(), 'survey-vite-env-contract-'));
  try {
    const env = resolveViteConfigEnv('development', emptyEnvRoot, {
      VITE_SUPABASE_URL: 'https://test-project.invalid',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    });

    const previous = Object.fromEntries([
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SURVEY_DEV_AUTH_EMAIL',
    ].map((name) => [name, process.env[name]]));
    Object.assign(process.env, {
      VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
      SURVEY_DEV_AUTH_EMAIL: 'owner@example.test',
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
    assert.equal(JSON.parse(config.define.__DEV_AUTH_RELAY_ENABLED__), true);
    assert.doesNotMatch(JSON.stringify(config.define), /test-service-role-key/);
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

    const request = Readable.from([JSON.stringify({ email: 'attacker@example.test' })]);
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

    assert.equal(response.statusCode, 403);
    assert.deepEqual(JSON.parse(response.body), { error: 'forbidden' });
  } finally {
    await rm(emptyEnvRoot, { recursive: true, force: true });
  }
});

test('eraser harness disables the machine-persistent owner login', async () => {
  const viteSource = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(viteSource, /process\.env\.SURVEY_DEV_AUTH_DISABLED === '1'/);
  const eraserConfig = await readFile(
    new URL('../playwright.eraser-permissions.config.mjs', import.meta.url),
    'utf8',
  );
  assert.match(eraserConfig, /SURVEY_DEV_AUTH_DISABLED:\s*'1'/);
});
