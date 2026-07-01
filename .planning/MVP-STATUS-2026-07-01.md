# Survey — MVP Status & Priority Map

_Compiled 2026-07-01 by cross-referencing the live codebase, the Linear board (Survey project), all planning docs, and the newest project memory. Where sources disagreed, the newest memory/production evidence wins over older planning docs._

---

## ⚠️ OWNER DECISIONS — 2026-07-01 (override anything below that conflicts)

Isaiah reviewed this map and made the calls. These supersede the "lean launch" recommendation in §2, the deferral list in §7, and any critical-path ordering below:

1. **Ship the FULL product — no lean/stripped-down version.** The entire point is working with Microsoft 365 + Excel. Live two-way Excel sync and the M365 permissions integration MUST be built and proven before launch. No "add Microsoft later."
2. **Permissions and sharing are NOT assumed working.** The earlier scan only confirmed database rules exist — not that the features work. Before building, verify in the real app what actually works end-to-end, then build out the rest: collaborators/invites, owner/editor/viewer roles (on-screen AND server-enforced), sharing of projects/files/templates, working share links, account creation, email confirmation + resend, and password change.
3. **Build the full save-and-restore reliability work BEFORE launch** (the KAL-254 A–F epic). It is PRE-LAUNCH, not deferred — re-label those tickets back to pre-MVP.
4. **Small product choices are decided one at a time, with Isaiah, as they come up** — never batched, never decided for him.
5. **Confirm Stripe is live** (currently test mode) with one real checkout.

The rest of this document (feature status, what works, security items) still stands as the factual map — only the launch scope and priorities are governed by the decisions above.

---

---

## 1. Bottom line

The app is **much closer to launch than the ticket pile implies.** 62 of 138 Survey tickets are already Done; 72 are open — but a large share of the "open + Pre-MVP" pile is a persistence-rebuild epic that a newer decision already deferred to after launch.

Confirmed against real evidence, not just notes:
- The old "annotations vanish on reload" fear was **live-disproven** on production (four scenarios, all survived) — it is not a release blocker.
- **Every annotation type works** (Survey Markers, regions, spaces, pen/line/arrow/rectangle/ellipse, text, callouts, highlighter, eraser) with real renderers and green tests (1769 node tests passing, clean build).
- The **old PDF engine (Syncfusion) is fully removed** — the owned pdf.js engine is the sole renderer as of 2026-06-27.
- The **Excel-change security wall is LIVE on the production database** (server-side validation + transactional apply, HMAC-signed Row IDs, audit trail) — verified by direct SQL, not memory.
- **Roles are enforced server-side** (owner/editor/viewer via row-level security on every core table), and **history / restore / trash / audit** exist on production.

So the core product is real. What's left splits into: a few genuine launch gaps, a set of owner-only unblocks, and a big pile that is post-launch hardening wearing a stale "Pre-MVP" label.

---

## 2. THE decision that changes the whole timeline

Two definitions of "MVP" are alive in the docs and were never reconciled:

| Framing | What it needs before launch | Timeline |
|---|---|---|
| **Full enterprise pitch** (HANDOFF-mvp-takeover, "we integrate with your M365 permissions + audit every Excel change") | Complete Excel-security wave (steps 10–12) + **live Microsoft write-back proven** + the owner/editor/viewer permission flip across every screen | Weeks more |
| **Lean launch** (DEPLOY-CHECKLIST.md, 2026-06-17 — your own newer doc) | Annotate / save / reload / export / collaborate — all working **today**. Storage rebuild, rest of Excel wave, and live M365 write-back all ship **post-launch**; soften pitch to "imports your Excel and audits changes." | Close |

**Recommendation: ship the lean launch.** The core works, and the ~20-ticket **"Save-and-restore overhaul" epic (KAL-254, milestones A–F)** is deferrable hardening, not a blocker. Its "Pre-MVP" labels predate the June 17 reprioritization and are stale. Treating that epic as pre-MVP pushes launch out by months for a data-loss risk that was already disproven.

This fork determines whether §4-v (Excel steps 10–12) and the live M365 chain are pre- or post-launch. **Only you can make this call — everything below assumes the lean launch unless you say otherwise.**

---

## 3. What already works — do NOT reopen

- All annotation tools, in standard / survey / region modes.
- Owned pdf.js renderer; ResizeObserver-driven zoom (overlays stay glued).
- Imported-PDF ink handling (one of the best-tested subsystems).
- Excel-change validation live on production; server-enforced roles; history/restore/trash/audit.
- Home, dashboard, projects, templates, upload, share-invites, and error/empty/loading states — solid on both web and desktop.
- Database decision locked (Supabase, reconfirmed 2026-06-28); permissions model locked; renderer locked.

---

## 4. Critical path to a lean MVP (in priority order)

