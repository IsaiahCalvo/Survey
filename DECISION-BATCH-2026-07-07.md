# Decision Batch — 2026-07-07 (answer once, unlocks ~40 tickets)

Reply "yes to all" to accept every recommendation, or redirect individual numbers
(e.g. "yes to all except 6: block duplicates"). Nothing below has been built yet.

## Look & feel (answer once, cascades everywhere)

**1. One primary color + overall look** — Recommend: **adopt the hub's warm-dark/gold
as the single design system and bring the document viewer to match.**
→ unlocks KAL-56, 64, 70, 71, 72, 294.

**2. Copy tone** — Recommend: **sentence case everywhere.**
→ unlocks KAL-63 (app-wide).

**3. One toast/banner style** — Recommend: **a single bottom toast + inline red error
banner, replacing all ~70 browser alert() popups and unifying the loading spinner.**
→ unlocks KAL-57, KAL-73, OBS-inline-error-banners.

**4. Empty-state style** — Recommend: **icon + one line + one primary button** for the
empty Documents / Projects / Templates tabs.
→ unlocks KAL-58, OBS-empty-comments-dashboard-states.

**5. Tooltip / modal-dim standard** — Recommend: **one custom tooltip style + one shared
dim backdrop, applied everywhere.**
→ unlocks KAL-62, 65, 67, 68, 69.

## Product behavior (quick either/or)

**6. Duplicate PDF upload** — Recommend: **recognize duplicates by file content, offer
"replace vs keep both," never silently block.**
→ unlocks KAL-277, 267, 286, 290, the held unique-index half of KAL-284, AND the held
Queue-B item B3 (content-addressed storage re-keying, KAL-281).

**7. Archiving & retention** — Recommend: **archive hides a document but keeps its
marks; no automatic hard-delete for now.**
→ unlocks KAL-280 + the held hard-delete half of KAL-281.

**8. File-access model** — Recommend: **keep the newest access function as canonical and
delete the two older rivals** (with a regression test pinning the winner).
→ unlocks KAL-264.

**9. Survey Markers on the shared annotation store?** — Recommend: **yes**, per the
existing callout-unification plan (callouts already made this move successfully).
→ unlocks KAL-81 + OBS-survey-marker-store-fork.

**10. History-click "restore context"** — Recommend: **restore page + survey/region mode
+ selected category, then spotlight the mark** (yanks the user to that context on
purpose — that's what clicking history means).
→ unlocks KAL-90.

**11. (New, found tonight) Callouts drawn in survey/region mode** — Recommend: **scope
them to the active space/region like pen strokes are** (today they're invisible-to-mode
filters because they're never stamped with the space/region).
→ unlocks the real remainder of KAL-88.

## 5-minute account tasks only you can do (no code from me)

- Azure portal change + work-account sign-in + writeback flag decision (KAL-291).
- Stripe test → live (OBS-stripe-live-mode).
- Resend DNS domain verification (OBS-resend-domain-verification).
- Confirm cloud sync stays free-for-everyone pre-launch (it's hardcoded on for all
  tiers with a dated comment saying that's intentional — I did NOT touch it).

## Corrections to the audit found tonight (FYI, no action needed)

- The "preferences → annotations tab" card claimed an auto-fit preference already
  shipped — it doesn't exist anywhere in the code. If you want it, it's a new small
  feature (say the word and I'll spec it as part of the settings work).
- The sync status chip renders in exactly one place (the sidebar collaboration
  footer) — if you want it visible elsewhere (hub, toolbar), that's a design call.

## Held for a supervised session (NOT in this batch — say when)

The save-and-restore rebuild epic (KAL-254 + 266/273/275, two-save-brains collapse),
the PDFViewer breakup (KAL-127), and the other risky refactors (KAL-89, 91, 84, 299,
82, 287 drop-execution). I'll prep a one-page go/no-go for each on request.
