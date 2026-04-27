# Feature Research

**Domain:** Multi-user collaboration on a desktop PDF annotation app (engineering survey work)
**Researched:** 2026-04-26
**Confidence:** MEDIUM-HIGH (Figma / Notion / Linear / Bluebeam / Drawboard / Google Docs / Excel claims grounded in vendor docs and engineering blogs; live-cursor UX claim is community-feedback-grade only)

---

## Scope Note: Read This First

The downstream consumer is a small construction-survey shop. The realistic multi-user shape is:

1. **Same user, multiple devices (95% of sessions):** Isaiah-on-Mac plus Isaiah-on-Windows plus future Isaiah-on-phone, often **not** simultaneous. Continuity matters more than concurrency.
2. **Owner + occasional contractor (5% of sessions):** Isaiah plus a sub or a PM dropping in to mark up one drawing for a few minutes. Concurrent for short windows.

It is **not** Figma's "12 designers in a file all afternoon" nor Bluebeam's "30-person punch-list session." Anything sized for that scale is over-engineering for v2.4. This document is ruthless about that distinction.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Per-annotation authorship stored on the record** | Already implied by current presence indicators; users assume "if you can see who's online, you can see who drew this." Bluebeam, Drawboard, Google Docs, Figma all do this. ([Drawboard](https://www.drawboard.com/), [Bluebeam Studio Sessions activity log](https://support.bluebeam.com/online-help/prime/Content/Studio%20Prime/Studio%20Prime%20Guide/03%20-%20Portal/How-to-See-a-Users-Activity.htm)) | LOW (data model only — `created_by`, `updated_by`, `created_at`, `updated_at` columns) | Foundational. Every other v2.4 feature reads from this. Backfill existing annotations to the document owner. |
| **Per-annotation authorship surfaced on hover** | Drawboard's "hover over any annotation to see exactly who made it and when" is the de facto standard for engineering markup tools ([Drawboard product page](https://www.drawboard.com/)). Figma puts authorship in the right-rail, Google Docs hovers reveal author from version history. | LOW-MED (tooltip on SVG hover; data already on record from row above) | Low friction — does not clutter the canvas. Better than persistent color halos for engineering where the markup itself carries meaning. |
| **Activity log of every change with user + timestamp** | Bluebeam Studio Sessions ships this and survey users explicitly want "who deleted this stroke 5 minutes ago" — this is the milestone's own stated requirement. Studio's session record covers join, document add, markup add/edit/status, chats ([Bluebeam](https://support.bluebeam.com/online-help/prime/Content/Studio%20Prime/Studio%20Prime%20Guide/03%20-%20Portal/How-to-See-a-Users-Activity.htm)). | MED (append-only event table, sidebar/panel UI; export to CSV is a small bonus) | Construction shops use this for accountability ("the GC marked this RFI'd, here's the trail"). Ship it. |
| **Live presence list of who's currently in the document** | Already shipped pre-v2.4. Listed for completeness — keep working. | — (existing) | Don't regress this when CRDT rebuild lands. |
| **Per-user undo (your undo never erases someone else's work)** | Figma, Google Docs, Notion, Linear all maintain a per-client undo stack — the "global undo" model is universally rejected as anti-pattern. Figma: "each user has their own undo / redo stack" ([Figma multiplayer blog](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), [Multiplayer Editing in Figma](https://www.figma.com/blog/multiplayer-editing-in-figma/)). | MED (already half-built — undo exists, just needs scoping to the local client's actions only) | The tricky case: undoing a delete must restore the deleted object. Figma's solution: "Data is stored in the undo buffer of the client that performed the delete. If that client wants to undo the delete, then it's also responsible for restoring all properties of the deleted objects" ([Figma blog](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)). Mirror this. |
| **Silent merge on reconnect (no conflict modals)** | Google Docs, Notion (mostly), Figma, Linear all merge silently. Excel co-authoring "the last change saved wins" is the only major exception and is widely disliked ([Microsoft Support](https://support.microsoft.com/en-us/office/collaborate-on-excel-workbooks-at-the-same-time-with-co-authoring-7152aa8b-b791-414c-a3bb-3024e46fb104)). For independent annotation objects (not a single rich-text stream), silent merge is trivial and correct. | MED (idempotent ops + last-write-wins per annotation property is enough — full CRDT not required) | An annotation is an independent object. Two users adding strokes simultaneously is not a "conflict," it's just two strokes. The CRDT-grade hard case (two users editing the same Bezier curve at the same moment) is rare enough to accept LWW per property. |
| **Offline editing with auto-sync on reconnect** | Drawboard Projects ships full offline markup ([Drawboard offline blog](https://www.drawboard.com/blog/markup-drawings-and-documents-while-offline-using-drawboard-projects)), Notion ships full offline ([Notion engineering](https://www.notion.com/blog/how-we-made-notion-available-offline)), Linear ships local-first as the architecture itself ([Linear sync engine](https://linear.app/now/scaling-the-linear-sync-engine)). Survey work happens in basements, mechanical rooms, job sites with no signal. This is non-negotiable. | HIGH (queue local mutations, retry with idempotency keys, replay through merge engine on reconnect) | Existing localStorage persistence is the foundation. The new work is the mutation queue + reconciliation pipeline. |
| **Permissions: viewer / commenter / editor / owner** | Figma's three-tier model (Viewer / Commenter / Editor) plus "owner" as a fourth invisible level is the universal pattern ([Figma roles docs](https://help.figma.com/hc/en-us/articles/360039960434-Roles-in-Figma)). Every collab tool with shared docs has it. Construction users expect "the GC can comment, the field tech can mark up, the foreman owns the doc." | MED (RLS policies + UI state + a permission column on the share row) | Don't go more granular than four roles. Figma users explicitly request more granular permissions; Figma has held the line at 3 levels for years and it's working. ([Figma forum granular permissions thread](https://forum.figma.com/archive-21/a-granular-apporach-to-user-roles-24788)) |

### Differentiators (Where v2.4 Can Win)

These are not table stakes but they directly serve the use case ("me on multiple devices") in ways the major incumbents do poorly.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Device attribution on every edit (Mac / Windows / phone)** | No major collab tool surfaces *device* in addition to user — Excel only shows device names when conflicts spawn duplicate files (`Report-LaptopName.docx`) ([Excel sync conflicts](https://www.digitalcitizen.life/cloud-sync-conflicts-explained-why-files-duplicate-or-overwrite-themselves/)). For a **single-user-multi-device** workflow this is genuinely useful: "I marked this in the field on iPad, finished on Mac, exported on Windows" — being able to retrace which device captured which observation is forensic-grade for survey work. | LOW (one extra column `device_label` derived from `os.hostname()` at app start; UI: append "(on Mac mini)" or "(on Surface)" to author tooltip + activity log row) | Treat device label as a free-text field the user can rename in Settings ("Mac mini in office", "Job-site iPad"). Otherwise default to OS hostname. |
| **Authorship hover with timestamp and device, no persistent color halo** | Color-coded selection halos work in Figma because the canvas is otherwise empty. Construction PDFs are already saturated with red/blue/green markup that *carries semantic meaning* (red = revision, blue = field measurement, green = approved). Adding per-user color halos directly conflicts with markup color semantics. Hover-only authorship surfacing is the right call here. | LOW (re-uses table-stakes hover) | Differentiator vs Figma/Bluebeam: do **not** ship color halos. Document this as a deliberate non-goal. |
| **Activity log filterable by user, by page, by date, by annotation type** | Bluebeam exports session activity reports but the UI filtering is weak. A small construction shop can ship a tighter, faster filterable log because the data volumes are tiny (one project = thousands of events, not millions). | MED (Postgres + simple filter UI) | "Show me everything Mike marked on page 6 yesterday" is the killer query for site visits. |
| **"Where am I picking up?" view across devices** | Same-user-multi-device unique need. Show "last edit on this doc was 12 minutes ago on your Surface, page 14, sticky note about HVAC duct" when you open the doc on Mac. No incumbent does this — they all assume different users on different devices. | LOW-MED (read latest event from activity log scoped to current user, render as a banner at doc open) | Possibly the single most valuable v2.4 feature for the actual primary use case. Almost free if activity log is already built. |
| **Optimistic UI everywhere — strokes commit locally first, sync in background** | Linear and Figma both treat optimistic-local-first as religion. The user never waits for the network. Already half-true in current build. | MED (extend existing local persistence to cover all annotation types under the new sync engine) | The single biggest perceived-quality lever. Network errors should never block the pencil. |
| **Toast for sync state ("Saved to cloud", "Working offline", "Resyncing 3 changes")** | Subtle but enormously calming for users who care about data integrity (survey deliverables go into legal RFI threads). Notion does this well; Drawboard does this well. | LOW | Use the existing toast/snackbar system. Don't gate the user — never block input behind sync state. |

### Anti-Features (Skip These — They Look Good but Cost a Lot)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Live cursors** ("see Sarah's cursor moving in real time") | Looks impressive in demos. Figma made it iconic. | (1) Figma's own community pushes back: "silent cursors floating around as distracting at best and anxiety-inducing at worst" ([Figma forum thread](https://forum.figma.com/suggest-a-feature-11/disable-observe-mode-18772/index2.html)). (2) For the actual use case (mostly same user across devices, occasional second person), there is no one to watch. (3) Network cost: cursor packets are the dominant traffic in real-time collab apps and require a dedicated low-latency channel beyond annotation sync. (4) Implementation complexity ladders into needing a presence server, throttling logic, smoothing/interpolation, multi-page cursor projection. | Stick with the existing presence-list-only approach. Maybe ship a cursor *click-to-locate* feature ("tell me what page Sarah is on") instead of continuous cursor tracking. **80% of the value at 5% of the cost.** |
| **Conflict resolution modals** ("These two versions conflict — pick one") | Feels safe to engineering minds — "the user is in control." | Catastrophically poor UX. Every modern collab tool that has tried this (Dropbox, old SharePoint, old Excel shared workbooks) has actively migrated away. Notion still does this for offline conflicts on database properties and it's their most-complained-about behavior ([Notion CRDT discussion](https://dev.to/smallstack/crdts-and-local-first-architecture-how-smallstack-handles-offline-conflict-resolution-338c)). Users dismiss the modal randomly and lose data either way. | Silent merge with last-write-wins per property + a "recent activity" panel. If users want to recover a lost edit, they go to activity log, not a modal. |
| **Per-annotation locks ("I'm editing this, you can't touch it")** | Surface-level reasonable. Zotero PDF Reader does this ([Zotero forum](https://forums.zotero.org/discussion/96174/zotero-pdf-reader-why-are-annotations-by-other-users-locked)) — annotations from other users are locked from edit. PDF Annotator has explicit lock UX. Altium Designer does soft-locks at the document level ([Altium docs](https://www.altium.com/documentation/altium-designer/collaborators-visualization-conflict-prevention)). | Wrong default for the use case. Survey users explicitly want to *correct* each other's mistakes ("the GC marked the wrong duct, let me fix it"). Locking by author creates a "frozen by predecessor" problem when the original author isn't reachable. **CRDT-style merging makes locks unnecessary** for the small-team case — there's no contention to lock against. | Don't ship locks. If a specific contractor scenario emerges later, ship them as an opt-in toggle on the document, not the default. |
| **Last-writer-wins on the *whole annotation*** (Excel-style) | Simplest possible merge model. | Excel co-authoring's "last change wins" is universally disliked when applied at the file level ([Excel co-authoring](https://www.breadcrumbdigital.com.au/co-authoring-troubleshooting-tips/)). Applied at the annotation-property level (color, position, stroke width independently) it's fine. Applied at the annotation level (whole stroke replaced) it loses work. | LWW *per property*, not per annotation. If two users change color on the same stroke, last-write-wins on color only. The stroke geometry is preserved. |
| **Real-time character-by-character sync inside text annotations** | The Google-Docs-y dream. Looks magical in demos. | Genuinely hard. Notion's blog ([Peritext / Notion](https://www.notion.com/blog/how-we-made-notion-available-offline)) outlines the problem: rich-text CRDTs with real-time character merge is *the* boss-level problem in collab. The current app's text annotations are short labels ("HVAC", "12'-3\""), not paragraphs. Two people typing in the same label simultaneously is essentially zero-frequency in survey work. | LWW on the whole text content of the annotation. If two people simultaneously edit the same text label (~zero-frequency event), one wins, the other shows up in activity log as a re-edit. Acceptable. |
| **Branching / forking / suggestion mode** ("propose a change, I approve") | Nice for review workflows. Word/Google Docs ship it as Track Changes / Suggestions. | Construction markup is ground-truth observation, not a suggestion-and-approval flow. Adding a suggestion layer on top of annotation drawing doubles the data model and quadruples the UI complexity for a workflow nobody is asking for. | Activity log + per-user undo covers 95% of "I want to back out a change someone made" without needing a formal approval pipeline. |
| **Comment threads on annotations** ("reply to this stroke") | Figma comments, Drawboard comments. | Different from annotations. Annotations *are* the comments in this app — that's what survey markup *is*. Adding a second-tier commenting layer is feature drift toward Drawboard Projects, which is a different product category (project management on top of PDFs). | Defer indefinitely. If the need surfaces, ship sticky-note replies, not a separate threading layer. |
| **5-second polling sync** ("check the cloud every 5 seconds") | Easy to build, looks like real-time. | Burns battery, burns mobile data, falls behind under load, doesn't actually feel real-time at 5s intervals. Every modern collab tool uses WebSockets / SSE / push for a reason. | Supabase Realtime channels (already in the stack) — sub-second push, far less network cost. |

---

## Capability-Area Synthesis (the 10 questions, answered directly)

### 1. Authorship surfacing — when and where?

**Answer:** Hover-only on the annotation, plus author column in activity log. **No persistent color halo.** Reasoning: construction markup colors carry semantic meaning (red = revision, blue = field, green = approved). Layering per-user halos on top corrupts the markup language. Hover-reveal is what Drawboard ships and what survey users have already been trained to expect.

**Pattern reference:** Drawboard ([drawboard.com](https://www.drawboard.com/)) — "hover over any annotation to see exactly who made it and when."

### 2. Live cursors — useful or not?

**Answer:** **No.** For this use case (mostly same-user-multi-device), there is no second person to track 95% of sessions. For the 5% with a contractor, presence-list + last-edit page indicator covers the need. Live cursors carry real complexity (smoothing, throttling, multi-page projection, low-latency channel) and a real UX cost ([Figma users complain](https://forum.figma.com/suggest-a-feature-11/disable-observe-mode-18772/index2.html)). **80/5 rule applies — biggest perceived feature savings in v2.4.**

### 3. Per-user undo — universal? How granular?

**Answer:** **Universal among modern collab tools.** Figma, Notion, Linear, Google Docs all maintain per-client undo stacks. Granularity is per-action (one stroke = one undo step), with undo of a delete restoring the full deleted object from the local client's buffer (Figma's approach). Don't try anything more granular than per-action. Don't ship a "global undo" — universally rejected.

**Pattern reference:** [Figma multiplayer undo](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) — "Data is stored in the undo buffer of the client that performed the delete. If that client wants to undo the delete, then it's also responsible for restoring all properties of the deleted objects."

### 4. Offline → online reconciliation UX

**Answer:** **Silent merge.** No modals. The mutation queue replays through last-write-wins per annotation property, and the activity log captures everything. If a user feels something was lost, they go to activity log to inspect or restore. **The conflict modal is a 1990s artifact.** Notion still has them for database property conflicts and it's their most-disliked offline behavior.

**Toast surface:** "Resyncing 3 changes…" → "All changes saved." That's the whole UX.

### 5. Activity log / change history — depth and surfacing?

**Answer:**
- **Depth:** Forever (event-sourced append-only table; data volumes are tiny — a project has tens of thousands of events, not millions).
- **Surfacing:** Sidebar panel on the document, filterable by user / page / date / annotation type. Plus a per-annotation "history" item in the right-click menu showing just that annotation's changes. Plus an export-to-CSV for the construction-shop legal-trail use case.
- **Don't ship:** Periodic snapshots (Google Docs version-history-style) — over-engineering for object-level annotations. Don't ship a separate page; the sidebar is enough.

**Pattern reference:** [Bluebeam Studio Sessions activity report](https://support.bluebeam.com/online-help/prime/Content/Studio%20Prime/Studio%20Prime%20Guide/03%20-%20Portal/How-to-See-a-Users-Activity.htm) — same shape, leaner UI.

### 6. Locking / soft-locking

**Answer:** **No locks.** The CRDT-grade merge model + per-user undo + activity log covers the small-team contention case without locks. Locks introduce frozen-by-predecessor problems and conflict with the survey-correction workflow. Zotero and PDF Annotator ship locks; that's because they're long-form document annotation tools where one author "owns" each comment. Construction markup is collaborative correction by design.

### 7. Device attribution beyond user

**Answer:** **Yes, ship it. This is a real differentiator.** No major collab tool surfaces device alongside user (Excel only does it as a side-effect of OneDrive conflict-copy filenames). For a workflow centered on "me across multiple devices," device attribution is exactly the missing piece. Implementation is one extra column + tooltip suffix.

**Implementation:** `device_label` as user-renameable (default to OS hostname). Surface as "Isaiah on Mac mini" in author hover and activity log.

### 8. Co-author count limits

**Answer:** **Soft cap at 10 concurrent on a doc, hard cap at 50 across the project.** Reasoning:
- Bluebeam Studio Sessions caps at 500 attendees ([Bluebeam](https://support.bluebeam.com/studio/resources/studio-faqs.html)) — far overkill for a small construction shop.
- The realistic case is 2-3 concurrent users at most.
- The infrastructure cost (Supabase Realtime channel cost, broadcast fan-out) starts mattering above ~20 concurrent users. Setting a soft cap forces the architecture to scale linearly within the budget the existing subscription tier supports.
- Practical ceiling for the design is whatever the WebSocket fan-out can handle without batching — likely 50-100 concurrent before things need redesign.

**Don't ship:** Live cursors at 50 users. The cursor packet rate becomes the dominant cost.

### 9. Permissions / roles

**Answer:** **Four roles: Owner / Editor / Commenter / Viewer.** Mirror Figma exactly ([Figma roles](https://help.figma.com/hc/en-us/articles/360039960434-Roles-in-Figma)). Figma has held this line for years against repeated requests for finer-grained permissions and the model is working. Construction users expect this exact split:
- **Owner:** the document owner. Manages permissions, can delete the doc.
- **Editor:** can draw / edit / delete any annotation.
- **Commenter:** can add sticky notes only. Cannot draw on the canvas.
- **Viewer:** read-only.

**Don't go more granular** ("can edit highlights but not strokes") — that's the request Figma users have raised and Figma has correctly refused. The complexity overhead isn't worth it for the use case.

### 10. Conflict scenarios that surprise users (the "even with CRDTs you still lose data" list)

These are the real ways collab tools lose data even with sophisticated merge engines. v2.4 must be honest about each:

1. **Concurrent delete + edit race.** User A deletes annotation X while user B is editing X's color offline. Most CRDTs resolve this as "delete wins" — user B's edit silently disappears. **Mitigation:** activity log surfaces it; per-user undo recovers it. **Don't try to "fix" it** — it's the correct CRDT semantics.
2. **Move + concurrent move.** User A drags the stroke 10px right, user B drags it 10px down. CRDTs implement move as delete+insert and you get one of the two destinations or, in pathological cases, two duplicates ([CRDT pitfalls](https://dev.to/puritanic/building-collaborative-interfaces-operational-transforms-vs-crdts-2obo)). **Mitigation:** treat position as a single mergeable property with LWW timestamp tiebreak. Accept the rare jumpy-position artifact.
3. **Property merges that don't merge.** Notion is honest about this: "database properties — select fields, dates, relations, rollups — don't merge. When two people edit the same property offline, only one version survives and the other is silently overwritten" ([Notion offline guide](https://www.taskfoundry.com/2025/08/notion-offline-mode-setup-sync-conflict-guide.html)). **Mitigation:** activity log + LWW per property. Don't pretend it merged when it didn't.
4. **Long offline window with parallel edits on the same annotation.** If both users have been offline for an hour and edited the same stroke independently, on reconnect only one survives. **Mitigation:** Activity log captures the loser's version verbatim so it can be re-applied manually if needed. Toast says "1 change replaced by newer edit" so the user knows.
5. **Tombstone garbage growth (long-term).** Every deleted annotation must persist as a tombstone forever, otherwise late-syncing devices will resurrect it ([CRDT dictionary](https://www.iankduncan.com/engineering/2025-11-27-crdt-dictionary/)). **Mitigation:** for an annotation-object model (vs character-level CRDT), tombstones are cheap — one row each. For 100 deletes per project, that's 100 rows. Acceptable. Run a quarterly garbage collect on tombstones older than 90 days.

---

## Feature Dependencies

```
[Per-annotation authorship columns (data model)]
    ├──required-by──> [Authorship hover UI]
    ├──required-by──> [Per-user undo scoping]
    ├──required-by──> [Activity log]
    └──required-by──> [Permissions enforcement]

[Activity log]
    ├──required-by──> [Filterable activity sidebar]
    ├──required-by──> [Per-annotation history menu item]
    └──required-by──> ["Where am I picking up?" cross-device resume banner]

[Mutation queue + idempotency keys]
    ├──required-by──> [Offline editing]
    ├──required-by──> [Silent merge on reconnect]
    └──required-by──> [Optimistic UI for cloud-sync writes]

[Device label column]
    ├──required-by──> [Device-aware hover + activity log rows]
    └──required-by──> [Cross-device resume banner]

[Permissions column]
    ├──required-by──> [RLS policies]
    └──required-by──> [Role-based UI gating (Commenter sees no pen)]

[Per-user undo]  ──displaces──>  [Per-annotation locks (anti-feature)]
[Activity log + LWW per property]  ──displaces──>  [Conflict modals (anti-feature)]
[Authorship hover]  ──displaces──>  [Per-user color halos (anti-feature)]
```

### Dependency Notes

- **Data model first.** Author / device / timestamp columns must land before any UI feature reads from them. Backfill existing annotations to the document owner's user ID at migration time.
- **Mutation queue is the gatekeeper for everything offline.** Offline edit, silent merge, optimistic UI all read from the same queue. Build it once, build it right.
- **Activity log is read-cheap.** Once it exists, it powers cross-device resume, per-annotation history, filterable views, and CSV export at near-zero incremental cost.
- **Per-user undo is independent of CRDT choice.** Figma is not a true CRDT and still ships per-user undo. Don't gate undo on the merge engine — it's a client-side stack.

---

## MVP Definition (v2.4 Scope)

### Launch With (v2.4.0)

The minimum that makes "Isaiah on multiple devices + occasional contractor" feel like a real collab product.

- [x] **Per-annotation authorship + timestamp columns** (data model) — foundational, blocks everything
- [x] **Authorship hover tooltip** — table stakes
- [x] **Mutation queue with idempotency keys** — gatekeeper for offline / silent-merge / optimistic
- [x] **Silent merge on reconnect (LWW per property)** — replaces conflict-modal anti-pattern
- [x] **Offline editing with auto-resync** — survey work demand
- [x] **Per-user undo (your undo never erases collaborator work)** — universal table stake
- [x] **Activity log (append-only) + sidebar UI with filters** — the "who deleted this" requirement, also enables resume banner
- [x] **Permissions: Owner / Editor / Commenter / Viewer** — gates real-world contractor sharing
- [x] **Device label column + hover/activity-log surfacing** — the actual differentiator vs Figma/Bluebeam for this use case
- [x] **"Where am I picking up?" cross-device resume banner** — almost free given activity log; biggest UX win for the same-user-multi-device case
- [x] **Sync-state toast** ("Resyncing 3 changes…", "All changes saved", "Working offline")

### Add After Validation (v2.4.x)

Real but lower-impact polish.

- [ ] **CSV export of activity log** — construction-shop legal trail. Add when first user asks.
- [ ] **Per-annotation right-click "show history"** — already in the data; add the menu item if hover-tooltip + sidebar isn't enough.
- [ ] **Renameable device labels in Settings** ("Mac mini in office" vs OS hostname default) — quality-of-life only.
- [ ] **Sync state in title bar** ("Document name — saving…" / "— offline") — only if toast feels too transient.

### Future Consideration (v2.5+)

- [ ] **Live cursors** — if and only if a heavy 3+ user concurrent use case emerges from real users (not from internal "would be cool" thinking). Default: never.
- [ ] **Comment threads on annotations** — only if survey markup language proves insufficient. Default: never (would compete with the annotation system itself).
- [ ] **Per-annotation locks** — only if a specific contractor scenario demands it; ship as opt-in document setting.
- [ ] **Branching / suggestion mode** — out of scope for survey workflow; defer indefinitely.
- [ ] **Real-time character-level merge inside text annotations** — out of scope; LWW-per-text-content is enough.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Authorship columns + hover | HIGH | LOW | **P1** |
| Mutation queue + idempotency | HIGH | MED | **P1** |
| Silent merge / LWW per property | HIGH | MED | **P1** |
| Offline editing + auto-sync | HIGH | HIGH | **P1** |
| Per-user undo (scoped) | HIGH | MED | **P1** |
| Activity log + sidebar | HIGH | MED | **P1** |
| Permissions (4 roles + RLS) | HIGH | MED | **P1** |
| Device attribution | MED | LOW | **P1** (cheap differentiator) |
| Cross-device resume banner | HIGH | LOW | **P1** (huge value, cheap) |
| Sync-state toast | MED | LOW | **P1** |
| CSV export of activity log | LOW | LOW | P2 |
| Per-annotation history right-click | LOW | LOW | P2 |
| Renameable device labels | LOW | LOW | P2 |
| Live cursors | LOW (this use case) | HIGH | **P3 / never** |
| Comment threads | LOW (overlaps with annotations) | HIGH | **P3 / never** |
| Per-annotation locks | LOW (anti-pattern for use case) | MED | **P3 / never** |
| Conflict modals | NEGATIVE | MED | **never** |
| Per-user color halos | NEGATIVE (clashes with markup colors) | LOW | **never** |
| Suggestion / branching mode | LOW | HIGH | **never** |

**Priority key:**
- **P1:** v2.4.0 launch
- **P2:** v2.4.x post-launch polish
- **P3:** v2.5+ if user demand surfaces
- **never:** ship in v2.4 docs explicitly as non-goals (saves future scope-creep arguments)

---

## Competitor Feature Analysis

| Feature | Figma | Bluebeam Studio Sessions | Drawboard Projects | Notion | Linear | Google Docs | Excel co-auth | Our Approach |
|---------|-------|--------------------------|--------------------|--------|--------|-------------|---------------|--------------|
| Authorship surfacing | Right-rail + selection halo color | Activity panel + markup author col | Hover tooltip on annotation | Per-block author indicator | Per-issue author + history tab | Hover in version history + colored highlights in version preview | None at cell level | **Hover tooltip only — no halo (markup color is semantic)** |
| Live cursors | Yes (signature feature) | No | No | Yes (multiplayer block highlight) | No (sync engine, not real-time editor) | Yes (in-text cursor) | No | **No — presence list only** |
| Per-user undo | Yes — per-client stack | Per-user, with redo modifying history | Yes | Yes | Yes (sync engine isolation) | Yes (per session) | Per-user, last-save-wins limits it | **Yes — Figma-pattern client-stored** |
| Offline editing | Limited (single-page) | No (Sessions need cloud) | Yes (Projects) | Yes (recent rebuild) | Yes (foundational) | Limited | Limited | **Yes — first-class** |
| Conflict UX | Silent (CRDT-inspired) | Server-mediated, last-save-wins | Silent merge | Silent for text, modal for db props | Silent (centralized server arbitrates) | Silent | Last-save-wins, sometimes spawns conflict file | **Silent + LWW per property** |
| Activity log | Comments + version history | Full session report, exportable | Hover-level | Page history per block | Full issue history | Version history + Activity Dashboard | Limited | **Full activity log + filterable sidebar + CSV export** |
| Per-annotation locks | No | No (per-document permissions only) | No | No | No | No | File-level only | **No — explicitly anti-feature** |
| Device attribution | No | No | No | No | No | No | Only via OneDrive conflict-copy filename | **Yes — first-class differentiator** |
| Co-author cap | High (org-tier) | 500 attendees | Unlimited (Projects) | High | High | 100 simultaneous editors | ~10 stable | **10 concurrent / 50 project (small-shop right-sized)** |
| Roles | Owner / Editor / Commenter / Viewer | Owner / Editor / Reviewer / Member | Owner / Editor / Reviewer | Workspace + page roles | Workspace + role | Owner / Editor / Commenter / Viewer | View / Edit | **Owner / Editor / Commenter / Viewer (Figma-clone)** |

---

## Sources

### Engineering blogs (HIGH confidence — primary sources)
- [How Figma's Multiplayer Technology Works — Figma Blog](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) — authoritative on Figma's not-quite-CRDT centralized server model, per-user undo, deleted-object responsibility
- [Multiplayer Editing in Figma — Figma Blog](https://www.figma.com/blog/multiplayer-editing-in-figma/) — original announcement; covers cursor and selection broadcasting
- [How we made Notion available offline — Notion Blog](https://www.notion.com/blog/how-we-made-notion-available-offline) — primary source on Notion's offline CRDT migration, rich-text conflict resolution
- [Scaling the Linear Sync Engine — Linear](https://linear.app/now/scaling-the-linear-sync-engine) — local-first architecture overview
- [Figma roles documentation](https://help.figma.com/hc/en-us/articles/360039960434-Roles-in-Figma) — canonical 3-role model

### Vendor support docs (HIGH confidence)
- [Bluebeam Studio Sessions activity reports](https://support.bluebeam.com/online-help/prime/Content/Studio%20Prime/Studio%20Prime%20Guide/03%20-%20Portal/How-to-See-a-Users-Activity.htm) — confirms what gets tracked and exported
- [Bluebeam Studio FAQ — 500 attendee cap](https://support.bluebeam.com/studio/resources/studio-faqs.html)
- [Drawboard Projects markup offline](https://www.drawboard.com/blog/markup-drawings-and-documents-while-offline-using-drawboard-projects) — confirms offline markup pattern
- [Drawboard product page — hover authorship](https://www.drawboard.com/) — hover-to-see-author UX pattern
- [Excel co-authoring conflict resolution](https://support.microsoft.com/en-us/office/collaborate-on-excel-workbooks-at-the-same-time-with-co-authoring-7152aa8b-b791-414c-a3bb-3024e46fb104) — last-save-wins model
- [Google Docs version history + activity dashboard](https://support.google.com/docs/answer/7378739) — per-user attribution UX

### Community / engineering analyses (MEDIUM confidence)
- [Building Collaborative Interfaces: OT vs CRDT — DEV](https://dev.to/puritanic/building-collaborative-interfaces-operational-transforms-vs-crdts-2obo) — pitfalls list
- [CRDTs and Local-First — smallstack](https://dev.to/smallstack/crdts-and-local-first-architecture-how-smallstack-handles-offline-conflict-resolution-338c) — rich-text user-intent problem
- [Notion offline guide — TaskFoundry](https://www.taskfoundry.com/2025/08/notion-offline-mode-setup-sync-conflict-guide.html) — confirms property-merge limitation
- [CRDT Dictionary — Ian Duncan](https://www.iankduncan.com/engineering/2025-11-27-crdt-dictionary/) — tombstone overhead, common pitfalls
- [Cloud Sync Conflicts Explained](https://www.digitalcitizen.life/cloud-sync-conflicts-explained-why-files-duplicate-or-overwrite-themselves/) — Excel/Dropbox device-name-in-filename pattern
- [Figma forum — disable observe mode](https://forum.figma.com/suggest-a-feature-11/disable-observe-mode-18772/index2.html) — community pushback on live cursors
- [Figma forum — granular permissions request](https://forum.figma.com/archive-21/a-granular-apporach-to-user-roles-24788) — confirms Figma's deliberate hold at 3 roles
- [Zotero PDF Reader annotation locks](https://forums.zotero.org/discussion/96174/zotero-pdf-reader-why-are-annotations-by-other-users-locked) — locks-by-author pattern (we are NOT adopting)
- [Altium Designer soft locks](https://www.altium.com/documentation/altium-designer/collaborators-visualization-conflict-prevention) — document-level soft-lock pattern (we are NOT adopting)

### Confidence caveats
- Figma's exact CRDT-vs-OT internals are inferred from blog posts, not source. The engineering blog is closest to authoritative.
- Linear's "OT not CRDT" claim comes from third-party reverse-engineering ([wzhudev/reverse-linear-sync-engine on GitHub](https://github.com/wzhudev/reverse-linear-sync-engine), endorsed by Linear CTO per readme). HIGH for the architectural claim; MEDIUM for any specific implementation detail.
- The "Figma users find live cursors distracting" claim is community-feedback grade, not formal user research. Treat as directionally true, not statistically proven.
- "No major collab tool surfaces device alongside user" is a confident negative — verified across Figma docs, Bluebeam docs, Drawboard, Notion, Linear, Google Docs, Excel. If a counter-example exists, it is rare enough that "device attribution" remains a real differentiator.

---
*Feature research for: v2.4 Multi-User Collaboration (CRDT/merge-engine rebuild)*
*Researched: 2026-04-26*