**i. Browser export of the annotated PDF — biggest functional gap.**
Today a clean annotated-PDF download only works in the **desktop app**; in the browser the only output is a flattened print. For a web-first enterprise product, users must be able to download their annotated PDF from the browser. The export engine (`bakeAnnotationsIntoPdf`) is **already built and unit-tested but wired to nothing** — this is wiring + finishing the print panel, not new invention. _(KAL-295 in progress; native-export tickets.)_ — **effort: medium**

**ii. Security clean-up before any real user touches it.**
Rotate the leaked developer credentials that shipped inside a bundle, and confirm uploaded documents live in a **private** bucket served by signed links (not public URLs). Mostly your action + a small code check. _(KAL-258 Urgent, KAL-288 High, KAL-259 in progress.)_ — **effort: small, but non-negotiable**

**iii. Close the save error that's mid-fix.**
A "failed to fetch / save" bug (returning a 64 MB response) is In Progress and Urgent. Confirm the one-line fix landed and close it — saving must be bulletproof. _(KAL-279.)_ — **effort: small**

**iv. Production sign-up plumbing.**
Turn on email confirmation, a real email sender, and the allowed-redirect list so new users can actually register on the live site. Pure configuration. _(DEPLOY-CHECKLIST item 3.)_ — **effort: small, owner config**

---

## 5. "Feels like one product" polish — strongly recommended, not strictly blocking

- **Bring the viewer's look up to the homepage's style.** Today the hub uses a warm gold, tight palette and the viewer chrome is unrelated dark-grey — they read as two different apps, and there is no shared design token. The select-mode checkbox is copy-pasted across three screens with already-drifting colors. This is the UI/UX consistency you have repeatedly said you care about. _(KAL-294, KAL-56, KAL-58.)_
- **Add a short first-run intro.** There is none today — just a one-line empty-state hint. Spaces, Templates, and Excel-sync are your differentiators and are non-obvious to a new enterprise user.

---

## 6. Owner-only unblocks (nobody else can clear these)

1. **Pick the MVP fork** in §2 — gates everything else.
2. **Microsoft portal change (15 min) + one work-account sign-in** — unlocks the live M365 write-back. _Only needed if you go full-enterprise now; skippable for the lean launch._ _(KAL-291.)_
3. **A ~10-minute batch of product rulings:** image/stamp annotations in or out (KAL-126); the four print/export sub-choices (KAL-295); imported-ink policy (KAL-91); the five dead-end buttons (KAL-82); free vs. paid at launch (payments are in test mode — going live needs your key flip + one real checkout).
4. **Say "go" to apply two finished database changes to production** (workbook registration table + trash/immutability trigger — validated on the test database, awaiting your prod approval); **rotate the two dev secrets**; **app-store enrollment** if you ship mobile.

---

## 7. Deferred to after launch — do not let these hold the release

- **The entire "Save-and-restore overhaul" epic (KAL-254, A–F):** op-log foundation, Yjs-as-single-source-of-truth, deduped snapshots, dual-write cleanup, patch deletion. ~20 tickets. Real hardening, but the data-loss it targets was disproven; ship without it.
- Callout post-migration cleanup (keystone already flipped default-ON + backfilled on 2026-06-29).
- Database-hygiene bundle (KAL-280–289): dead tables, query hygiene, WAL bloat, GC — opportunistic only.
- Page reorder/insert re-index wiring; text-markup highlight/underline on the new engine; the Excel add-in (explicitly V2).
- The retention **sweep is not scheduled** (no cron on production) — trash accumulates but is not lost; wire a scheduler post-launch.
- The known CRDT dual-write "quarantine" queue bug — bounded, parked until the persistence rebuild.
- The ongoing "de-fragilize the codebase" campaign — internal cleanup already running in parallel; **not a feature gap**, don't gate launch on it.

---

## 8. Housekeeping for the board

- **Re-label the KAL-254 "Save-and-restore" epic and its A–F children from _Pre-MVP_ to _post-launch_** so the board stops implying months of blockers.
- **Stale docs — trust newest memory over these:** frozen roadmap/state/milestone files (last touched April), the root pointer handoff, the legacy-engine-removal handoff, and the "callout unification in progress / flag off" memory (it's now default-ON). One planning doc claims overlays don't stay glued during zoom and links/text-select are broken — the code contradicts it; worth a 2-minute live check but treat the doc as stale.

---

### Source coverage
Codebase (rendering/annotation, backend/sync/permissions, UX/export/shell), full Linear inventory (138 issues), all MVP-relevant planning docs, and the project memory store — six parallel maps, reconciled newest-wins. The one thing not re-tested end-to-end this pass: driving a real Microsoft work-account login and a live Excel file through the panel (both code-confirmed, not hands-on-run).
