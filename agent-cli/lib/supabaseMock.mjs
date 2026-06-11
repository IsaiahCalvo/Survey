// agent-cli/lib/supabaseMock.mjs — network-edge Supabase mock for the KAL-92
// browser regression (PLAN-KAL92-BROWSER.md).
//
// SAFETY CORE: register() routes **/rest/v1/** and **/storage/v1/** and NEVER
// calls route.continue() for them — a durable write to the real backend is
// impossible by construction, even if a handler is buggy. Reads are answered
// from fixtures with PostgREST-faithful semantics; mutations are recorded into
// a ledger (stamped with the current scenario window) and answered with
// synthetic success. Anything unrecognized is recorded as unmatched, answered
// with a PostgREST-shaped error, and fails the run at verdict time.
//
// PostgREST semantics implemented (Codex plan-review round 1/2 requirements):
//   * Accept: application/vnd.pgrst.object+json → exactly-one-object contract:
//     1 row → 200 object; 0 or >1 → 406 {code:'PGRST116'} (supabase-js turns the
//     0-row case into data:null for .maybeSingle(), surfaces it for .single()).
//   * count=exact (head or not) → Content-Range header carries the total.
//   * INSERT ... select('seq').single() on annotation_updates → returns a real
//     monotonically assigned {seq} (the CRDT cursor is load-bearing).
//   * CORS: routed responses still face the browser's CORS checks, so every
//     response carries permissive ACAO headers and OPTIONS preflights get 204.

import { readFileSync } from 'node:fs';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'Content-Range',
};

function jsonHeaders(extra = {}) {
  return { 'content-type': 'application/json', ...CORS, ...extra };
}

// --- tiny PostgREST query-string parser (just what the app's calls use) ------
//
// Returns { select, order, limit, filters: [{column, op, value}] }. Unparsed
// params (or=, etc.) are kept verbatim in `raw` so handlers can sniff them.
function parseQuery(url) {
  const out = { select: null, order: null, limit: null, offset: null, filters: [], raw: {}, unknown: [] };
  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'select') out.select = value;
    else if (key === 'order') out.order = value;
    else if (key === 'limit') out.limit = Number(value);
    else if (key === 'offset') out.offset = Number(value);
    else if (key === 'on_conflict' || key === 'columns') out.raw[key] = value;
    else if (key === 'or') out.rawOr = value; // handled per-table or flagged unmatched
    else if (key === 'and') out.unknown.push(`${key}=${value}`); // unmodeled boolean trees
    else {
      const m = /^(eq|neq|gt|gte|lt|lte|in|is)\.(.*)$/s.exec(value);
      if (m) out.filters.push({ column: key, op: m[1], value: m[2] });
      else out.unknown.push(`${key}=${value}`); // not.*, fts, ranges — unmodeled
    }
  }
  return out;
}

function rowMatches(row, f) {
  if (!(f.column in row)) return false; // strict: unknown column never matches
  const v = row[f.column];
  switch (f.op) {
    case 'eq': return String(v) === f.value;
    case 'neq': return String(v) !== f.value;
    case 'gt': return Number(v) > Number(f.value);
    case 'gte': return Number(v) >= Number(f.value);
    case 'lt': return Number(v) < Number(f.value);
    case 'lte': return Number(v) <= Number(f.value);
    case 'in': {
      const list = f.value.replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      return list.includes(String(v));
    }
    case 'is': return f.value === 'null' ? (v === null || v === undefined) : Boolean(v) === (f.value === 'true');
    default: return true; // permissive on operators we don't model
  }
}

export function applyFilters(rows, q) {
  let out = rows.filter((r) => q.filters.every((f) => rowMatches(r, f)));
  if (q.order) {
    const [col, ...mods] = q.order.split('.');
    const desc = mods.includes('desc');
    out = [...out].sort((a, b) => {
      const av = a[col]; const bv = b[col];
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * (desc ? -1 : 1);
    });
  }
  if (Number.isFinite(q.offset) && q.offset > 0) out = out.slice(q.offset);
  if (Number.isFinite(q.limit)) out = out.slice(0, q.limit);
  return out;
}

