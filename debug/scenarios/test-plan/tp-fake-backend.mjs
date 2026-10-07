// A tiny in-memory stand-in for the Supabase backend, served from inside the
// Playwright process. NOTHING here touches the network or the real database.
//
// WHY: the real document path (Y.Doc store, write-ahead log, live sync between
// windows, History) only runs for a document with an id, and with an id the
// app talks to Supabase. Instead of a real account, every Supabase request the
// test browser makes is answered here:
//   * REST (PostgREST): a few tables kept in memory with insert / upsert /
//     select / update / delete and the filters the app uses (eq, neq, gt, gte,
//     lt, lte, in, is, the History keyset `or`), order, limit.
//   * RPC: append_annotation_update (the write-ahead log; assigns `seq` and
//     tells every subscribed window, as Postgres Realtime would),
//     store_annotation_snapshot (the checkpoint, with the real function's
//     compare-and-set: at_seq must be the log head and the expected base must
//     be the stored one), get_my_document_role ('owner'); anything else
//     answers null.
//   * Realtime (WebSocket, Phoenix protocol v2): channel join/leave, heartbeat,
//     broadcast relay between windows (JSON and binary user pushes), presence,
//     and postgres_changes INSERT delivery for annotation_updates.
//   * auth answers 401 (the route has no session), storage/functions answer {}.
// Two browser contexts that share one FakeBackend behave like two windows on
// one live document. `counts` records every call for the evidence table.
//
// Two accounts (2026-10-07, shared templates): `attach(context, { userId })`
// makes every request from that window act as that person, and the template
// tables answer under the same row-level rules as the real database
// (supabase/migrations/20260701120000_project_template_sharing.sql):
//   templates             SELECT owner or any active collaborator; UPDATE owner
//                         or an editor+ collaborator; INSERT/DELETE owner
//   template_collaborators SELECT anyone who can see the template; INSERT /
//                         UPDATE only the template's owner; DELETE owner or self
//   template_invites      owner only
//   replace_my_templates  the caller's own rows only (refuses another's row)
// get_my_document_role answers per person (the document's owner, else their
// document_collaborators row). Without a userId everything acts as the owner,
// exactly as before.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DOC_TOOL = fileURLToPath(new URL('./tp-doc-tool.mjs', import.meta.url));

// The app's store code runs in a child Node (see tp-doc-tool.mjs for why).
function runDocTool(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', DOC_TOOL], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`tp-doc-tool failed (${code}): ${Buffer.concat(err).toString().slice(0, 400)}`));
      else resolve(JSON.parse(Buffer.concat(out).toString('utf8')));
    });
    child.stdin.end(JSON.stringify(input));
  });
}

const json = (value) => JSON.stringify(value);
const nowIso = () => new Date().toISOString();
let uuidCounter = 0;
const fakeUuid = () => {
  uuidCounter += 1;
  const hex = uuidCounter.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
};

function parseValue(raw) {
  let v = decodeURIComponent(raw);
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v;
}

function compare(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  const na = Number(a);
  const nb = Number(b);
  if (typeof a !== 'string' || typeof b !== 'string') {
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  }
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (/^\d{4}-\d\d-\d\dT/.test(String(a)) && Number.isFinite(da) && Number.isFinite(db)) return da - db;
  if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === String(a) && String(nb) === String(b)) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function getPath(row, column) {
  // payload->restoreAction->>spaceId style JSON paths.
  const parts = column.split(/->>?/);
  let value = row[parts[0]];
  for (const part of parts.slice(1)) value = value == null ? undefined : value[part];
  return value;
}

function testCondition(row, column, expr) {
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const rawValue = expr.slice(dot + 1);
  const actual = getPath(row, column);
  switch (op) {
    case 'eq': return String(actual) === parseValue(rawValue);
    case 'neq': return String(actual) !== parseValue(rawValue);
    case 'gt': return compare(actual, parseValue(rawValue)) > 0;
    case 'gte': return compare(actual, parseValue(rawValue)) >= 0;
    case 'lt': return compare(actual, parseValue(rawValue)) < 0;
    case 'lte': return compare(actual, parseValue(rawValue)) <= 0;
    case 'is': return rawValue === 'null' ? actual == null : String(actual) === rawValue;
    case 'in': {
      const list = decodeURIComponent(rawValue).replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
      return list.includes(String(actual));
    }
    case 'not': {
      const rest = rawValue;
      return !testCondition(row, column, rest);
    }
    case 'like':
    case 'ilike': {
      const pattern = parseValue(rawValue).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/%/g, '.*');
      return new RegExp(`^${pattern}$`, op === 'ilike' ? 'i' : '').test(String(actual ?? ''));
    }
    default: return true;
  }
}

