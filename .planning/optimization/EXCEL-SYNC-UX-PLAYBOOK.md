# Survey Marker ↔ Excel Sync — UX Playbook

*Audience: product owner (plain English) and engineer (precise rules). Grounded in Figma, Linear, Google Docs/Sheets, Notion, Bluebeam Studio Sessions, Microsoft 365 co-authoring, and the NNG/Material/LogRocket notification-surface literature.*
*Produced 2026-06-07 via the `collab-merge-ux-research` workflow (4 parallel app researchers + synthesis). Companion to `EXCEL-SYNC-MAP.md`.*

> ⚠️ **Amended 2026-06-08 — PLAN.md "Product Decision Amendments" GOVERN.** Two surfaces are now pinned by owner decision: clean new Excel rows appear **directly in the Survey panel** as unplaced items with the orange locate button — no separate import-inbox surface (#2); and individual row sync problems show a **red circled exclamation icon on the affected Survey-panel row** with a hover explanation (asset `/Users/isaiahcalvo/Downloads/exclamation-circle-svgrepo-com.svg`), never a global warning (#7). The "Needs your choice" duplicate-vs-new prompt (#3) rides that same per-row icon. Everything else here still applies.

> Background constraint that shapes everything below: you cannot write to an Excel file someone has open, and Microsoft Graph offers no real-time co-authoring hook for a third-party app. Excel is therefore an **asynchronous attribute database**, not a live canvas. Survey Markers are structured attribute records (status, answer, note, assignee) — like Linear issues or Bluebeam markups — *not* free-form text. That is why last-writer-wins is sufficient and CRDTs are unnecessary.

---

## 1. The one rule

**Apply silently, notify ambiently, interrupt only the one person whose unsaved work is about to be overwritten — and make every destructive change recoverable so we never have to ask "are you sure?".**

Said in four moves:

1. **Apply silently.** A teammate's add / edit / delete lands live and quietly. No broadcast popup, ever. *(Figma, Linear, Google Docs, Notion, Bluebeam all do this.)*
2. **Notify ambiently.** The user learns *what* changed through low-cost surfaces — a small toast with Undo, an avatar chip, an activity log, a "while you were away" pill — never a modal. *(Material/NNG: surface cost must match severity.)*
3. **Interrupt narrowly.** The *only* justified interruption is a remote change that would clobber **this** user's locally-edited-but-unsaved Survey Marker. It is routed to that one session — never the room. *(Microsoft's own co-authoring rule; NNG modal rule.)*
4. **Always recoverable.** Deleted Survey Markers go to a recoverable trash, and an activity history records every change. Because nothing is truly lost, we earn the right to apply changes without confirmation dialogs. *(Notion trash, Google/MS version history, NNG/LogRocket undo-over-confirm.)*

---

## 2. What the user sees in each situation

For each scenario: **on screen / blocking? / recovery / who sees it.** The "proven by" column cites the app whose shipped behavior is the precedent.

