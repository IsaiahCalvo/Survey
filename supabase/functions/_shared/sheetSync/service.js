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
//     sign-in). The consent page's answer is parked with a one-time code that
//     only the browser that said yes gets; it becomes the person's connection
//     only when the same Survey account sends the code back ('claim'), so a
//     consent link sent to someone else links nothing;
//   * link a survey to a new sheet: an editor or owner of the document, signed
//     in to that provider, with the beta on (flag 'sheet-team-sync' or a
//     Nightly tester);
//   * run a round, answer a conflict: any editor or owner of a linked
//     document. A field tech never needs a Google account: the server reaches
//     the sheet with the sign-in of the person who linked it, and writes the
//     markers as the field tech (append_annotation_update checks the role);
//   * unlink: the person who linked it, or the document's owner.
import { buildSyncLayout, layoutProblems } from './layout.js';
import { initialsOf, runSheetRound } from './round.js';
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
// Rounds per link at most this often. Excel's "has it changed?" check is one
// cheap file read (its version moves within a second or two of an edit in
// Excel for the web, measured 2026-11-03), so an open survey can ask often;
// Google rounds read the whole sheet each time (#1312) and keep the slower
// pace for its read quota.
const MIN_ROUND_GAP_MS = 8000;
const MIN_ROUND_GAP_MS_EXCEL = 2500;
const MIN_FORCED_GAP_MS = 2000; // "Sync now" pressed again and again
const LEASE_SECONDS = 120;
const STATE_TTL_MS = 10 * 60 * 1000;
const CLAIM_TTL_MS = 10 * 60 * 1000;
const CLAIM_MAX_TRIES = 5;
// 8 letters from 32 (no 0/O, 1/I): about a trillion codes, five tries.
const CLAIM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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
    if (url.pathname.endsWith('/sweep')) return await sweep(req, deps);
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
      action: s.enum(['status', 'connect', 'claim', 'disconnect', 'link', 'sync', 'choose', 'unlink', 'folders']),
      documentId: s.string({ max: 64, pattern: UUID, optional: true }),
      templateId: s.string({ max: 128, optional: true }),
      template: s.record({ maxBytes: 1024 * 1024, optional: true }),
      kit: s.record({ maxBytes: 64 * 1024, optional: true }),
      answerValues: s.array(s.string({ max: 80 }), { max: 20, optional: true }),
      // The answers' cell colours ({ value, argb }) for the Excel workbook.
      answerFills: s.any({ maxBytes: 4 * 1024 }),
      title: s.string({ max: 200, optional: true }),
      // An Excel workbook's OneDrive folder, "A/B" from the drive's top.
      folder: s.string({ max: 400, optional: true }),
      markerId: s.string({ max: 200, optional: true }),
      choice: s.enum(['app', 'sheet', 'putBack', 'putBackTab'], { optional: true }),
      scopeId: s.string({ max: 300, optional: true }),
      appOrigin: s.string({ max: 200, optional: true }),
      force: s.boolean({ optional: true }),
      provider: s.enum(['google', 'msgraph'], { optional: true }),
      code: s.string({ max: 32, optional: true }),
      client: s.enum(['web', 'desktop', 'phone'], { optional: true }),
    }, raw);
    if (!parsed.ok) return json({ error: 'invalid_request', detail: parsed.error }, 400);

    const service = deps.createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    rememberOwnUrl(env, service);
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
      service,
    };
    switch (parsed.value.action) {
      case 'status': return json(await statusFor(ctx));
      case 'connect': return json(ctx.provider === 'msgraph' ? await connectMicrosoft(ctx) : await connectGoogle(ctx));
      case 'claim': return json(await claimSignIn(ctx));
      case 'disconnect': return json(ctx.provider === 'msgraph' ? await disconnectMicrosoft(ctx) : await disconnectGoogle(ctx));
      case 'link': return json(await linkSheet(ctx));
      case 'sync': return json(await syncLink(ctx));
      case 'choose': return json(await chooseConflict(ctx));
      case 'unlink': return json(await unlinkSheet(ctx));
      case 'folders': return json(await listFolders(ctx));
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

// Which app pressed Connect, carried through the sign-in so the last page
// knows how to hand the person back: the phone app gets an "Open Survey"
// button (its own link scheme), the desktop app reads the page itself.
const appParam = (state) => (state?.c === 'phone' || state?.c === 'desktop' ? `&app=${state.c}` : '');

const appOrigins = (env) => (env.SHEET_SYNC_APP_ORIGINS ? env.SHEET_SYNC_APP_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean) : DEFAULT_APP_ORIGINS);

