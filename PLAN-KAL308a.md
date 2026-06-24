# PLAN-KAL308a — Move the Row-ID signing secret server-side (so the Edge can verify Excel Row-ID tokens)

_Precondition for KAL-308. Governed by PLAN-KAL308.md (Decisions 1–3) +
PLAN-EXCEL-SECURITY-V1.md. Drafted by Claude 2026-06-24 from an exhaustive
code-map + adversarial pass (workflow kal308a-understand). This is the REVISED
design — it deliberately replaces the workflow's first draft (server-side
plpgsql signing + verdict RPC + matcher rewrite), which the adversarial critic
showed has a fatal byte-encoding trap (S3) and a per-row RPC storm (A1/A2)._

## Problem

The per-document Row-ID signing secret is minted by `crypto.getRandomValues()`
on the client and stored ONLY in `localStorage` (`rowIdSecret:{documentId}`,
`src/services/rowIdSecretStore.js`). Tokens are HMAC-signed client-side at export
(`generateRowIdToken`, `rowIdToken.js:115`) and verified client-side at import
(`classifyRowIdToken` → `resolveSecret`, `rowIdToken.js:207`,
`PDFViewer.jsx:13646/14259`). Because the secret never leaves the browser, **a
Supabase Edge Function cannot verify a Row-ID token** — so KAL-308's server-side
change-set validation can never trust a Row-ID. KAL-308a moves the secret's HOME
to the server so the Edge can resolve it.

## Decision: server-stored, server-AND-authorized-client-resolvable (Model B)

The token is **identity-binding, not authorization** — PLAN-EXCEL-SECURITY-V1 is
explicit: "the token binds workbook↔survey identity; it is NOT bearer
authorization … the actor-role check is the wall." That reframes the whole
problem:

- We do NOT need to hide the secret from authorized editors/owners. They can
  already author markers and push Excel changes; a forged-but-valid token from an
  editor asserts only a binding they're already allowed to assert. The security
  wall against viewers/outsiders is the **actor-role check** (KAL-308) + **RLS on
  the secret** (only editors/owners can resolve it).
- We DO need the secret to be **server-stored and server-readable** so the Edge
  can verify.

**Model B (chosen):** store the secret server-side keyed by the stable
`documents.id` UUID; let the **Edge resolve it via service-role** (the goal) AND
let **authorized editor/owner clients resolve it via an RLS-gated RPC** (replacing
`localStorage` as the source). The existing JS `generateRowIdToken` /
`classifyRowIdToken` keep doing the HMAC **unchanged** — they just receive a
server-sourced secret instead of a localStorage one.

**Why not Model A (server signs + verify-returns-verdicts, never vend secret):**
the workflow's first draft. The adversarial pass found it requires (a)
re-implementing base32url + HMAC in plpgsql with the secret keyed as the **UTF-8
bytes of the base64 string** (`rowIdToken.js:91`) — get one byte wrong and EVERY
token silently fails (S3); (b) a per-row verify RPC storm or an invasive matcher
contract change (the matcher's `classifyRowIdToken` HMACs locally and expects the
secret, not a verdict — A1/A2); (c) async signing on the export hot path risking
blank-token writeback (C2). Model B avoids ALL of these: HMAC stays in JS
everywhere (client + Deno Edge both use `rowIdToken.js` verbatim — byte-identical
by construction), no plpgsql crypto, no matcher rewrite, no breaking RPC. The
only cost is that the secret is resolvable by authorized clients — acceptable
because it is not an authorization secret.

> **OPEN FOR CODEX:** is Model B's "vend the secret to authorized editors/owners"
> posture acceptable, given the token is identity-binding not authorization and
> the role check is the real wall? If Codex argues the secret must NEVER reach a
> client, fall back to Model A-via-Edge (Edge signs + verifies using
> `rowIdToken.js` under Deno — still avoids the plpgsql S3 trap, but adds the
> matcher verdict-override + export-async-sign surface). I recommend Model B.

