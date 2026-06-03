# Handoff: optimize DB sync → multi-user collaboration → buttery zoom/scroll/pan

**Generated**: 2026-06-03 (evening)
**Branch**: main (pushed; HEAD `ba4d7b30`, origin/main up to date)
**Workflow**: direct-to-main. Land on local `main`, user tests on their own dev server (`localhost:5173`, Electron), push only when explicitly asked. The user verifies backend changes with a **Cmd+Shift+L** network capture → writes `Desktop/Survey-BetaSafeS2/Logs/<timestamp>/network.json` (URLs + method + duration, no bodies). `Desktop/Survey-BetaSafeS2` and the primary repo are the SAME files (symlink).

---

## THE MASTER PLAN (the north star — do these in order, never forget it)

1. **Optimize ALL backend database communication** — every round-trip for auth, document loading/rendering, saving, deleting, resizing, sharing. Make it lightweight, fast, few round-trips, correct. ← IN PROGRESS.
2. **Then optimize multi-user collaboration / presence** — make it professional-grade real-time multiplayer.
3. **Then go back to zoom / scroll / pan and make it buttery-smooth** — the real app's pdf.js path is better than before but NOT yet demo-perfect. This was deprioritized until the data layer is "mint," but it is the ultimate goal.

**Benchmark everything against the pros (the user named these explicitly):**
- **Figma** — server-authoritative multiplayer, per-property last-write-wins + live awareness.
- **Drawboard PDF** — collaborative annotation over an immutable PDF (our exact problem).
- **Google Docs** — operational transform, server revision log, offline.
- **tldraw sync** — freshest realtime multiplayer/presence reference (tldraw.dev/docs/sync).

