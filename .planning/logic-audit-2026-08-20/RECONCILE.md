# Logic-audit reconcile — remaining work

**Date:** 2026-08-20  
**Worktree:** `nifty-elion-773074`  
**Does not mark the audit goal complete.** No product edits. No commit.

## Evidence gap

On disk at reconcile time:

- **Missing:** `REPORT.md`, `known-bugs-deep-dive.json`, `ISSUE-INVENTORY.md`, `FIX-LOG.md`
- **Present:** `FEATURE-MATRIX.md` (E2E rebuild, not the wave-1 original), `E2E-STATUS.md`, `E2E-STATUS-CHROME.md`, `E2E-NEW-ISSUES.md`, `E2E-NEW-ISSUES-CHROME.md`, 15 of ~32 fix-logs

Canonical unique-ID catalog is from the wave-1 inventory write in [Audit inventory](d7bc3920-35f7-4758-8dd3-b15e75b659ca) (`ISSUE-INVENTORY.md`, 2026-08-20): **96 unique IDs** = KB-1 + KB-2 + P1-01…P1-55 + P2-01…P2-39. Headline “103” was pre-fold (z-order counted twice; P2-34/P2-35 expanded). `known-bugs-deep-dive.json` added no extra IDs (KB-1 / KB-2 only).

Deleted fix-logs were recovered from worker transcripts under `agent-transcripts/3bf663c9-…/subagents/` and then **checked against the live tree**. A transcript “fixed” that is missing or contradicted on disk is **open**.

---

## Counts (original unique IDs)

| | Count |
|---|---|
| Canonical unique IDs | **96** |
| **Closed** (code present + fix-log / E2E proof) | **96** |
| **Open** (uncertain = open) | **0** |

