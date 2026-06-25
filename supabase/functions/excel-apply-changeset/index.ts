// supabase/functions/excel-apply-changeset/index.ts
//
// KAL-309 keystone Edge Function (PLAN-KAL309 §C). Server-authoritative entry point for
// applying an Excel change-set to a document's Survey Markers. The transactional apply lives
// in the kal308_apply_changeset RPC (service-role only); this function is the trusted gateway
// that authenticates the caller, validates the workbook registration + sync token, runs the
// matcher to classify rows, flattens decisions into the RPC's p_rows contract, then — AFTER
// the RPC commits — signs + persists Row-ID tokens for server-created rows and broadcasts a
// content-free hint so open clients reconcile.
//
// Trust boundary (F6/F17): the authenticated JWT user IS p_actor_id. The RPC RE-VALIDATES
// everything (role, registration, lock, TOCTOU drift, field whitelist) against p_actor_id and
// the server-resolved registration — the Edge checks below are advisory/defense-in-depth. The
// Edge tier is actor auth + Row-ID HMAC verify + Excel-vs-Excel drift; the app-vs-Excel merge
// is the client reducer's job (it owns live Yjs; the server cannot read it).
//
// Secrets discipline: the Row-ID signing secret is resolved server-side and NEVER returned to
// the client or logged. Errors are structured and content-free.

// esm.sh, deno target — same convention as create-checkout-session/index.ts.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10?target=deno';

// Guarded copy of the matcher/token modules (synced by scripts/sync-matcher-to-edge.sh;
// drift-gated by tests/edgeMatcherDrift.test.mjs). Explicit .js paths — the copy keeps its
// relative imports intact, and Deno resolves these statically at deploy.
import { buildScopeImportPlans } from '../_shared/matcher/buildScopeImportPlans.js';
import { generateRowIdToken } from '../_shared/matcher/rowIdToken.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Content-free structured log (Decision 14). NEVER pass row content, tokens, or secrets.
const log = (event: string, fields: Record<string, unknown> = {}) => {
  try {
    console.log(JSON.stringify({ fn: 'excel-apply-changeset', event, ...fields }));
  } catch {
    /* logging must never throw */
  }
};

// sha256 → lowercase hex, via the Deno/Web SubtleCrypto (same engine the matcher uses).
const sha256Hex = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

// Stable JSON stringify so request_hash is deterministic regardless of key order — the RPC
// only logs a mismatch (the change-set id is the idempotency contract, F7), but a stable hash
// keeps the warning meaningful.
const canonicalStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
};

interface ChangeSetRow {
  opId: string;
  opType: 'apply' | 'create' | 'candidateDelete';
  rowIdToken?: string;
  values?: Record<string, unknown>;
  baseFingerprints?: { identityVector?: string; fields?: Record<string, string> };
  changedFieldKeys?: string[];
  scopeId?: string;
}