// Per-table FILTERABLE column schemas (Codex result r3): a filter naming a
// column outside its table's schema is shape drift and is recorded as
// unmatched — including on empty-fixture tables, which row-presence checks
// could never validate. Schemas list the columns the real tables expose
// (migrations + the verified read inventory).
const TABLE_COLUMNS = {
  documents: ['id', 'user_id', 'project_id', 'archived', 'name', 'file_path', 'file_size', 'page_count', 'created_at', 'updated_at', 'last_opened_at', 'locked_at', 'locked_by', 'locked_label', 'tool_preferences', 'annotations_changed_at', 'cutover_completed_at', 'embedded_import_completed_at', 'content_sha256'],
  projects: ['id', 'user_id', 'name', 'created_at', 'updated_at'],
  templates: ['id', 'user_id', 'name', 'config', 'created_at', 'updated_at'],
  document_collaborators: ['id', 'document_id', 'user_id', 'status', 'role', 'created_at'],
  connected_services: ['id', 'user_id', 'service_name', 'created_at', 'updated_at'],
  document_presence: ['id', 'document_id', 'user_id', 'client_type', 'last_seen', 'page_number', 'updated_at'],
  // Full migration column list (20260524090000_document_history_events.sql) —
  // the KAL-74 harness reads/filters every column the app's GET selects.
  document_history_events: ['id', 'document_id', 'user_id', 'client_event_id', 'event_type', 'source', 'page_number', 'annotation_id', 'summary', 'payload', 'is_undoable', 'is_checkpoint', 'occurred_at', 'created_at'],
  user_subscriptions: ['user_id', 'tier', 'status', 'storage_used_bytes'],
  annotation_snapshots: ['document_id', 'at_seq', 'snapshot', 'encoding_version', 'updated_at'],
  annotation_updates: ['id', 'document_id', 'client_id', 'client_seq', 'seq', 'data', 'created_at'],
  doc_yjs_state: ['document_id', 'state', 'state_vector', 'through_seq', 'encoding_version', 'updated_at'],
  doc_yjs_updates: ['document_id', 'client_id', 'seq', 'update', 'server_ts', 'origin', 'client_ts'],
  activity_log: ['id', 'document_id', 'user_id', 'action', 'created_at'],
  document_annotations: ['id', 'document_id', 'user_id', 'annotation_id', 'annotation_type', 'page_number', 'bounds', 'category_id', 'module_id', 'space_id', 'name', 'notes', 'entity_id', 'entity_name', 'checklist_responses', 'changed_by', 'changed_date', 'color', 'opacity', 'last_modified_by', 'version', 'annotation_data', 'created_at', 'updated_at'],
};

function validateFilterColumns(table, q) {
  const schema = TABLE_COLUMNS[table];
  if (!schema) return;
  const set = new Set(schema);
  for (const f of q.filters) {
    if (!set.has(f.column)) q.unknown.push(`unknown column filter ${table}.${f.column}.${f.op}`);
  }
}

// The ONE or= shape the app's annotation read uses (annotationCloudSync.js:125-126):
//   or=(annotation_type.in.(t1,t2,…),and(annotation_type.in.(m1,m2),annotation_data->fabricObject.not.is.null))
// Returns a row predicate, or null if the string is not exactly this shape
// (caller then records the request as unmatched — no permissive fallback).
function parseAnnotationOr(rawOr) {
  const m = /^\(annotation_type\.in\.\(([^)]*)\),and\(annotation_type\.in\.\(([^)]*)\),annotation_data->fabricObject\.not\.is\.null\)\)$/.exec(rawOr);
  if (!m) return null;
  const plain = new Set(m[1].split(',').map((s) => s.trim()));
  const fabricCarrying = new Set(m[2].split(',').map((s) => s.trim()));
  return (row) =>
    plain.has(String(row.annotation_type)) ||
    (fabricCarrying.has(String(row.annotation_type)) && row.annotation_data && row.annotation_data.fabricObject != null);
}

function wantsSingleObject(headers) {
  return String(headers['accept'] || '').includes('vnd.pgrst.object+json');
}

