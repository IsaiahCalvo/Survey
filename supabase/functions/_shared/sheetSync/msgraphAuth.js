// Microsoft sign-in for the sheet-sync server job. The person who links a workbook
// signs in once on the web; the server keeps their refresh token (encrypted) and gets
// short-lived Graph tokens from it, so phones and the web never need Microsoft.
//
// Confidential client (authorization code + client secret). Inert until the secret
// is set: msgraphAuthConfigFromEnv returns null and callers say "not set up yet".
//
// Environment:
//   MS_GRAPH_CLIENT_SECRET   required; a client secret on the Azure app
//   MS_GRAPH_REDIRECT_URI    this server's callback, registered on the app
//                            (the sheet-sync function passes its own default)
//   MS_GRAPH_CLIENT_ID       optional; defaults to Survey's Azure app
//   MS_GRAPH_TENANT          optional; defaults to 'common'
//   MS_GRAPH_AUTHORIZE_URL, MS_GRAPH_TOKEN_URL, MS_GRAPH_ADMIN_CONSENT_URL, MS_GRAPH_API_BASE
//                            optional; only the e2e fake sets them

const LOGIN = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SURVEY_AZURE_APP = '0da81a9e-2b05-46ee-b826-5efc5114c765';
// Files the person can open (their own and shared work files); no SharePoint site list.
export const MSGRAPH_SCOPES = Object.freeze(['offline_access', 'User.Read', 'Files.ReadWrite.All']);

export function msgraphAuthConfigFromEnv(get, { redirectUri: defaultRedirect = '' } = {}) {
  const read = (name) => String(get(name) ?? '').trim();
  const clientSecret = read('MS_GRAPH_CLIENT_SECRET');
  const redirectUri = read('MS_GRAPH_REDIRECT_URI') || defaultRedirect;
  if (!clientSecret || !/^https?:\/\//.test(redirectUri)) return null;
  const tenant = encodeURIComponent(read('MS_GRAPH_TENANT') || 'common');
  return {
    clientId: read('MS_GRAPH_CLIENT_ID') || SURVEY_AZURE_APP,
    clientSecret,
    redirectUri,
    authorizeUrl: read('MS_GRAPH_AUTHORIZE_URL') || `${LOGIN}/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: read('MS_GRAPH_TOKEN_URL') || `${LOGIN}/${tenant}/oauth2/v2.0/token`,
    // Any work or school directory ('common' would also let personal accounts in).
    adminConsentUrl: read('MS_GRAPH_ADMIN_CONSENT_URL') || `${LOGIN}/${tenant === 'common' ? 'organizations' : tenant}/v2.0/adminconsent`,
    graphBase: (read('MS_GRAPH_API_BASE') || GRAPH).replace(/\/$/, ''),
  };
}

// Home-email services: a Survey account on one of these is never the person's
// work Microsoft account, and hinting it sends Microsoft to a personal account.
const CONSUMER_MAIL = /@(gmail|googlemail|outlook|hotmail|live|msn|icloud|me|mac|yahoo|ymail|aol|proton|protonmail|pm|gmx|mail|yandex|zoho)\.[a-z.]+$/i;

/** A work-looking email to prefill on Microsoft's page, or '' for a home one. */
export function workLoginHint(email) {
  const e = String(email || '').trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !CONSUMER_MAIL.test(e) ? e : '';
}

// No forced account picker: someone already signed in to one work account goes
// straight through (one click fewer). `pickAccount` asks Microsoft for the
// picker, for the "Use another account" retry after a personal account.
export function buildMsgraphAuthorizeUrl(config, state, { loginHint, pickAccount = false } = {}) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    response_mode: 'query',
    scope: MSGRAPH_SCOPES.join(' '),
    state,
  });
  if (pickAccount) params.set('prompt', 'select_account');
  const hint = workLoginHint(loginHint);
  if (hint && !pickAccount) params.set('login_hint', hint);
  return `${config.authorizeUrl}?${params}`;
}

/**
 * The page a company's Microsoft admin opens to approve Survey for everyone
 * at once, for companies that do not let staff approve apps themselves
 * ("Need admin approval"). Microsoft sends the admin back to the same
 * callback with admin_consent=True.
 */
export function buildMsgraphAdminConsentUrl(config, state) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: MSGRAPH_SCOPES.filter((sc) => sc !== 'offline_access').map((sc) => `https://graph.microsoft.com/${sc}`).join(' '),
    state,
  });
  return `${config.adminConsentUrl}?${params}`;
}

// Token errors that need the person to sign in again in a browser: the
// sign-in ended (invalid_grant: revoked, password reset by an admin, unused
// for 90 days, consent taken back), or their company now asks for a fresh
// sign-in or MFA (interaction_required: sign-in frequency, Conditional Access).
const SIGN_IN_AGAIN = new Set(['invalid_grant', 'interaction_required', 'consent_required', 'login_required']);
// Survey's own Azure app is the problem (its secret expired or was changed):
// never the person's fault, and their sign-in must not be thrown away.
const APP_PROBLEM = new Set(['invalid_client', 'unauthorized_client']);

async function tokenRequest(config, fields, fetchImpl) {
  const response = await fetchImpl(config.tokenUrl, {
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
    if (SIGN_IN_AGAIN.has(code)) {
      const error = new Error(code === 'interaction_required' || code === 'login_required'
        ? 'Your company asks you to sign in to Microsoft again. Connect Microsoft again.'
        : 'The Microsoft sign-in for this sheet has ended. Connect Microsoft again.');
      error.status = 401;
      error.code = 'reconnect';
      error.reason = code;
      throw error;
    }
    if (APP_PROBLEM.has(code)) {
      const error = new Error('Microsoft sign-in is down on Survey\'s side. Nothing to do on yours; it starts again on its own once fixed.');
      error.status = 503;
      error.code = 'app_setup';
      error.reason = code;
      throw error;
    }
    const error = new Error(`Microsoft sign-in failed (${code}).`);
    error.status = response.status || 500;
    error.code = code;
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
export async function fetchMsgraphAccount(accessToken, { fetch: fetchImpl = globalThis.fetch, graphBase = GRAPH } = {}) {
  const response = await fetchImpl(`${graphBase}/me?$select=id,displayName,mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw Object.assign(new Error('Could not read the Microsoft account.'), { status: response.status });
  const me = await response.json();
  return { id: me.id, name: me.displayName || null, email: me.mail || me.userPrincipalName || null };
}

/**
 * 'personal' for a home Microsoft account (outlook.com, hotmail.com...), whose
 * OneDrive Microsoft's Excel API won't edit cell by cell; 'business' for a
 * work or school OneDrive; 'none' when the account has no OneDrive of its own
 * (a guest or an unlicensed account: Graph answers 401/403/404), which can
 * still save in SharePoint or Teams. Throws when Graph can't be reached.
 */
export async function fetchMsgraphDriveKind(accessToken, { fetch: fetchImpl = globalThis.fetch, graphBase = GRAPH } = {}) {
  const response = await fetchImpl(`${graphBase}/me/drive?$select=id,driveType`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if ([401, 403, 404].includes(response.status)) return 'none';
  if (!response.ok) throw Object.assign(new Error('Could not read the OneDrive.'), { status: response.status });
  const drive = await response.json().catch(() => null);
  return drive?.driveType === 'personal' ? 'personal' : 'business';
}
