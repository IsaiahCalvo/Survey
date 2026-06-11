# Plan Review Log: KAL-303 + KAL-304 RevisionsPanel fixes
Started 2026-06-11 ~04:15 (loop session). MAX_ROUNDS=5. PLAN_FILE=PLAN-KAL303-KAL304.md. Same Codex thread as KAL-74 (context: it reviewed the harness that found these bugs).

## Round 1 — Codex

3 findings: (1) DOM fallback path renderDomPathFallbackSpotlight (:521-542) also mints pixel-viewBox spotlights and its closest() page resolution is overlay-broken — plumb pageNumber from overlay ancestry; (2) bare global svg[data-svg-annotation-layer="N"] too broad (multiple mount sites) — wrapper-scoped selector first + isConnected + nonzero-rect checks; (3) verification gaps: standalone banner, multi-page, no-layer fallback, DOM-fallback rows. KAL-304 hoist sound if verbatim.

VERDICT: REVISE

### Claude's response
(1) ACCEPTED — fix includes the DOM fallback path (derive pageNumber from target's closest annotation-svg/wrapper attrs, findPageElement fallback). (2) ACCEPTED — tightening selector order with connectivity+rect checks. (3) PARTIAL: new harness case S3b covers the DOM-fallback row (synthetic no-preview row via the store, aligned-glow assert); standalone is UNREACHABLE in the live app (sole mount is PDFSidebar:430 embedded — verified) → code-inspection disposition, verbatim JSX move; multi-page declared residual on KAL-303 (fixture is 1-page; per-page keying structural, pattern shipped in 2 siblings).

## Round 2 — Codex (2026-06-11 09:30, same thread, resumed by recovery session)

No blocking findings. Confirmed: DOM-fallback routing through createPageSpotlightSvg covers the real missed path; wrapper-scoped selector matches actual source attrs; standalone disposition verified against live mount PDFSidebar.jsx:430; multi-page residual explicit and acceptable.

VERDICT: APPROVED — proceeding to implementation (KAL-304 commit 1, then KAL-303 + harness S3b commit 2).

## Result review — Round 1 — Codex (2026-06-11 09:45)

Commits 666f1c5f (KAL-304) + 30c9bf53 (KAL-303 + harness S3b + allowlist emptied). Findings: (1) banner hoist sound, standalone equivalent; (2) KAL-303 host resolution/rAF/DOM-fallback/page-div-fallback all match plan; (3) S3b + empty allowlist re-arm confirmed; (4) multi-page residual unchanged, accepted. Evidence: strict ×2 PASS zero KNOWN-BUG, alignment deltas 0px, S3b wrapper-scoped viewBox 0 0 1224 792, KAL-75 + KAL-92 harnesses PASS, build clean, tests 1432/0/6.

VERDICT: APPROVED (result converged round 1)
