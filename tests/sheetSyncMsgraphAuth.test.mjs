// Microsoft sign-in helpers for the sheet-sync server job (fake token endpoint).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MSGRAPH_SCOPES, buildMsgraphAuthorizeUrl, exchangeMsgraphCode, msgraphAuthConfigFromEnv,
  refreshMsgraphToken,
} from '../supabase/functions/_shared/sheetSync/msgraphAuth.js';

const env = (values) => (name) => values[name];
const CONFIG = msgraphAuthConfigFromEnv(env({
  MS_GRAPH_CLIENT_SECRET: 'shh', MS_GRAPH_REDIRECT_URI: 'https://x.supabase.co/functions/v1/msgraph-connect',
}));

function tokenEndpoint(reply, status = 200) {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, form: Object.fromEntries(new URLSearchParams(init.body)) });
    return { ok: status < 300, status, json: async () => reply };
  };
  return { fetch, seen };
}

test('stays off until the secret and a https callback are set', () => {
  assert.equal(msgraphAuthConfigFromEnv(env({})), null);
  assert.equal(msgraphAuthConfigFromEnv(env({ MS_GRAPH_CLIENT_SECRET: 'shh' })), null);
  assert.equal(msgraphAuthConfigFromEnv(env({ MS_GRAPH_CLIENT_SECRET: 'shh', MS_GRAPH_REDIRECT_URI: 'ftp://x' })), null);
  assert.equal(CONFIG.clientId, '0da81a9e-2b05-46ee-b826-5efc5114c765');
  assert.equal(CONFIG.tokenUrl, 'https://login.microsoftonline.com/common/oauth2/v2.0/token');
  assert.equal(CONFIG.graphBase, 'https://graph.microsoft.com/v1.0');
  // The sheet-sync function passes its own callback when the env names none.
  assert.equal(msgraphAuthConfigFromEnv(env({ MS_GRAPH_CLIENT_SECRET: 'shh' }), { redirectUri: 'https://x/cb' }).redirectUri, 'https://x/cb');
});

test('the sign-in link asks to stay signed in, for files only', () => {
  const url = new URL(buildMsgraphAuthorizeUrl(CONFIG, 'st', { loginHint: 'pm@contoso.com' }));
  assert.equal(url.origin + url.pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  assert.equal(url.searchParams.get('scope'), 'offline_access User.Read Files.ReadWrite.All');
  assert.equal(url.searchParams.get('redirect_uri'), CONFIG.redirectUri);
  assert.equal(url.searchParams.get('state'), 'st');
  assert.equal(url.searchParams.get('login_hint'), 'pm@contoso.com');
  assert.equal(MSGRAPH_SCOPES.includes('Sites.ReadWrite.All'), false);
});

test('code exchange needs a refresh token; refresh keeps the old one if none comes back', async () => {
  const now = () => 1_000_000;
  const good = tokenEndpoint({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600, scope: 'Files.ReadWrite.All User.Read' });
  const got = await exchangeMsgraphCode(CONFIG, 'code1', { fetch: good.fetch, now });
  assert.deepEqual(got, { accessToken: 'a1', refreshToken: 'r1', expiresAt: 1_000_000 + 3540_000, scopes: ['Files.ReadWrite.All', 'User.Read'] });
  assert.equal(good.seen[0].form.grant_type, 'authorization_code');
  assert.equal(good.seen[0].form.client_secret, 'shh');

  const noOffline = tokenEndpoint({ access_token: 'a1', expires_in: 3600 });
  await assert.rejects(exchangeMsgraphCode(CONFIG, 'c', { fetch: noOffline.fetch }), (e) => e.code === 'no_refresh_token');

  const refresh = tokenEndpoint({ access_token: 'a2', expires_in: 3600 });
  const next = await refreshMsgraphToken(CONFIG, 'r1', { fetch: refresh.fetch, now });
  assert.equal(next.refreshToken, 'r1');
  assert.equal(refresh.seen[0].form.refresh_token, 'r1');
});

test('an ended sign-in says to reconnect (401) so the runner marks the link', async () => {
  const ended = tokenEndpoint({ error: 'invalid_grant' }, 400);
  await assert.rejects(refreshMsgraphToken(CONFIG, 'r1', { fetch: ended.fetch }), (e) => e.status === 401 && e.code === 'reconnect');
  const other = tokenEndpoint({ error: 'invalid_client' }, 401);
  await assert.rejects(refreshMsgraphToken(CONFIG, 'r1', { fetch: other.fetch }), (e) => e.code === 'invalid_client');
});