## Approach

### 1. Secret store (1 migration)
`supabase/migrations/<ts>_kal308a_rowid_signing_secrets.sql`:
```sql
CREATE TABLE public.rowid_signing_secrets (
  document_id    UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  key_id         TEXT NOT NULL,           -- 'k1' (matches token grammar)
  secret_b64     TEXT NOT NULL,           -- base64 string of 32 random bytes; the EXACT
                                          -- string rowIdToken.js HMACs over (S3-safe)
  signing_doc_id TEXT NOT NULL,           -- FROZEN canonical signing id (the composite at
                                          -- first mint); client signs/verifies over THIS;
                                          -- Edge checks token.documentId === this value
  is_current     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, key_id)
);
ALTER TABLE public.rowid_signing_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rowid_signing_secrets FROM authenticated, anon;
-- NO RLS SELECT/INSERT/UPDATE/DELETE policies for any client role → all access is via
-- the SECURITY DEFINER RPC (authorized editors/owners) or the service role (the Edge).
```
- Secret **lookup keyed by the stable `documents.id` UUID** (not the unstable
  composite). Secret is `encode(extensions.gen_random_bytes(32),'base64')` — server
  entropy, stored as the base64 STRING (S3-safe: the exact value the JS HMAC keys on).
- **`signing_doc_id` (Codex r1 #2):** the composite signing id is FROZEN at first
  mint and stored here. The client signs/verifies over the RETURNED stored value
  (not its freshly-computed composite), so the signing id is stable across renames
  (resolves the rename→`foreign` quirk for free), and KAL-308's Edge verifies the
  token's embedded `documentId` against this stored value — never a parsed/client
  value.
- RLS revokes all client access; a test asserts an editor's direct `SELECT` returns
  nothing (Codex r1 #7).

### 2. One RPC (editor/owner-gated, get-or-create, returns secret + frozen signing id)
`kal308a_get_or_create_signing_secret(p_document_id UUID, p_signing_id_seed TEXT)`
— SECURITY DEFINER, `search_path=''`:
- `auth.uid()` not null; `user_can_access_document(p_document_id,'editor')` or
  raise. (Viewer/anon → denied: this is the wall that stops forging.)
- **Atomic get-or-create (Codex r1 #4):** `INSERT INTO rowid_signing_secrets
  (document_id, key_id, secret_b64, signing_doc_id) VALUES (p_document_id,'k1',
  encode(extensions.gen_random_bytes(32),'base64'), p_signing_id_seed) ON CONFLICT
  (document_id, key_id) DO UPDATE SET document_id = EXCLUDED.document_id RETURNING
  key_id, secret_b64, signing_doc_id;` — the no-op `DO UPDATE` lets us `RETURNING`
  the existing row on conflict, race-free. `p_signing_id_seed` is used ONLY on first
  insert; later calls return the FROZEN stored `signing_doc_id`.
- Returns `(key_id, secret_b64, signing_doc_id)` to the authorized caller. The
  client signs/verifies over the returned `signing_doc_id`.
- The Edge read path is a service-role `SELECT` (no RPC needed; KAL-308's Edge reads
  the table directly with the service key).
- **No change to `kal307_register_workbook`** — secret mint is decoupled from
  registration (avoids the breaking-signature trap).
- A concurrency test fires two parallel first-calls and asserts one secret, no
  unique-violation (Codex r1 #4).

### 3. Client cutover (secret source) — new `src/services/rowIdServerSecretClient.js`
The branch is on **whether the doc has a Supabase UUID** (`pdfFile?.id`):

**Supabase-backed doc (has UUID) — server secret or BLANK, never localStorage
(Codex r1 #1):**
- `getServerSigningSecret(supabaseDocId, signingIdSeed)` calls
  `kal308a_get_or_create_signing_secret`, returns `{keyId, secret, signingDocId}`.
- **Memoize the in-flight promise per `(docId,keyId)` (Codex r1 #5):** the import
  matcher resolves tokens in parallel (`rowImportMatcher.js:62`); all parallel
  `resolveSecret` calls await ONE cached promise → exactly one RPC per doc, no storm.
- Export (`PDFViewer.jsx:~12236`) must **explicitly `await` the server secret BEFORE
  token generation (Codex r1 #3)** — today's secret read is synchronous; this adds an
  await. Sign over the returned `signingDocId` (frozen), NOT the freshly-computed
  composite. Then `generateRowIdToken` runs UNCHANGED.
- **On server failure at export → write BLANK Row IDs** (fingerprint recovery),
  NEVER fall back to localStorage signing — a localStorage-signed token on a
  registered workbook would be unverifiable by the Edge forever. Blank is the only
  safe degradation here.
- Import (`PDFViewer.jsx:13646/14259`): `resolveSecret` returns the server secret
  (memoized). `classifyRowIdToken` runs UNCHANGED. (Optional, additive: a same-browser
  legacy localStorage read for pre-308a tokens — never causes a wrong-accept since
  the matcher still gates; drop if it complicates.)

**Local-only doc (no UUID) — stays fully client-side (Codex r1 #8):** keep the
existing localStorage signing/verifying path entirely. Local-only docs get NO server
secret and therefore NO Edge-verified sync — explicitly client-only/offline; secured
multi-user sync requires a Supabase document UUID (consistent with "local-file sync
is unshared-only").

### 4. Legacy / migration — REQUIRED hard preflight (Codex r1 #6)
An active KAL-307-registered workbook whose Row-IDs were signed only by a localStorage
secret must NOT silently proceed to server-trusted sync (its tokens can't be Edge-
verified). So a minimal but HARD preflight: `kal308a_has_server_key(p_document_id)`
(SECURITY DEFINER bool). If the doc has an active registration AND no server key →
**block server sync and surface the existing re-export/re-link prompt** (the one
PLAN-EXCEL-SECURITY-V1's legacy-migration step + `workbookRegistration.js:171` already
reserve). Re-export runs the new server-signing path and mints the key, healing it;
until then, import stays in fingerprint + review (non-destructive). NEW docs post-308a
mint cleanly on first export. No client→server secret upload (would reintroduce
client-entropy trust). Per the disposable-data stance we don't preserve old tokens —
re-export is the migration.

## Files
ADD: the migration (`rowid_signing_secrets` + `kal308a_get_or_create_signing_secret`
+ `kal308a_has_server_key`); `src/services/rowIdServerSecretClient.js`;
`src/services/__tests__/rowIdServerSecretClient.test.mjs`; `tests/kal308a/*.test.mjs`
(integration, survey-test).
CHANGE: `src/services/rowIdSecretStore.js` (route to server for UUID docs,
localStorage only for no-UUID); export + import secret-resolver lambdas in
`src/PDFViewer.jsx` (server source + `await` + blank-on-failure + the legacy
preflight route); `src/services/workbookRegistration.js` (`hasServerSigningKey`
wrapper for the preflight).
DO NOT TOUCH: `rowIdToken.js` grammar (it's the spec both client + Edge match —
read-only); `rowIdWritebackQueue.js`/`rowIdGraphWriteback.js`/`rowIdLocalWriteback.js`
(carry already-signed tokens); `kal307_register_workbook` (no signature change);
the annotation Y.Doc stack.

## Tests
- Client wrapper: UUID doc → server resolve; server failure at export → **blank Row
  IDs** (NOT localStorage); no-UUID doc → localStorage; **memoization** — N parallel
  `resolveSecret` calls fire ONE RPC. Inject a fake `supabaseClient`.
- **Round-trip parity (the critical guard):** a secret minted by the RPC, fed to
  `generateRowIdToken` over the returned frozen `signingDocId`, verifies `valid` via
  `classifyRowIdToken` — proves the server-sourced base64 secret is byte-compatible
  with the JS HMAC. Survey-test integration (real RPC) per
  `survey_test_supabase_project` (NEVER production for automated tests — hygiene only).
- RPC gating: viewer denied, anon denied, editor/owner allowed; get-or-create
  idempotent (second call returns the SAME secret + frozen `signing_doc_id`).
- **Concurrency:** two parallel first-calls → one secret, no unique-violation.
- **RLS:** an authenticated editor's direct `SELECT` on `rowid_signing_secrets`
  returns nothing; viewer RPC call denied.
- **Preflight:** active registration + no server key → "needs re-export" (blocked);
  server key present → clean.
- Regression: `rowIdToken.test.mjs`, `rowIdSecretStore.test.mjs`,
  `excelBlankRowIdScenario.test.mjs` still green.
- Gate: `npx vite build` + `node scripts/run-node-tests.mjs` clean; report baseline.

## Acceptance criteria
- **Given** an editor/owner on a Supabase-backed doc, **when** they export, **then**
  tokens are signed with a server-minted secret (verifiable later by the Edge), and
  a viewer calling the secret RPC is denied — survey-test integration verified.
- **Given** the same doc re-opened on another device by an editor, **when** they
  import, **then** the secret resolves from the server (not device localStorage) and
  tokens verify `valid` — cross-device continuity that localStorage never had.
- **Given** the server is unreachable at export, **then** export degrades to blank
  Row IDs (fingerprint recovery), never blocks — unchanged contract.
- **Given** a viewer/anon, **when** they request the signing secret, **then**
  denied at the RPC — they cannot forge tokens.
- **Given** gates run, **then** build clean + 0 test fails (baseline reported).

## Build notes (Codex round-2 approval — non-blocking)
1. **Import must pass the FROZEN `signingDocId` as the `documentId`** into the matcher.
   `classifyRowIdToken` checks `documentId` BEFORE calling `resolveSecret`
   (`rowIdToken.js:197`); passing the current composite (`PDFViewer.jsx:13645`) would
   classify frozen-id tokens as `foreign`. Pre-resolve `{secret, signingDocId}` once,
   then pass `signingDocId` as the matcher's documentId.
2. **Gate `kal308a_has_server_key`** (editor/owner) too — else it leaks key existence
   by UUID.
3. **RLS test** should accept "permission denied" OR empty result (`REVOKE ALL` may
   raise rather than return empty).
4. The **legacy localStorage import fallback must never be used by the Edge/server-sync
   path** — it's a client-read-only legacy aid only.

## DO NOT CHANGE
- `rowIdToken.js` grammar/HMAC (the cross-language spec); `kal307_register_workbook`
  signature; the writeback modules; the annotation Y.Doc stack; standing high-risk
  files beyond the named import/export secret-resolver lines in `PDFViewer.jsx`.
- Production Supabase for automated TESTS (survey-test only — hygiene). Applying
  the migration to the real project for manual use is fine per the disposable-data
  stance.

## Risks / open questions
- **Model B vend-secret posture** — the one real design call; flagged for Codex above.
- **Dual-secret migration for old workbooks** — handled by the REQUIRED hard
  preflight (active registration + no server key → forced re-export); no localStorage
  signing fallback for registered docs, no client→server secret upload.
- **Identity stability** — RESOLVED: secret keyed by stable UUID, and the signing id
  is FROZEN at first mint (`signing_doc_id`) and returned to the client to sign over,
  so renames no longer flip tokens to `foreign`.
- **local-only docs** (no UUID) keep the localStorage path; they get no server
  secret and therefore no Edge verification — consistent with unshared-only local
  sync.

## Build-step-0 (settled by the workflow; carried for KAL-308, not 308a)
Survey markers live solely in the `annotationDocSync` Y.Doc's `Y.Map('surveyMarkers')`
(`annotationDocStore.js:73`); materialize via `handle.applySurveyMarkers(markers, opts)`
(`annotationDocSync.js:363`, field-level diff). 308a does not touch the Y.Doc.