function wantsCount(headers) {
  return String(headers['prefer'] || '').includes('count=');
}

// rpcHandlers (KAL-75): { [fnName]: (body, ctx) => ({ status, json }) } serves
// POST /rest/v1/rpc/<fnName>. ctx = { fixtures, sniffedUserId } so handlers can
// mutate fixture rows in place (e.g. the kal49 lock RPCs setting locked_at on
// the documents row). Unhandled RPC names stay unmatched → run failure.
// readHandlerOverrides (KAL-74): { [table]: (q) => rows } merged OVER the
// default read handlers — lets a harness serve a stateful store (e.g. history
// events fed from the mutation ledger) without touching the shared defaults.
// onMutation (KAL-74): callback invoked after every ledger record with the
// recorded entry ({ window, method, table, filters, body }) — default no-op.
export function createSupabaseMock({ fixtures, pdfPath, log = () => {}, rpcHandlers = {}, readHandlerOverrides = {}, onMutation = () => {} }) {
  const pdfBytes = readFileSync(pdfPath);

  const state = {
    window: 'boot',          // current scenario window for ledger stamping
    userId: null,            // captured from the dashboard's own user_id=eq. filter
    seqCounter: 1000,        // assigned seqs for annotation_updates INSERTs
    mutations: [],           // { window, method, table, filters, body }
    unmatched: [],           // { window, method, url, note }
    reads: [],               // light read trace for diagnosis { window, method, table, qs }
  };

  const setWindow = (name) => { state.window = name; log(`[mock] window → ${name}`); };

  const record = (entry) => {
    const stamped = { window: state.window, ...entry };
    state.mutations.push(stamped);
    onMutation(stamped); // throws surface as router-crash unmatched → run fails loudly
  };
  const recordUnmatched = (method, url, note) => {
    state.unmatched.push({ window: state.window, method, url: url.toString().slice(0, 300), note });
    log(`[mock] UNMATCHED ${method} ${url.pathname}${url.search.slice(0, 160)} (${note})`);
  };

  // The FIRST query filtering user_id=eq.<uuid> (whichever table — the
  // subscription-tier read usually wins the race) reveals the real logged-in
  // user; stamp fixture rows so strict column filtering matches. NULL-ONLY
  // (KAL-75 plan review r1): a fixture row with an explicit user_id is a
  // deliberately foreign-owned row and must stay foreign — stamping it would
  // silently convert the non-owner scenario into an owner one. KAL-92 fixtures
  // ship user_id:null everywhere, so this is behavior-identical for them.
  const subscription = { user_id: null, tier: 'pro', status: 'active', storage_used_bytes: 0 };
  const stampIfNull = (row) => { if (row.user_id == null) row.user_id = state.userId; };
  const captureUserId = (q) => {
    const f = q.filters.find((x) => x.column === 'user_id' && x.op === 'eq');
    if (f && !state.userId) {
      state.userId = f.value;
      subscription.user_id = state.userId;
      for (const row of fixtures.documents) stampIfNull(row);
      for (const row of fixtures.projects ?? []) stampIfNull(row);
      for (const row of fixtures.templates) stampIfNull(row);
      for (const row of fixtures.documentCollaborators ?? []) stampIfNull(row);
      for (const doc of Object.values(fixtures.docsById)) {
        for (const row of doc.annotationRows) stampIfNull(row);
      }
      log(`[mock] captured user id ${state.userId.slice(0, 8)}…`);
    }
  };

  // --- per-table read handlers ------------------------------------------------
  const readHandlers = {
    documents: (q) => applyFilters(fixtures.documents, q),
    projects: (q) => applyFilters(fixtures.projects, q),
    templates: (q) => applyFilters(fixtures.templates, q),
    document_collaborators: (q) => applyFilters(fixtures.documentCollaborators ?? [], q),
    connected_services: () => [],
    document_presence: () => [],
    document_history_events: () => [],
    user_subscriptions: (q) => applyFilters([subscription], q),
    annotation_snapshots: () => [],          // no snapshot → app replays the WAL tail
    annotation_updates: (q) => {
      const docF = q.filters.find((f) => f.column === 'document_id' && f.op === 'eq');
      const doc = docF ? fixtures.docsById[docF.value] : null;
      if ((q.select || '').includes('client_seq')) return [];   // per-client seed query
      if (!doc) return [];
      return applyFilters(doc.walRows, q);                       // tail read (seq, data)
    },
    doc_yjs_state: () => [],
    doc_yjs_updates: () => [],
    activity_log: () => [],
    document_annotations: (q) => {
      const docF = q.filters.find((f) => f.column === 'document_id' && f.op === 'eq');
      const doc = docF ? fixtures.docsById[docF.value] : null;
      if (!doc) return [];
      let rows = doc.annotationRows;
      if (q.rawOr) {
        const pred = parseAnnotationOr(q.rawOr);
        if (!pred) { q.unknown.push(`or=${q.rawOr}`); return []; }
        rows = rows.filter(pred);
        q.rawOr = null; // consumed
      }
      return applyFilters(rows, q);
    },
  };

  // KAL-74: harness-supplied overrides win per table; defaults untouched.
  const effectiveReadHandlers = { ...readHandlers, ...readHandlerOverrides };

  // KAL-74 (Codex plan-review r2 #1 / r3 #1): the ONE exact embedded select the
  // app issues — RevisionsPanel's owner check (RevisionsPanel.jsx:157-169):
  //   documents.select('user_id, project_id, projects!documents_project_id_fkey(user_id)')
  // postgrest-js strips whitespace, so compare whitespace-normalized. Consumed
  // BEFORE the generic projection/unmatched logic; any OTHER embedded select
  // stays unmatched (no permissive fallback).
  const OWNER_CHECK_EMBED_SELECT = 'user_id,project_id,projects!documents_project_id_fkey(user_id)';
  const consumeOwnerCheckEmbed = (table, q, rows) => {
    if (table !== 'documents' || !q.select) return null;
    if (q.select.replace(/\s+/g, '') !== OWNER_CHECK_EMBED_SELECT) return null;
    const projected = rows.map((r) => {
      const proj = (fixtures.projects ?? []).find((p) => p.id === r.project_id) || null;
      return {
        user_id: r.user_id ?? null,
        project_id: r.project_id ?? null,
        projects: proj ? { user_id: proj.user_id ?? null } : null,
      };
    });
    q.select = null; // handled — generic embed-unmatched + projection both skip
    return projected;
  };

  async function handleRest(route, request) {
    const url = new URL(request.url());
    const method = request.method();
    const headers = request.headers();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS } });

    const pathTail = url.pathname.replace(/^.*\/rest\/v1\//, '');
    const table = pathTail.split('/')[0];

    // ---- RPC routing (KAL-75): POST /rest/v1/rpc/<fn> ----
    if (table === 'rpc') {
      const fn = pathTail.split('/')[1] || '';
      let body = null;
      try { body = request.postDataJSON(); } catch { body = request.postData(); }
      const handler = rpcHandlers[fn];
      if (method !== 'POST' || !handler) {
        recordUnmatched(method, url, `unhandled rpc ${fn}`);
        return route.fulfill({ status: 404, headers: jsonHeaders(), body: JSON.stringify({ code: 'PGRST202', message: `Could not find the function public.${fn}` }) });
      }
      record({ method: 'RPC', table: `rpc/${fn}`, filters: [], body });
      log(`[mock] RPC ${fn} (window=${state.window})`);
      let res;
      try { res = handler(body, { fixtures, get sniffedUserId() { return state.userId; } }); } catch (err) {
        recordUnmatched(method, url, `rpc handler threw: ${err?.message}`);
        return route.fulfill({ status: 500, headers: jsonHeaders(), body: JSON.stringify({ code: 'KAL75_RPC_HANDLER_ERROR', message: String(err?.message) }) });
      }
      return route.fulfill({ status: res.status ?? 200, headers: jsonHeaders(), body: JSON.stringify(res.json ?? null) });
    }

    const q = parseQuery(url);
    captureUserId(q);
    validateFilterColumns(table, q);

    if (method === 'GET' || method === 'HEAD') {
      const handler = effectiveReadHandlers[table];
      if (!handler) {
        recordUnmatched(method, url, `no read handler for table ${table}`);
        return route.fulfill({ status: 500, headers: jsonHeaders(), body: JSON.stringify({ code: 'KAL92_UNMATCHED', message: `unmatched read: ${table}` }) });
      }
      let rows;
      try { rows = handler(q) || []; } catch (err) {
        recordUnmatched(method, url, `read handler threw: ${err?.message}`);
        return route.fulfill({ status: 500, headers: jsonHeaders(), body: JSON.stringify({ code: 'KAL92_HANDLER_ERROR', message: String(err?.message) }) });
      }
      // Unmodeled filter syntax (unconsumed or=, not.*, fts…) is served so the
      // scenario can finish, but RECORDED as unmatched and fails the run at
      // verdict time — wrong query shapes never silently pass (Codex result r1).
      if (q.rawOr) q.unknown.push(`or=${q.rawOr}`);
      if (q.unknown.length) recordUnmatched(method, url, `unmodeled filter syntax: ${q.unknown.join(' & ').slice(0, 140)}`);
      // KAL-74 owner-check embed: exact-match consumed here, BEFORE the
      // generic projection/unmatched path (Codex plan-review r3 #1).
      const embedded = consumeOwnerCheckEmbed(table, q, rows);
      if (embedded) rows = embedded;
      // Apply the select projection so a drifted app projection (e.g. a WAL
      // read that stops selecting `data`) breaks loudly instead of being
      // backfilled by the mock (Codex result r4). Embedded selects (parens)
      // are unmodeled → recorded as unmatched, served unprojected.
      if (q.select && q.select !== '*') {
        if (q.select.includes('(')) {
          recordUnmatched(method, url, `unmodeled embedded select: ${q.select.slice(0, 100)}`);
        } else {
          const cols = q.select.split(',').map((s) => s.trim()).filter(Boolean);
          rows = rows.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])));
        }
      }
      state.reads.push({ window: state.window, method, table, qs: url.search.slice(0, 400) });
      const extra = {};
      if (wantsCount(headers) || method === 'HEAD') extra['content-range'] = method === 'HEAD' ? `*/${rows.length}` : `0-${Math.max(rows.length - 1, 0)}/${rows.length}`;
      if (method === 'HEAD') return route.fulfill({ status: 200, headers: jsonHeaders(extra), body: '' });
      if (wantsSingleObject(headers)) {
        if (rows.length === 1) return route.fulfill({ status: 200, headers: jsonHeaders(extra), body: JSON.stringify(rows[0]) });
        return route.fulfill({
          status: 406,
          headers: jsonHeaders(extra),
          body: JSON.stringify({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `Results contain ${rows.length} rows`, hint: null }),
        });
      }
      return route.fulfill({ status: 200, headers: jsonHeaders(extra), body: JSON.stringify(rows) });
    }

    // ---- mutation: record + synthetic success, NEVER forwarded ----
    // Unmodeled filter syntax on a MUTATION is flagged too (Codex result r2).
    if (q.rawOr) q.unknown.push(`or=${q.rawOr}`);
    if (q.unknown.length) recordUnmatched(method, url, `unmodeled filter syntax on mutation: ${q.unknown.join(' & ').slice(0, 140)}`);
    let body = null;
    try { body = request.postDataJSON(); } catch { body = request.postData(); }
    record({ method, table, filters: q.filters, body });
    log(`[mock] MUTATION ${method} ${table} (window=${state.window})`);

    if (method === 'DELETE' || method === 'PATCH') {
      // DELETE applies to fixture state (KAL-75 plan review r1 finding 2):
      // deleteDocumentEverywhere verify-reads the row after deleting and the
      // hub refetches — a non-applying mock fails the app's own verification
      // and resurrects the row. Recorded above as always; KAL-92 windows have
      // zero fixture-table DELETEs, so this is behavior-neutral for it.
      if (method === 'DELETE') {
        const arr = {
          documents: fixtures.documents,
          projects: fixtures.projects,
          templates: fixtures.templates,
          document_collaborators: fixtures.documentCollaborators,
        }[table];
        if (arr && q.filters.length) {
          for (let i = arr.length - 1; i >= 0; i -= 1) {
            if (q.filters.every((f) => rowMatches(arr[i], f))) arr.splice(i, 1);
          }
        }
      }
      return route.fulfill({ status: 204, headers: jsonHeaders(), body: '' });
    }
    if (method === 'POST') {
      // representation requests get their row back with server-assigned fields,
      // projected through the request's select (Codex result r5) — a drifted
      // app projection (e.g. WAL insert no longer selecting seq) breaks loudly.
      const rows = Array.isArray(body) ? body : [body || {}];
      let enriched = rows.map((r) => ({
        id: r?.id || `mock-${state.seqCounter + 1}`,
        ...r,
        ...(table === 'annotation_updates' ? { seq: (state.seqCounter += 1) } : {}),
        updated_at: r?.updated_at || new Date().toISOString(),
      }));
      if (q.select && q.select !== '*' && !q.select.includes('(')) {
        const cols = q.select.split(',').map((s) => s.trim()).filter(Boolean);
        enriched = enriched.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])));
      }
      if (wantsSingleObject(headers)) return route.fulfill({ status: 201, headers: jsonHeaders(), body: JSON.stringify(enriched[0]) });
      if (String(headers['prefer'] || '').includes('return=representation')) return route.fulfill({ status: 201, headers: jsonHeaders(), body: JSON.stringify(enriched) });
      return route.fulfill({ status: 201, headers: jsonHeaders(), body: '' });
    }
    recordUnmatched(method, url, 'unhandled mutation method');
    return route.fulfill({ status: 500, headers: jsonHeaders(), body: JSON.stringify({ code: 'KAL92_UNMATCHED', message: 'unhandled method' }) });
  }

  async function handleStorage(route, request) {
    const url = new URL(request.url());
    const method = request.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS } });

    // Every non-read storage request hits the mutation ledger FIRST — sidecar
    // and PDF special cases apply to GET/HEAD only (Codex result r3).
    if (method !== 'GET' && method !== 'HEAD') {
      record({ method, table: `storage:${url.pathname.slice(0, 120)}`, filters: [], body: null });
      return route.fulfill({ status: 200, headers: jsonHeaders(), body: JSON.stringify({ Key: 'mock' }) });
    }
    const isSeededPdf = Object.values(fixtures.docsById).some((d) => url.pathname.includes(d.row.file_path));
    if (method === 'GET' && isSeededPdf) {
      state.reads.push({ window: state.window, method, table: 'storage:pdf', qs: url.pathname.slice(-80) });
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', ...CORS }, body: pdfBytes });
    }
    if (url.pathname.includes('_data.json')) {
      return route.fulfill({ status: 404, headers: jsonHeaders(), body: JSON.stringify({ error: 'Not found', message: 'sidecar intentionally absent' }) });
    }
    recordUnmatched(method, url, 'storage read for unseeded object');
    return route.fulfill({ status: 404, headers: jsonHeaders(), body: JSON.stringify({ error: 'Not found' }) });
  }

  async function register(page) {
    await page.route('**/rest/v1/**', (route, request) =>
      handleRest(route, request).catch((err) => {
        recordUnmatched(request.method(), new URL(request.url()), `router crashed: ${err?.message}`);
        return route.fulfill({ status: 500, headers: jsonHeaders(), body: JSON.stringify({ code: 'KAL92_ROUTER_CRASH', message: String(err?.message) }) });
      }));
    await page.route('**/storage/v1/**', (route, request) =>
      handleStorage(route, request).catch((err) => {
        recordUnmatched(request.method(), new URL(request.url()), `storage router crashed: ${err?.message}`);
        return route.fulfill({ status: 500, headers: jsonHeaders(), body: JSON.stringify({ code: 'KAL92_ROUTER_CRASH', message: String(err?.message) }) });
      }));
  }

  return {
    register,
    setWindow,
    get mutations() { return state.mutations; },
    get unmatched() { return state.unmatched; },
    get reads() { return state.reads; },
    mutationsIn(windowName) { return state.mutations.filter((m) => m.window === windowName); },
  };
}
