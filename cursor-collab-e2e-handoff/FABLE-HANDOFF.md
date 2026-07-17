# Fable handoff — Cursor collab E2E fleet results

**Date:** 2026-07-17  
**From:** Cursor cloud agent (tester fleet only — no app-code changes, no commits)  
**Against:** `main` @ `5ec82ef1`  
**Dev server:** `http://localhost:5420` (`npm run dev:ui -- --port 5420 --strictPort`)  
**Companion brief:** `CURSOR-COLLAB-E2E-BRIEF.md` (same T1–T11 sequence; Codex ran the parallel `codex-*` fleet)

Give Fable **this file** + optionally point it at the evidence folder / screenshots below. Do **not** ask Cursor to re-run setup unblocking — remaining gaps need product decisions or Fable fixes.

---

## What already works (do not re-prove unless regressing)

| Test | Status | One-line proof |
|------|--------|----------------|
| T1 Share flow | **PASS** | UI invite → `/invite/:token` accept; B & C see `cursor-collab-e2e-0717.pdf` with no manual `document_collaborators` writes |
| T2 Presence | **PASS** | Both clients show **2 viewing** + avatars (left rail must be **expanded**; collapsed hides caption) |
| T3 Live draw | **PASS** | B pen+rect → A in **~254ms**; A callout text → B |
| T5 Simultaneous edit | **PASS** | Concurrent drags, no crash |
| T7 Undo scoping | **PASS** | B undo did not wipe A's callouts |

---

## What Fable should take (prioritized)

### P0 — Real product bug

**Hub Share never opens Access Management after collaborators join (T9 BLOCKED)**

- **Symptom:** After B/C accept invites, owner Documents ⋯ → Share still opens the invite modal (`Share document`, Permission=Viewer), **not** `Document Access` with role selects.
- **Repro:** Owner shares via UI → invitee accepts → owner returns to Documents → ⋯ → Share.
- **Likely cause:** `SurveyHub.jsx` gates manage mode with `manage: !!single?.shared`, and the hub document row’s `shared` flag is not set/refreshed after accepts (`DocumentsLedger` maps `shared: !!d.shared`).
- **Evidence:** `evidence/t9r-error.png`
- **Ask:** Fix so accepted collaborators make Share open Access Management; then verify role flip Editor↔Viewer (T9).

### P1 — Spec vs product (decide, then fix or update brief)

**Cross-author delete (T6 PARTIAL)**

- Brief expected editor B to delete owner A's callouts (keyboard Delete + context Delete) and see a confirmation dialog; then owner deletes collaborator marks with owner-cross-author confirm.
- Live code (`permissionScope.js` / `ConfirmDeleteModal.jsx`): **only the document owner** may modify others’ marks. Editors silently cannot select/delete foreign annotations — no dialog.
- **Ask Fable:** Confirm intended UX.
  - If current product is correct → update the E2E brief (editors should get a clear “can’t edit others’ marks” signal, or test only owner path).
  - If brief is correct → change product so editors get an explicit denial/dialog, and owner cross-author confirm is reliable.
- **Evidence:** `evidence/t6r-A-owner-nodialog.png`

### P2 — Verify manually / locally (not worth another Cursor fleet)

| Item | Status | Ask |
|------|--------|-----|
| T8 Styled callout sync | **FAIL** | Manually create callout with bold+underline, dashed leader, non-default arrowhead; confirm peer sees identical styling. Plain callout **text** sync already worked in T3 — this is styling fidelity. Evidence: `evidence/t8r-*.png` |
| T4 Live move | **PARTIAL** | Quick manual: A drags B’s rect / B drags A’s callout; confirm settle. Automation dragged but didn’t pixel-assert. |
| T11 Export interop | **PARTIAL** | Open `evidence/t11r-export.pdf` (valid PDF 1.7) in a real viewer; check text style, arrows, callouts. Headless couldn’t visually verify. |
| T10 Print w/ annotations | **BLOCKED** | Leave to Codex / Electron — web has no Print-with-annotations entry point. |

