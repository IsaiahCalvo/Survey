// The sheet-sync edge function's logic (supabase/functions/sheet-sync wraps
// it). Plain JS with its outside pieces passed in (supabase-js createClient,
// yjs, fetch, env), so node tests drive the whole function against the local
// database and a fake Google.
//
// Who may do what:
//   * connect / disconnect Google: any signed-in person (their own sign-in);
//   * link a survey to a new Google Sheet: an editor or owner of the document,
//     signed in to Google, with the beta on (flag 'sheet-team-sync' or a
//     Nightly tester);
//   * run a round, answer a conflict: any editor or owner of a linked
//     document. A field tech never needs a Google account: the server reaches
//     the sheet with the sign-in of the person who linked it, and writes the
//     markers as the field tech (append_annotation_update checks the role);
//   * unlink: the person who linked it, or the document's owner.
import { buildSyncLayout } from './layout.js';
import { runSheetRound } from './round.js';
import { encryptToken, decryptToken } from './tokenCrypto.js';
import {
  googleEndpoints, googleAuthUrl, googleSheetsProvider, exchangeGoogleCode, refreshGoogleToken, revokeGoogleToken,
} from './providers/google.js';
import { docToSurveyMarkers, syncSurveyMarkersToDoc } from '../surveyMarkerDocSync.js';
import { bytesToPgHex, pgHexToBytes } from '../pgBytea.js';
import { parseBody, s } from '../inputSchema.js';
import { GUEST_REFUSED_MESSAGE, isGuestUser } from '../guestSession.js';