Deno.serve(async (req: Request) => {
  // 1. CORS preflight + POST only.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    log('config_error');
    return json({ error: 'server_misconfigured' }, 500);
  }

  // 2. AUTH (F17). Authorization: Bearer JWT → auth.getUser(token); reject anon / service key.
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || token === anonKey || token === serviceKey) {
    return json({ error: 'unauthorized' }, 401);
  }

  // Anon-key client purely to resolve the caller's identity from their JWT.
  const authClient = createClient(supabaseUrl, anonKey);
  let actorId: string;
  try {
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data?.user) {
      return json({ error: 'unauthorized' }, 401);
    }
    actorId = data.user.id; // the authenticated user IS p_actor_id (F17).
  } catch {
    return json({ error: 'unauthorized' }, 401);
  }

  // Service-role client for all privileged reads + the apply RPC (bypasses RLS).
  const service = createClient(supabaseUrl, serviceKey);

  // 3. PARSE BODY.
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const {
    documentId,
    templateId,
    workbookId,
    syncToken,
    changeSet,
    // Optional matcher inputs (the matcher is advisory; the RPC is authoritative). When the
    // client preformatted decisions it may send them in changeSet.rows directly; the raw
    // matcher inputs let the Edge re-derive classification server-side.
    worksheetDataList = [],
    surveyMarkers = {},
    appValuesByMarkerId = null,
    templateConfig = null,
    ingestSeq = null,
    capabilityTier = 'unknown',
    deviceHint = null,
  } = body ?? {};

  if (!documentId || !templateId || !workbookId || !syncToken || !changeSet) {
    return json({ error: 'missing_required_fields' }, 400);
  }
  const clientChangeSetId = changeSet.clientChangeSetId;
  const clientRows: ChangeSetRow[] = Array.isArray(changeSet.rows) ? changeSet.rows : [];
  if (!clientChangeSetId) {
    return json({ error: 'missing_client_change_set_id' }, 400);
  }

  try {
    // 4. WORKBOOK IDENTITY + TOKEN VALIDATION (F16). workbook_id is UNIQUE on active rows.
    const { data: reg, error: regErr } = await service
      .from('excel_workbook_registrations')
      .select('id, document_id, template_id, token_hash, token_expiry, revoked_at, rowid_signing_doc_id')
      .eq('workbook_id', workbookId)
      .is('revoked_at', null)
      .maybeSingle();
    if (regErr) {
      log('registration_read_error');
      return json({ error: 'registration_lookup_failed' }, 500);
    }
    if (!reg) {
      log('no_active_registration');
      return json({ error: 'no_active_registration' }, 409);
    }
    if (reg.document_id !== documentId || reg.template_id !== templateId) {
      log('workbook_mismatch');
      return json({ error: 'workbook_mismatch' }, 409);
    }
    // token_hash == sha256(syncToken).
    const tokenHash = await sha256Hex(syncToken);
    if (!reg.token_hash || tokenHash !== reg.token_hash) {
      log('sync_token_invalid');
      return json({ error: 'sync_token_invalid' }, 403);
    }
    // not expired.
    if (reg.token_expiry && new Date(reg.token_expiry).getTime() <= Date.now()) {
      log('sync_token_expired');
      return json({ error: 'sync_token_expired', detail: 're-export required' }, 409);
    }

    // 5. RESOLVE THE SIGNING SECRET SERVER-SIDE (F15). kal308a_get_signing_secret is
    //    auth.uid()-gated (editor/owner) and would throw under the service role, so read the
    //    rowid_signing_secrets table directly (service-role bypasses RLS). The frozen
    //    signing_doc_id is the canonical id the matcher verifies tokens against — never a
    //    client-supplied documentId (build-note: pass the frozen signing_doc_id).
    const { data: secretRow, error: secretErr } = await service
      .from('rowid_signing_secrets')
      .select('key_id, secret_b64, signing_doc_id')
      .eq('document_id', documentId)
      .eq('is_current', true)
      .maybeSingle();
    if (secretErr) {
      log('signing_secret_read_error');
      return json({ error: 'signing_secret_lookup_failed' }, 500);
    }
    if (!secretRow) {
      // 308a legacy-preflight: a document with no server key cannot verify Row-IDs.
      log('legacy_unsigned');
      return json({ error: 'legacy_unsigned', detail: 're-export required' }, 409);
    }
    const signingKeyId: string = secretRow.key_id;
    const signingSecret: string = secretRow.secret_b64;
    // Prefer the frozen signing id captured on the registration; fall back to the secret row's
    // (both are the same frozen value — A.1(ii) duplicates it onto the registration for a
    // one-read resolve). Tokens are verified/signed against THIS id, not the document id.
    const signingDocId: string = reg.rowid_signing_doc_id || secretRow.signing_doc_id;
    if (!signingDocId) {
      log('signing_doc_id_unresolved');
      return json({ error: 'legacy_unsigned', detail: 're-export required' }, 409);
    }

    // resolveSecret matches the matcher contract: (keyId) => secret | null. Only the document's
    // own current key resolves; any other keyId → null → that row classifies 'key-unavailable'
    // → routed to review. Tokens whose HMAC doesn't verify classify 'malformed' → review.
    const resolveSecret = (keyId: string): string | null =>
      keyId === signingKeyId ? signingSecret : null;

    // 6. RUN MATCHER (advisory). buildScopeImportPlans verifies each Row-ID against the FROZEN
    //    signingDocId (documentId param) — never a client value. surveyMarkers +
    //    appValuesByMarkerId come from the client body (the server can't read live Yjs).
    let scopePlans: Map<string, { byRowIndex: Map<number, any>; candidateDeletes: string[] }> =
      new Map();
    let matcherRan = false;
    if (Array.isArray(worksheetDataList) && worksheetDataList.length > 0) {
      try {
        // The matcher is a JS module whose JSDoc types the param object as closed; ingestSeq +
        // logger are real runtime params (defaulted) the JSDoc omits, so cast the args object at
        // this boundary. Do NOT edit the guarded copy to "fix" the types — it must stay
        // byte-identical to src/services/* (drift-gated).
        const matcherArgs = {
          worksheetDataList,
          surveyMarkers,
          templateToUse: templateConfig,
          documentId: signingDocId, // FROZEN signing id — the token-verify anchor (build-note).
          resolveSecret,
          appValuesByMarkerId,
          ingestSeq,
        };
        // deno-lint-ignore no-explicit-any
        scopePlans = await buildScopeImportPlans(matcherArgs as any);
        matcherRan = true;
      } catch (err) {
        // The matcher is advisory; a failure must not silently apply unverified rows. Fall back
        // to the client-supplied decisions, which the RPC re-validates anyway.
        log('matcher_error', { name: (err as Error)?.name });
        matcherRan = false;
      }
    }

    // 7. FLATTEN decisions → p_rows. Preference order: matcher decisions (server-classified,
    //    token-verified) when the matcher ran; otherwise the client-declared rows (the RPC is
    //    still the authority and re-validates each). We attach the matcher's changedFields →
    //    changedFieldKeys + base fingerprints where present.
    const pRows: Array<Record<string, unknown>> = [];

    if (matcherRan) {
      // Each plan VALUE is self-describing — buildScopeImportPlans now stamps scopeId
      // (`${moduleId}:${categoryId}`, the value the matcher signs Row-ID tokens over), moduleId
      // and categoryId onto it (Fix 5 / Codex round 2). We read identity straight off the value
      // and NEVER reverse-split the collision-free Map key. The matching worksheet (for the
      // visible row values, Fix 3) is found by moduleId/categoryId from the value.
      const worksheetByScopeId = new Map<string, any>();
      for (const ws of worksheetDataList as Array<any>) {
        const moduleId = ws?.matchedModuleId;
        const categoryId = ws?.matchedCategory?.id;
        if (moduleId != null && categoryId != null) {
          worksheetByScopeId.set(`${moduleId}:${categoryId}`, ws);
        }
      }

      // Fix 4: the Excel-vs-Excel TOCTOU base is the matched marker's STORED export baseline,
      // NOT the incoming row's fingerprints. Build markerId → its excelSync baseline from
      // surveyMarkers (the matcher's own `stored` source). A create has no prior baseline.
      const storedBaselineByMarkerId = new Map<
        string,
        { identityVector: string | null; fields: Record<string, string> | null }
      >();
      for (const [markerId, marker] of Object.entries(surveyMarkers as Record<string, any>)) {
        const xs = marker?.excelSync;
        if (xs) {
          storedBaselineByMarkerId.set(markerId, {
            identityVector: xs.identityVectorFingerprint ?? null,
            fields: xs.fieldFingerprints ?? null,
          });
        }
      }

      // Collapse every scope's per-row decisions into one ordered list. Token/secret material
      // is never placed into the payload (the RPC also sanitizes defensively). opId must be
      // unique within the change-set (RPC UNIQUE (…, client_change_set_id, op_id)); the real
      // scopeId + the byRowIndex Map key (a per-scope-unique json data-row index) form a
      // collision-free tuple — no hyphen-splitting (Fix 5).
      for (const [, plan] of scopePlans) {
        // Read identity from the plan VALUE (never reverse-split the Map key).
        const scopeId: string | null = (plan as any).scopeId ?? null;
        // Collision-free fallback for opId when scopeId is somehow absent: a JSON tuple of the
        // value's moduleId/categoryId — never a hyphen-join (the very ambiguity Fix 5 closes).
        const scopeKeyFallback = JSON.stringify([
          (plan as any).moduleId ?? null,
          (plan as any).categoryId ?? null,
        ]);
        const worksheet = scopeId ? worksheetByScopeId.get(scopeId) : null;
        // Per-scope visible-values resolver (Fix 3), mirroring buildScopeImportPlans' buildValues
        // against the same header layout. jsonIndex is the byRowIndex Map key.
        const valuesAt = worksheet
          ? makeWorksheetValueResolver(worksheet, templateConfig)
          : () => null;

        for (const [jsonIndex, decision] of plan.byRowIndex) {
          const opType =
            decision.action === 'apply'
              ? 'apply'
              : decision.action === 'create'
                ? 'create'
                : 'review'; // matcher 'review' rows are sent so the RPC audits them as review.

          // Fix 3: send the VISIBLE incoming row values so the RPC has values to apply.
          //   - conflict-review rows already stash decision.excelValues; prefer it.
          //   - otherwise rebuild from the worksheet row at jsonIndex.
          const fields = decision.excelValues ?? valuesAt(jsonIndex);

          // Fix 4: baseFingerprints = the matched marker's STORED baseline (apply only).
          //   A create has no prior server/export baseline → null (RPC seeds state on insert).
          const base =
            opType === 'apply' && decision.markerId
              ? storedBaselineByMarkerId.get(decision.markerId) ?? null
              : null;

          const ir = decision.identityRecord ?? {};
          pRows.push({
            // Fix 5: collision-free tuple key (real scopeId from the plan value + json data-row
            // index). scopeKeyFallback uses the value's module/category tuple, never a hyphen.
            opId: `${scopeId ?? scopeKeyFallback}#${jsonIndex}#${decision.decision}`,
            opType,
            markerAnnotationId: decision.markerId ?? null,
            scopeId,
            templateId,
            // changedFieldKeys: prefer the matcher's 3-way merge whitelist (excelChangedFields),
            // else the plain field diff (changedFields) — both are arrays of field keys.
            changedFieldKeys: decision.excelChangedFields ?? decision.changedFields ?? [],
            fields,
            baseFingerprints: base,
            // identityRecord carries the INCOMING row's fingerprints (used by the RPC to seed
            // excel_sync_state on accept) — distinct from baseFingerprints (the diff base).
            identityRecord: ir,
          });
        }
        // candidateDeletes → review-only ops (F10). The RPC never auto-deletes.
        for (const markerId of plan.candidateDeletes ?? []) {
          pRows.push({
            opId: `del#${scopeId ?? scopeKeyFallback}#${markerId}`,
            opType: 'candidateDelete',
            markerAnnotationId: markerId,
            scopeId,
            templateId,
          });
        }
      }
    } else {
      // Fix 2: client-declared fallback path. The client's `rowIdToken` is NOT a verified
      // markerAnnotationId — it has not passed HMAC verification against the server secret over
      // the frozen signingDocId. Trusting it would let a UUID-shaped value bypass verification
      // and would mis-route a real token (the RPC expects a UUID markerAnnotationId, not a
      // token). The matcher path is the ONLY trusted classifier. So every fallback row is forced
      // to 'review' — applied/created nothing, surfaced for the user. The client should re-send
      // with worksheetDataList so the server-side matcher can verify + classify.
      for (const row of clientRows) {
        pRows.push({
          opId: row.opId,
          // Force review: an unknown op_type routes to the RPC's review branch with no write.
          opType: 'review',
          // Never forward an unverified token as a markerAnnotationId.
          markerAnnotationId: null,
          scopeId: row.scopeId ?? null,
          templateId,
          changedFieldKeys: [],
          fields: null,
          baseFingerprints: null,
        });
      }
      if (clientRows.length > 0) {
        log('fallback_path_forced_review', { rowCount: clientRows.length });
      }
    }

    // request_hash: sha256 of the canonical request body (replay sanity, F7/F19).
    const requestHash = await sha256Hex(
      canonicalStringify({ documentId, templateId, workbookId, clientChangeSetId, rows: pRows }),
    );

    // 8. CALL THE RPC. p_workbook_id is passed (NOT a client registration id/generation) — the
    //    RPC re-resolves the live generation server-side (R2#3) and re-validates everything.
    const { data: rpcData, error: rpcError } = await service.rpc('kal308_apply_changeset', {
      p_actor_id: actorId,
      p_document_id: documentId,
      p_template_id: templateId,
      p_workbook_id: workbookId,
      p_capability_tier: capabilityTier,
      p_client_change_set_id: clientChangeSetId,
      p_request_hash: requestHash,
      p_device_hint: deviceHint,
      p_template_config: templateConfig,
      p_rows: pRows,
    });
    if (rpcError) {
      log('rpc_error', { code: (rpcError as any)?.code });
      return json({ error: 'apply_failed' }, 500);
    }

    // The RPC returns { revision_head, outcomes, writeback_jobs, replayed? } OR
    // { error, outcomes } for change-set-level rejections (unauthorized / locked / mismatch).
    const result = rpcData as {
      error?: string;
      revision_head?: number;
      outcomes?: Array<Record<string, any>>;
      writeback_jobs?: Array<Record<string, any>>;
      replayed?: boolean;
    };

    if (result?.error) {
      // Change-set-level rejection (no head bump, no broadcast). Surface, don't broadcast.
      log('changeset_rejected', { reason: result.error });
      const status =
        result.error === 'unauthorized'
          ? 403
          : result.error === 'locked'
            ? 423
            : result.error === 'no_active_registration' || result.error === 'workbook_mismatch'
              ? 409
              : 400;
      return json({ error: result.error, outcomes: result.outcomes ?? [] }, status);
    }

    const outcomes = result?.outcomes ?? [];
    const excelRevision = result?.revision_head ?? 0;

    // 9. SIGN + PERSIST CREATED-ROW TOKENS (F20) — BEFORE any broadcast. For every create
    //    outcome, sign a Row-ID token over the FROZEN signingDocId with the resolved secret,
    //    then persist it via kal309_persist_created_token (writes assigned_token + the
    //    writeback job into the stored change-set). The token NEVER goes into the op log.
    //
    //    Fix 1 (replay safety): do NOT skip this on replay. A retry after a partial/crashed
    //    persist replays the stored outcomes (with the minted ids) but its writeback_jobs may be
    //    INCOMPLETE — the original run died after minting the id but before/partway through
    //    persisting tokens. So on BOTH the first apply AND a replay, persist any create whose
    //    token is not yet recorded in the stored writeback_jobs. kal309_persist_created_token is
    //    idempotent + dedupes by markerAnnotationId (build note 2), so re-running an
    //    already-persisted create is a safe no-op. This guarantees every create has a durable
    //    token BEFORE we broadcast.
    const startingJobs: Array<Record<string, any>> = result?.writeback_jobs ?? [];
    const persistedMarkerIds = new Set<string>(
      startingJobs
        .map((j) => j?.markerAnnotationId)
        .filter((m): m is string => typeof m === 'string'),
    );
    const writebackJobs: Array<Record<string, any>> = [...startingJobs];
    let allTokensPersisted = true;

    const created = outcomes.filter((o) => o?.outcome === 'create' && o?.markerAnnotationId);
    for (const o of created) {
      const markerId: string = o.markerAnnotationId;
      // Already has a durable token from a prior (possibly first-apply) run → nothing to do.
      if (persistedMarkerIds.has(markerId)) continue;

      const scopeId: string | null = o.scopeId ?? findScopeForOpId(pRows, o.opId);
      if (!scopeId) {
        // Without a scope we cannot key the state row — leave the token pending; the client
        // retries the change-set (idempotent — F7 replays, this persist re-runs for the
        // still-missing token).
        allTokensPersisted = false;
        log('created_token_missing_scope', { opId: o.opId });
        continue;
      }
      let assignedToken: string;
      try {
        assignedToken = await generateRowIdToken({
          keyId: signingKeyId,
          secret: signingSecret,
          documentId: signingDocId, // FROZEN signing id (build-note) — never a client value.
          scopeId,
          markerId,
        });
      } catch (err) {
        allTokensPersisted = false;
        log('token_sign_failed', { name: (err as Error)?.name });
        continue;
      }
      const { data: persisted, error: persistErr } = await service.rpc(
        'kal309_persist_created_token',
        {
          p_document_id: documentId,
          p_template_id: templateId,
          p_scope_id: scopeId,
          p_marker_annotation_id: markerId,
          p_client_change_set_id: clientChangeSetId,
          p_assigned_token: assignedToken,
        },
      );
      if (persistErr || persisted === false) {
        allTokensPersisted = false;
        log('token_persist_failed', { hasError: Boolean(persistErr) });
        continue;
      }
      persistedMarkerIds.add(markerId);
      writebackJobs.push({ markerAnnotationId: markerId, assignedToken, scopeId });
    }

    // If ANY created token failed to persist, do NOT broadcast (F20 — no hint before every
    // token is durable). Return outcomes WITHOUT the writeback jobs so the client retries the
    // SAME change-set id (idempotent replay re-runs the persist for still-NULL tokens).
    if (!allTokensPersisted) {
      log('partial_token_persist', { excelRevision });
      return json(
        {
          excelRevision,
          outcomes,
          writebackJobs: [],
          tokenWritebackIncomplete: true,
        },
        200,
      );
    }

    // 10. BROADCAST a content-free hint POST-COMMIT (F12). Channel yjs:<documentId>, event
    //     'excel_sync_applied', payload { documentId, templateId, excelRevision }. NO row
    //     content, NO tokens. Best-effort — a failed broadcast doesn't fail the apply (clients
    //     also reconcile on open via fetchSince).
    try {
      const channel = service.channel(`yjs:${documentId}`, {
        config: { broadcast: { ack: false, self: false } },
      });
      await channel.send({
        type: 'broadcast',
        event: 'excel_sync_applied',
        payload: { documentId, templateId, excelRevision },
      });
      // Release the ephemeral channel; we only needed it to emit one hint.
      await service.removeChannel(channel);
    } catch (err) {
      log('broadcast_failed', { name: (err as Error)?.name });
    }

    // 11. RETURN per-row outcomes + the new excelRevision + the verified writeback jobs.
    log('applied', {
      excelRevision,
      replayed: Boolean(result?.replayed),
      rowCount: outcomes.length,
      writebackCount: writebackJobs.length,
    });
    return json(
      {
        excelRevision,
        outcomes,
        writebackJobs,
        replayed: Boolean(result?.replayed),
      },
      200,
    );
  } catch (err) {
    // Structured, content-free error. Never leak secrets or row content.
    log('unhandled_error', { name: (err as Error)?.name });
    return json({ error: 'internal_error' }, 500);
  }
});

