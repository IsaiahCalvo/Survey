// agent-cli/lib/kal74Fixtures.mjs — fixtures + stateful stores for the KAL-74
// Version History e2e (PLAN-KAL74-HISTORY-E2E.md, Codex-approved round 4).
//
// Three pieces:
//   buildFixtures()        — single owned document derived from kal75Fixtures'
//                            DOC_OWNED (3 WAL-seeded overlapping rects
//                            kal75-fab-01..03 on page 1 — the "rest of the
//                            document" for ticket case 17). project_id null +
//                            user_id null (stamped) → creator-owner path of the
//                            RevisionsPanel owner check.
//   createHistoryStore()   — stateful PRIMARY history store fed via the mock's
//                            onMutation callback from the app's real upsert
//                            bodies. Honors (document_id, client_event_id)
//                            ignoreDuplicates; assigns stable synthetic ids
//                            hist-<n> (the upsert body has NO id — DB-generated
//                            in prod; Codex plan-review r2 #4); serves GETs via
//                            a read override sorted occurred_at desc.
//   createRevisionStore()/buildKal48RpcHandlers(store)
//                          — owner-faithful kal48_* RPC handlers with exact
//                            p_* request-key pins (handlers THROW on key drift
//                            → recorded unmatched → run fails), revision_*-
//                            prefixed list rows, natural-key create/get/restore
//                            rows, count-faithful snapshot_json via the
//                            setLiveCount hook (also on restore — r3 #3), and
//                            failNext() armed-failure support (r2 #12).

import { applyFilters } from './supabaseMock.mjs';
import {
  buildFixtures as buildKal75Fixtures,
  DOC_OWNED_ID,
  DOC_OWNED_NAME,
} from './kal75Fixtures.mjs';

export const DOC_ID = DOC_OWNED_ID;
export const DOC_NAME = DOC_OWNED_NAME;
export const FIXTURE_ANNOTATION_IDS = ['kal75-fab-01', 'kal75-fab-02', 'kal75-fab-03'];

export function buildFixtures() {
  const base = buildKal75Fixtures();
  const docOwned = base.docsById[DOC_OWNED_ID];
  return {
    documents: [docOwned.row],
    projects: [],
    templates: [],
    documentCollaborators: [],
    docsById: { [DOC_OWNED_ID]: docOwned },
  };
}

// --- history store (document_history_events) ---------------------------------
export function createHistoryStore() {
  const rows = [];
  const seen = new Set();
  let counter = 0;
  return {
    rows,
    // Fed from the mock's mutation ledger — the app's REAL upsert bodies.
    onMutation(entry) {
      if (entry.method !== 'POST' || entry.table !== 'document_history_events') return;
      const bodies = Array.isArray(entry.body) ? entry.body : [entry.body];
      for (const body of bodies) {
        if (!body || !body.document_id || !body.client_event_id) continue;
        const key = `${body.document_id}::${body.client_event_id}`;
        if (seen.has(key)) continue; // ignoreDuplicates: first accepted row wins
        seen.add(key);
        counter += 1;
        rows.push({ id: `hist-${counter}`, ...body });
      }
    },
    // Read override: filter on the app's eq filters, sort occurred_at desc
    // FAITHFULLY regardless of param drift (plan §Risks), then apply the
    // generic filter/order/limit machinery on the pre-sorted rows.
    readOverrides: {
      document_history_events: (q) => {
        const sorted = [...rows].sort((a, b) =>
          (Date.parse(b.occurred_at || b.created_at || 0) || 0)
          - (Date.parse(a.occurred_at || a.created_at || 0) || 0));
        return applyFilters(sorted, q);
      },
    },
  };
}

// --- kal48 revision store + RPC handlers --------------------------------------
const RPC_BODY_KEYS = {
  kal48_create_revision: ['p_document_id', 'p_label', 'p_origin'],
  kal48_list_revisions: ['p_document_id'],
  kal48_get_revision: ['p_revision_id'],
  kal48_restore_revision: ['p_revision_id'],
};

function assertExactKeys(fn, body) {
  const got = Object.keys(body || {}).sort();
  const want = [...RPC_BODY_KEYS[fn]].sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    // Throwing records the request as unmatched → run failure (exact p_* pin).
    throw new Error(`${fn} body keys drifted: got [${got}] want [${want}]`);
  }
}