export const SHEET_SYNC_FLAG = 'sheet-team-sync';
const MARKER_FIELDS_FLAG = 'survey-marker-fields';
const SNAPSHOT_ENC_GZIP = 2;
const MIN_ROUND_GAP_MS = 3000; // two devices asking at once share one round
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
        const responses = { ...(now.checklistResponses || {}) };
        const a = was.checklistResponses || {};
        const b = next.checklistResponses || {};
        for (const cid of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if (stable(a[cid]) === stable(b[cid])) continue;
          if (b[cid] === undefined) delete responses[cid]; else responses[cid] = b[cid];
        }
        merged.checklistResponses = responses;
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
      choice: s.enum(['app', 'sheet', 'putBack'], { optional: true }),
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
      // Google today; Microsoft 365 workbooks plug in here (providers/msgraph.js).
      provider: parsed.value.provider || 'google',
      userDb: deps.createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }),
      service: deps.createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }),
    };
    switch (parsed.value.action) {
      case 'status': return json(await statusFor(ctx));
      case 'connect': return json(await connectGoogle(ctx));
      case 'disconnect': return json(await disconnectGoogle(ctx));
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
  if (ctx.provider !== 'google') throw new SyncError('Microsoft 365 live sync is not switched on yet.', 501, 'provider_not_ready');
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

// ---- gates ----------------------------------------------------------------------

async function requireBeta(ctx) {
  const [{ data: flags }, { data: nightly }] = await Promise.all([
    ctx.userDb.rpc('get_my_feature_flags'),
    ctx.userDb.rpc('can_use_nightly'),
  ]);
  if (flags?.[SHEET_SYNC_FLAG] === true || nightly === true) return;
  throw new SyncError('Google Sheets live sync is in beta on Survey Nightly.', 403, 'beta');
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

async function linkFor(ctx, documentId, templateId) {
  if (!templateId) throw new SyncError('Say which survey template.', 400, 'missing_template');
  const { data, error } = await ctx.service.from('sheet_sync_links').select(LINK_COLUMNS)
    .eq('document_id', documentId).eq('template_id', templateId).eq('provider', ctx.provider).maybeSingle();
  if (error) throw new SyncError('Could not read the sheet link.', 500, 'link_read');
  return data;
}

function layoutFrom(body) {
  if (!body.template || !body.kit) return null;
  try {
    return buildSyncLayout({ template: body.template, kit: body.kit, answerValues: body.answerValues || ['Y', 'N', 'N/A'] });
  } catch {
    throw new SyncError('This survey template cannot be laid out as a sheet.', 400, 'bad_layout');
  }
}

async function providerFor(ctx, connectionUserId, provider = 'google') {
  if (provider !== 'google') throw new SyncError('Microsoft 365 live sync is not switched on yet.', 501, 'provider_not_ready');
  const g = googleConfig(ctx.env);
  if (!g.configured) throw new SyncError('Google Sheets is not set up on this server yet.', 503, 'not_configured');
  const { data: row } = await ctx.service.from('sheet_sync_connections')
    .select('refresh_token_enc').eq('user_id', connectionUserId).eq('provider', 'google').maybeSingle();
  if (!row) throw Object.assign(new Error('no connection'), { status: 401 });
  const refreshToken = await decryptToken(row.refresh_token_enc, tokenKey(ctx.env));
  let access = null;
  const getAccessToken = async () => {
    if (access && access.expiresAt > Date.now() + 60_000) return access.accessToken;
    access = await refreshGoogleToken({ ...g, refreshToken, fetchImpl: ctx.fetchImpl });
    return access.accessToken;
  };
  return googleSheetsProvider({ endpoints: g.endpoints, getAccessToken, fetchImpl: ctx.fetchImpl });
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

const publicLink = (link, userId) => (link ? {
  provider: link.provider,
  fileUrl: link.file_url,
  title: link.title,
  status: link.status,
  lastRoundAt: link.last_round_at,
  lastError: link.last_error,
  isConnectionOwner: link.connection_user_id === userId,
  conflicts: Object.entries(link.state?.conflicts || {}).map(([markerId, c]) => ({ markerId, ...c })),
  removedInSheet: Object.entries(link.state?.removedInSheet || {}).map(([markerId, r]) => ({ markerId, ...r })),
  problems: (link.state?.problems || []).slice(0, 50),
  missingTabs: link.state?.missingTabs || [],
} : null);

async function statusFor(ctx, round = null) {
  const g = googleConfig(ctx.env);
  const { data: conn } = await ctx.service.from('sheet_sync_connections')
    .select('account_email').eq('user_id', ctx.user.id).eq('provider', ctx.provider).maybeSingle();
  let link = null;
  let role = null;
  if (ctx.body.documentId && ctx.body.templateId) {
    role = await roleOf(ctx, ctx.body.documentId);
    if (role) link = await linkFor(ctx, ctx.body.documentId, ctx.body.templateId);
  }
  return {
    configured: g.configured,
    google: { connected: Boolean(conn), email: conn?.account_email || null },
    role,
    link: publicLink(link, ctx.user.id),
    ...(round ? { round } : {}),
  };
}

async function linkSheet(ctx) {
  const { documentId, templateId } = ctx.body;
  if (ctx.provider !== 'google') throw new SyncError('Microsoft 365 live sync is not switched on yet.', 501, 'provider_not_ready');
  await requireEditor(ctx, documentId);
  await requireBeta(ctx);
  if (!templateId) throw new SyncError('Say which survey template.', 400, 'missing_template');
  const layout = layoutFrom(ctx.body);
  if (!layout?.scopes.length) throw new SyncError('This template has no categories to put in a sheet.', 400, 'empty_layout');
  const existing = await linkFor(ctx, documentId, templateId);
  if (existing) throw new SyncError('This survey already has a linked Google Sheet.', 409, 'already_linked');
  let provider;
  try { provider = await providerFor(ctx, ctx.user.id); } catch (err) {
    if (err instanceof SyncError) throw err;
    throw new SyncError('Connect Google first.', 409, 'not_connected');
  }
  const signing = await signingFor(ctx, documentId);
  const title = ctx.body.title || 'Survey';
  const made = await provider.createFile({ title, layout });
  const { data: link, error } = await ctx.service.from('sheet_sync_links').insert({
    document_id: documentId,
    template_id: templateId,
    provider: 'google',
    connection_user_id: ctx.user.id,
    file_id: made.fileId,
    file_url: made.url,
    title,
    layout,
    state: { sheetIds: made.sheetIds },
    created_by: ctx.user.id,
  }).select(LINK_COLUMNS).single();
  if (error) throw new SyncError('Could not save the sheet link.', 500, 'link_write');
  log('linked', { provider: 'google', scopes: layout.scopes.length });
  const round = await runRoundFor(ctx, link, { provider, signing, force: true });
  return statusFor(ctx, round);
}

async function runRoundFor(ctx, link, { provider = null, signing = null, force = false } = {}) {
  if (link.status === 'paused') return { status: 'paused' };
  if (!force && link.backoff_until && new Date(link.backoff_until).getTime() > Date.now()) return { status: 'waiting' };
  if (!force && link.last_round_at && Date.now() - new Date(link.last_round_at).getTime() < MIN_ROUND_GAP_MS
      && !Object.keys(link.state?.choices || {}).length) {
    return { status: 'recent' };
  }
  const { data: leased } = await ctx.service.rpc('sheet_sync_take_lease', { p_link_id: link.id, p_seconds: 60 });
  if (leased !== true) return { status: 'busy' };
  const release = (patch) => ctx.service.from('sheet_sync_links')
    .update({ ...patch, lease_until: null, updated_at: new Date().toISOString() }).eq('id', link.id);
  try {
    const p = provider || await providerFor(ctx, link.connection_user_id, link.provider);
    const sign = signing || await signingFor(ctx, link.document_id);
    const store = markerStore(ctx, link.document_id);
    let result = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      result = await runSheetRound({ link, provider: p, loadMarkers: store.load, saveMarkers: store.save, signing: sign, force: force || attempt > 0 });
      if (result.status !== 'retry') break;
    }
    if (result.status === 'synced') {
      await release({ ...result.patch, status: 'active', last_round_at: new Date().toISOString(), last_error: null, backoff_until: null });
      Object.assign(link, result.patch, { status: 'active', last_error: null, last_round_at: new Date().toISOString() });
    } else {
      await release({ last_round_at: new Date().toISOString() });
    }
    return { status: result.status, ...(result.summary ? { summary: result.summary } : {}) };
  } catch (err) {
    if (err instanceof SyncError) {
      await release({ last_error: err.message });
      throw err;
    }
    const status = Number(err?.status) || 500;
    const message = status === 401 ? 'The Google sign-in used for this sheet stopped working. The person who linked it needs to connect Google again.'
      : status === 404 ? 'The linked Google Sheet was deleted or is no longer shared with the person who linked it.'
      : status === 429 ? 'Google asked us to slow down. Syncing again in a minute.'
      : status === 409 && err?.code === 'personal-onedrive' ? 'This workbook is on a personal OneDrive, which cannot sync cell by cell.'
      : 'Could not reach the Google Sheet. Trying again soon.';
    const patch = { last_error: message };
    if (status === 401 || status === 404) patch.status = 'broken';
    if (status === 409 && err?.code === 'personal-onedrive') patch.status = 'paused';
    if (status === 429) patch.backoff_until = new Date(Date.now() + 60_000).toISOString();
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
  if (!link) throw new SyncError('This survey has no linked Google Sheet.', 404, 'not_linked');
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
  const { documentId, templateId, markerId, choice } = ctx.body;
  await requireEditor(ctx, documentId);
  if (!markerId || !choice) throw new SyncError('Say which row and which side.', 400, 'missing_choice');
  const link = await linkFor(ctx, documentId, templateId);
  if (!link) throw new SyncError('This survey has no linked Google Sheet.', 404, 'not_linked');
  const state = { ...(link.state || {}) };
  const known = choice === 'putBack' ? state.removedInSheet?.[markerId] : state.conflicts?.[markerId];
  if (!known) return statusFor(ctx);
  state.choices = { ...(state.choices || {}), [markerId]: choice };
  await ctx.service.from('sheet_sync_links').update({ state }).eq('id', link.id);
  link.state = state;
  const round = await runRoundFor(ctx, link, { force: true });
  return statusFor(ctx, round);
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