### P3 — UX polish (optional)

**Presence caption hidden when left rail collapsed** — expand rail to see “N viewing”. Low severity. Compare `evidence/t2-presence-A.png` (collapsed) vs `evidence/t2r-presence-A.png` (expanded).

---

## Full results table

| Test | Status | Evidence | Note |
|------|--------|----------|------|
| T1 | PASS | `t1-*.png` | Share UI invites + accept; B/C see doc |
| T2 | PASS | `t2r-presence-*.png` | Both show **2 viewing** (rail expanded) |
| T3 | PASS | `t3-*.png` | B→A shapes ~254ms; A callout text on B |
| T4 | PARTIAL | `t4r-*.png`, `t4-*.png` | Drags ran; settle via screenshots only |
| T5 | PASS | `t5-*.png` | Concurrent drags: no crash |
| T6 | PARTIAL | `t6r-A-owner-nodialog.png` | No delete confirm dialogs observed |
| T7 | PASS | `t7-*.png` | B undo did not remove A's callouts |
| T8 | FAIL | `t8r-*.png`, `t8r-style-bits.json` | Styled callout never landed on B |
| T9 | BLOCKED | `t9r-error.png` | Share reopened invite modal, not Access Management |
| T10 | BLOCKED | — | Cloud/web cannot reach print-with-annotations; Codex lane |
| T11 | PARTIAL | `t11r-export.pdf` | Valid export; visual interop not verified headless |

---

## Environment notes (so Fable doesn’t rediscover)

- Cloud agent used project `cvamwtpsuvxvjdnotbeg` (injected service role; dedicated `zgdkyslxbkusexmkfvgd` test key was unavailable).
- Login: `__fix20AuthOverride` + `/__dev-auth/session` captcha fallback (Turnstile blocks real form in cloud VM).
- Accounts used then **deleted**: `cursor-owner-0717@example.com`, `cursor-editor-0717@example.com`, `cursor-viewer-0717@example.com` (all seeded `user_subscriptions.tier=pro`).
- **Left alone:** `codex-owner-0717@example.com`, `codex-editor-0717@example.com`, `codex-viewer-0717@example.com`.
- No application source was modified; no git commits from this fleet.

---

## Suggested Fable prompt (paste this)

```
Read FABLE-HANDOFF.md (Cursor collab E2E results). You are fixing product gaps, not re-running the whole Cursor fleet.

Do in order:
1. P0: Fix hub Share so that after collaborators accept, Documents ⋯ → Share opens Access Management (shared/manage flag). Repro + evidence in the handoff (t9r-error.png). Verify Editor↔Viewer role flip.
2. P1: Decide T6 cross-author delete UX (brief vs permissionScope). Either fix product or document the intentional behavior and adjust the E2E brief.
3. P2: Manually verify T8 styled callout sync, T4 move settle, T11 export fidelity. Leave T10 to Codex/Electron.

Do not touch codex-* test users. Prefer minimum viable diffs in SurveyHub / document shared flag plumbing; run npm test if you touch high-risk files.
```

---

## Evidence location

All screenshots + export PDF + this handoff:

- Cloud artifacts: `/opt/cursor/artifacts/cursor-collab-e2e/`
  - `FABLE-HANDOFF.md` (this file)
  - `REPORT.md` (raw tester report)
  - `evidence/` (screenshots + `t11r-export.pdf`)

Key screenshots to attach for Fable if you can’t share the whole folder:

1. `evidence/t9r-error.png` — T9 Access Management bug  
2. `evidence/t2r-presence-A.png` — presence PASS  
3. `evidence/t3-B-sees-A-callout.png` — live callout sync PASS  
4. `evidence/t6r-A-owner-nodialog.png` — T6 delete dialog gap  
