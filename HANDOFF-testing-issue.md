# Handoff: User found an issue live-testing — discuss THEIR proposed solution first

**Generated**: 2026-06-09 (night, end of session)
**Branch**: `main` (local-only, 148 commits ahead of origin — direct-to-main; push only on the user's say-so)
**HEAD**: `131d63d9` at fix time; the scenario-suite + docs commit (`test(excel-sync): integration scenarios for blank-Row-ID matching …`) lands immediately after — check `git log -1` for the true tip
**Status**: RESOLVED-PENDING-LIVE-TEST (2026-06-09 late night) — the issue Isaiah found was the blank-Row-ID duplicate: an Excel row with no Row ID, edited on both sides, created a duplicate Survey Marker instead of the keep-app/use-Excel choice (and auto-trashed an exported original). Root-caused, designed under his locked amendments (`.planning/blank-rowid-matching-verdict.md`, AMENDMENTS section GOVERNING), and fixed in commits `cad87ac5` → `9edaa8f8` → `5108cc97` → `131d63d9` + the staged scenario suite. Full state: `HANDOFF-excel-sync-next.md` ("What changed most recently"). **His next action: re-run tonight's exact steps live on the dev server.** The "ask him to describe the issue" instructions below are SUPERSEDED — kept for the historical record only.

## Goal (next session's first move)

Isaiah hit an issue while live-testing tonight's work and **has a proposed solution
he wants to work out collaboratively**. He did NOT describe the issue before the
session ended. So the next session must:

1. **Ask him to describe the issue** (what he did, what he saw, what he expected) and
   **his proposed solution** — before reading code or proposing anything.
2. Reproduce it on the dev server (`npm run dev:ui`, port 5174; drive via the
   Playwright MCP) or via the headless harnesses in `agent-cli/` before theorizing.
3. Evaluate his solution honestly — he explicitly values push-back with reasons
   (memory: `feedback_push_back_when_warranted`). Root-cause fixes only, no patches.
4. Plain-English replies (hard hook): no file paths / code names / line numbers /
   lettered menus; ≤ ~5 short sentences; always write "Survey Marker" in full.

## Likely suspects (he was testing tonight's work — check these FIRST against his report)

| If his issue is… | Know this before responding |
|---|---|
| Microsoft sign-in fails (browser opens, then error / redirect mismatch) | **EXPECTED, not a bug** — the one-time Azure portal change hasn't been made (see below). Legacy embedded sign-in is untouched and still works. |
| Sync banner says the Excel file "looks older" / sync skipped | The new stale guard (`e8017e69`). Auto paths refuse stale/stamp-less workbooks BY DESIGN; a workbook never exported by the new code has no stamp only if it predates `_SurveyMetadata` (almost none do). But: a workbook exported BEFORE tonight while markers carry NEWER `lastExportId` stamps could trip the 120s tolerance — check `excelImportRecencyGuard` classification first. |
| Excel edits stop applying to a row | The new 3-way merge (`e8017e69`): apply loops write ONLY `excelChangedFields` (fields Excel changed vs the stored baseline). A wrong/stale baseline (`marker.excelSync.fieldFingerprints`) would make Excel-side edits look unchanged → nothing written. Check `buildScopeImportPlans` whitelist attachment. |
| Survey panel row behavior (drag/expand/rename) | Panel was freshly rewritten in `9e1259d0` + polish commits — high churn; re-read `src/SurveySpacesRail.jsx` before editing. |
| Items 5/4 conflict/delete flows | Committed earlier (`ef1058b6`, `b80f19dc`) but tonight was their FIRST live test — a real-bug report here is plausible. Evidence map: `HANDOFF-excel-sync-next.md` items 4–5. |

## What this session shipped (all committed, gates green)

- `aa5ea955` docs: PLAN Amendment (b) committed (GOVERNING); root `HANDOFF.md` → pointer; original 5-round review log recovered.
- `b311ee6b` tests: 12 KAL-256 patch-deletion tripwires + fixture.
- `01332458` send-email open-relay fix — **committed, NOT deployed** (`supabase functions deploy send-email` still pending → production relay still open).
- `ccda926d` tooling: project hooks, CLAUDE.md graphify/wiki sections.
- `e8017e69` **item 9**: stale/export-clock guard (one shared export stamp in workbook `_SurveyMetadata` B3 + `marker.excelSync.lastExportId`; auto refuses stale/stamp-less; manual confirms; untrusted recency never deletes) + **true 3-way merge** (`excelChangedFields` whitelist in both apply loops — fixes "keep my version" being silently reverted).
- `2c5b475d` **item 8 code**: Microsoft sign-in via system browser (`@azure/msal-node` in Electron main, `acquireTokenInteractive` + loopback), main-process token custody (safeStorage-encrypted cache `src/electron/msalCacheStore.cjs`, narrow `msauth:*` IPC, refresh tokens never reach renderer), `connected_services` reduced to a no-token marker; legacy embedded flow kept as fallback/dual-read.
- `2eb7f7d1` handoff refresh.

**Gates at HEAD**: `node scripts/run-node-tests.mjs` → 1153 pass / 0 fail / 6 skipped; `npx vite build` clean. Both adversarially verified pre-commit (claude-obsidian:verifier); all HIGH/BLOCKER findings fixed before committing.

## Failed Approaches (Don't Repeat)

None abandoned. Verifier findings were fixed in place, notably: (a) missing-export-clock manual imports must NOT delete (`recencyDeletesDisabled`), (b) the recency guard reads markers via `surveyMarkersRef` (not stale closure), (c) main-custody restore retries one transient token miss then surfaces reconnect against the cached account instead of falling through to misread the no-token marker row. Don't "simplify" these away.

## Key decisions (this session)

| Decision | Rationale |
|---|---|
| Stale guard compares the existing ISO export stamp, not the full CRDT clock-vector design | Stamp already existed on both sides; single-user direct-to-main reality; Step 0 semantics honored (stale/missing → refuse or review); upgradeable later. 120s tolerance absorbs legacy two-`Date()` write skew. |
| 3-way merge shipped with item 9 | Same data-loss class; verifiers proved any import could revert app-only edits incl. resolved "keep mine" choices. Legacy (no-baseline) rows keep old Excel-wins behavior. |
| Legacy embedded sign-in kept as fallback | Web build needs it; legacy rows keep refreshing until first system-browser sign-in (the plan's allowed dual-read migration); zero regression risk to the working personal-account path. |

## User-only steps still pending (surface, don't nag)

1. **Azure portal (one-time)** — app `0da81a9e-2b05-46ee-b826-5efc5114c765`: add platform "Mobile and desktop applications" with redirect `http://localhost`, enable "Allow public client flows". Until then system-browser sign-in fails with redirect-URI mismatch.
2. **`supabase functions deploy send-email`** — closes the live open relay.
3. **Live tests** of items 5 / 4 / 9 (in progress — tonight's issue came from this).
4. Push to origin only after live tests pass and he says so.

## Files to know (for whatever he reports)

| File | Why |
|---|---|
| `HANDOFF-excel-sync-next.md` | Full workstream state, items 1–11 status, queue 7 → 1/10 → 2/3. |
| `src/services/excelImportRecencyGuard.js` (+ its test) | The new stale-guard core. |
| `src/services/buildScopeImportPlans.js` | Conflict downgrade + `excelChangedFields` whitelist. |
| `src/PDFViewer.jsx` ~13351–14600 | Both import executors (guard entry, apply loops, delete triage). HIGH-RISK: minimum diff, `npm test` after. |
| `src/contexts/MSGraphContext.jsx` | Dual-path auth (main custody vs legacy PKCE). |
| `src/electron/msalAuthMain.js` / `msalCacheStore.cjs` | Main-process sign-in + encrypted cache. |
| `tests/excelStaleGuardContracts.test.mjs`, `tests/microsoftAuthMainContracts.test.mjs` | Wiring tripwires — update deliberately if wiring changes. |

## Resume instructions

1. Read this file, then `HANDOFF-excel-sync-next.md`, then the two GOVERNING sections of `PLAN.md`. Do NOT re-ask settled Excel-sync decisions (memory: `excel-sync-authority-chain`).
2. Ask Isaiah for: the issue (steps, what he saw vs expected) and his proposed solution. Listen first.
3. Map his report against the "Likely suspects" table; reproduce before diagnosing (dev server + Playwright MCP, or `agent-cli/` harnesses; `node agent-cli/yjs-roundtrip.mjs` for the persistence path).
4. Gate any fix on `npx vite build` + `node scripts/run-node-tests.mjs` (baseline 1153/0/6), verifier pass for non-trivial diffs, commit locally, no push.