async function connectGoogle(ctx) {
  const g = googleConfig(ctx.env);
  if (!g.configured) throw new SyncError('Google Sheets is not set up on this server yet.', 503, 'not_configured');
  await requireBeta(ctx);
  // Desktop and phone apps have no web origin to come back to; they land on
  // the website's "connected" page and poll status.
  const origin = appOrigins(ctx.env).includes(ctx.body.appOrigin) ? ctx.body.appOrigin : appOrigins(ctx.env)[0];
  const state = await signState(g.clientSecret, { u: ctx.user.id, o: origin, c: ctx.body.client, e: Date.now() + STATE_TTL_MS, n: crypto.randomUUID() });
  return { url: googleAuthUrl({ endpoints: g.endpoints, clientId: g.clientId, redirectUri: g.redirectUri, state, loginHint: ctx.user.email }) };
}

async function oauthCallback(url, deps) {
  const { env } = deps;
  const g = googleConfig(env);
  const fallback = appOrigins(env)[0];
  let app = '';
  const back = (origin, result, claim = '') => new Response(null, {
    status: 302,
    headers: { Location: `${origin}/google-connected.html?result=${encodeURIComponent(result)}${app}${claimFragment(claim)}`, 'Cache-Control': 'no-store' },
  });
  if (!g.configured) return back(fallback, 'not_configured');
  const state = await readState(g.clientSecret, url.searchParams.get('state'));
  if (!state?.u) return back(fallback, 'expired');
  app = appParam(state);
  const origin = appOrigins(env).includes(state.o) ? state.o : fallback;
  if (url.searchParams.get('error')) return back(origin, 'cancelled');
  const code = url.searchParams.get('code');
  if (!code) return back(origin, 'cancelled');
  try {
    const tokens = await exchangeGoogleCode({ ...g, code, fetchImpl: deps.fetchImpl || fetch });
    if (!tokens.scope.includes('drive.file')) return back(origin, 'no_access');
    const service = deps.createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const claim = await parkSignIn(service, env, {
      userId: state.u, provider: 'google', email: tokens.email, refreshToken: tokens.refreshToken, scopes: tokens.scope,
    });
    return back(origin, 'finish', claim);
  } catch (err) {
    log('oauth_failed', { status: err?.status });
    return back(origin, 'failed');
  }
}

// ---- finishing a sign-in --------------------------------------------------------
// The consent page lands in whatever browser said yes. The tokens wait here
// (sheet_sync_pending_connections) until the Survey account that pressed
// Connect sends back the code that only that browser got.

function newClaimCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CLAIM_ALPHABET[b % CLAIM_ALPHABET.length]).join('');
}

const normalizeClaimCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const claimCodeHash = (env, code) => hmac(`claim:${tokenKey(env)}`, normalizeClaimCode(code));

// In the fragment, so it never reaches a server log or a Referer header.
const claimFragment = (code) => (code ? `#code=${code.slice(0, 4)}-${code.slice(4)}` : '');

async function parkSignIn(service, env, { userId, provider, email, refreshToken, scopes }) {
  const now = Date.now();
  // Old ones nobody claimed: gone.
  await service.from('sheet_sync_pending_connections').delete().lt('expires_at', new Date(now).toISOString());
  const code = newClaimCode();
  const { error } = await service.from('sheet_sync_pending_connections').upsert({
    user_id: userId,
    provider,
    code_hash: await claimCodeHash(env, code),
    account_email: email,
    refresh_token_enc: await encryptToken(refreshToken, tokenKey(env)),
    scopes,
    attempts: 0,
    expires_at: new Date(now + CLAIM_TTL_MS).toISOString(),
    created_at: new Date(now).toISOString(),
  });
  if (error) throw new Error('store failed');
  return code;
}