// Best-effort scope recovery for a created outcome whose RPC outcome omitted scopeId — read it
// back from the p_rows we sent (the op carries scopeId). Content-free; no token material.
function findScopeForOpId(
  pRows: Array<Record<string, unknown>>,
  opId: unknown,
): string | null {
  if (!opId) return null;
  const match = pRows.find((r) => r.opId === opId);
  const scope = match?.scopeId;
  return typeof scope === 'string' && scope !== '' ? scope : null;
}

// Fix 3: per-worksheet resolver for the VISIBLE incoming row values at a given json data-row
// index (the buildScopeImportPlans byRowIndex Map key). Mirrors buildScopeImportPlans' buildValues
// + colToChecklistId resolution EXACTLY (system headers + template checklist text → id), so the
// values the RPC applies are byte-for-byte what the matcher fingerprinted. We replicate the logic
// here rather than editing the guarded matcher copy (which must stay byte-identical to
// src/services/*). If the worksheet/header is malformed, returns null (RPC routes that row's
// outcome accordingly — no crash).
const SYSTEM_HEADERS = ['Row ID', 'Changed By', 'Changed Date', 'Item', 'Entity', 'Notes'];

function resolveCategoryChecklist(templateToUse: any, matchedCategory: any): any[] {
  const modules = templateToUse?.modules || templateToUse?.spaces || [];
  for (const mod of modules) {
    const cat = (mod?.categories || []).find((c: any) => c?.id === matchedCategory?.id);
    if (cat) return cat.checklist || [];
  }
  return matchedCategory?.checklist || [];
}

