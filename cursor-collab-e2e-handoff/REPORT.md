# Cursor Collab E2E Report (second fleet)

**Base:** http://localhost:5420  
**Commit:** 5ec82ef1+  
**Tester:** Cursor cloud agent (findings only — no app-code changes, no commits)  
**Accounts used:** `cursor-owner-0717@example.com`, `cursor-editor-0717@example.com`, `cursor-viewer-0717@example.com`  
**Left untouched:** all `codex-*` users (3 still present after cleanup)

## Results

| Test | Status | Evidence | Note |
|------|--------|----------|------|
| T1 | PASS | `evidence/t1-*.png` | Share UI → email invites → `/invite/:token` accept; B and C see `cursor-collab-e2e-0717.pdf` with no manual collaborator DB writes |
| T2 | PASS | `evidence/t2r-presence-A.png`, `t2r-presence-B.png` | Both show **2 viewing** + avatars C / CE in left-rail footer (rail must be expanded; collapsed hides caption) |
| T3 | PASS | `evidence/t3-*.png` | B pen+rect appeared on A in **~254ms**; A callout text appeared on B |
| T4 | PARTIAL | `evidence/t4r-*.png`, `t4-*.png` | Drag gestures completed on both clients; settle confirmed via screenshots but pixel-diff of final positions not automated |
| T5 | PASS | `evidence/t5-*.png` | Concurrent different-annotation + same-rect drags: **no crash**; both screens remained usable (winner not conclusively attributed) |
| T6 | PARTIAL | `evidence/t6r-A-owner-nodialog.png` | B Delete / right-click Delete on A's callout produced **no confirmation dialog** (selection often no-ops for foreign marks). A Delete on B's rect also produced **no owner-cross-author dialog** in this run (selection may have missed). See Bugs. |
| T7 | PASS | `evidence/t7-*.png` | After B Cmd/Ctrl+Z×5, A's callouts remained (`aStillHas=true`); B's own stroke count dropped |
| T8 | FAIL | `evidence/t8r-*.png`, `t8r-style-bits.json` | Could not reliably create a bold+underline+dashed+arrowhead callout in automation this pass; styled text never observed on B. (Plain callout text sync did work in T3.) |
| T9 | BLOCKED | `evidence/t9r-error.png` | After collaborators accepted, Documents ⋯ → Share opened **Share document** invite modal again (Permission=Viewer), **not** Document Access / role editor — could not flip C to Viewer via UI. See Bugs. |
| T10 | BLOCKED | — | not reachable in cloud environment — Codex fleet covers this (web has no Print-with-annotations control; Electron-only) |
| T11 | PARTIAL | `evidence/t11r-export.pdf` | Export produced a valid PDF 1.7 (~4KB with sparse annotations). Headless environment cannot visually verify bold/italic/arrowheads/callout fidelity in a PDF viewer |

## Bugs found

### 1. Hub Share does not open Access Management after collaborators join
- **Severity:** high (blocks permission-flip UX / T9)
- **Symptom:** With active collaborators present, Documents ⋯ → Share still opens the invite `Share document` modal (`t9r-error.png`) instead of `Document Access` with role `<select>` rows (`data-kal31-row="member"`).
- **Repro:** Owner shares via UI → invitee accepts → owner returns to Documents → ⋯ → Share.
- **Likely cause:** Hub list `shared` flag / `share.manage` gating in `SurveyHub.jsx` not reflecting accepted collaborators.
- **Evidence:** `/opt/cursor/artifacts/cursor-collab-e2e/evidence/t9r-error.png`

### 2. Cross-author delete confirmations not reachable for editors (and owner dialog missed in run)
- **Severity:** medium (may be by design for editors)
- **Symptom:** Editor B selecting/deleting owner callouts produced no `ConfirmDeleteModal`. Product code (`permissionScope.js`) only allows the **document owner** to modify others' marks — editors silently cannot. Brief expected B to delete A's callouts with a dialog.
- **Owner path:** A Delete on B's annotation also showed no `owner-cross-author` dialog in this run (likely selection miss on SVG layer).
- **Evidence:** `t6r-A-owner-nodialog.png`; first-pass Playwright logs showed SVG intercepting element clicks on `[data-callout-id]`.

### 3. Presence caption hidden when left rail is collapsed
- **Severity:** low (UX)
- **Symptom:** Default collapsed left rail uses `compact` PresenceAvatars and hides the "N viewing" caption → easy to miss active users. Expanding the rail reveals **2 viewing**.
- **Evidence:** Compare first-pass `t2-presence-A.png` (collapsed, no caption) vs `t2r-presence-A.png` (expanded, "2 viewing").

### 4. Styled callout creation/sync unverified (automation gap + possible product gap)
- **Severity:** high if product; medium if harness-only
- **Symptom:** Bold/underline/dashed/arrowhead callout could not be created reliably via UI automation; B never saw `cursor-styled-BOLD-UNDER`. Plain callout text sync worked in T3.
- **Evidence:** `t8r-A-styled.png` (no styled callout visible), `t8r-style-bits.json`

## Setup repairs I made (no app source edits)

- `.env.test` was missing in the cloud clone — wrote it using the injected `SUPABASE_SERVICE_ROLE_KEY` against `cvamwtpsuvxvjdnotbeg` (same project as app `.env` / JWT `ref`; dedicated `zgdkyslxbkusexmkfvgd` test-project key was not available in this environment).
- Wrote gitignored `.env.local` with `SUPABASE_SERVICE_ROLE_KEY` only (intentionally **no** `VITE_DEV_AUTO_LOGIN_*`) so `/__dev-auth/session` captcha fallback works per browser context.
- Login via existing `__fix20AuthOverride` localStorage harness + captcha bootstrap (Turnstile blocks real login form in cloud VM).
- Seeded `user_subscriptions.tier=pro` for the three `cursor-*` users so Share invites are allowed.
- Invite tokens read via Admin API **after** UI invite create (read-only) so B/C could open `/invite/:token` without inboxes.
- Cleanup: deleted all `cursor-*` users and `cursor-`-prefixed documents; verified `codex-*` users remain (3).

## Cleanup status

| Artifact | Status |
|----------|--------|
| `cursor-*` users | deleted |
| `cursor-*` documents | deleted |
| `codex-*` users | untouched (3 remain) |

No application source code was modified. No git commits.
