// The sheet-sync edge function's logic (supabase/functions/sheet-sync wraps
// it). Plain JS with its outside pieces passed in (supabase-js createClient,
// yjs, fetch, env), so node tests drive the whole function against the local
// database and a fake Google.
//
// Two providers: Google Sheets (providers/google.js) and Excel workbooks on a
// work or school Microsoft 365 (providers/msgraph.js). A survey + template has
// at most one linked sheet, whichever provider made it.
//
// Who may do what:
//   * connect / disconnect Google or Microsoft: any signed-in person (their own
//     sign-in);
//   * link a survey to a new sheet: an editor or owner of the document, signed
//     in to that provider, with the beta on (flag 'sheet-team-sync' or a
//     Nightly tester);
//   * run a round, answer a conflict: any editor or owner of a linked
//     document. A field tech never needs a Google account: the server reaches
//     the sheet with the sign-in of the person who linked it, and writes the
//     markers as the field tech (append_annotation_update checks the role);
//   * unlink: the person who linked it, or the document's owner.
import { buildSyncLayout, layoutProblems } from './layout.js';
import { runSheetRound } from './round.js';
import { encryptToken, decryptToken } from './tokenCrypto.js';
import {
  googleEndpoints, googleAuthUrl, googleSheetsProvider, exchangeGoogleCode, refreshGoogleToken, revokeGoogleToken,
} from './providers/google.js';
import { createMsGraphProvider } from './providers/msgraph.js';
import {
  buildMsgraphAuthorizeUrl, exchangeMsgraphCode, fetchMsgraphAccount, msgraphAuthConfigFromEnv, refreshMsgraphToken,
} from './msgraphAuth.js';
import { docToSurveyMarkers, syncSurveyMarkersToDoc } from '../surveyMarkerDocSync.js';
import { bytesToPgHex, pgHexToBytes } from '../pgBytea.js';
import { parseBody, s } from '../inputSchema.js';
import { GUEST_REFUSED_MESSAGE, isGuestUser } from '../guestSession.js';

export const SHEET_SYNC_FLAG = 'sheet-team-sync';
const MARKER_FIELDS_FLAG = 'survey-marker-fields';
const SNAPSHOT_ENC_GZIP = 2;
// Rounds a link runs at most this often unless someone presses Sync now: every
// device of every survey a person linked shares that person's Google quota
// (60 reads a minute), and the whole app shares 300.
const MIN_ROUND_GAP_MS = 8000;
const MIN_FORCED_GAP_MS = 2000; // "Sync now" pressed again and again
const LEASE_SECONDS = 120;
const STATE_TTL_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_APP_ORIGINS = [
  'https://surveytool.app', 'https://surveytool-nightly.vercel.app',
  'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5199', 'http://127.0.0.1:5199',
];