function makeWorksheetValueResolver(
  worksheet: any,
  templateToUse: any,
): (jsonIndex: number) => Record<string, unknown> | null {
  const headerRow = worksheet?.headerRow;
  const jsonData = worksheet?.jsonData;
  if (!Array.isArray(headerRow) || !Array.isArray(jsonData)) {
    return () => null;
  }

  const idxOf = (label: string) => headerRow.indexOf(label);
  const changedByIdx = idxOf('Changed By');
  const changedDateIdx = idxOf('Changed Date');
  const itemIdx = idxOf('Item');
  const entityIdx = idxOf('Entity');
  const notesIdx = idxOf('Notes');

  const checklistItems = resolveCategoryChecklist(templateToUse, worksheet?.matchedCategory);
  const colToChecklistId: Record<number, string> = {};
  headerRow.forEach((colText: unknown, index: number) => {
    if (SYSTEM_HEADERS.includes(colText as string)) return;
    const trimmed = colText?.toString().trim();
    if (!trimmed) return;
    const ci = checklistItems.find((c: any) => c?.text === trimmed);
    if (ci) colToChecklistId[index] = ci.id;
  });

  const cellAt = (row: any, idx: number) => (idx >= 0 ? row[idx] : '');

  return (jsonIndex: number) => {
    const row = jsonData[jsonIndex];
    // Rows are array-LIKE (ExcelJS row arrays carry an extra sheetRowNumber prop); the matcher
    // indexes them numerically without an isArray guard, so accept any indexable non-null value.
    if (row == null || typeof row !== 'object') return null;
    const answers: Record<string, unknown> = {};
    for (const [colIndex, checklistId] of Object.entries(colToChecklistId)) {
      answers[checklistId] = row[Number(colIndex)];
    }
    return {
      changedBy: cellAt(row, changedByIdx),
      changedDate: cellAt(row, changedDateIdx),
      item: cellAt(row, itemIdx),
      entity: cellAt(row, entityIdx),
      notes: cellAt(row, notesIdx),
      answers,
    };
  };
}