// `or=(a.lt."x",and(a.eq."x",id.lt.y))` — split on top-level commas.
function splitTop(text) {
  const out = [];
  let depth = 0;
  let quote = false;
  let cur = '';
  for (const ch of text) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === '(') depth += 1;
    if (!quote && ch === ')') depth -= 1;
    if (!quote && depth === 0 && ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function testLogic(row, kind, body) {
  const items = splitTop(body);
  const results = items.map((item) => {
    const nested = item.match(/^(and|or)\((.*)\)$/);
    if (nested) return testLogic(row, nested[1], nested[2]);
    const firstDot = item.indexOf('.');
    return testCondition(row, item.slice(0, firstDot), item.slice(firstDot + 1));
  });
  return kind === 'and' ? results.every(Boolean) : results.some(Boolean);
}

function applyFilters(rows, params) {
  let out = rows;
  for (const [key, value] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue;
    if (key === 'or' || key === 'and') {
      const body = decodeURIComponent(value).replace(/^\(|\)$/g, '');
      out = out.filter((row) => testLogic(row, key, body));
      continue;
    }
    out = out.filter((row) => testCondition(row, key, value));
  }
  const order = params.get('order');
  if (order) {
    const keys = order.split(',').map((part) => {
      const [column, dir = 'asc'] = part.split('.');
      return { column, desc: dir === 'desc' };
    });
    out = [...out].sort((a, b) => {
      for (const { column, desc } of keys) {
        const c = compare(a[column], b[column]);
        if (c !== 0) return desc ? -c : c;
      }
      return 0;
    });
  }
  const offset = Number(params.get('offset') || 0);
  const limit = params.has('limit') ? Number(params.get('limit')) : Infinity;
  return out.slice(offset, offset + limit);
}

export class FakeBackend {
  constructor({ documentId, ownerId = 'dev-test-user', role = 'owner', latencyMs = 0 } = {}) {
    this.documentId = documentId;
    this.ownerId = ownerId;
    this.role = role;
    this.latencyMs = latencyMs;
    this.tables = new Map();
    this.counts = new Map();
    this.sockets = new Set();
    this.walSeq = 0;
    this.presenceRef = 0;
    // The document row: its owner is the dev route's signed-in user (the
    // eraser and History refuse to act without a known owner), already on the
    // live mark store (cutover sealed), not locked.
    this.table('documents').push({
      id: documentId,
      user_id: ownerId,
      name: 'Test plan document',
      locked_at: null,
      locked_by: null,
      locked_label: null,
      tool_preferences: null,
      cutover_completed_at: '2026-09-01T00:00:00.000Z',
      annotations_changed_at: null,
      created_at: '2026-09-01T00:00:00.000Z',
    });
  }

  table(name) {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name);
  }

  count(key) {
    this.counts.set(key, (this.counts.get(key) || 0) + 1);
    if (!key.startsWith('GET ') && !key.startsWith('WS ')) this.lastWriteAt = Date.now();
  }

  /**
   * Wait until no write has arrived for `quietMs` (a first open uploads the
   * PDF's own markup as dozens of log rows; edits made meanwhile queue
   * behind it for a few seconds).
   */
  async settle({ quietMs = 1500, timeout = 60_000 } = {}) {
    const until = Date.now() + timeout;
    this.lastWriteAt = this.lastWriteAt || Date.now();
    while (Date.now() < until && Date.now() - this.lastWriteAt < quietMs) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  summary() {
    return [...this.counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}x ${k}`);
  }

  writes() {
    let n = 0;
    for (const [k, v] of this.counts) if (!k.startsWith('GET ') && !k.startsWith('WS ')) n += v;
    return n;
  }

  /** Install REST + Realtime handlers on a browser context (after any blocking route). */
  async attach(context, { userId = null } = {}) {
    const caller = userId || this.ownerId;
    await context.route(/\.supabase\.co\//, (route) => this.handleRest(route, caller));
    if (typeof context.routeWebSocket === 'function') {
      await context.routeWebSocket(/\.supabase\.co\/realtime\//, (ws) => this.handleSocket(ws));
    }
  }

  // ------------------------------------------------ row-level rules (templates)

  templateRole(caller, templateId) {
    const tpl = this.table('templates').find((t) => t.id === templateId);
    if (!tpl) return null;
    if (tpl.user_id === caller) return 'owner-of-row';
    const row = this.table('template_collaborators')
      .find((r) => r.template_id === templateId && r.user_id === caller && (r.status ?? 'active') === 'active');
    return row?.role || null;
  }

  canAccessTemplate(caller, templateId, need = 'viewer') {
    const role = this.templateRole(caller, templateId);
    if (!role) return false;
    if (role === 'owner-of-row') return true;
    const rank = { viewer: 1, editor: 2, owner: 3 };
    return (rank[role] || 0) >= rank[need];
  }

  canSee(caller, name, row) {
    if (name === 'templates') return this.canAccessTemplate(caller, row.id, 'viewer');
    if (name === 'template_collaborators') return this.canAccessTemplate(caller, row.template_id, 'viewer');
    if (name === 'template_invites') return this.canAccessTemplate(caller, row.template_id, 'owner');
    return true;
  }

  canInsert(caller, name, row) {
    if (name === 'templates') return row.user_id === caller;
    if (name === 'template_collaborators' || name === 'template_invites') return this.canAccessTemplate(caller, row.template_id, 'owner');
    return true;
  }

  canUpdate(caller, name, row) {
    if (name === 'templates') return row.user_id === caller || this.canAccessTemplate(caller, row.id, 'editor');
    if (name === 'template_collaborators' || name === 'template_invites') return this.canAccessTemplate(caller, row.template_id, 'owner');
    return true;
  }

  canDelete(caller, name, row) {
    if (name === 'templates') return row.user_id === caller || this.canAccessTemplate(caller, row.id, 'owner');
    if (name === 'template_collaborators') return row.user_id === caller || this.canAccessTemplate(caller, row.template_id, 'owner');
    if (name === 'template_invites') return this.canAccessTemplate(caller, row.template_id, 'owner');
    return true;
  }

  /** The caller's role on this document, as get_my_document_role answers. */
  documentRoleFor(caller) {
    if (!caller || caller === this.ownerId) return this.role;
    const row = this.table('document_collaborators')
      .find((r) => r.document_id === this.documentId && r.user_id === caller && (r.status ?? 'active') === 'active');
    return row?.role || null;
  }

  /** public.replace_my_templates (migration 20260811140000), in memory: the
   *  caller's whole template list in one go; another person's row refuses. */
  replaceMyTemplates(entries, caller) {
    if (!Array.isArray(entries)) return { __rpcError: 'Templates must be a JSON array' };
    const rows = this.table('templates');
    const retained = [];
    for (const entry of entries) {
      const id = entry?.supabase_id;
      if (!id) return { __rpcError: 'Invalid template row id' };
      const existing = rows.find((r) => r.id === id);
      if (existing && existing.user_id !== caller) return { __rpcError: 'Template row does not belong to the signed-in user' };
      if (existing) Object.assign(existing, { name: String(entry.name).trim(), config: entry.config, updated_at: nowIso() });
      else rows.push({ id, user_id: caller, name: String(entry.name).trim(), config: entry.config, created_at: nowIso(), updated_at: nowIso(), user_archived_at: null });
      retained.push(id);
    }
    this.tables.set('templates', rows.filter((r) => r.user_id !== caller || retained.includes(r.id)));
    return this.table('templates').filter((r) => r.user_id === caller)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  /** A template row owned by `ownerId` (config = the app's template object). */
  seedTemplate({ ownerId = this.ownerId, config, name = config?.name || 'Template' }) {
    const row = {
      id: fakeUuid(), user_id: ownerId, name, config,
      created_at: nowIso(), updated_at: nowIso(), user_archived_at: null,
    };
    this.table('templates').push(row);
    return row;
  }

  /** Share the document with `userId` as `role` (a document_collaborators row). */
  seedDocumentCollaborator({ userId, role = 'editor', email = null }) {
    const row = { id: fakeUuid(), document_id: this.documentId, user_id: userId, role, email, status: 'active', created_at: nowIso() };
    this.table('document_collaborators').push(row);
    return row;
  }

  async handleRest(route, caller = this.ownerId) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    const path = url.pathname;
    const accept = req.headers().accept || '';
    const prefer = req.headers().prefer || '';
    const wantsObject = accept.includes('vnd.pgrst.object');
    // Same CORS answer as the real API (WebKit enforces it on fulfilled
    // responses; Chromium does not).
    const cors = {
      'access-control-allow-origin': req.headers().origin || '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*, authorization, apikey, content-type, prefer, accept-profile, content-profile, x-client-info, range',
      'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS',
      'access-control-expose-headers': 'content-range, content-profile, range',
    };
    const reply = (status, body, headers = {}) => {
      // eslint-disable-next-line no-console
      if (process.env.TP_DEBUG && method !== 'GET') console.log(`[fake] ${method} ${path} -> ${status}`);
      return route.fulfill({ status, headers: { ...cors, ...headers }, contentType: 'application/json', body: body === undefined ? '' : json(body) });
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });

    if (path.startsWith('/auth/')) { this.count(`${method} ${path}`); return reply(401, { message: 'no session (fake backend)' }); }
    if (path.startsWith('/storage/') || path.startsWith('/functions/')) { this.count(`${method} ${path}`); return reply(200, {}); }

    const rpc = path.match(/^\/rest\/v1\/rpc\/(.+)$/);
    if (rpc) {
      this.count(`RPC ${rpc[1]}`);
      let args = {};
      try { args = JSON.parse(req.postData() || '{}') || {}; } catch { args = {}; }
      // A test can hold checkpoint uploads (`holdSnapshots()`): the request
      // waits, then is answered — or dropped, as when its tab is reloaded.
      if (rpc[1] === 'store_annotation_snapshot' && this.snapshotHold) {
        const verdict = await this.snapshotHold.promise;
        if (verdict === 'drop') {
          this.count('snapshot dropped (tab gone)');
          return route.abort().catch(() => {});
        }
      }
      const answer = this.rpc(rpc[1], args, caller);
      if (answer && answer.__rpcError) return reply(400, { code: 'P0001', message: answer.__rpcError });
      return reply(200, answer);
    }
    const tableMatch = path.match(/^\/rest\/v1\/([^/]+)$/);
    if (!tableMatch) { this.count(`${method} ${path}`); return reply(404, { message: 'unknown path' }); }
    const name = tableMatch[1];
    this.count(`${method} ${name}`);
    const rows = this.table(name);
    const params = url.searchParams;
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `0-0/${rows.length}` }, body: '' });
    if (method === 'GET') {
      const result = applyFilters(rows.filter((r) => this.canSee(caller, name, r)), params);
      // eslint-disable-next-line no-console
      if (process.env.TP_DEBUG) console.log(`[fake] GET ${name}?${decodeURIComponent(url.search.slice(1))} -> ${result.length}/${rows.length}`);
      if (wantsObject) return result[0] ? reply(200, result[0]) : reply(406, { code: 'PGRST116', message: 'no rows' });
      return reply(200, result);
    }
    let body = null;
    try { body = JSON.parse(req.postData() || 'null'); } catch { body = null; }
    if (method === 'POST') {
      const incoming = (Array.isArray(body) ? body : [body]).filter(Boolean);
      const conflict = params.get('on_conflict')?.split(',') || null;
      const ignore = prefer.includes('ignore-duplicates');
      const out = [];
      const refused = incoming.find((raw) => !this.canInsert(caller, name, raw));
      if (refused) {
        this.count(`refused INSERT ${name} (row-level security)`);
        return reply(403, { code: '42501', message: `new row violates row-level security policy for table "${name}"` });
      }
      for (const raw of incoming) {
        const row = { id: raw.id ?? fakeUuid(), created_at: raw.created_at ?? nowIso(), ...raw };
        if (name === 'document_history_events') row.created_at = nowIso();
        const existingIndex = conflict
          ? rows.findIndex((r) => conflict.every((c) => String(r[c]) === String(row[c])))
          : rows.findIndex((r) => r.id === row.id);
        if (existingIndex >= 0) {
          if (!ignore) {
            const old = rows[existingIndex];
            rows[existingIndex] = { ...old, ...raw };
            this.emitChange(name, 'UPDATE', rows[existingIndex], old);
          }
          out.push(rows[existingIndex]);
        } else {
          rows.push(row);
          out.push(row);
          this.emitChange(name, 'INSERT', row, null);
        }
      }
      if (wantsObject) return reply(201, out[0] ?? null);
      return reply(201, prefer.includes('return=representation') ? out : undefined);
    }
    if (method === 'PATCH') {
      const matched = applyFilters(rows.filter((r) => this.canSee(caller, name, r) && this.canUpdate(caller, name, r)), params);
      if (wantsObject && matched.length === 0) return reply(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
      for (const row of matched) {
        const old = { ...row };
        Object.assign(row, body || {});
        this.emitChange(name, 'UPDATE', row, old);
      }
      if (wantsObject) return reply(200, matched[0] ?? null);
      return reply(200, prefer.includes('return=representation') ? matched : undefined);
    }
    if (method === 'DELETE') {
      const matched = new Set(applyFilters(rows.filter((r) => this.canSee(caller, name, r) && this.canDelete(caller, name, r)), params));
      this.tables.set(name, rows.filter((r) => !matched.has(r)));
      for (const row of matched) this.emitChange(name, 'DELETE', null, row);
      return reply(200, prefer.includes('return=representation') ? [...matched] : undefined);
    }
    return reply(405, { message: 'method' });
  }

  /**
   * Put marks (and optional eraser lanes) in the document "on the server"
   * before a window opens it: one write-ahead-log row built with the app's own
   * store code, exactly as another device would have written it.
   */
  async seedMarks(byPage, lanes = {}) {
    const { hex } = await runDocTool({ op: 'seed', byPage, lanes });
    this.walSeq += 1;
    this.table('annotation_updates').push({
      id: fakeUuid(),
      seq: this.walSeq,
      document_id: this.documentId,
      client_id: 'tp-seed-writer',
      client_seq: this.walSeq,
      actor_user_id: this.ownerId,
      data: `\\x${hex}`,
      created_at: nowIso(),
    });
    return hex.length / 2;
  }

  /**
   * The document as the server holds it (the stored checkpoint, then every
   * WAL row after it, applied with the app's store code — what a fresh open
   * reads): { byPage, lanes } — lanes keyed "<writer> <storageKey>".
   */
  async serverState() {
    const snapshot = this.table('annotation_snapshots').find((r) => r.document_id === this.documentId) || null;
    const after = snapshot ? Number(snapshot.at_seq) || 0 : 0;
    const rows = [...this.table('annotation_updates')].filter((r) => r.seq > after).sort((a, b) => a.seq - b.seq);
    return runDocTool({
      op: 'decode',
      rows,
      snapshot: snapshot ? { data: snapshot.snapshot, encoding: snapshot.encoding_version } : null,
    });
  }

  /** Ink objects' outlines in page units (same transform the app renders with). */
  // eslint-disable-next-line class-methods-use-this
  async pagePaths(objects) {
    return (await runDocTool({ op: 'toPage', objects })).paths;
  }

  rpc(name, args, caller = this.ownerId) {
    if (name === 'append_annotation_update') {
      const rows = this.table('annotation_updates');
      const existing = rows.find((r) => r.client_id === args.p_client_id && Number(r.client_seq) === Number(args.p_client_seq));
      if (existing) return existing.seq;
      this.walSeq += 1;
      const row = {
        id: fakeUuid(),
        seq: this.walSeq,
        document_id: args.p_document_id,
        client_id: args.p_client_id,
        client_seq: args.p_client_seq,
        // The real append function stamps the caller (auth.uid()); readers check it.
        actor_user_id: caller,
        data: args.p_data,
        created_at: nowIso(),
      };
      rows.push(row);
      this.emitInsert('annotation_updates', row);
      return row.seq;
    }
    if (name === 'store_annotation_snapshot') return this.storeSnapshot(args);
    if (name === 'get_my_document_role') return this.documentRoleFor(caller);
    if (name === 'replace_my_templates') return this.replaceMyTemplates(args.p_templates, caller);
    return null;
  }

  /**
   * Hold every checkpoint upload until the returned release(verdict) is
   * called: 'answer' (stored or refused as usual) or 'drop' (never reaches
   * the server, as when its tab is reloaded first).
   */
  holdSnapshots() {
    let release;
    const promise = new Promise((resolve) => { release = resolve; });
    this.snapshotHold = { promise };
    return (verdict = 'answer') => { this.snapshotHold = null; release(verdict); };
  }

  /** public.store_annotation_snapshot (supabase/migrations/20260727131230), in memory. */
  storeSnapshot(args) {
    const rows = this.table('annotation_snapshots');
    const current = rows.find((r) => r.document_id === args.p_document_id) || null;
    const same = (a, b) => (a ?? null) === (b ?? null);
    if (current
      && Number(current.at_seq) === Number(args.p_at_seq)
      && current.snapshot === args.p_snapshot
      && Number(current.encoding_version) === Number(args.p_encoding_version)
      && same(current.writer_id, args.p_writer_id)
      && Number(current.writer_epoch) === Number(args.p_writer_epoch)) return true;
    const head = this.table('annotation_updates')
      .filter((r) => r.document_id === args.p_document_id)
      .reduce((max, r) => Math.max(max, Number(r.seq) || 0), 0);
    if (head !== Number(args.p_at_seq)) { this.count('snapshot refused (head moved)'); return false; }
    if (current) {
      if (!same(current.at_seq == null ? null : Number(current.at_seq), args.p_expected_at_seq == null ? null : Number(args.p_expected_at_seq))
        || !same(current.writer_id, args.p_expected_writer_id)
        || Number(current.writer_epoch) !== Number(args.p_expected_writer_epoch)
        || Number(current.at_seq) > Number(args.p_at_seq)
        || Number(current.writer_epoch) >= Number(args.p_writer_epoch)) { this.count('snapshot refused (base changed)'); return false; }
    } else if (args.p_expected_at_seq != null || args.p_expected_writer_id != null
      || Number(args.p_expected_writer_epoch) !== 0 || !(Number(args.p_writer_epoch) > 0)) {
      this.count('snapshot refused (base changed)');
      return false;
    }
    const row = {
      document_id: args.p_document_id,
      at_seq: Number(args.p_at_seq),
      snapshot: args.p_snapshot,
      encoding_version: args.p_encoding_version,
      writer_id: args.p_writer_id,
      writer_epoch: Number(args.p_writer_epoch),
      base_at_seq: args.p_expected_at_seq,
      base_writer_id: args.p_expected_writer_id,
      base_writer_epoch: args.p_expected_writer_epoch,
      updated_at: nowIso(),
    };
    if (current) Object.assign(current, row); else rows.push(row);
    return true;
  }

  // ------------------------------------------------------------ Realtime

  emitInsert(table, record) { this.emitChange(table, 'INSERT', record, null); }

  /** Postgres Realtime: tell every window subscribed to this table's changes. */
  emitChange(table, type, record, oldRecord) {
    const subject = record || oldRecord || {};
    for (const sock of this.sockets) {
      for (const [topic, ch] of sock.channels) {
        for (const binding of ch.postgres) {
          if (binding.table !== table || ![type, '*'].includes(binding.event)) continue;
          if (binding.filter) {
            const [col, expr] = [binding.filter.slice(0, binding.filter.indexOf('=')), binding.filter.slice(binding.filter.indexOf('=') + 1)];
            if (!testCondition(subject, col, expr)) continue;
          }
          this.count('WS postgres_changes delivered');
          sock.send([null, null, topic, 'postgres_changes', {
            ids: [binding.id],
            data: { type, schema: 'public', table, commit_timestamp: nowIso(), record: record || {}, old_record: oldRecord || {}, columns: [], errors: null },
          }]);
        }
      }
    }
  }

  handleSocket(ws) {
    const sock = {
      ws,
      channels: new Map(),
      send: (frame) => { try { ws.send(JSON.stringify(frame)); } catch { /* closed */ } },
    };
    this.sockets.add(sock);
    ws.onClose(() => {
      for (const topic of sock.channels.keys()) this.presenceLeave(sock, topic);
      this.sockets.delete(sock);
    });
    ws.onMessage((message) => {
      if (typeof message !== 'string') {
        this.handleBinaryPush(sock, Buffer.from(message));
        return;
      }
      let frame;
      try { frame = JSON.parse(message); } catch { return; }
      const [joinRef, ref, topic, event, payload] = frame;
      const ok = (response = {}) => sock.send([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]);
      if (topic === 'phoenix' && event === 'heartbeat') return ok();
      if (event === 'phx_join') {
        this.count('WS join');
        const config = payload?.config || {};
        const postgres = (config.postgres_changes || []).map((pc, i) => ({ ...pc, id: 1000 + i }));
        sock.channels.set(topic, { joinRef, postgres, self: Boolean(config.broadcast?.self), presenceKey: config.presence?.key || '' });
        ok({ postgres_changes: postgres.map(({ id, event: e, schema, table, filter }) => ({ id, event: e, schema, table, filter })) });
        // presence_state for the joiner
        sock.send([joinRef, null, topic, 'presence_state', this.presenceState(topic)]);
        return undefined;
      }
      if (event === 'phx_leave') {
        this.presenceLeave(sock, topic);
        sock.channels.delete(topic);
        return ok();
      }
      if (event === 'access_token') return undefined;
      if (event === 'presence') {
        if (payload?.event === 'track') this.presenceTrack(sock, topic, payload.payload || {});
        if (payload?.event === 'untrack') this.presenceLeave(sock, topic);
        return ok();
      }
      if (event === 'broadcast') {
        this.relayBroadcast(sock, topic, { type: 'broadcast', event: payload?.event, payload: payload?.payload });
        return ok();
      }
      return ok();
    });
  }

  handleBinaryPush(sock, buf) {
    // kind(1) joinRefLen refLen topicLen eventLen metaLen encoding, then strings, then payload.
    if (buf[0] !== 3) return;
    const [joinLen, refLen, topicLen, eventLen, metaLen, encoding] = [buf[1], buf[2], buf[3], buf[4], buf[5], buf[6]];
    let o = 7;
    const take = (n) => { const s = buf.subarray(o, o + n).toString('latin1'); o += n; return s; };
    const joinRef = take(joinLen);
    const ref = take(refLen);
    const topic = take(topicLen);
    const event = take(eventLen);
    take(metaLen);
    const rest = buf.subarray(o);
    const payload = encoding === 1 ? JSON.parse(rest.toString('utf8') || 'null') : null;
    this.relayBroadcast(sock, topic, { type: 'broadcast', event, payload });
    if (ref) sock.send([joinRef || null, ref, topic, 'phx_reply', { status: 'ok', response: {} }]);
  }

  relayBroadcast(from, topic, body) {
    this.count(`WS broadcast ${String(topic).split(':')[0]}`);
    for (const sock of this.sockets) {
      const ch = sock.channels.get(topic);
      if (!ch) continue;
      if (sock === from && !ch.self) continue;
      sock.send([null, null, topic, 'broadcast', body]);
    }
  }

  presenceState(topic) {
    const state = {};
    for (const sock of this.sockets) {
      const ch = sock.channels.get(topic);
      if (ch?.presence) state[ch.presenceKey || ch.presence.phx_ref] = { metas: [ch.presence] };
    }
    return state;
  }

  presenceTrack(sock, topic, meta) {
    const ch = sock.channels.get(topic);
    if (!ch) return;
    this.presenceRef += 1;
    const leaves = ch.presence ? { [ch.presenceKey || ch.presence.phx_ref]: { metas: [ch.presence] } } : {};
    ch.presence = { ...meta, phx_ref: `p${this.presenceRef}` };
    const key = ch.presenceKey || ch.presence.phx_ref;
    for (const other of this.sockets) {
      if (!other.channels.has(topic)) continue;
      other.send([null, null, topic, 'presence_diff', { joins: { [key]: { metas: [ch.presence] } }, leaves }]);
    }
  }

  presenceLeave(sock, topic) {
    const ch = sock.channels.get(topic);
    if (!ch?.presence) return;
    const key = ch.presenceKey || ch.presence.phx_ref;
    const leaves = { [key]: { metas: [ch.presence] } };
    ch.presence = null;
    for (const other of this.sockets) {
      if (other === sock || !other.channels.has(topic)) continue;
      other.send([null, null, topic, 'presence_diff', { joins: {}, leaves }]);
    }
  }
}
