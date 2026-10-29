// Microsoft sign-in for the sheet-sync server job. The person who links a workbook
// signs in once on the web; the server keeps their refresh token (encrypted) and gets
// short-lived Graph tokens from it, so phones and the web never need Microsoft.
//
// Confidential client (authorization code + client secret). Inert until the secret
// is set: msgraphAuthConfigFromEnv returns null and callers say "not set up yet".
//
// Environment:
//   MS_GRAPH_CLIENT_SECRET   required; a client secret on the Azure app
//   MS_GRAPH_REDIRECT_URI    required; this server's callback, registered on the app
//   MS_GRAPH_CLIENT_ID       optional; defaults to Survey's Azure app
//   MS_GRAPH_TENANT          optional; defaults to 'common'

const LOGIN = 'https://login.microsoftonline.com';
const SURVEY_AZURE_APP = '0da81a9e-2b05-46ee-b826-5efc5114c765';
// Files the person can open (their own and shared work files); no SharePoint site list.
export const MSGRAPH_SCOPES = Object.freeze(['offline_access', 'User.Read', 'Files.ReadWrite.All']);
const STATE_TTL_MS = 10 * 60 * 1000;

export function msgraphAuthConfigFromEnv(get) {
  const read = (name) => String(get(name) ?? '').trim();
  const clientSecret = read('MS_GRAPH_CLIENT_SECRET');
  const redirectUri = read('MS_GRAPH_REDIRECT_URI');
  if (!clientSecret || !/^https:\/\//.test(redirectUri)) return null;
  return {
    clientId: read('MS_GRAPH_CLIENT_ID') || SURVEY_AZURE_APP,
    clientSecret,
    redirectUri,
    tenant: read('MS_GRAPH_TENANT') || 'common',
  };
}

export function buildMsgraphAuthorizeUrl(config, state, { loginHint } = {}) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    response_mode: 'query',
    scope: MSGRAPH_SCOPES.join(' '),
    state,
    prompt: 'select_account',
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${LOGIN}/${encodeURIComponent(config.tenant)}/oauth2/v2.0/authorize?${params}`;
}

async function tokenRequest(config, fields, fetchImpl) {
  const response = await fetchImpl(`${LOGIN}/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: MSGRAPH_SCOPES.join(' '),
      ...fields,
    }).toString(),
  });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok || !body?.access_token) {
    const code = body?.error || 'token_failed';
    // invalid_grant: the person revoked access, changed password, or the token aged out.
    const error = new Error(code === 'invalid_grant'
      ? 'The Microsoft sign-in for this sheet has ended. Connect Microsoft again.'
      : `Microsoft sign-in failed (${code}).`);
    error.status = code === 'invalid_grant' ? 401 : (response.status || 500);
    error.code = code === 'invalid_grant' ? 'reconnect' : code;
    throw error;
  }
  return body;
}

function tokens(body, now, previousRefreshToken = null) {
  return {
    accessToken: body.access_token,
    // Microsoft usually hands back a new refresh token; keep the old one if not.
    refreshToken: body.refresh_token || previousRefreshToken,
    expiresAt: now() + Math.max(0, (Number(body.expires_in) || 3600) - 60) * 1000,
    scopes: String(body.scope || '').split(' ').filter(Boolean),
  };
}

export async function exchangeMsgraphCode(config, code, { fetch: fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const body = await tokenRequest(config, { grant_type: 'authorization_code', code, redirect_uri: config.redirectUri }, fetchImpl);
  if (!body.refresh_token) {
    throw Object.assign(new Error('Microsoft did not allow staying signed in (offline access).'), { status: 400, code: 'no_refresh_token' });
  }
  return tokens(body, now);
}

export async function refreshMsgraphToken(config, refreshToken, { fetch: fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const body = await tokenRequest(config, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetchImpl);
  return tokens(body, now, refreshToken);
}

/** The signed-in Microsoft account, for the "Connected as" line. */
export async function fetchMsgraphAccount(accessToken, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw Object.assign(new Error('Could not read the Microsoft account.'), { status: response.status });
  const me = await response.json();
  return { id: me.id, name: me.displayName || null, email: me.mail || me.userPrincipalName || null };
}

// --- The OAuth "state": who started the sign-in, signed so the callback can trust it.

const encoder = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(key, data) {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)));
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** @param {{ userId: string, returnTo?: string }} payload */
export async function signConnectState(payload, key, { now = Date.now } = {}) {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const body = b64url(encoder.encode(JSON.stringify({ ...payload, exp: now() + STATE_TTL_MS, nonce })));
  return `${body}.${b64url(await hmac(key, body))}`;
}

/** The payload, or null when the state is forged, changed or older than 10 minutes. */
export async function verifyConnectState(state, key, { now = Date.now } = {}) {
  const [body, signature] = String(state || '').split('.');
  if (!body || !signature) return null;
  try {
    if (!sameBytes(fromB64url(signature), await hmac(key, body))) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (!payload?.userId || !(payload.exp > now())) return null;
    return payload;
  } catch {
    return null;
  }
}