// snapshot_json shape PINNED (Codex plan-review r3 #4 — what the read-only
// banner reads): { version, annotations[<count-faithful>], survey_items, meta }.
function snapshotJsonFor(count) {
  return {
    version: 1,
    annotations: Array.from({ length: count }, (_, i) => ({ slot: i + 1 })),
    survey_items: [],
    meta: {},
  };
}

export function createRevisionStore() {
  const revisions = [];
  let nextNumber = 1;
  let liveCountFn = () => 0;
  const armedFailures = new Set();
  return {
    revisions,
    // The harness supplies the RENDERED annotation count at call time —
    // revision counts must NOT come from table rows (the KAL-75 rects are
    // WAL-seeded, not document_annotations rows; Codex plan-review r2 #8).
    setLiveCount(fn) { liveCountFn = typeof fn === 'function' ? fn : () => 0; },
    liveCount() { return Math.max(0, Number(liveCountFn()) || 0); },
    takeNumber() { return nextNumber++; },
    failNext(fn) { armedFailures.add(fn); },
    consumeFailure(fn) {
      if (!armedFailures.has(fn)) return false;
      armedFailures.delete(fn);
      return true;
    },
  };
}

export function buildKal48RpcHandlers(store) {
  const findRevision = (id) => store.revisions.find((r) => r.id === id);
  const notFound = () => ({
    status: 404,
    json: { code: 'PGRST116', message: 'revision not found', details: null, hint: null },
  });

  return {
    kal48_create_revision: (body, ctx) => {
      assertExactKeys('kal48_create_revision', body);
      if (store.consumeFailure('kal48_create_revision')) {
        return { status: 400, json: { code: 'KAL74_INJECTED', message: 'kal74-injected-failure', details: null, hint: null } };
      }
      const count = store.liveCount();
      const n = store.takeNumber();
      const row = {
        id: `kal74-rev-${n}`,
        document_id: body.p_document_id,
        revision_number: n,
        label: body.p_label ?? null,
        origin: body.p_origin || 'manual',
        created_by: ctx.sniffedUserId || null,
        created_at: new Date().toISOString(),
        annotation_count: count,
        survey_item_count: 0,
        snapshot_json: snapshotJsonFor(count),
      };
      store.revisions.push(row);
      return { status: 200, json: { ...row } };
    },
    kal48_list_revisions: (body) => {
      assertExactKeys('kal48_list_revisions', body);
      const rows = store.revisions
        .filter((r) => r.document_id === body.p_document_id)
        .map((r) => ({
          // revision_*-prefixed keys (OUT-column collision workaround in the
          // real SQL fn; documentRevisionService re-keys these — r2 #2/#3).
          revision_id: r.id,
          revision_document_id: r.document_id,
          revision_number: r.revision_number,
          revision_label: r.label,
          revision_origin: r.origin,
          revision_created_by: r.created_by,
          revision_created_at: r.created_at,
          revision_annotation_count: r.annotation_count,
          revision_survey_item_count: r.survey_item_count,
        }));
      return { status: 200, json: rows };
    },
    kal48_get_revision: (body) => {
      assertExactKeys('kal48_get_revision', body);
      const row = findRevision(body.p_revision_id);
      if (!row) return notFound();
      return { status: 200, json: { ...row } }; // natural keys incl. snapshot_json
    },
    kal48_restore_revision: (body, ctx) => {
      assertExactKeys('kal48_restore_revision', body);
      const target = findRevision(body.p_revision_id);
      if (!target) return notFound();
      // Mint the auto pre-restore row CAPTURING THE DIVERGED LIVE STATE —
      // count comes from the live hook, not from the restored snapshot
      // (Codex plan-review r3 #3).
      const count = store.liveCount();
      const n = store.takeNumber();
      const auto = {
        id: `kal74-rev-${n}`,
        document_id: target.document_id,
        revision_number: n,
        label: `Auto: pre-restore of v${target.revision_number}`,
        origin: 'auto-pre-restore',
        created_by: ctx.sniffedUserId || null,
        created_at: new Date().toISOString(),
        annotation_count: count,
        survey_item_count: 0,
        snapshot_json: snapshotJsonFor(count),
      };
      store.revisions.push(auto);
      return { status: 200, json: { ...auto } };
    },
  };
}