export const corsHeaders = {
  // INTENTIONAL '*': Bearer-token API for web, Electron (file://) and
  // Capacitor. See CLAUDE.md "Edge-function CORS".
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

class SyncError extends Error {
  constructor(message, status = 400, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const log = (event, fields = {}) => {
  try { console.log(JSON.stringify({ fn: 'sheet-sync', event, ...fields })); } catch { /* never throw */ }
};

// ---- small crypto helpers ---------------------------------------------------
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (text) => {
  const t = String(text).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t.padEnd(Math.ceil(t.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
};
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`sheet-sync-state:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))));
}
async function signState(secret, payload) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}
async function readState(secret, state) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig || sig !== await hmac(secret, body)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
    return payload && Number(payload.e) > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

async function gunzip(bytes) {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  const chunk = new Uint8Array(bytes.length);
  chunk.set(bytes);
  writer.write(chunk);
  writer.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

// The document's annotation Y.Doc from its snapshot + WAL tail, the same load
// the app and survey-mcp do.
async function loadAnnotationDoc(db, Y, documentId) {
  const doc = new Y.Doc();
  const { data: snap, error: snapErr } = await db.from('annotation_snapshots')
    .select('snapshot, at_seq, encoding_version').eq('document_id', documentId).maybeSingle();
  if (snapErr) throw new SyncError('Could not open the survey.', 500, 'doc_read');
  let fromSeq = 0;
  if (snap?.snapshot) {
    let bytes = pgHexToBytes(snap.snapshot);
    if (Number(snap.encoding_version) === SNAPSHOT_ENC_GZIP) bytes = await gunzip(bytes);
    Y.applyUpdate(doc, bytes);
    fromSeq = Number(snap.at_seq) || 0;
  }
  for (;;) {
    const { data: rows, error } = await db.from('annotation_updates')
      .select('seq, data').eq('document_id', documentId).gt('seq', fromSeq)
      .order('seq', { ascending: true }).limit(1000);
    if (error) throw new SyncError('Could not open the survey.', 500, 'doc_read');
    if (!rows?.length) break;
    for (const row of rows) {
      Y.applyUpdate(doc, pgHexToBytes(row.data));
      fromSeq = Math.max(fromSeq, Number(row.seq));
    }
    if (rows.length < 1000) break;
  }
  return doc;
}

const stable = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
};

// Part by part: the parts `next` changed from `was`, put onto `now`.
function mergeParts(now, was, next) {
  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(was) || !isObj(next) || (now != null && !isObj(now))) return next;
  const out = { ...(now || {}) };
  for (const k of new Set([...Object.keys(was), ...Object.keys(next)])) {
    if (stable(was[k]) === stable(next[k])) continue;
    if (next[k] === undefined) delete out[k]; else out[k] = next[k];
  }
  return Object.keys(out).length || now ? out : undefined;
}

// Put only what the round changed onto the freshest copy of each marker, so an
// edit someone made to another field (or another answer) meanwhile survives.
export function mergeMarkerWrites(fresh, before, writes) {
  const out = {};
  for (const [id, next] of Object.entries(writes)) {
    const was = before[id];
    const now = fresh[id];
    if (!was || !now) { out[id] = now ? { ...now, ...next } : next; continue; }
    const merged = { ...now };
    for (const key of new Set([...Object.keys(was), ...Object.keys(next)])) {
      if (stable(was[key]) === stable(next[key])) continue;
      if (key === 'checklistResponses') {
        // Per answer, and inside an answer per part: a round sets `selection`;
        // a comment, photo or new answer added meanwhile stays.
        const responses = { ...(now.checklistResponses || {}) };
        const a = was.checklistResponses || {};
        const b = next.checklistResponses || {};
        for (const cid of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if (stable(a[cid]) === stable(b[cid])) continue;
          const merged1 = mergeParts(responses[cid], a[cid], b[cid]);
          if (merged1 === undefined) delete responses[cid]; else responses[cid] = merged1;
        }
        merged.checklistResponses = responses;
      } else if (key === 'note') {
        // A round sets the note's text; photos or anything else on the note stay.
        merged.note = mergeParts(now.note, was.note, next.note);
      } else if (next[key] === undefined) {
        delete merged[key];
      } else {
        merged[key] = next[key];
      }
    }
    out[id] = merged;
  }
  return out;
}

// ---- the handler --------------------------------------------------------------

/**
 * @param {Request} req
 * @param {{ env: Record<string,string|undefined>, createClient: Function, Y: any, fetchImpl?: typeof fetch,
 *           isAgentSession?: (authHeader: string) => boolean }} deps
 */
export async function handleSheetSync(req, deps) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const { env } = deps;
  const url = new URL(req.url);
  try {
    if (req.method === 'GET' && url.pathname.endsWith('/oauth/callback')) return await oauthCallback(url, deps);
    if (req.method === 'GET' && url.pathname.endsWith('/oauth/msgraph/callback')) return await msgraphCallback(url, deps);
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const supabaseUrl = env.SUPABASE_URL;
    const anonKey = env.SUPABASE_ANON_KEY;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'server_misconfigured' }, 500);

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token || token === anonKey || token === serviceKey) return json({ error: 'unauthorized' }, 401);
    if (deps.isAgentSession?.(authHeader)) return json({ error: 'AI agents cannot link spreadsheets.' }, 403);
    const authClient = deps.createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data: who, error: whoErr } = await authClient.auth.getUser(token);
    if (whoErr || !who?.user) return json({ error: 'unauthorized' }, 401);
    if (isGuestUser(who.user)) return json({ error: GUEST_REFUSED_MESSAGE }, 403);

    let raw;
    try { raw = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const parsed = parseBody({
      action: s.enum(['status', 'connect', 'disconnect', 'link', 'sync', 'choose', 'unlink']),
      documentId: s.string({ max: 64, pattern: UUID, optional: true }),
      templateId: s.string({ max: 128, optional: true }),
      template: s.record({ maxBytes: 1024 * 1024, optional: true }),
      kit: s.record({ maxBytes: 64 * 1024, optional: true }),
      answerValues: s.array(s.string({ max: 80 }), { max: 20, optional: true }),
      title: s.string({ max: 200, optional: true }),
      markerId: s.string({ max: 200, optional: true }),
      choice: s.enum(['app', 'sheet', 'putBack', 'putBackTab'], { optional: true }),
      scopeId: s.string({ max: 300, optional: true }),
      appOrigin: s.string({ max: 200, optional: true }),
      force: s.boolean({ optional: true }),
      provider: s.enum(['google', 'msgraph'], { optional: true }),
    }, raw);
    if (!parsed.ok) return json({ error: 'invalid_request', detail: parsed.error }, 400);

    const ctx = {
      ...deps,
      fetchImpl: deps.fetchImpl || fetch,
      user: who.user,
      body: parsed.value,
      // Which provider a call means. Calls about a linked survey may leave it
      // out: linkFor finds the survey's one link whatever its provider.
      provider: parsed.value.provider || 'google',
      providerGiven: Boolean(parsed.value.provider),
      userDb: deps.createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }),
      service: deps.createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }),
    };
    switch (parsed.value.action) {
      case 'status': return json(await statusFor(ctx));
      case 'connect': return json(ctx.provider === 'msgraph' ? await connectMicrosoft(ctx) : await connectGoogle(ctx));
      case 'disconnect': return json(ctx.provider === 'msgraph' ? await disconnectMicrosoft(ctx) : await disconnectGoogle(ctx));
      case 'link': return json(await linkSheet(ctx));
      case 'sync': return json(await syncLink(ctx));
      case 'choose': return json(await chooseConflict(ctx));
      case 'unlink': return json(await unlinkSheet(ctx));
      default: return json({ error: 'unknown_action' }, 400);
    }
  } catch (err) {
    if (err instanceof SyncError) return json({ error: err.message, code: err.code }, err.status);
    log('unhandled', { name: err?.name, status: err?.status });
    return json({ error: 'Something went wrong syncing the sheet. Try again.' }, 500);
  }
}

// ---- Google sign-in -----------------------------------------------------------

const googleConfig = (env) => {
  const clientId = env.GOOGLE_SHEETS_CLIENT_ID;
  const clientSecret = env.GOOGLE_SHEETS_CLIENT_SECRET;
  const base = (env.SHEET_SYNC_PUBLIC_URL || `${String(env.SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/sheet-sync`).replace(/\/$/, '');
  return { clientId, clientSecret, redirectUri: `${base}/oauth/callback`, endpoints: googleEndpoints(env), configured: Boolean(clientId && clientSecret) };
};

const tokenKey = (env) => env.SHEET_SYNC_TOKEN_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

const appOrigins = (env) => (env.SHEET_SYNC_APP_ORIGINS ? env.SHEET_SYNC_APP_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean) : DEFAULT_APP_ORIGINS);

async function connectGoogle(ctx) {
  const g = googleConfig(ctx.env);
  if (!g.configured) throw new SyncError('Google Sheets is not set up on this server yet.', 503, 'not_configured');
  await requireBeta(ctx);
  // Desktop and phone apps have no web origin to come back to; they land on
  // the website's "connected" page and poll status.
  const origin = appOrigins(ctx.env).includes(ctx.body.appOrigin) ? ctx.body.appOrigin : appOrigins(ctx.env)[0];
  const state = await signState(g.clientSecret, { u: ctx.user.id, o: origin, e: Date.now() + STATE_TTL_MS, n: crypto.randomUUID() });
  return { url: googleAuthUrl({ endpoints: g.endpoints, clientId: g.clientId, redirectUri: g.redirectUri, state, loginHint: ctx.user.email }) };
}

async function oauthCallback(url, deps) {
  const { env } = deps;
  const g = googleConfig(env);
  const fallback = appOrigins(env)[0];
  const back = (origin, result) => new Response(null, {
    status: 302,
    headers: { Location: `${origin}/google-connected.html?result=${encodeURIComponent(result)}`, 'Cache-Control': 'no-store' },
  });
  if (!g.configured) return back(fallback, 'not_configured');
  const state = await readState(g.clientSecret, url.searchParams.get('state'));
  if (!state?.u) return back(fallback, 'expired');
  const origin = appOrigins(env).includes(state.o) ? state.o : fallback;
  if (url.searchParams.get('error')) return back(origin, 'cancelled');
  const code = url.searchParams.get('code');
  if (!code) return back(origin, 'cancelled');
  try {
    const tokens = await exchangeGoogleCode({ ...g, code, fetchImpl: deps.fetchImpl || fetch });
    if (!tokens.scope.includes('drive.file')) return back(origin, 'no_access');
    const service = deps.createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { error } = await service.from('sheet_sync_connections').upsert({
      user_id: state.u,
      provider: 'google',
      account_email: tokens.email,
      refresh_token_enc: await encryptToken(tokens.refreshToken, tokenKey(env)),
      scopes: tokens.scope,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error('store failed');
    // A link that broke because this sign-in stopped working works again.
    await service.from('sheet_sync_links').update({ status: 'active', last_error: null })
      .eq('connection_user_id', state.u).eq('provider', 'google').eq('status', 'broken');
    return back(origin, 'connected');
  } catch (err) {
    log('oauth_failed', { status: err?.status });
    return back(origin, 'failed');
  }
}

async function disconnectGoogle(ctx) {
  const { data: row } = await ctx.service.from('sheet_sync_connections')
    .select('refresh_token_enc').eq('user_id', ctx.user.id).eq('provider', 'google').maybeSingle();
  if (row?.refresh_token_enc) {
    try {
      const refresh = await decryptToken(row.refresh_token_enc, tokenKey(ctx.env));
      await revokeGoogleToken({ endpoints: googleConfig(ctx.env).endpoints, token: refresh, fetchImpl: ctx.fetchImpl });
    } catch { /* deleted below either way */ }
  }
  await ctx.service.from('sheet_sync_connections').delete().eq('user_id', ctx.user.id).eq('provider', 'google');
  await ctx.service.from('sheet_sync_links')
    .update({ status: 'broken', last_error: 'The person who linked this sheet disconnected Google.' })
    .eq('connection_user_id', ctx.user.id).eq('provider', 'google');
  return { ok: true };
}

// ---- Microsoft sign-in ----------------------------------------------------------
// Confidential client with offline access (msgraphAuth.js); off until the Azure
// app's secret is set. Microsoft hands back a new refresh token on each refresh,
// so the stored one is replaced as it rotates.

const msgraphConfig = (env) => {
  const base = (env.SHEET_SYNC_PUBLIC_URL || `${String(env.SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/sheet-sync`).replace(/\/$/, '');
  return msgraphAuthConfigFromEnv((name) => env[name], { redirectUri: `${base}/oauth/msgraph/callback` });
};

async function connectMicrosoft(ctx) {
  const ms = msgraphConfig(ctx.env);
  if (!ms) throw new SyncError('Microsoft 365 is not set up on this server yet.', 503, 'not_configured');
  await requireBeta(ctx);
  const origin = appOrigins(ctx.env).includes(ctx.body.appOrigin) ? ctx.body.appOrigin : appOrigins(ctx.env)[0];
  const state = await signState(ms.clientSecret, { u: ctx.user.id, o: origin, e: Date.now() + STATE_TTL_MS, n: crypto.randomUUID() });
  return { url: buildMsgraphAuthorizeUrl(ms, state, { loginHint: ctx.user.email }) };
}

async function msgraphCallback(url, deps) {
  const { env } = deps;
  const ms = msgraphConfig(env);
  const fallback = appOrigins(env)[0];
  const back = (origin, result) => new Response(null, {
    status: 302,
    headers: { Location: `${origin}/google-connected.html?provider=msgraph&result=${encodeURIComponent(result)}`, 'Cache-Control': 'no-store' },
  });
  if (!ms) return back(fallback, 'not_configured');
  const state = await readState(ms.clientSecret, url.searchParams.get('state'));
  if (!state?.u) return back(fallback, 'expired');
  const origin = appOrigins(env).includes(state.o) ? state.o : fallback;
  if (url.searchParams.get('error')) return back(origin, 'cancelled');
  const code = url.searchParams.get('code');
  if (!code) return back(origin, 'cancelled');
  const fetchImpl = deps.fetchImpl || fetch;
  try {
    const tokens = await exchangeMsgraphCode(ms, code, { fetch: fetchImpl });
    if (!tokens.scopes.some((sc) => /files\.readwrite/i.test(sc))) return back(origin, 'no_access');
    const account = await fetchMsgraphAccount(tokens.accessToken, { fetch: fetchImpl, graphBase: ms.graphBase });
    const service = deps.createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { error } = await service.from('sheet_sync_connections').upsert({
      user_id: state.u,
      provider: 'msgraph',
      account_email: account.email,
      refresh_token_enc: await encryptToken(tokens.refreshToken, tokenKey(env)),
      scopes: tokens.scopes.join(' '),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error('store failed');
    await service.from('sheet_sync_links').update({ status: 'active', last_error: null })
      .eq('connection_user_id', state.u).eq('provider', 'msgraph').eq('status', 'broken');
    return back(origin, 'connected');
  } catch (err) {
    log('oauth_failed', { provider: 'msgraph', status: err?.status, code: err?.code });
    return back(origin, err?.code === 'no_refresh_token' ? 'no_access' : 'failed');
  }
}

async function disconnectMicrosoft(ctx) {
  // Microsoft has no call to revoke one refresh token; deleting ours ends
  // Survey's access (the person can also remove Survey under My Apps).
  await ctx.service.from('sheet_sync_connections').delete().eq('user_id', ctx.user.id).eq('provider', 'msgraph');
  await ctx.service.from('sheet_sync_links')
    .update({ status: 'broken', last_error: 'The person who linked this workbook disconnected Microsoft.' })
    .eq('connection_user_id', ctx.user.id).eq('provider', 'msgraph');
  return { ok: true };
}

// ---- gates ----------------------------------------------------------------------

async function requireBeta(ctx) {
  const [{ data: flags }, { data: nightly }] = await Promise.all([
    ctx.userDb.rpc('get_my_feature_flags'),
    ctx.userDb.rpc('can_use_nightly'),
  ]);
  if (flags?.[SHEET_SYNC_FLAG] === true || nightly === true) return;
  throw new SyncError('Live sheet sync is in beta on Survey Nightly.', 403, 'beta');
}

async function roleOf(ctx, documentId) {
  if (!documentId) throw new SyncError('Say which survey.', 400, 'missing_document');
  const { data, error } = await ctx.userDb.rpc('get_my_document_role', { doc_id: documentId });
  if (error) throw new SyncError('Could not check your access to this survey.', 500, 'role');
  return data || null;
}

async function requireEditor(ctx, documentId) {
  const role = await roleOf(ctx, documentId);
  if (role !== 'owner' && role !== 'editor') throw new SyncError('Only editors of this survey can sync its sheet.', 403, 'not_editor');
  return role;
}

async function fieldMapsOn(ctx) {
  const { data } = await ctx.userDb.rpc('get_my_feature_flags');
  return data?.[MARKER_FIELDS_FLAG] === true;
}

// ---- links ---------------------------------------------------------------------

const LINK_COLUMNS = 'id, document_id, template_id, provider, connection_user_id, file_id, file_url, title, layout, baseline, state, remote_version, app_hash, status, last_round_at, last_error, backoff_until, created_by';

// The survey's linked sheet. linkSheet keeps it to one per survey + template,
// so without a named provider the one there is the answer.
async function linkFor(ctx, documentId, templateId, { anyProvider = !ctx.providerGiven } = {}) {
  if (!templateId) throw new SyncError('Say which survey template.', 400, 'missing_template');
  let query = ctx.service.from('sheet_sync_links').select(LINK_COLUMNS)
    .eq('document_id', documentId).eq('template_id', templateId);
  if (!anyProvider) query = query.eq('provider', ctx.provider);
  const { data, error } = await query.order('created_at', { ascending: true }).limit(1);
  if (error) throw new SyncError('Could not read the sheet link.', 500, 'link_read');
  return data?.[0] || null;
}

const providerName = (provider) => (provider === 'msgraph' ? 'Microsoft 365' : 'Google');
const sheetName = (provider) => (provider === 'msgraph' ? 'Excel workbook' : 'Google Sheet');

function layoutFrom(body) {
  if (!body.template || !body.kit) return null;
  let layout;
  try {
    layout = buildSyncLayout({ template: body.template, kit: body.kit, answerValues: body.answerValues || ['Y', 'N', 'N/A'] });
  } catch {
    throw new SyncError('This survey template cannot be laid out as a sheet.', 400, 'bad_layout');
  }
  // The same limits the sheet can hold (tabs, columns, names), checked here
  // because the template comes from the device.
  const problems = layout.scopes.length ? layoutProblems(layout) : [];
  if (problems.length) throw new SyncError(`This survey template cannot be laid out as a sheet (${problems[0]}).`, 400, 'bad_layout');
  return layout;
}

const ACCESS_TOKENS = new Map();

async function providerFor(ctx, connectionUserId, provider = 'google') {
  if (provider === 'msgraph') return msgraphProviderFor(ctx, connectionUserId);
  const g = googleConfig(ctx.env);
  if (!g.configured) throw new SyncError('Google Sheets is not set up on this server yet.', 503, 'not_configured');
  const { data: row } = await ctx.service.from('sheet_sync_connections')
    .select('refresh_token_enc').eq('user_id', connectionUserId).eq('provider', 'google').maybeSingle();
  if (!row) throw Object.assign(new Error('no connection'), { status: 401 });
  const refreshToken = await decryptToken(row.refresh_token_enc, tokenKey(ctx.env));
  // Kept by this server instance between requests (an access token lasts an
  // hour), so a round is not also a call to Google's token endpoint.
  const cacheKey = `google:${connectionUserId}:${row.refresh_token_enc}`;
  const getAccessToken = async () => {
    const access = ACCESS_TOKENS.get(cacheKey);
    if (access && access.expiresAt > Date.now() + 60_000) return access.accessToken;
    const fresh = await refreshGoogleToken({ ...g, refreshToken, fetchImpl: ctx.fetchImpl });
    if (ACCESS_TOKENS.size > 500) ACCESS_TOKENS.clear();
    ACCESS_TOKENS.set(cacheKey, fresh);
    return fresh.accessToken;
  };
  return googleSheetsProvider({ endpoints: g.endpoints, getAccessToken, fetchImpl: ctx.fetchImpl });
}

async function msgraphProviderFor(ctx, connectionUserId) {
  const ms = msgraphConfig(ctx.env);
  if (!ms) throw new SyncError('Microsoft 365 is not set up on this server yet.', 503, 'not_configured');
  const { data: row } = await ctx.service.from('sheet_sync_connections')
    .select('refresh_token_enc').eq('user_id', connectionUserId).eq('provider', 'msgraph').maybeSingle();
  if (!row) throw Object.assign(new Error('no connection'), { status: 401 });
  let refreshToken = await decryptToken(row.refresh_token_enc, tokenKey(ctx.env));
  let access = null;
  const getAccessToken = async () => {
    if (access && access.expiresAt > Date.now() + 60_000) return access.accessToken;
    access = await refreshMsgraphToken(ms, refreshToken, { fetch: ctx.fetchImpl });
    if (access.refreshToken && access.refreshToken !== refreshToken) {
      refreshToken = access.refreshToken;
      await ctx.service.from('sheet_sync_connections')
        .update({ refresh_token_enc: await encryptToken(refreshToken, tokenKey(ctx.env)), updated_at: new Date().toISOString() })
        .eq('user_id', connectionUserId).eq('provider', 'msgraph');
    }
    return access.accessToken;
  };
  return createMsGraphProvider({ getAccessToken, fetch: ctx.fetchImpl, baseUrl: ms.graphBase });
}

async function signingFor(ctx, documentId) {
  const { data, error } = await ctx.userDb.rpc('kal308a_get_or_create_signing_secret', {
    p_document_id: documentId, p_signing_id_seed: `${documentId}:sheet-sync`,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.secret_b64) throw new SyncError('Could not get this survey\'s row keys.', 500, 'signing');
  return { keyId: row.key_id, secret: row.secret_b64, signingDocId: row.signing_doc_id };
}

function markerStore(ctx, documentId) {
  let before = {};
  return {
    load: async () => {
      before = docToSurveyMarkers(await loadAnnotationDoc(ctx.userDb, ctx.Y, documentId));
      return before;
    },
    save: async (writes) => {
      const doc = await loadAnnotationDoc(ctx.userDb, ctx.Y, documentId);
      const fresh = docToSurveyMarkers(doc);
      const merged = mergeMarkerWrites(fresh, before, writes);
      const sv = ctx.Y.encodeStateVector(doc);
      // Additive: a round never deletes a marker.
      const res = syncSurveyMarkersToDoc(doc, merged, { origin: 'excel-import', fieldMaps: await fieldMapsOn(ctx) });
      if (!res.added && !res.updated) return;
      const { error } = await ctx.userDb.rpc('append_annotation_update', {
        p_document_id: documentId,
        p_client_id: `sheet-sync-${crypto.randomUUID()}`,
        p_client_seq: 1,
        p_data: bytesToPgHex(ctx.Y.encodeStateAsUpdate(doc, sv)),
      });
      if (error) throw new SyncError('Could not save the sheet\'s changes to the survey (is it locked?).', 409, 'doc_write');
    },
  };
}

// What the app shows about a link. Viewers see that it is live and when it
// last synced, not what the sheet holds that the survey does not (yet):
// values waiting on a choice and rows that could not come in.
const publicLink = (link, userId, role = null) => {
  if (!link) return null;
  const editor = role === 'owner' || role === 'editor';
  const titleOf = (scopeId) => (link.layout?.scopes || []).find((sc) => sc.scopeId === scopeId)?.title || 'A category';
  return {
    provider: link.provider,
    fileUrl: link.file_url,
    title: link.title,
    status: link.status,
    lastRoundAt: link.last_round_at,
    lastError: link.last_error,
    isConnectionOwner: link.connection_user_id === userId,
    conflicts: editor ? Object.entries(link.state?.conflicts || {}).map(([markerId, c]) => ({ markerId, ...c })) : [],
    removedInSheet: editor ? Object.entries(link.state?.removedInSheet || {}).map(([markerId, r]) => ({ markerId, ...r })) : [],
    problems: editor ? (link.state?.problems || []).slice(0, 50) : [],
    missingTabs: (link.state?.missingTabs || []).map((scopeId) => ({ scopeId, title: titleOf(scopeId) })),
  };
};

async function statusFor(ctx, round = null) {
  const g = googleConfig(ctx.env);
  const { data: conns } = await ctx.service.from('sheet_sync_connections')
    .select('provider, account_email').eq('user_id', ctx.user.id);
  const connOf = (provider) => (conns || []).find((c) => c.provider === provider) || null;
  const conn = connOf('google');
  const msConn = connOf('msgraph');
  let link = null;
  let role = null;
  if (ctx.body.documentId && ctx.body.templateId) {
    role = await roleOf(ctx, ctx.body.documentId);
    if (role) link = await linkFor(ctx, ctx.body.documentId, ctx.body.templateId);
  }
  return {
    configured: g.configured,
    providers: { google: { configured: g.configured }, msgraph: { configured: Boolean(msgraphConfig(ctx.env)) } },
    google: { connected: Boolean(conn), email: conn?.account_email || null },
    microsoft: { connected: Boolean(msConn), email: msConn?.account_email || null },
    role,
    link: publicLink(link, ctx.user.id, role),
    ...(round ? { round } : {}),
  };
}

async function linkSheet(ctx) {
  const { documentId, templateId } = ctx.body;
  await requireEditor(ctx, documentId);
  await requireBeta(ctx);
  if (!templateId) throw new SyncError('Say which survey template.', 400, 'missing_template');
  const layout = layoutFrom(ctx.body);
  if (!layout?.scopes.length) throw new SyncError('This template has no categories to put in a sheet.', 400, 'empty_layout');
  // One sheet per survey + template, so two server writers never race.
  const existing = await linkFor(ctx, documentId, templateId, { anyProvider: true });
  if (existing) throw new SyncError(`This survey already has a linked ${sheetName(existing.provider)}.`, 409, 'already_linked');
  let provider;
  try { provider = await providerFor(ctx, ctx.user.id, ctx.provider); } catch (err) {
    if (err instanceof SyncError) throw err;
    throw new SyncError(`Connect ${providerName(ctx.provider)} first.`, 409, 'not_connected');
  }
  const signing = await signingFor(ctx, documentId);
  const title = ctx.body.title || 'Survey';
  let made;
  try { made = await provider.createFile({ title, layout }); } catch (err) {
    if (err?.code === 'personal-onedrive') {
      throw new SyncError('This Microsoft account has a personal OneDrive. Live sync needs a work or school Microsoft 365 account.', 409, 'personal-onedrive');
    }
    throw err;
  }
  const { data: link, error } = await ctx.service.from('sheet_sync_links').insert({
    document_id: documentId,
    template_id: templateId,
    provider: ctx.provider,
    connection_user_id: ctx.user.id,
    file_id: made.fileId,
    file_url: made.url,
    title,
    layout,
    state: { sheetIds: made.sheetIds },
    created_by: ctx.user.id,
  }).select(LINK_COLUMNS).single();
  if (error) {
    // Two "Make a live sheet" presses at once: the database keeps one link per
    // survey; the second file stays in the person's Drive, unsynced.
    if (error.code === '23505') throw new SyncError('This survey already has a linked sheet.', 409, 'already_linked');
    throw new SyncError('Could not save the sheet link.', 500, 'link_write');
  }
  log('linked', { provider: ctx.provider, scopes: layout.scopes.length });
  const round = await runRoundFor(ctx, link, { provider, signing, force: true });
  return statusFor(ctx, round);
}

// One round at a time per link. The lease carries a token; a round saves only
// while it still holds its own token, so a round that ran past its lease
// never overwrites the one that took over.
async function takeLease(ctx, linkId, { waitMs = 0 } = {}) {
  const until = Date.now() + waitMs;
  for (;;) {
    const { data } = await ctx.service.rpc('sheet_sync_take_lease_token', { p_link_id: linkId, p_seconds: LEASE_SECONDS });
    if (typeof data === 'string' && data) return data;
    if (Date.now() >= until) return null;
    await new Promise((r) => setTimeout(r, 400));
  }
}

const releaseLease = (ctx, linkId, token, patch) => ctx.service.from('sheet_sync_links')
  .update({ ...patch, lease_until: null, lease_token: null, updated_at: new Date().toISOString() })
  .eq('id', linkId).eq('lease_token', token);

async function readLink(ctx, linkId) {
  const { data, error } = await ctx.service.from('sheet_sync_links').select(LINK_COLUMNS).eq('id', linkId).maybeSingle();
  if (error) throw new SyncError('Could not read the sheet link.', 500, 'link_read');
  return data;
}

async function runRoundFor(ctx, link, { provider = null, signing = null, force = false, leaseToken = null, change = null } = {}) {
  if (link.status === 'paused') return { status: 'paused' };
  if (!leaseToken) {
    // Sync now skips the wait between rounds, never Google's "slow down".
    if (link.backoff_until && new Date(link.backoff_until).getTime() > Date.now()) return { status: 'waiting' };
    const gap = force ? MIN_FORCED_GAP_MS : MIN_ROUND_GAP_MS;
    if (link.last_round_at && Date.now() - new Date(link.last_round_at).getTime() < gap) {
      return { status: 'recent', retryInMs: gap - (Date.now() - new Date(link.last_round_at).getTime()) };
    }
  }
  const token = leaseToken || await takeLease(ctx, link.id);
  if (!token) return { status: 'busy', retryInMs: 3000 };
  // Read the link fresh under the lease: another round may have just saved.
  const fresh = await readLink(ctx, link.id);
  if (!fresh) return { status: 'unlinked' };
  Object.assign(link, fresh);
  if (change) change(link);
  const release = (patch) => releaseLease(ctx, link.id, token, patch);
  try {
    // The sheet is reached with the linker's sign-in: only while the linker
    // can still edit the survey. Someone removed from it keeps nothing.
    const { data: linkerRole } = await ctx.service.rpc('sheet_sync_user_role', { p_document_id: link.document_id, p_user_id: link.connection_user_id });
    if (linkerRole !== 'owner' && linkerRole !== 'editor') {
      const message = `The person who linked this ${sheetName(link.provider)} is no longer an editor of this survey, so it stopped syncing. An editor can make a new live sheet.`;
      await release({ status: 'broken', last_error: message, ...(change ? { state: link.state, baseline: link.baseline } : {}) });
      Object.assign(link, { status: 'broken', last_error: message });
      return { status: 'error', error: message };
    }
    const p = provider || await providerFor(ctx, link.connection_user_id, link.provider);
    const sign = signing || await signingFor(ctx, link.document_id);
    const store = markerStore(ctx, link.document_id);
    let result = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      result = await runSheetRound({ link, provider: p, loadMarkers: store.load, saveMarkers: store.save, signing: sign, force: force || attempt > 0 || Boolean(change) });
      if (result.status !== 'retry') break;
    }
    if (result.status === 'synced') {
      await release({ ...result.patch, status: 'active', last_round_at: new Date().toISOString(), last_error: null, backoff_until: null });
      Object.assign(link, result.patch, { status: 'active', last_error: null, last_round_at: new Date().toISOString() });
    } else if (result.status === 'retry') {
      // Rows kept moving (someone sorting or typing fast): say so, try later.
      const message = `The ${sheetName(link.provider)} kept changing while syncing. Trying again soon.`;
      await release({ last_round_at: new Date().toISOString(), last_error: message, ...(change ? { state: link.state, baseline: link.baseline } : {}) });
      Object.assign(link, { last_error: message });
    } else {
      await release({ last_round_at: new Date().toISOString(), ...(change ? { state: link.state, baseline: link.baseline } : {}) });
    }
    return { status: result.status, ...(result.summary ? { summary: result.summary } : {}) };
  } catch (err) {
    if (err instanceof SyncError) {
      await release({ last_error: err.message, ...(change ? { state: link.state, baseline: link.baseline } : {}) });
      throw err;
    }
    const status = Number(err?.status) || 500;
    const who = providerName(link.provider);
    const what = sheetName(link.provider);
    const message = status === 401 ? `The ${who} sign-in used for this sheet stopped working. The person who linked it needs to connect ${who} again.`
      : status === 404 ? `The linked ${what} was deleted or is no longer shared with the person who linked it.`
      : status === 429 ? `${who} asked us to slow down. Syncing again in a minute.`
      : status === 413 ? `The linked ${what} is too big to sync (over 250,000 cells in its synced tabs). Delete rows or tabs you no longer need.`
      : status === 409 && err?.code === 'personal-onedrive' ? 'This workbook is on a personal OneDrive, which cannot sync cell by cell.'
      : `Could not reach the ${what}. Trying again soon.`;
    const patch = { last_error: message };
    if (status === 401 || status === 404) patch.status = 'broken';
    if (status === 409 && err?.code === 'personal-onedrive') patch.status = 'paused';
    if (status === 429) patch.backoff_until = new Date(Date.now() + 60_000).toISOString();
    if (change) Object.assign(patch, { state: link.state, baseline: link.baseline });
    await release(patch);
    Object.assign(link, patch);
    log('round_failed', { status });
    return { status: 'error', error: message };
  }
}

async function syncLink(ctx) {
  const { documentId, templateId } = ctx.body;
  await requireEditor(ctx, documentId);
  const link = await linkFor(ctx, documentId, templateId);
  if (!link) throw new SyncError('This survey has no linked sheet.', 404, 'not_linked');
  const layout = layoutFrom(ctx.body);
  if (layout && stable(layout) !== stable(link.layout)) {
    // The template changed (new category, line or entity): sync by the new layout.
    await ctx.service.from('sheet_sync_links').update({ layout }).eq('id', link.id);
    link.layout = layout;
  }
  const round = link.status === 'broken' && !ctx.body.force ? { status: 'broken' } : await runRoundFor(ctx, link, { force: Boolean(ctx.body.force) });
  return statusFor(ctx, round);
}

async function chooseConflict(ctx) {
  const { documentId, templateId, markerId, scopeId, choice } = ctx.body;
  await requireEditor(ctx, documentId);
  if (choice === 'putBackTab' ? !scopeId : !markerId || !choice) throw new SyncError('Say which row and which side.', 400, 'missing_choice');
  const link = await linkFor(ctx, documentId, templateId);
  if (!link) throw new SyncError('This survey has no linked sheet.', 404, 'not_linked');
  // The choice goes in under the lease, read fresh, so a round running at
  // the same moment can neither lose it nor be undone by it.
  const token = await takeLease(ctx, link.id, { waitMs: 8000 });
  if (!token) throw new SyncError('The sheet is busy syncing. Try again in a moment.', 409, 'busy');
  let known = false;
  const change = (l) => {
    const state = { ...(l.state || {}) };
    if (choice === 'putBackTab') {
      // "Put the tab back": forget the tab and its rows, so the next round
      // makes the tab again and fills it from the survey.
      known = (state.missingTabs || []).includes(scopeId) && state.sheetIds?.[scopeId] != null;
      if (!known) return;
      const { [scopeId]: _gone, ...sheetIds } = state.sheetIds;
      state.sheetIds = sheetIds;
      state.missingTabs = state.missingTabs.filter((id) => id !== scopeId);
      const baseline = { ...(l.baseline || {}) };
      for (const [id, b] of Object.entries(baseline)) if (b?.scopeId === scopeId) delete baseline[id];
      l.baseline = baseline;
    } else {
      known = Boolean(choice === 'putBack' ? state.removedInSheet?.[markerId] : state.conflicts?.[markerId]);
      if (!known) return;
      state.choices = { ...(state.choices || {}), [markerId]: choice };
    }
    l.state = state;
  };
  const round = await runRoundFor(ctx, link, { force: true, leaseToken: token, change });
  return statusFor(ctx, known ? round : null);
}

async function unlinkSheet(ctx) {
  const { documentId, templateId } = ctx.body;
  const role = await roleOf(ctx, documentId);
  const link = await linkFor(ctx, documentId, templateId);
  if (!link) return statusFor(ctx);
  if (role !== 'owner' && link.connection_user_id !== ctx.user.id) {
    throw new SyncError('Only the person who linked this sheet, or the survey\'s owner, can unlink it.', 403, 'not_allowed');
  }
  // The sheet itself stays in the person's Google Drive; it just stops syncing.
  await ctx.service.from('sheet_sync_links').delete().eq('id', link.id);
  return statusFor(ctx);
}