| # | Scenario | What appears on screen | Blocking? | Recovery / Undo | Who sees it | Proven by |
|---|----------|------------------------|-----------|------------------|-------------|-----------|
| **a** | **Teammate deletes a Survey Marker while I'm in the app** | The marker disappears from the page live. A small dismissible toast anchored near it: *"Survey Marker 47 removed by Alex — Undo."* Toast also logged in the activity panel with a delete icon. | **No.** Toast floats, auto-dismisses. | Marker goes to **recoverable trash** (not hard-deleted). Undo in the toast restores it for everyone; trash panel restores it later. | Everyone with the app open who can see that page. The teammate who deleted it can also undo from their own stack. | Figma (object just vanishes), Bluebeam (markup sync + delete entry in the Record), Notion (delete → 30-day trash) |
| **b** | **Teammate changes an answer/status while I'm in the app** | The field updates in place (value swaps live). Optional brief highlight pulse on the marker; entry added to activity log. No toast required for a non-destructive edit (toast is reserved for destructive/visible-loss events) — but show an avatar chip on the marker while they're actively editing it. | **No.** | Not "undoable" by me (it wasn't my action); the prior value is in **activity history** if anyone needs it. My *own* unsaved edits are never touched by this — unless it's the same field, which is scenario (d). | Everyone with the app open. | Linear (status/assignee deltas appear inline, no popup), Google Sheets (cell value swaps live; presence border + name on active cell), Notion (live block edit + avatar on block) |
| **c** | **I was away; I reopen and a lot changed in Excel** | App becomes usable immediately with all changes already folded in (last-writer-wins / field merge). A **non-blocking banner or pill**: *"Synced — 18 changes while you were away · Review."* "Review" opens the activity feed / diff, not a gate. Deleted markers sit in trash with Restore. | **No** — apply first, review on demand. Never a block-to-review wall. | Anything removed while away is in **trash**; any merged result is inspectable + reversible via activity history. | Only me (the returning user). It's my catch-up surface, not a broadcast. | Figma offline reconnect (blue "Open to sync" banner + before/after version checkpoints), AppMaster/Replicache ("apply-then-summarize"), Google Docs ("Last edit" blue-dot breadcrumb) |
| **d** | **My unsaved edit collides with an incoming change to the *same* Survey Marker** | A **scoped, non-blocking inline prompt** on that one marker: *"Alex changed Survey Marker 47 while you were editing it. [Keep mine] [Take theirs] [Compare]."* The rest of the app stays fully usable. | **Mostly no** — inline, scoped to that marker; it does not freeze the app. A true blocking modal is justified *only* if accepting would cause irreversible data loss with no trash path (rare; see §4). | Whichever side loses is preserved in **activity history / trash**, so "Keep mine" never silently destroys their value and vice-versa. | **Only me** — the one user with the conflicting unsaved edit. No one else is prompted. | Microsoft 365 (conflict UI fires only on same-cell/same-paragraph collision, routed to the affected author), NNG/Smashing (interrupt only when relevant + serious), Fernando Ruiz (scope conflict to the stakeholder) |
| **e** | **Excel introduces a new row (a new Survey Marker upstream)** | The new marker appears in the list/page live (or on next sync poll, since Excel is asynchronous). Brief, optional "1 new Survey Marker added" toast or a count bump in the activity log. No placement modal. | **No.** | If the row is malformed/unplaceable, surface it in a small "needs placement / needs attention" tray rather than blocking — user resolves on their own time. | Everyone with the app open. | Google Sheets (collaborator row insert reflows live, no modal), Linear (new issue from a teammate appears inline), Bluebeam (new markup appears for all) |
| **f** | **The workbook is open/locked, so my change can't push to Excel yet** | My change is **applied locally and to our own store immediately** (optimistic). An ambient status chip shows it's queued: *"Saved · syncing to Excel when the workbook is free"* (a small "pending"/cloud-arrow indicator, not an error). It pushes automatically when the lock releases. | **No.** Never block my editing on Excel availability. | The change is durable in our store regardless; the Excel write is a background retry. If the push ultimately fails (e.g., unsupported edit), *then* surface a single soft, actionable notice — not a dialog mid-work. | Only me (it's my pending write). | Microsoft AutoSave (saves locally, syncs in background), Linear/offline-first (optimistic local write + background sync + ambient "pending" indicator), Figma offline ("changes apply on reconnect") |

**Design note on the asynchronous reality (f, e):** because we literally cannot co-author into a third-party Excel file in real time, our app's own store (Supabase row + the durable Y.Doc, with `updated_at`) is the live canvas; Excel is a downstream/upstream attribute mirror reconciled on a polling/lock-release cycle. The UX above is written so the user never feels that latency as a block — they feel it, at most, as a quiet "syncing" chip.

---

## 3. Who gets interrupted, ever

**Default: no one.** Adds, edits, and deletes from teammates apply silently with at most an ambient toast/log entry. A passive viewer is *never* interrupted by someone else's action — a remote delete of a marker you haven't touched is a non-event for you (you get the toast in scenario a, nothing more).

**The single exception — and how to scope it:** interrupt exactly one person, *only* when a remote change would overwrite a Survey Marker that **that person has personally edited and not yet saved** (scenario d). The interrupt is routed to that one client session by field-level conflict detection — never broadcast to all connected clients. Broadcasting a conflict prompt to users who have no stake in the change is the antipattern we are explicitly avoiding (no source in the research advocated it; every source warned against it).

**The Microsoft precedent for when even MS decides an interruption is justified:** Microsoft 365 co-authoring syncs ~99% of activity silently every ~30 seconds. It fires its interrupting **"Upload Failed — Resolve Conflict"** dialog in exactly one situation: two users edited the **identical atomic unit** (the same cell, the same paragraph) and the automatic merge has **no principled tiebreaker**. It does *not* interrupt the bystanders — only the author whose pending edit can't be merged. A softer, non-blocking **"Refresh Recommended"** appears when a newer server version exists but the user has *no* unsaved work at risk. That two-tier rule is our exact model:

- Newer remote state, my work *not* at risk → **silent apply + ambient notice** (our scenarios a, b, c, e).
- Newer remote state collides with *my* unsaved edit to the *same* unit → **scoped interrupt to me only** (our scenario d).

---

## 4. The recovery net

The recovery net is what *licenses* the "apply silently, no confirms" posture. We can be aggressive about applying changes precisely because nothing is ever truly lost. Three layers:

1. **Recoverable trash for deleted Survey Markers (the headline safety net).**
   Deleted markers are **soft-deleted** to a trash state with a retention window, surfaced in a sidebar "Trash" section with a one-click Restore (filterable by who deleted, like Notion's trash). This is the structural move that replaces every "Are you sure you want to delete?" modal — Notion never asks, because the answer is always "yes, trash will catch it." *Proven by: Notion (30-day trash, restore + filter by deleter), Figma version-history checkpoints, Google Docs/Sheets version history.*

2. **Activity / version history (the audit + field-level safety net).**
   A timestamped, append-only log of every add / edit / delete with author and time — the equivalent of Bluebeam's **Session Record** (hyperlinked to the PDF location of each action) and Google's per-cell edit history. This is where superseded answer values live after a last-writer-wins merge, so "Take theirs" in scenario (d) never irrecoverably loses "mine." *Proven by: Bluebeam Studio Record (per-action, hyperlinked, delete icon), Google Sheets per-cell edit history, Microsoft/Google version snapshots.*

3. **Snackbar-Undo for the immediate window (the zero-friction reversal).**
   The toast in scenario (a) and the user's own deletes carry an Undo affordance. Follow the proven timing: a **minimum 4-second** action window (Material Design floor), Gmail's **5s action / 10s total** as the baseline, and extend toward **10–30s** for markers the user actually viewed/touched this session. After the toast expires the marker is still in trash — Undo is the fast path, trash is the durable path. *Proven by: Gmail (5s/10s undo-send), Material Design snackbar guidelines, NNG / LogRocket / Smashing (undo-over-confirm; confirmation dialogs habituate users into mindless "yes" and lose their protective value).*

**The principle tying it together (NNG/Smashing three-factor test):** a blocking confirmation modal is justified only when an action is **irreversible AND serious AND infrequent** — all three. Soft-delete removes "irreversible," so confirms are unwarranted for routine marker deletion. Reserve a real modal for the one narrow case left: a **permanent purge** ("delete forever" / end of trash retention), shown only to the user performing it, with enough friction (an explicit acknowledgment, not a bare "OK") to defeat habituation.

---

## 5. What we copy from whom

| Pattern we ship | Source app it's proven in |
|---|---|
| Remote add/edit/delete applies live with **no broadcast popup** | Figma (canvas just updates), Linear (inline delta), Google Docs/Sheets (OT silent merge), Notion ("not locked while edited"), Bluebeam ("instantly visible to everyone") |
| **Ambient presence** — avatar/name chip on the marker a teammate is editing | Google Sheets (colored cell border + name), Figma (labeled cursors + avatar rail), Notion (avatar next to the block) |
| **Toast + Undo** for a destructive change the user can see | Gmail (undo-send 5s/10s), Material Design snackbar, Linear (undo most mutations), NNG/LogRocket (undo-over-confirm) |
| **Per-user undo stack** (you can only undo *your own* actions; a teammate's delete is recovered via trash, not Ctrl+Z) | Figma, Google Docs, Linear, Liveblocks reference model |
| **Interrupt only the affected author**, routed to one session, on same-item unsaved collision | Microsoft 365 ("Resolve Conflict" only on same-cell/same-paragraph), NNG/Smashing/Fernando Ruiz |
| **Two-tier reconnect**: soft "refresh recommended" vs. hard "resolve conflict" | Microsoft 365 (Refresh Recommended vs Upload Failed) |
| **"While you were away" = apply-then-summarize banner**, not block-to-review; with before/after recovery points | Figma offline reconnect (blue banner + version checkpoints), AppMaster/Replicache offline-first |
| **Recoverable trash with retention + restore + filter-by-deleter** | Notion (30-day trash) |
| **Per-action activity/audit log**, hyperlinked to PDF location | Bluebeam Studio Record |
| **Optimistic local write + background sync + "pending" chip** when Excel is locked | Microsoft AutoSave, Linear sync engine, Figma/offline-first |
| **Last-writer-wins on structured attributes** (no CRDT) | Linear (LWW chosen deliberately for issues), Figma (property-level LWW), Google Sheets (cell-level LWW) |
| **Authorship ownership** as conflict *prevention* (consider: only the placer of a marker can delete/edit it) | Bluebeam Studio (markups editable only by creator) — see Open Sub-Decision 4 |

---

## 6. Open sub-decisions (need a product-owner call)

Each is phrased as a concrete fork with its consequence.

1. **Trash retention window — how long do deleted Survey Markers stay recoverable?**
   - *Notion default is 30 days.* Shorter (e.g. 7 days) keeps the trash list small but risks "the marker I needed got purged" complaints on slow projects. Longer/unlimited is safest for recovery but grows storage and clutters the trash UI.
   - **Consequence:** this single number defines how aggressively we can apply silent deletes. **Recommendation: 30 days, configurable per project**, matching the Notion precedent users already know.

2. **"While you were away" — quiet pill, or a one-time review panel?**
   - *Quiet pill* (Figma/Google style): minimal friction, but a returning user might never notice 40 changes landed.
   - *One-time review panel* on reopen (still non-blocking, dismissible): better awareness after a long absence, but heavier and can feel like a wall if shown too often.
   - **Consequence: Recommendation — quiet pill by default, auto-upgrade to a one-time (dismissible) review panel only above a threshold** (e.g. >N changes, or absence > X days). Below threshold: just the pill.

3. **Toast on *non-destructive* remote edits (scenario b) — show one, or stay fully silent?**
   - Silent-with-log (Linear/Sheets style) is cleaner; a toast for every status flip from a busy teammate becomes noise.
   - **Consequence: Recommendation — no toast for plain answer/status edits; reserve toasts for deletes and visible-loss events**, with all edits captured in the activity log. Revisit if users report "things changed and I didn't notice."

4. **Authorship ownership — adopt Bluebeam's "only the creator can delete/edit a marker," or allow anyone to edit any marker?**
   - Bluebeam's hard ownership rule eliminates most edit conflicts by construction. But our Excel reality breaks the model: a teammate editing the *spreadsheet* can change/remove a row they didn't originally add, and Excel has no concept of our app's "owner." Strict ownership would fight the two-way Excel sync.
   - **Consequence: Recommendation — do NOT enforce hard ownership; keep last-writer-wins + the recovery net.** Use ownership only as soft *presence/attribution* (show who placed it, who last touched it), not as a write-lock. Flag for explicit PO confirmation since it diverges from the otherwise-ideal Bluebeam template.

5. **Conflict resolution default in scenario (d) — auto-pick, or always ask?**
   - Microsoft/Figma/Linear default to **last-writer-wins and move on**, surfacing the loser in history. Always-ask (the inline Keep/Take/Compare prompt) is safer for high-stakes survey answers but adds friction on every same-field race.
   - **Consequence: Recommendation — last-writer-wins by default with the superseded value preserved in activity history, AND show the scoped inline prompt only to the author with the *unsaved* conflicting edit.** If a saved-vs-saved race happens, resolve silently to LWW (both values in history) with no prompt. Confirm whether survey answers are high-stakes enough to warrant always-prompt instead.

6. **Sync cadence to/from Excel when the workbook is free — poll interval and conflict granularity.**
   - Because there's no real-time Graph hook, "live" is really "fast polling." Too slow (minutes) makes scenarios a/b/e feel laggy; too fast hammers Graph and risks lock contention.
   - **Consequence:** affects how "live" the whole experience feels. **Recommendation — define a target poll/diff interval (e.g. 15–30s when a workbook is reachable) and reconcile at the row+field level (not whole-sheet)** so a teammate editing one cell never overwrites another's unrelated edit. Needs an engineering spike against real Graph rate limits before locking the number.

---

*Terminology note for the build: always write "Survey Marker" in full in all UI copy, toasts, trash labels, and activity-log entries — never "marker" alone.*