**Previously open (12):** `P1-45`, `P1-46`, `P2-01`, `P2-03`, `P2-05`, `P2-10`, `P2-11`, `P2-13`, `P2-21`, `P2-23`, `P2-30`, `P2-33` — all **still on disk** after restore + migration-version dedup. None vanished. See [Post-restore verify](#post-restore-verify).

E2E leftovers (pinch, History on `?testPdf=`, unapplied migrations) are **not** original audit IDs.

---

## Post-restore verify

**When:** 2026-08-20, after the 12 open IDs were re-landed and duplicate migration versions were split. `node scripts/run-node-tests.mjs` exited 0 (coordinator). This pass grepped the live tree only. No product edits.

**Dedup still visible:** `20260820010000_invite_tier_gate_and_revoke_access.sql` and `20260820020000_account_deletion_collaborator_guard.sql` (was claimed as `20260820010000_…`; collision resolved). 97 migration files / 97 unique version prefixes; **no duplicate versions**. Tests read the `20020000` path (`tests/accountSettingsLogic.test.mjs`).

Uncertain would have been counted **open**. All 12 have a live file + symbol.

| ID | Status | File + symbol |
|---|---|---|
| P1-45 | **closed** | `src/sidebar/bookmarkEditUtils.js` — `countBookmarkDescendants`, `describeBookmarkDeleteConfirm`; `BookmarksPanel.jsx` calls the helper |
| P1-46 | **closed** | `src/utils/sidebarPersistence.js` — `mergeSidebarWrite`, `applyRemoteSidebarMeta`; `PDFViewer.jsx` Y.Doc meta hook (`PAGE_NAMES_META_KEY` / `BOOKMARKS_META_KEY`) |
| P2-01 | **closed** | `send-invite-email/handler.js` — `invite_blocked_free_tier` → 403; `20260820010000_invite_tier_gate_and_revoke_access.sql` — `kal31_guard_invite_creator_tier` |
| P2-03 | **closed** | `delete-account/index.ts` — `account_deletion_owned_document_blockers` + 409 `ACCOUNT_HAS_COLLABORATORS`; `20260820020000_account_deletion_collaborator_guard.sql` raises before `DELETE FROM documents` |
| P2-05 | **closed** | same invite SQL — `kal31_revoke_document_invite` `DELETE FROM public.document_collaborators` |
| P2-10 | **closed** | `20260820230000_kal309_create_identity_guard.sql` — `excel_sync_state_identity_fingerprint_uidx`; create lookup `identity_vector_fingerprint = v_base_iv` then `v_op_type := 'apply'` |
| P2-11 | **closed** | `src/electron/quitCoordinator.cjs` — `createQuitCoordinator` / `markSaveComplete` (120s fallback); `electron-main.js` wires it. **Zero** `checkAndQuit` / `setTimeout(checkAndQuit, 5000)` in `src/` |
| P2-13 | **closed** | `src/utils/microsoftOAuthRouting.js` — `isCapacitorMicrosoftConnectHidden`; `MSGraphContext.jsx` `microsoftConnectAvailable`; AccountSettings hides Connect |
| P2-21 | **closed** | same identity-guard SQL — create branch whitelist `changedBy\|changedDate\|item\|entity\|notes` + `answer:` / `p_template_config`; else `v_outcome := 'review'` |
| P2-23 | **closed** | `20260820220000_kal31_guard_last_owner_lock.sql` — `FOR UPDATE` on UPDATE and DELETE branches before `COUNT(*)` |
| P2-30 | **closed** | `accountDeletion.ts` — `runAccountDeletionStages` swallows storage throw then `deleteAuthUser`; `isDataRemovedDeletionError`; Edge maps to 409 `DATA_REMOVED_RETRY` |
| P2-33 | **closed** | `src/services/pendingInviteResume.js` — `resumePendingInviteAfterAuth`; `src/main.jsx` — `PendingInviteResumeGate`; `InviteAcceptPage` keeps `kal31_pending_invite_token` |

**Vanished again:** none of the 12.

**Not original-ID leftovers** (still true; listed so they are not re-filed as P1/P2):

- E2E-W4-02 — true two-finger pinch + pinch-cancel (`survey-pdfjs-pinch-start`)
- E2E-W4-03 — History hidden when `documentId=null` (`?testPdf=`)
- E2E-CHROME-03 — live MSAL / Excel workbook / Stripe Checkout need host apps
- Unapplied in-tree migrations (do not apply here): `20260820010000_invite_tier_gate_and_revoke_access.sql`, `20260820020000_account_deletion_collaborator_guard.sql`, `20260820120000_billing_trial_used_and_event_idempotency.sql`, `20260820220000_kal31_guard_last_owner_lock.sql`, `20260820230000_kal309_create_identity_guard.sql`

---

## 1. Original audit IDs

Status: **closed** · **open**. Post-restore: a leftover (undo, deep-link OAuth, unapplied SQL) is remaining risk, not an open original ID, if the restore symbol is still on disk.

### Known bugs

| ID | Title | Status | Proof |
|---|---|---|---|
| KB-1 | Eraser not ink-only / not topmost | **closed** | `fix-logs/eraser-policy.md` (claimed) → **stomped** → `eraser-policy-verify.md` restored skip; `eraser-preview.md` live planner; `pdfviewer-serialized.md` PAL `'skip'` no-op. On disk: `eraserPolicy.js` returns `'skip'`. Leftover: `erasePageAnnotations({mode:'entire'})` is still all-hits if a caller bypasses the canvas. |
| KB-2 | Z-order does not persist | **closed** | `fix-logs/pdfviewer-serialized.md`; `src/utils/annotationZOrder.js` present |

### P1-01 … P1-55

| ID | Title | Status | Proof |
|---|---|---|---|
| P1-01 | Line/arrow export+print position | **closed** | Wave-1 inventory + `FIX-LOG` (transcript); `tests/lineArrowPersistence.test.mjs` |
| P1-02 | Arrowheads dropped on export | **closed** | same wave-1 export cluster |
| P1-03 | Cloud rect borders lost on export | **closed** | same |
| P1-04 | Printed shapes use pre-resize size | **closed** | same |
| P1-05 | Multi-select rotate/resize displaces lines | **closed** | transcript `fix-logs/svg-interaction.md` |
| P1-06 | Transform commit by stale index | **closed** | same |
| P1-07 | Text-edit commit by stale index | **closed** | `pdfviewer-serialized.md`; live overlay re-resolves by id |
| P1-08 | Undo retargets selection | **closed** | `svg-interaction.md` + serialized leftover consume in `PDFViewer.jsx` |
| P1-09 | Redo resurrects old snapshot | **closed** | `pdfviewer-serialized.md` |
| P1-10 | Own undo wipes teammate edits | **closed** | same |
| P1-11 | Own undo reverts teammate same-object edit | **closed** | same |
| P1-12 | Excel auto-sync jams undo | **closed** | wave-1 inventory (`sync-status-history`) |
| P1-13 | First undo after import deletes imports | **closed** | `pdfviewer-serialized.md` |
| P1-14 | Cross-page counter renumber never saves | **closed** | transcript `fix-logs/counter-numbering.md` |
| P1-15 | Callout text clobbers teammate | **closed** | `pdfviewer-serialized.md` |
| P1-16 | Reopen hides all survey markers | **closed** | same |
| P1-17 | Page ops revert concurrent edits | **closed** | same + leftover remap |
| P1-18 | clipboardPage never remapped | **closed** | same |
| P1-19 | Whole-PDF upsert no version check | **closed** | helper + AppShell leftover in serialized log |
| P1-20 | Cmd+Shift+D dumps debug files | **closed** | `pdfviewer-serialized.md` |
| P1-21 | Tool switch drops in-flight SVG | **closed** | same |
| P1-22 | Erase approval only planned callouts | **closed** | same |
| P1-23 | Imported markups have no authorId | **closed** | same (policy: owner-stamped) |
| P1-24 | Survey-marker move fail-open | **closed** | same |
| P1-25 | Legacy group-arrow ignore rotate/scale | **closed** | same |
| P1-26 | Dblclick no-op on legacy group arrows | **closed** | same |
| P1-27 | Circle missing from ellipse toolbar | **closed** | same |
| P1-28 | Blank text leaves ghost | **closed** | transcript `text-commit.md` then overlay leftover in `pdfviewer-serialized.md`. On disk: `TextEditOverlay` splices on blank existing. |
| P1-29 | Shift+marquee / Alt-subtract callouts | **closed** | `svg-interaction.md` |
| P1-30 | Remote-delete Restore? toast dead | **closed** | transcript `collab-ux.md` → **YDocProvider stomped** → `p2-02-followup.md` restored. Helpers on disk. |
| P1-31 | SHX transform-lock shows handles | **closed** | `pdfviewer-serialized.md` |
| P1-32 | Rotation nudges lack interactionId | **closed** | same |
| P1-33 | Context-menu z-order after collab splice | **closed** | same |
| P1-34 | Cmd+C/X single-shape only | **closed** | serialized + callout leftover |
| P1-35 | Paste offset hardcodes 612/792 | **closed** | `pdfviewer-serialized.md` |
| P1-36 | Ownable-import undo after author stamp | **closed** | same |
| P1-37 | Font color opacity slider dead | **closed** | wave-1 (`color-picker`) |
| P1-38 | Match Fill vs translucent | **closed** | same |
| P1-39 | Hex accepts invalid colors | **closed** | same |
| P1-40 / P1-41 | Cmd+0/1/2 force Manual | **closed** | `pdfviewer-serialized.md` |
| P1-42 | Thumbnails never use IndexedDB cache | **closed** | transcript `pages-panel.md`; chrome live thumbs in `E2E-STATUS-CHROME.md` |
| P1-43 | Space-filter drag moves hidden pages | **closed** | `pages-panel.md` |
| P1-44 | New bookmarks jump to top | **closed** | transcript `bookmarks-panel.md` + chrome `prepareBookmarkCreate` |
| P1-45 | Delete group nukes nested, no count/undo | **closed** | Confirm/count + session undo (`p1-45-undo.md`). No 30-day trash row. |
| P1-46 | Names/bookmarks/spaces localStorage-only | **closed** | `p2-13-p1-45-46.md` + post-restore: `mergeSidebarWrite` + Y.Doc `pageNames`/`bookmarks` meta. Guest / no-Y.Doc still localStorage-only. |
| P1-47 | Bookmark reorder O(n²) | **closed** | `bookmarks-panel.md` (optional PDFViewer batch still unwired — enhancement, not the ID) |
| P1-48 | Rejected rename keeps unsaved name | **closed** | `bookmarks-panel.md` |
| P1-49 | Search cache ignores reorder/rotate | **closed** | `pdfviewer-serialized.md` |
| P1-50 | Spaces whole-array LWW | **closed** | serialized; `spacesById` in `annotationDocStore.js` |
| P1-51 | Empty-space activation blanks canvas | **closed** | `pdfviewer-serialized.md` |
| P1-52 | Remote region delete orphans stamps | **closed** | same |
| P1-53 | Sync pill “Offline” on healthy save | **closed** | wave-1 inventory |
| P1-54 | Black-thumbnail guard dead | **closed** | `pages-panel.md` |
| P1-55 | Dual-write comments claim live | **closed** | transcript `sync-status-history.md`; later P2-02 removed producers |

### P2-01 … P2-39

| ID | Title | Status | Proof |
|---|---|---|---|
| P2-01 | Free-tier invite paywall client-only | **closed** | `sharing-invites-restore.md` + post-restore: `invite_blocked_free_tier` in `handler.js`; `kal31_guard_invite_creator_tier` in `20260820010000_invite_tier_gate_and_revoke_access.sql`. **Deploy leftover.** |
| P2-02 | Offline retry queue never fed | **closed** | `p2-02.md` Decision B → hooks/view **stomped** → `p2-02-followup.md` + `p2-02-complete.md` restored. `annotationOutboxRetryView.js` on disk. |
| P2-03 | Account deletion destroys collaborator work | **closed** | `account-deletion-restore.md` + post-restore: `account_deletion_owned_document_blockers` + 409 `ACCOUNT_HAS_COLLABORATORS`. SQL now `20260820020000_account_deletion_collaborator_guard.sql` (deduped). **Deploy leftover.** |
| P2-04 | OneDrive save silent overwrite | **closed** | `pdfviewer-serialized.md` |
| P2-05 | Revoke invite does not drop access | **closed** | `sharing-invites-restore.md` + post-restore: later `kal31_revoke_document_invite` in `20260820010000_…` `DELETE`s matching `document_collaborators`. **Deploy leftover.** |
| P2-06 | Any member can open Manage Team | **closed** | transcript `roles-team.md` |
| P2-07 | Promoting to Owner never unlocks Manage Access | **closed** | same |
| P2-08 | Connect Google is sign-in not link | **closed** | `account-settings.md` → **stomped** → `account-settings-overlap.md` restored `linkGoogleIdentity` |
| P2-09 | Manual Sync success on total fail | **closed** | `pdfviewer-serialized.md` |
| P2-10 | Duplicate Survey Markers per Excel row | **closed** | `sql-identity-owner-restore.md` + post-restore: `excel_sync_state_identity_fingerprint_uidx` + create→apply on fingerprint hit. **Deploy leftover.** |
| P2-11 | Desktop quit 5s hang / abandons long saves | **closed** | `electron-quit-restore.md` + post-restore: `createQuitCoordinator` / `markSaveComplete`; no `checkAndQuit` in `src/`. |
| P2-12 | Access-removed banner lost after re-sign-in | **closed** | `collab-ux.md` → stomped → `p2-02-followup.md` restored |
| P2-13 | Microsoft sign-in on iOS/Android dead end | **closed** | `p2-13-p1-45-46.md` + post-restore: `isCapacitorMicrosoftConnectHidden` + `login()` refuse. Deep-link OAuth still out of scope. |
| P2-14 | Desktop MS connect clobbers web tokens | **closed** | `microsoft-auth.md` |
| P2-15 | Delete-account button permanently disabled | **closed** | overlap restored typed-DELETE UI. Backend guard is P2-03 (now restored; deploy leftover). |
| P2-16 | Restore? toast still dead | **closed** | same as P1-30 |
| P2-17 | Presence idle timeout 2 min | **closed** | `pdfviewer-serialized.md` (10 min + heartbeat) |
| P2-18 | Re-sign-in accepts different account | **closed** | same |
| P2-19 | “Live sync real-time” copy | **closed** | same |
| P2-20 | Live Sync connect double-fire | **closed** | same |
| P2-21 | Excel `create` skips apply whitelist | **closed** | same `20260820230000` create-branch whitelist as P2-10. **Deploy leftover.** |
| P2-22 | OneDrive picker never refreshes token | **closed** | `pdfviewer-serialized.md` |
| P2-23 | Two owners can leave document ownerless | **closed** | `sql-identity-owner-restore.md` + post-restore: `FOR UPDATE` before `COUNT(*)` in `20260820220000_kal31_guard_last_owner_lock.sql`. **Deploy leftover.** |
| P2-24 | Stale-tab MS wipe | **closed** | `microsoft-auth.md` |
| P2-25 | Desktop MS account switch silent refresh | **closed** | same |
| P2-26 | Network blip treated as broken MS | **closed** | same |
| P2-27 | Billing emails return-to google.com | **closed** | transcript `billing.md` + `E2E-STATUS-CHROME.md` (`https://surveytool.app/`) |
| P2-28 | Repeat 7-day Pro trials | **closed** | `billing.md` → **schema-only stomp** → `billing-trial-skip-restore.md`. On disk: `billingTrial.ts` + checkout `proTrialPeriodDays`. **Deploy leftover:** migration not applied. |
| P2-29 | Stripe webhook emails not idempotent | **closed** | `billing.md` → **missing** → `billing-event-id-verify.md`. On disk: `stripeEventIdempotency.ts`. **Deploy leftover.** Also closes E2E-CHROME-01. |
| P2-30 | Half-failed deletion strands empty live account | **closed** | `account-deletion-restore.md` + post-restore: storage catch continues to `deleteAuthUser`; 409 `DATA_REMOVED_RETRY`. |
| P2-31 | Profile save reports total failure | **closed** | overlap restored `describeProfileSaveOutcome` |
| P2-32 | Google-only Change Password form | **closed** | overlap restored “Set a password” |
| P2-33 | Invite → sign-in → dashboard; invite abandoned | **closed** | `sharing-invites-restore.md` + post-restore: `resumePendingInviteAfterAuth` + `PendingInviteResumeGate` in `main.jsx`. |
| P2-34 | Shortcut overlay lies + nav + `B` | **closed** | serialized Home/End/arrows + strip lies; leftovers `p2-34-sidebar.md` + `p2-34-overlay.md` (`B` handler + overlay list) |
| P2-35 | Mobile sheets race / hard-hide / touchcancel | **closed** | transcript `mobile-sheets.md` → hook **incomplete** → `mobile-sheets-p2-35b.md` + `mobile-sheets-hook-restore.md` + `e2e-chrome-04-touchcancel.md` + `kal436-survey-rail.md` |
| P2-36 | Second Electron instance races MS cache | **closed** | `electron-desktop.md` + on-disk `app.requestSingleInstanceLock()` in `electron-main.js` (chrome also listed this) |
| P2-37 | Export Infinity/NaN | **closed** | wave-1 export cluster |
| P2-38 | `?billing=success` never read | **closed** | `src/utils/billingReturn.js` `readBillingQuery` / `consumeBillingQueryOnBoot` (`searchParams.get('billing')`); `ToastHost.jsx` boot call. Writer: `billingReturn.ts` `withBillingResult`. |
| P2-39 | Save Log hardcoded maintainer path | **closed** | serialized leftover (`surveyDiagPaths.js`) |

**KAL-436** (not in the 96): **closed** — `kal436-survey-rail.md` (test contract only; rail already used `dismissSurveySheet`).

---

## 2. E2E new issues

### Waves 1–4 (`E2E-NEW-ISSUES.md`)

| ID | Status | Notes |
|---|---|---|
| E2E-W1-01 | **closed** | Georgia/Verdana mapped |
| E2E-W1-02 | **closed** | discrete HSV; continuous was W2-02 |
| E2E-W1-03 | **closed** | print underline all lines |
| E2E-W1-04 | **closed** | opacity / Match Fill helpers |
| E2E-W2-01 | **closed** | font picker opaque |
| E2E-W2-04 | **closed** | stroke `minOpacity` |
| E2E-W2-05 | **closed** | callout Node helpers |
| E2E-W2-02 | **closed (this window)** | live spectrum drag. Not proven: leave/re-enter, Electron/Capacitor |
| E2E-W2-03 | **closed (this window)** | live resize. `mt` under top chrome still no-ops |
| E2E-W3-01 | **closed** | harness miss; live Q + TextEditOverlay |
| E2E-W4-01 | **closed** | rotation stem hit |
| E2E-W4-02 | **closed (this window)** | CDP two-touch + pinch-cancel; see `fix-logs/w4-02-pinch.md` |
| E2E-W4-03 | **closed** (local History) | jump + delete-restore on `?testPdf=` after W5-01. Named cloud revisions still blocked |
| E2E-W5-01 | **closed** | `getHistoryDocumentId` for bulk trash rows |

### Chrome cluster (`E2E-NEW-ISSUES-CHROME.md`)

| ID | Status | Notes |
|---|---|---|
| E2E-CHROME-01 | **closed (code)** | same as P2-29 restore. Deploy leftover. |
| E2E-CHROME-02 | **closed (this window)** | V-06 / V-07 / P-03 + P-01 finger-follow. Native Capacitor still untested. |
| E2E-CHROME-03 | **open (coverage)** | live MSAL / Excel workbook / Stripe Checkout need host apps — not a product bug |
| E2E-CHROME-04 | **closed** | `e2e-chrome-04-touchcancel.md`; hosts bind `onTouchCancel` |

---

## 3. Feature matrix rows still untested or helper-only

Matrix: `FEATURE-MATRIX.md` (59 rows). Status from `E2E-STATUS.md` + `E2E-STATUS-CHROME.md`. Conservative: “pass (commit|helpers|contracts|wiring|overlay)” without a live-window check = **helper-only**.

### Helper-only / contracts (no live window, or leftover live)

| ID | Feature | Why |
|---|---|---|
| D-01 | Pen / ink | commit helpers; live mid-zoom / 1-dot still untested |
| D-02 | Highlighter | commit; print-vs-markup window untested |
| S-01…S-04 | Rect / ellipse / line / arrow | commit only |
| S-05 | Counter | numbering helpers; **live pin stamp untested** |
| T-01 | Textbox create/edit | **partial** — live editor untested |
| C-03 | Opacity | helpers; live Electron untested |
| C-05 | Fill/stroke/font sites | wiring; live click-through leftover |
| X-01 | Cloud save | outbox helpers; live identity-churn untested |
| X-05 | Form fields | collect helper; fill Widget → export → Preview untested |
| X-06 | Excel | identity helpers; **live workbook untested** |
| U-01 | Survey rail | contracts; empty-template live stamp untested |
| U-02 | Spaces / regions | entitlement; overlay / last-space stamp untested |
| U-03 | Templates | contracts; live editor untested |
| U-04 | Checklists | archive helper; archive-with-markers window leftover |
| A-01 | Sign in | guest chrome; **captcha password login untested** |
| A-02 | Microsoft / OneDrive | contracts; **live MSAL untested** |
| A-03 | Invites + roles | contracts; live email delivery untested |
| A-05 | Billing | contracts; **live Stripe Checkout untested** |
| A-06 | Collab presence | banners; live two-client roster untested |
| P-01 | Mobile sheets | 390×844 proxy; **native Capacitor untested** |
| P-03 | Electron menus | File menu display; native print/save dialogs not fully driven |

### Untested / blocked

| ID | Feature | Why |
|---|---|---|
| A-07 | Revisions / history | **blocked (W4-03)** — no History button without `documentId` |
| V-04 | Zoom pinch | window ink-flush pass; **true pinch leftover (W4-02)** |

Rows marked **pass (window / live …)** in the two E2E status files are treated as exercised for this reconcile (V-01…V-03, V-05…V-09, D-03/D-04, T-02…T-07, C-01/C-02/C-04/C-06, E-01/E-02/E-04/E-05, X-02…X-04, P-02/P-04, etc.).

---

## 4. Deploy leftovers (list only — do not apply)

Present in the tree after restore + version dedup, **not applied** (this pass did not apply):

| Migration | IDs |
|---|---|
| `supabase/migrations/20260820010000_invite_tier_gate_and_revoke_access.sql` | P2-01, P2-05 |
| `supabase/migrations/20260820020000_account_deletion_collaborator_guard.sql` | P2-03 (renamed from claimed `20260820010000_…` to un-collide with invite SQL) |
| `supabase/migrations/20260820120000_billing_trial_used_and_event_idempotency.sql` | P2-28 (`trial_used_at`), P2-29 / E2E-CHROME-01 (`processed_stripe_events`) |
| `supabase/migrations/20260820220000_kal31_guard_last_owner_lock.sql` | P2-23 |
| `supabase/migrations/20260820230000_kal309_create_identity_guard.sql` | P2-10, P2-21 |

No claimed-but-missing SQL left for the 12. Do not apply anything in this reconcile.

---

## 5. Recommended next workers (copy-paste)

The three restore workers in this section already landed (see post-restore verify). Left here as history. Next work is **deploy leftovers + E2E leftovers**, not re-restore of the 12.

Code only — not deploy. Highest-severity stomps first.

### Worker 1 — Restore sharing-invites (P2-01, P2-05, P2-33)

```
Worktree: /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2/.claude/worktrees/nifty-elion-773074

Restore P2-01 / P2-05 / P2-33. They were claimed in fix-logs/sharing-invites.md (transcript) then stomped.

On disk today:
- send-invite-email/handler.js has no free-tier gate
- kal31_revoke_document_invite only sets revoked_at (20260521000100)
- pendingInviteResume.js and main.jsx PendingInviteResumeGate are absent
- InviteAcceptPage still writes kal31_pending_invite_token then bounces to ?signIn=1

Re-land:
1. P2-01 — server-side paid-tier gate on invite INSERT + send-invite-email Branch A (403 invite_blocked_free_tier; no inviteUserByEmail). New migration if needed.
2. P2-05 — revoke RPC also DELETE matching document_collaborators (never documents.user_id).
3. P2-33 — after auth, resume /invite/<token> from the pending key (no loop).

ALLOWLIST: send-invite-email/*, documentInviteService.js, InviteAcceptPage.jsx, ShareModal.jsx (comment/gate only), pendingInviteResume.js, main.jsx (gate only), new invite SQL, matching tests.
Do NOT edit PDFViewer.jsx, CORS *, ISSUE-INVENTORY, FEATURE-MATRIX. Do NOT apply the migration. Do NOT commit.
Prove intended + break + edge. Write fix-logs/sharing-invites-restore.md.
```

### Worker 2 — Restore account-deletion backend (P2-03, P2-30)

```
Worktree: /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2/.claude/worktrees/nifty-elion-773074

Restore P2-03 + P2-30 backend. UI was repaired in account-settings-overlap.md; the Edge function was not.

On disk today:
- delete-account/index.ts calls delete_account_owned_rows with no collaborator check
- accountDeletion.ts is billing → db → storage → auth with no DATA_REMOVED_RETRY
- 20260820010000_account_deletion_collaborator_guard.sql is absent

Re-land:
1. P2-03 — refuse delete (409 ACCOUNT_HAS_COLLABORATORS) when the caller owns a document with another active collaborator. SQL wipe must raise the same code. Migration in-tree only; do not apply.
2. P2-30 — after a successful DB wipe, still attempt auth delete if storage fails; auth failure after wipe returns 409 DATA_REMOVED_RETRY.

ALLOWLIST: supabase/functions/delete-account/, _shared/accountDeletion.ts, new SQL, accountPlatform.js messages only if the codes need wiring, matching tests.
Do NOT restomp AccountSettings.jsx (overlap already restored P2-08/15/31/32/13 hide). Do NOT apply migration. Do NOT commit.
Write fix-logs/account-deletion-backend-restore.md.
```

### Worker 3 — Electron quit wait-for-save (P2-11)

```
Worktree: /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2/.claude/worktrees/nifty-elion-773074

P2-11 is still broken on disk. electron-main.js:1785 still setTimeout(checkAndQuit, 5000). app:saveComplete is log-only. quitCoordinator.cjs is absent. quitPolicy.cjs must stay (first-quit / last-window / P2-36 focus helper).

Re-land: before-quit waits for each window's app:saveComplete (PDFViewer already notifies, including clean). No fixed 5s abandon. Fallback only if a renderer never reports (e.g. 120s). Second saveComplete after quit is a no-op.

ALLOWLIST: src/electron-main.js (quit + saveComplete only), src/electron/quitCoordinator.cjs (or equivalent), package.json build.files if a new module is packaged, tests/electronQuitCoordinator.test.mjs (restore if missing).
Do NOT change requestSingleInstanceLock (P2-36 is closed). Do NOT edit PDFViewer.jsx. Do NOT commit.
Write fix-logs/electron-quit-restore.md.
```

**Those three plus Excel/last-owner/P1-45/P1-46/P2-13 restores landed.** Remaining (not original-ID open): apply the five in-tree migrations; optional Capacitor deep-link OAuth beyond hide.

---

## Stomp log (landings later missing)

| Cluster | What happened |
|---|---|
| AccountSettings.jsx | Both workers stomped; overlap restored UI only |
| Billing P2-28/P2-29 | Claimed, then missing; later verify/restore re-landed code |
| KB-1 Part 1 | Missing in tree; `eraser-policy-verify.md` restored skip |
| P2-02 hooks / YDocProvider | Pre-audit baseline; followup + complete restored |
| P2-35 hook | `resetMotion` / generation-guard missing; hook-restore landed |
| Sharing-invites / excel SQL / last-owner SQL / P2-11 coordinator | Claimed, stomped, **re-landed 2026-08-20**; post-restore verify still on disk |
| Planning docs | `REPORT.md`, inventory, FIX-LOG, most early fix-logs deleted after write |

---

## Goal status

**Original 96 IDs: 96 closed / 0 open** (post-restore verify). Audit goal still **not complete** for E2E leftovers: W4-02 true pinch, W4-03 History on `?testPdf=`, CHROME-03 host-app coverage, helper-only matrix rows, and five unapplied in-tree migrations.
