# PLAN — KAL-74 Version History e2e (test-only, cap-free)
_Round 3 revision — r2 (12 findings) + r3 (6 refinements) incorporated._

## Goal

Playwright e2e harness `agent-cli/version-history-e2e.mjs` covering the 22 KAL-74 test
cases: History entry point, activity rows (single row per action, no Yjs duplicates),
spotlight glow (path-shaped, pulsing, tracking through wait/scroll/zoom/pan),
deleted-item restore via payload, and named version/checkpoint flows (save, read-only
open, restore with pre-restore auto-revision). Same architecture as the proven KAL-75
harness: real vite app + Playwright + network-edge Supabase mock (mutations recorded,
never forwarded).

Exit codes 0/1/2 (pass / assertion fail / infra fail), DISCOVERY=1 record-only mode,
HEADFUL=1, PORT=5176 (KAL-75 owns 5175).

## Verified feature facts (Explore dossier + direct reads, file:line cited)

- History button: `button[aria-label="Version History"]` in PDFSidebar's collab footer
  between SyncStatusChip and PresenceAvatars; rendered only when `cloudSyncEnabled` &&
  `documentId` (PDFSidebar.jsx:25–51, 567). Click → `openHistoryPanel` — OPEN-ONLY
  (sets isCollapsed=false + tab 'history'); it does NOT toggle closed (Codex r2 #9).
  Panel teardown happens on sidebar collapse/unmount → case 19 uses the sidebar
  collapse control, not the History button.
- Panel: `RevisionsPanel` embedded (`data-testid="kal48-revisions-panel"`), header
  "Version History" (RevisionsPanel.jsx:672, 699).
- OWNER CHECK (Codex r2 #1, verified RevisionsPanel.jsx:157–169): one read
  `documents.select('user_id, project_id, projects!documents_project_id_fkey(user_id)')
  .eq('id', …).maybeSingle()`. The mock has no embedded-select support → this read
  would go unmatched AND isOwner would resolve false, hiding Save/Restore entirely
  (S6 impossible). The mock must serve this exact embedded projection.
- Activity rows: `data-testid="document-history-event-<id>"`; pen stroke summary
  "<Actor> drew a pen stroke on page N" (documentHistoryService.js:85–86, 202). Yjs
  events filtered at build (yjs_history_added/popped → null, :204–213); upsert dedup on
  (document_id, client_event_id) ignoreDuplicates (:253); localStorage fallback
  `survey_document_history_events_v1` + primary-wins merge (:15, 167–195).
- Upsert BODY HAS NO `id` (DB-generated) — a naive stateful store would serve id-less
  rows and the panel would render `document-history-event-undefined` (Codex r2 #4).
- Restore button on delete rows: isDeleteHistoryEvent + payload.restoreAction
  (RevisionsPanel.jsx:735, 779: `document-history-restore-<id>`).
- Spotlight: SVG `#document-history-spotlight-svg` appended page-relative; rAF sync;
  pen glow is inner `<path>`; animation `document-history-pulse-glow` 900ms infinite via
  `<style id="document-history-spotlight-style">`; stroke #4a90e2 (RevisionsPanel.jsx:
  39–50, 303–345, 386–519). Removed by stopSpotlightTracking on deselect/collapse.
- kal48 RPC contracts (documentRevisionService.js:34–109, verified):
  - REQUEST bodies use exact `p_*` keys: p_document_id, p_label, p_origin (create);
    p_document_id (list); p_revision_id (get/restore). Handlers + ledger asserts pin
    these exact keys (Codex r2 #2).
  - `kal48_list_revisions` rows use `revision_*`-prefixed keys (re-keyed by wrapper);
    create/get/restore return natural-key document_revisions rows; get includes
    `snapshot_json` (NOT `snapshot` — Codex r2 #3); panel reads row.revision_number and
    pre.revision_number directly.
- KAL-75 fixture annotations are WAL-seeded (kal75Fixtures.mjs:110 walRows via
  buildWalHex(3); annotationRows: []) — NOT document_annotations rows (Codex r2 #8).
  Revision annotation_count and "rest of document untouched" asserts must come from
  the RENDERED state (g[data-annotation-index] identities/geometry), not table rows.
- Read-only open contract (dossier): getRevision → viewingRevision state →
  banner + body[data-readonly="true"]; the snapshot is NOT rendered to the page.
  Case 21 is therefore pinned as BANNER-ONLY SCOPE + state-not-lost (Codex r2 #11):
  assert banner, body attr, and that after return-to-current the live annotations are
  unchanged. Snapshot-rendering verification is declared out of scope in the run log.

Hard rule (Codex r1): the harness must NEVER assert on POST/upsert RESPONSE bodies —
the mock's representation path does not apply select projection. All persistence
asserts go through the mutation LEDGER (request bodies) + subsequent GET reads served
by the stateful store.

## Changes

### 1. `agent-cli/lib/supabaseMock.mjs` — additive extensions only

- New optional param `readHandlerOverrides = {}`; effective read handlers =
  `{ ...readHandlers, ...readHandlerOverrides }`. Existing harnesses unaffected.
- New optional param `onMutation(entry)` callback (default no-op) invoked after each
  ledger record — feeds the kal74 history store from real POST bodies.
- Expand `TABLE_COLUMNS.document_history_events` to the full migration column list.
- Embedded-select support, MINIMAL and exact (Codex r2 #1, mechanics r3 #1): detection
  happens BEFORE the generic projection/unmatched logic — if `q.select` equals the one
  exact embedded projection the app uses
  ('user_id, project_id, projects!documents_project_id_fkey(user_id)'), the documents
  handler attaches `projects: { user_id: <project owner> }` (or null) to matching rows
  and SETS A HANDLED FLAG / replaces q.select with the plain columns so the generic
  path neither strips the embed nor records unmatched. Any other embedded select stays
  unmatched (no permissive fallback). Gate: KAL-75 + KAL-92 harnesses re-run green.

### 2. New `agent-cli/lib/kal74Fixtures.mjs`

- `buildFixtures()` — derive from kal75Fixtures' DOC_OWNED (3 WAL-seeded overlapping
  rects kal75-fab-01..03 on page 1) — these are the "rest of the document" for case 17.
  Document row: project_id null + user_id null (stamped to the live user) → creator-
  owner path of the owner check.
- `createHistoryStore()` — stateful primary store fed via onMutation from real upsert
  bodies; honors (document_id, client_event_id) ignoreDuplicates; ASSIGNS a stable
  synthetic id (`hist-<n>`) to each accepted row (Codex r2 #4); read override
  `document_history_events: (q) => <filter store rows on document_id, order, limit>`.
- `buildKal48RpcHandlers(revStore)` — stateful revision store, owner-faithful:
  - `kal48_create_revision` (body: p_document_id/p_label/p_origin) → natural-key row
    { id, document_id, revision_number: n++, label, origin, created_by, created_at,
    annotation_count, survey_item_count, snapshot_json }, appends, returns it.
    annotation_count AND snapshot_json.annotations are supplied by the harness via a
    `setLiveCount(fn)` hook (computed from the RENDERED annotation count at call
    time), not from table rows (Codex r2 #8). The restore handler ALSO calls the hook
    when minting the auto-pre-restore row, so that row is count-faithful to the
    diverged state (r3 #3).
  - `kal48_list_revisions` (p_document_id) → rows projected to `revision_*` keys.
  - `kal48_get_revision` (p_revision_id) → natural row incl. `snapshot_json`
    (Codex r2 #3). snapshot_json shape PINNED (r3 #4, what the banner reads):
    { version, annotations: [<count-faithful array, one entry per live annotation at
    save time>], survey_items: [], meta: {} } — annotations.length must equal the
    rendered count captured at create/restore time.
  - `kal48_restore_revision` (p_revision_id) → appends origin:'auto-pre-restore' row
    and returns it (natural keys).
  - One FAILURE mode wired (Codex r2 #12): the store exposes `failNext(fn)` — harness
    arms it once for kal48_create_revision → handler returns { status: 400, json:
    {message: 'kal74-injected-failure'} }; assert panel status shows an error and NO
    revision row appears. get/restore failure cases listed as residuals.

### 3. New `agent-cli/version-history-e2e.mjs`

Scenario map → ticket cases:

- S1 entry point (cases 1–2): assert collab footer DOM order SyncStatusChip → History
  button → PresenceAvatars; click; `kal48-revisions-panel` visible, header "Version
  History"; zero event rows at start.
- S2 draw + single row + PRIMARY persistence (cases 3–5):
  - draw one pen stroke on page 1 (KAL-75 gesture: `p`, drag in `.e-pv-page-div`,
    Escape, poll `g[data-annotation-index]` +1).
  - poll for exactly ONE `document-history-event-*` row, text /drew a pen stroke on
    page 1/; zero rows matching /edited annotation/; total event-row count 1.
  - row's testid id must NOT be 'undefined'/'null' (store id integrity, Codex r2 #4).
  - PRIMARY-PATH PROBE (Codex r2 #5): clear localStorage key
    `survey_document_history_events_v1` (page.evaluate), close panel via sidebar
    collapse, reopen via History button → the row STILL renders exactly once (served
    by the mock store through the real GET; ledger shows the GET hit
    document_history_events with document_id filter). This kills the
    localStorage-masking false-green.
- S3 spotlight (cases 6–12): click the draw row →
  - `#document-history-spotlight-svg` exists; inner shape is `<path>` (NOT
    rect/ellipse/polygon); style tag present; computed animationName ===
    'document-history-pulse-glow' (cases 6–8).
  - wait 4.5s → still attached + animating (case 9).
  - ALIGNMENT METRIC (Codex r2 #6): compare the INNER glow `<path>`
    getBoundingClientRect against the target annotation's VISIBLE rendered path
    (`g[data-annotation-index]` path for the stroke; skip invisible hit-zone twins) —
    centers are the strict signal: |Δcenter| ≤ 3px; size compared with stroke-width
    allowance (glow stroke inflates the bbox): |Δwidth|,|Δheight| ≤ (glowStroke +
    targetStroke) + 2px rather than a bare ratio (r3 #5). After each mutation:
    scroll down/up (case 10), zoom in ×2 via the app's real zoom control located in
    DISCOVERY (fallback keyboard zoom; never synthetic) with settle-poll (case 11),
    horizontal pan while zoomed (case 12). Zoom back to 100% after.
- S4 delete + restore payload (cases 13–17):
  - record the stroke path's bbox; select + Delete → rendered count back to 3;
    poll for /deleted a pen stroke/ row (case 14).
  - click delete row → glow `<path>` bbox ≈ recorded pre-delete bbox ±8px (case 15).
  - `document-history-restore-<id>` present (case 16); click → rendered count 4 AND
    the three fixture rects kal75-fab-01..03 still present with unchanged geometry
    (identity+bbox match, not count — Codex r2 #7) AND restored path bbox ≈ original;
    ledger shows ZERO kal48_restore_revision calls in this window (case 17: payload
    restore, not snapshot restore).
- S5 glow lifecycle (cases 18–19): click the delete row then the draw row → exactly
  ONE spotlight svg at all times (replaced, not stacked) (case 18). Collapse the
  sidebar (the real teardown path, Codex r2 #9) → spotlight svg gone (case 19);
  reopen for S6.
- S6 named versions (cases 20–22), DIVERGENCE-FIRST design (Codex r2 #10):
  - prompt-queue label "E2E v1"; click `kal48-save-revision` → revision row
    `kal48-revision-row-1`, 'manual' badge, ledger shows kal48_create_revision with
    exact p_* keys (case 20).
  - DIVERGE: draw a SECOND pen stroke (rendered count 5). Save nothing.
  - read-only open via `kal48-open-v1` → banner + body[data-readonly="true"];
    return-to-current → rendered count STILL 5 (current state never lost, case 21;
    banner-only scope logged).
  - confirm-queue; click `kal48-restore-v1` → ledger kal48_restore_revision once with
    p_revision_id; panel shows revision row v2 with visible badge text 'auto' (the
    originBadge mapping renders 'auto', NOT the raw origin string — r3 #2; raw
    origin:'auto-pre-restore' verified in the revision STORE, not the DOM); the v2
    row/store snapshot captures the DIVERGED state — annotation_count === 5 (r3 #3);
    status matches /Restored v1\. Previous state saved as v2\./ (case 22). NOTE: what the app DOES to live
    annotations on restore is whatever PDFViewer's restore pathway does with the
    snapshot — DISCOVERY records actual behavior; the hard asserts are the RPC
    contract + auto-pre-restore row + status. If live-state revert is observable
    (count back to 4), assert it; if not, log as residual (snapshot application is
    KAL-48 scope, not KAL-74).
  - FAILURE CASE (Codex r2 #12): arm failNext(create) → second save attempt with
    label "E2E v2-fail" → panel status shows error text, revision count unchanged.
- Ledger gates (whole run): zero unmatched requests; table mutations confined to the
  benign whitelist (copy KAL-75's list + document_history_events); RPC gate (r3 #6):
  kal48_* calls allowed ONLY with exact expected counts and bodies — create ×2 (one
  success "E2E v1", one armed failure "E2E v2-fail"), get ×1, restore ×1, list ≥1,
  each body using exact p_* keys; any other RPC or extra kal48 call fails the run.

## Out of scope / residuals (recorded on the ticket)

- Real Supabase RLS + the actual kal48 SQL fns (cloud test project residual, same as
  KAL-75/KAL-92).
- Visual glow quality (blur/exact-blue rendering) — DOM/computed-style only.
- kal48_get/restore failure-path status handling (one create-failure case wired;
  the rest residual).
- Snapshot application to live annotations on restore (KAL-48 scope) — recorded in
  DISCOVERY, asserted only if observable.
- Migration-applied verification.

## Order of work

1. supabaseMock additive params + TABLE_COLUMNS + exact-match embedded-select support.
2. kal74Fixtures.mjs (history store, kal48 handlers, failNext).
3. Harness S1–S2; DISCOVERY=1; fix selectors/timing.
4. S3–S6 incrementally, DISCOVERY between additions.
5. Strict green ×2; `npx vite build` + `node scripts/run-node-tests.mjs`; re-run
   lock-document-e2e.mjs + regress-idle-disappearance.mjs to prove mock extensions
   harmless.
6. Codex result review until converged; commit; boards; report.

## Risks

- Zoom control selector unverified — DISCOVERY first; keyboard fallback; never fake.
- Spotlight rAF settle after zoom — settle-poll (alignment stable across 3 consecutive
  frames, 5s cap), no fixed sleeps.
- The embedded-select handler is the only mock change with cross-harness blast radius —
  gated by re-running both existing harnesses.
- documentHistoryService GET ordering uses occurred_at desc — store must sort
  faithfully or row-order asserts may flake; sort in the read override.