**For zoom/scroll/pan, reference our OWN demos** — we had three throwaway demos (the pdf.js / EmbedPDF "two-arm" spikes: `src/prototype/PdfjsArm.jsx`, `src/prototype/FeatureSpike.jsx`, plus the renderer spike) where **zoom/scroll/pan were WAY smoother than the real app**. That smoothness is the bar. Phase 37 `DEMO-PARITY-BLUEPRINT` (in `.planning/phases/37-pdfjs-cutover/`) has the concrete fix (Strategy B: per-frame live-zoom emit; overlay portals must ride the engine's transformed content node, not snap on settle).

End goal: instant opens, cheap backend, real multi-user collaboration, buttery zoom/scroll/pan — feels professional and "mint."

---

## THE AUDIT + RANKED PLAN (read first)

The full audit lives at **`.planning/DB-SYNC-AUDIT-2026-06-03.md`** (16-agent workflow). §6 is the ranked optimization backlog (#1–#13), §7 the correctness invariants, §8 the things to confirm with a live capture. Work the backlog top-down.

---

## DONE (this session, 2026-06-03 evening) — committed + pushed `ba4d7b30`

**Audit #3 — kill the duplicate-fetch fan-out + dead code.** Three pieces:
1. **In-flight request coalescer** (`src/hooks/requestCoalescer.js`, + 7 unit tests). The boot burst of identical Supabase reads (the same query fired 3–4× within ~3ms by multiple uncoordinated hook instances) now collapses to ONE round-trip per query. In-flight-ONLY (key deleted on settle — NOT a value cache). Wired into `useDocuments`, `useTemplates`, `useSubscriptionLimits` (boot effect coalesces; `refetch` is a zero-arg BYPASS wrapper), and `AuthContext` tier read (module-level `inFlightTierByUser`; the two boot calls coalesce; window-focus + 5-min interval + `refreshSubscriptionTier` BYPASS so Stripe upgrades always land). Every hook keeps its public contract — no consumer call sites touched. **This is Linear KAL-251.**
2. **AuthContext tier read** `.single()` → `.maybeSingle()` — stops a false "Error fetching subscription tier" logged on every free-tier boot/focus/5-min refresh.
3. **Removed dead code** `getUserSubscriptionTier` + `canUserBeCollaborator` from `documentAnnotationService.js` — superseded by server-side RPCs `check_user_collaborator_eligibility` / `check_collaborator_by_email`; verified unreferenced repo-wide by an adversarial 3-agent workflow.

**Verified** by before/after Cmd+Shift+L capture (`Logs/2026-06-03_17-24-18` → `Logs/2026-06-03_18-01-08`): documents list 10→2, collaborators 10→2, documents id=in 10→2, templates 8→2, tier 2→1; ALL documents-table reads 37→12; total session requests 107→81. The ~3ms simultaneous boot burst collapsed to exactly ONE in every family; the remaining 2× are legitimate reads seconds apart (separate auth settles + per-tab document opens), which the in-flight-only design correctly does NOT merge. `npm test` 862/0/6, `npm run build` clean. Independent code review confirmed all must-not-regress invariants. Proof posted as a comment on KAL-251.

**Linear filed this session:** KAL-251 (the fan-out, High — IMPLEMENTED+VERIFIED, see its comment), KAL-250 (the per-open `documents`/`cutover_completed_at` 3× read → one shared per-open metadata resolver, Low/deferred — fully self-contained ticket).

---

## DEFERRED TO NEXT SESSION — start here

**#4 — the "who's viewing this" presence re-polling (the background chatter).** This is the next target. The presence realtime handler discards the payload and re-SELECTs the whole roster on every event; a 30s poll runs forever per viewer (the `document_presence` reads/upserts seen in every capture: ~13/session). Incremental fix: apply `payload.new`/`payload.old` directly instead of refetching, add a `clientSessionId` echo filter, gate the 30s poll on visibility + >1 viewer, shallow-equal the roster before `setPresence`. Structural fix: migrate to Supabase Realtime Presence (`track`/`presenceState`). **Must NOT regress** the presence-upsert-as-RLS-probe behavior (the upsert success flips `documentSyncEnabled`) — keep a separate entitlement probe if moving off the table. See audit §6 #4.

**Then the rest of the audit backlog** (top-down toward "mint"): #2 merge the two keyset loops, #5 batch history writes + stop the RevisionsPanel poll, #6 reuse hydrate read for backfill (kill double cold read), #8 don't block first paint on the tier read, #9 realtime payload (REPLICA IDENTITY), and the structural bets #10–#13 (per-open Y.Doc rebuild, realtime transport decision, CRDT completeness/persistence — central to step 2 multi-user collab, RLS/index tuning). KAL-250 (per-open cutover read dedup) fits here too.

**ONLY after the data + collaboration layers are mint:** return to step 3 — buttery zoom/scroll/pan vs the demos (Phase 37 blueprint).

---

## UNCOMMITTED WORK STILL IN THE TREE (needs a decision — NOT pushed)

Pushing `ba4d7b30` published only this session's #3 work + the prior commit backlog. Two other bodies of work remain UNCOMMITTED in the working tree:

**(B) The #1 watermark / fast-open DB-sync optimization (prior session today) — VERIFIED, and its prod migration is ALREADY LIVE.** This is the real liability: production has the `documents.annotations_changed_at` column + trigger (migration `20260603130000`, applied via `supabase db push`), but the code that uses it is uncommitted. **Recommend committing this next so the repo matches prod.** Files: `src/hooks/useAnnotationCloudSync.js` (HIGH-RISK), `src/services/annotationCloudSync.js`, `src/services/annotationTypeSerializers.js`, new `src/lib/collab/snapshotStore.js`, `src/lib/collab/snapshotFeatureFlag.js`, `src/lib/collab/__tests__/snapshotStore.watermark.test.mjs`, `src/services/annotationReadPagination.js`, migrations `20260602000000`/`20260602120000`/`20260603130000` + rollback, `.planning/DB-SYNC-AUDIT-2026-06-03.md`, `tests/kal241/`. ⚠ `snapshotFeatureFlag.js` is **TEMP default-ON — must be reverted to env/localStorage-gated before any real release.**

**(A) The v2.0 pdf.js engine cutover + tooling (multi-session, in-progress) — large, deliberate, commit separately later.** pdf.js is wired as the default engine behind a selector but not demo-smooth yet. Files: `src/PDFViewer.jsx` (HIGH-RISK), `src/main.jsx`, `src/viewerShared.js`, `src/sidebar/SearchTextPanel.jsx`, `src/prototype/*`, new `src/components/Pdfjs*.jsx` + `PDFViewerEngineSelector.jsx` + `pdfEngineContract.js`, `tests/performance/overlayPresentationGate.test.mjs`, `agent-cli/`, `.planning/phases/36-*` + `37-*`, `HANDOFF-forms-persistence.md`. **Scratch/local artifacts that should probably be gitignored, NOT committed:** the loose screenshots (`forms-*.png`, `pdfjs-*.jpeg`), `debug/fixtures/*.pdf`, and the local tooling folders (`.agents/`, `.hermes/`, `skills/`, `.claude/skills/`, `skills-lock.json`).

---

## WARNINGS / INVARIANTS (carry forward)

- **HIGH-RISK files** (minimum-viable-diff, run `npm test` after every touch; standing waiver applies): `src/PDFViewer.jsx`, `src/hooks/useAnnotationCloudSync.js`, `src/PageAnnotationLayer.jsx`, the Fabric canvases, `src/viewerShared.js`, `package.json`/`vite.config.js`. The #3 work this session deliberately stayed OUT of all of these (and out of `Dashboard.jsx`).
- **The coalescer is in-flight-ONLY** — never turn it into a settled-TTL value cache without per-key invalidation on mutations; that reintroduces the create→refetch and bulk-delete stale-read hazards the design avoided. Deliberate refetches MUST bypass.
- **Enforced viewer invariants** (still binding): SVG viewBox owns zoom scaling; never reintroduce JS zoom coordination; never remove the `zoomGeneration` signal; container-aware canvas sizing; single-name `fontFamily`; don't structurally edit the per-page overlay portal loop; don't imperatively transform overlay divs for pdf.js zoom (they ride the engine's transformed node — double-scale otherwise).
- **#1 read-skip guards (audit §7)** must never regress: wrong-page source-of-truth heal, the `queuedLocalWrites.hasPending` guard, the <80% Y.Map degeneracy guard, the empty-everything legacy probe. Snapshots are sourced from durable ROWS, never the Y.Doc.

---

## HOW TO VERIFY (no GUI needed)

- `npm test` (expect 862/0/6) and `npm run build` (clean; the chunk-size warning is pre-existing).
- Backend timing/reads via the headless `agent-cli/` driver (`docs`, `open`, `open-fast`, `sweep [--write]`).
- Backend behavior proof: user runs Cmd+Shift+L on their dev server → compare `Logs/<ts>/network.json` request counts before/after.

---

## RESUME INSTRUCTIONS

1. Read this file + `.planning/DB-SYNC-AUDIT-2026-06-03.md` §6 + today's session-moments (`~/.claude/projects/-Users-isaiahcalvo-Documents-Projects-Active-Survey-BetaSafeS2/memory/session-moments/2026-06-03.md`).
2. Confirm baseline: `npm test` 862/0/6, build clean.
3. **First decide the uncommitted work (section above):** recommend committing (B) the #1 watermark work since its migration is already live in prod (separate commit; flag the temp feature flag); handle (A) the pdf.js cutover deliberately and gitignore the scratch artifacts.
4. **Then start audit #4** — the presence "who's viewing" re-polling/chatter. Verify before/after with a Cmd+Shift+L capture (presence request count).
5. Keep working the backlog toward "mint," then move to step 2 (multi-user collaboration vs Figma/Drawboard/tldraw), then step 3 (buttery zoom/scroll/pan vs the demos).