async function claimSignIn(ctx) {
  const provider = ctx.provider;
  const who = provider === 'msgraph' ? 'Microsoft' : 'Google';
  const pending = () => ctx.service.from('sheet_sync_pending_connections').delete()
    .eq('user_id', ctx.user.id).eq('provider', provider);
  const { data: row } = await ctx.service.from('sheet_sync_pending_connections')
    .select('code_hash, account_email, refresh_token_enc, scopes, attempts, expires_at')
    .eq('user_id', ctx.user.id).eq('provider', provider).maybeSingle();
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    throw new SyncError(`That ${who} sign-in ran out. Press Connect ${who} again.`, 410, 'claim_expired');
  }
  if (Number(row.attempts) >= CLAIM_MAX_TRIES) {
    await pending();
    throw new SyncError(`Too many wrong codes. Press Connect ${who} again.`, 429, 'claim_locked');
  }
  if (!secretsMatch(await claimCodeHash(ctx.env, ctx.body.code), row.code_hash)) {
    await ctx.service.from('sheet_sync_pending_connections').update({ attempts: Number(row.attempts) + 1 })
      .eq('user_id', ctx.user.id).eq('provider', provider);
    log('claim_wrong', { provider });
    throw new SyncError('That code does not match. Check the code the browser shows and try again.', 400, 'claim_wrong');
  }
  const { error } = await ctx.service.from('sheet_sync_connections').upsert({
    user_id: ctx.user.id,
    provider,
    account_email: row.account_email,
    refresh_token_enc: row.refresh_token_enc,
    scopes: row.scopes,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new SyncError(`Could not save the ${who} sign-in. Try again.`, 500, 'claim_store');
  await pending();
  // A link that broke because this sign-in stopped working works again.
  await ctx.service.from('sheet_sync_links').update({ status: 'active', last_error: null })
    .eq('connection_user_id', ctx.user.id).eq('provider', provider).eq('status', 'broken');
  log('claimed', { provider });
  return { ok: true, provider, email: row.account_email || null };
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
  const state = await signState(ms.clientSecret, { u: ctx.user.id, o: origin, c: ctx.body.client, e: Date.now() + STATE_TTL_MS, n: crypto.randomUUID() });
  return { url: buildMsgraphAuthorizeUrl(ms, state, { loginHint: ctx.user.email }) };
}

async function msgraphCallback(url, deps) {
  const { env } = deps;
  const ms = msgraphConfig(env);
  const fallback = appOrigins(env)[0];
  let app = '';
  const back = (origin, result, claim = '') => new Response(null, {
    status: 302,
    headers: { Location: `${origin}/google-connected.html?provider=msgraph&result=${encodeURIComponent(result)}${app}${claimFragment(claim)}`, 'Cache-Control': 'no-store' },
  });
  if (!ms) return back(fallback, 'not_configured');
  const state = await readState(ms.clientSecret, url.searchParams.get('state'));
  if (!state?.u) return back(fallback, 'expired');
  app = appParam(state);
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
    const claim = await parkSignIn(service, env, {
      userId: state.u, provider: 'msgraph', email: account.email, refreshToken: tokens.refreshToken, scopes: tokens.scopes.join(' '),
    });
    return back(origin, 'finish', claim);
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

const LINK_COLUMNS = 'id, document_id, template_id, provider, connection_user_id, file_id, file_url, title, layout, baseline, state, remote_version, app_hash, status, last_round_at, last_change_at, last_error, backoff_until, created_by';

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

// { value, argb } pairs from the app (answerSets.js excelAnswerFills), kept
// only when well formed; the workbook falls back to Y / N / N/A by tone.
function answerFillsFrom(body) {
  const fills = Array.isArray(body.answerFills) ? body.answerFills : [];
  return fills
    .filter((f) => f && typeof f.value === 'string' && f.value.length <= 80 && /^[0-9A-Fa-f]{8}$/.test(String(f.argb || '')))
    .slice(0, 20)
    .map((f) => ({ value: f.value, argb: String(f.argb).toUpperCase() }));
}

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
    .select('refresh_token_enc, account_email').eq('user_id', connectionUserId).eq('provider', 'google').maybeSingle();
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
  // The linker's account: Survey's own writes show as theirs in the file.
  return Object.assign(googleSheetsProvider({ endpoints: g.endpoints, getAccessToken, fetchImpl: ctx.fetchImpl }), { accountEmail: row.account_email || null });
}

async function msgraphProviderFor(ctx, connectionUserId) {
  const ms = msgraphConfig(ctx.env);
  if (!ms) throw new SyncError('Microsoft 365 is not set up on this server yet.', 503, 'not_configured');
  const { data: row } = await ctx.service.from('sheet_sync_connections')
    .select('refresh_token_enc, account_email').eq('user_id', connectionUserId).eq('provider', 'msgraph').maybeSingle();
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
  return Object.assign(createMsGraphProvider({ getAccessToken, fetch: ctx.fetchImpl, baseUrl: ms.graphBase }), { accountEmail: row.account_email || null });
}

async function signingFor(ctx, documentId) {
  const { data, error } = await ctx.userDb.rpc('kal308a_get_or_create_signing_secret', {
    p_document_id: documentId, p_signing_id_seed: `${documentId}:sheet-sync`,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.secret_b64) throw new SyncError('Could not get this survey\'s row keys.', 500, 'signing');
  return { keyId: row.key_id, secret: row.secret_b64, signingDocId: row.signing_doc_id };
}

// The linker's initials, the way the app makes them (PDFViewer
// getUserInitials): first and last name, else the full name, else the email.
const initialsCache = new Map();
async function initialsFor(ctx, userId) {
  if (!userId) return '';
  if (initialsCache.has(userId)) return initialsCache.get(userId);
  let out = '';
  try {
    const { data } = (await ctx.service.auth?.admin?.getUserById?.(userId)) || {};
    const user = data?.user;
    const md = user?.user_metadata || {};
    const first = md.first_name || md.firstName || '';
    const last = md.last_name || md.lastName || '';
    out = first || last
      ? `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
      : initialsOf(md.full_name || md.name || String(user?.email || '').split('@')[0]);
  } catch { out = ''; }
  initialsCache.set(userId, out);
  return out;
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
    // Where the file lives: an Excel workbook's OneDrive folder ('' = top).
    folder: link.provider === 'msgraph' ? (typeof link.state?.folder === 'string' ? link.state.folder : 'Survey') : null,
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

// "A/B" with each name cleaned the way OneDrive allows; null when not given.
export function cleanFolder(raw) {
  if (raw == null) return null;
  const parts = String(raw).split('/').map((p) => p.replace(/[\\:*?"<>|#%]/g, '-').trim()).filter((p) => p && p !== '.' && p !== '..');
  return parts.slice(0, 12).map((p) => p.slice(0, 120)).join('/');
}

// The folders inside one OneDrive folder, for "Save in" before making a
// workbook (owner 2026-11-03: "I wasn't able to select where I was going to save").
async function listFolders(ctx) {
  if (ctx.provider !== 'msgraph') throw new SyncError('Only Excel workbooks can pick a folder.', 400, 'not_supported');
  await requireBeta(ctx);
  let provider;
  try { provider = await providerFor(ctx, ctx.user.id, 'msgraph'); } catch (err) {
    if (err instanceof SyncError) throw err;
    throw new SyncError('Connect Microsoft first.', 409, 'not_connected');
  }
  const folder = cleanFolder(ctx.body.folder) ?? '';
  return { folder, folders: await provider.listFolders(folder) };
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
  const folder = ctx.provider === 'msgraph' ? cleanFolder(ctx.body.folder) : null;
  try { made = await provider.createFile({ title, layout, answerFills: answerFillsFrom(ctx.body), ...(folder != null ? { folder } : {}) }); } catch (err) {
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
    // The real file name: OneDrive adds " 1" when the name is taken.
    title: made.title || title,
    layout,
    state: { sheetIds: made.sheetIds, lastWriteAt: new Date().toISOString(), ...(made.folder != null ? { folder: made.folder } : {}) },
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
    const gap = force ? MIN_FORCED_GAP_MS : link.provider === 'msgraph' ? MIN_ROUND_GAP_MS_EXCEL : MIN_ROUND_GAP_MS;
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
    const fillBy = await initialsFor(ctx, link.connection_user_id);
    let result = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      result = await runSheetRound({ link, provider: p, loadMarkers: store.load, saveMarkers: store.save, signing: sign, force: force || attempt > 0 || Boolean(change), fillBy });
      if (result.status !== 'retry') break;
    }
    if (result.status === 'synced') {
      const moved = Object.entries(result.summary || {}).some(([k, n]) => k !== 'conflicts' && Number(n) > 0);
      await release({
        ...result.patch, status: 'active', last_round_at: new Date().toISOString(), last_error: null, backoff_until: null,
        ...(moved ? { last_change_at: new Date().toISOString() } : {}),
      });
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
    if (status === 429) {
      // The quota is the linker's, shared by every sheet they linked: all of
      // them wait, not just this one.
      await ctx.service.from('sheet_sync_links').update({ backoff_until: patch.backoff_until })
        .eq('connection_user_id', link.connection_user_id).eq('provider', link.provider);
    }
    Object.assign(link, patch);
    log('round_failed', { status });
    return { status: 'error', error: message, ...(status === 429 ? { rateLimited: true } : {}) };
  }
}

// ---- background sweep -------------------------------------------------------
// A cron job (migration 20261030030000) posts here every minute with the
// sweep secret from sheet_sync_settings. The sweep picks linked sheets no
// device has synced lately and runs each in its own request (its own CPU
// budget), as the person who linked it. Busy sheets every minute, quiet ones
// rarely, so Google's quota goes where edits are.
const SWEEP_TIERS = [
  // [changed within, check every]
  [60 * 60 * 1000, 60 * 1000],
  [24 * 60 * 60 * 1000, 5 * 60 * 1000],
  [7 * 24 * 60 * 60 * 1000, 30 * 60 * 1000],
  [Infinity, 6 * 60 * 60 * 1000],
];
// Excel's check is one cheap file read, so a workbook is looked at every
// minute for a day after it last changed, not only for the first hour.
const SWEEP_TIERS_EXCEL = [
  [24 * 60 * 60 * 1000, 60 * 1000],
  [7 * 24 * 60 * 60 * 1000, 5 * 60 * 1000],
  [Infinity, 30 * 60 * 1000],
];
// The cron fires once a minute: a link due a few seconds after a sweep runs
// in that sweep, not the next one (it waited two minutes for a one-minute tier).
const SWEEP_SLACK_MS = 15 * 1000;
const SWEEP_MAX_LINKS = 30;
const SWEEP_PARALLEL = 4;

// The sweep calls itself server to server, so it uses SUPABASE_URL (inside a
// local stack that is the gateway's in-network address), never
// SHEET_SYNC_PUBLIC_URL, which is the browser-facing address for sign-in.
const ownUrl = (env) => (env.SHEET_SYNC_SWEEP_URL || `${String(env.SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/sheet-sync`).replace(/\/$/, '');

// The cron job needs this function's address, which only the function knows.
let urlRemembered = false;
function rememberOwnUrl(env, service) {
  if (urlRemembered || !env.SUPABASE_URL) return;
  urlRemembered = true;
  service.from('sheet_sync_settings').update({ function_url: ownUrl(env), updated_at: new Date().toISOString() })
    .eq('id', 1).is('function_url', null)
    .then(() => {}, () => { urlRemembered = false; });
}

function secretsMatch(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  if (!x.length || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** When a link is next due for a background round (ms since epoch). */
export function sweepDueAt(link, now = Date.now()) {
  const changed = link.last_change_at ? new Date(link.last_change_at).getTime() : 0;
  const tiers = link.provider === 'msgraph' ? SWEEP_TIERS_EXCEL : SWEEP_TIERS;
  const every = tiers.find(([within]) => now - changed < within)[1];
  const last = link.last_round_at ? new Date(link.last_round_at).getTime() : 0;
  return last + every;
}

// The linker's database calls, made by the server on their behalf.
const asUser = (service, userId) => ({
  from: (table) => service.from(table),
  rpc: async (name, args = {}) => {
    const { data, error } = await service.rpc('sheet_sync_as_user', { p_user_id: userId, p_call: name, p_args: args });
    return { data, error };
  },
});

async function sweep(req, deps) {
  const { env } = deps;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'server_misconfigured' }, 500);
  const service = deps.createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: settings } = await service.from('sheet_sync_settings').select('sweep_secret').eq('id', 1).maybeSingle();
  const given = (req.headers.get('x-sheet-sync-sweep') || '').trim();
  if (!settings?.sweep_secret || !secretsMatch(given, settings.sweep_secret)) return json({ error: 'unauthorized' }, 401);
  let body = {};
  try { body = (await req.json()) || {}; } catch { /* none */ }
  const fetchImpl = deps.fetchImpl || fetch;

  if (typeof body.linkId === 'string' && UUID.test(body.linkId)) {
    const { data: link } = await service.from('sheet_sync_links').select(LINK_COLUMNS).eq('id', body.linkId).maybeSingle();
    if (!link || link.status !== 'active') return json({ status: 'skipped' });
    if (Date.now() + SWEEP_SLACK_MS < sweepDueAt(link)) return json({ status: 'recent' });
    const ctx = {
      ...deps, fetchImpl, service, body: {}, provider: link.provider, providerGiven: true,
      user: { id: link.connection_user_id }, userDb: asUser(service, link.connection_user_id),
    };
    try {
      const round = await runRoundFor(ctx, link, {});
      log('swept', { status: round.status });
      return json({ status: round.status, rateLimited: Boolean(round.rateLimited) });
    } catch (err) {
      log('sweep_failed', { code: err?.code, status: err?.status });
      return json({ status: 'error' });
    }
  }

  // Which sheets are due: live, not waiting out a "slow down", not mid-round.
  const now = Date.now();
  const { data: links } = await service.from('sheet_sync_links')
    .select('id, provider, last_round_at, last_change_at, backoff_until, lease_until')
    .eq('status', 'active')
    .order('last_round_at', { ascending: true, nullsFirst: true })
    .limit(500);
  const due = (links || []).filter((l) => (!l.backoff_until || new Date(l.backoff_until).getTime() <= now)
    && (!l.lease_until || new Date(l.lease_until).getTime() <= now)
    && sweepDueAt(l, now) <= now + SWEEP_SLACK_MS).slice(0, SWEEP_MAX_LINKS);
  const results = [];
  let stop = false;
  const queue = [...due];
  const worker = async () => {
    while (queue.length && !stop) {
      const link = queue.shift();
      try {
        const res = await fetchImpl(`${ownUrl(env)}/sweep`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-sheet-sync-sweep': settings.sweep_secret },
          body: JSON.stringify({ linkId: link.id }),
        });
        const out = await res.json().catch(() => ({}));
        results.push(out.status || `http_${res.status}`);
        // Google said slow down: that is likely the whole app's quota. Stop
        // this minute's sweep; the next one tries again.
        if (out.rateLimited) stop = true;
      } catch {
        results.push('unreachable');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SWEEP_PARALLEL, due.length) }, worker));
  log('sweep', { due: due.length, ran: results.length, stopped: stop });
  return json({ due: due.length, results });
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
  // It stops for everyone on the survey, so only its owners and editors may
  // (owner 2026-11-03), plus the person who linked it.
  if (role !== 'owner' && role !== 'editor' && link.connection_user_id !== ctx.user.id) {
    throw new SyncError('Only the survey\'s owners and editors can stop syncing.', 403, 'not_allowed');
  }
  // The sheet itself stays in the person's Google Drive; it just stops syncing.
  await ctx.service.from('sheet_sync_links').delete().eq('id', link.id);
  return statusFor(ctx);
}
