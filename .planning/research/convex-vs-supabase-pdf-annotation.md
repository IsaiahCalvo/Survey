# Convex vs. Supabase for the Survey Marker app — deep review

_Date: 2026-06-06. Author: research pass requested by Isaiah._
_Sources reviewed: Theo (t3.gg) video "It's time to change your database" (Jan 13 2026, 39:44), the local Gemini "Convex vs. Supabase for a collaborative PDF annotation app" export, Convex docs (limits + pricing), Supabase pricing/billing docs, and third-party 2026 comparisons. Grounded against this app's actual architecture (graphify map + the live lifecycle harness run today)._

---

## TL;DR

**Switching the database will NOT make this app feel faster.** The lag you care about (zoom, pan, render) comes from the Syncfusion render lifecycle, not the database. We proved today, end-to-end against the real backend, that the Supabase data layer is sound and fast (save→reopen→import→delete all green). The database is not the bottleneck, so swapping it cannot fix a rendering problem.

**Convex is genuinely excellent — for a greenfield, TypeScript-first, real-time app being built fresh by AI agents.** Theo's enthusiasm is mostly fair on those merits. But this app is the opposite of greenfield: ~35 SQL migrations, security-audited row-level security, Stripe tier enforcement, document sharing + invite tokens, just-completed durability work, multi-platform packaging (Capacitor iOS/Android + Electron + web), and a Yjs/CRDT live-sync rebuild already underway that is database-agnostic.

**Recommendation: stay on Supabase.** Migrating to Convex would mean re-implementing and re-securing months of working, audited infrastructure for a benefit that does not touch the actual performance pain. Spend that energy on the zoom/render rebuild (the real win) and finishing the Yjs sync layer (which rides on any transport). Revisit Convex only for a brand-new product, or if Supabase Realtime ever hits a hard wall at scale.

---

## Source credibility (read this first)

- **Theo is a Convex investor and admits in the video he has "never built anything serious with Supabase."** He's transparent about both, which is to his credit, but it means the video is an informed-enthusiast pitch, not a neutral benchmark. Every Supabase weakness is second-hand (from Robin's "why I stopped using Supabase" video); every Convex strength is first-hand.
- The Gemini doc is more balanced but is generic LLM output with the standard "verify before production" disclaimer, and it has at least one factual error (see Airtable note below — directionally right, numbers stale).
- Net: treat both as **idea sources, not decision sources.** The decision has to be grounded in this app's reality, which is what the rest of this doc does.

---

## Point-by-point review of Theo's video

### Pricing claims

1. **"Supabase punishes you for having ideas" — free plan caps at 2 active projects; paused after 7 days inactivity.** ✅ True (confirmed in Supabase docs). **Relevance to us: ~zero.** That pain is for hobbyists juggling many throwaway projects. We are ONE production product, not 25 side projects.

2. **"Upgrade one project to Pro and every project in that org becomes paid, min $10/mo each."** ✅ Substantially true: Supabase billing is org-based, paid orgs lose free-project rights, each project carries a Micro compute instance (~$10/mo, offset by $10 credit). **Relevance to us: low** — single product, single project. This is a multi-hobby-project complaint.

3. **Convex free tier is very generous (1M function calls/mo, 0.5 GB storage, multiple deployments, several team members free).** ✅ Confirmed. Convex's free tier genuinely is friendlier for sprawl. Again, not our situation.

4. **Convex pro is "$25/developer/month"; Theo waves off the per-seat cost.** ✅ Confirmed it's **per developer (per seat)**. For a solo/small team this is fine; worth noting it's per-seat, which Supabase Pro is not (Supabase Pro is $25/org). For a bigger team Convex's per-seat model can flip the cost story.

5. **Convex file bandwidth $0.30/GB is "too expensive" (Theo + the CEO both admit it).** ✅ Confirmed and notable: **this app is PDF-heavy** (downloading source PDFs is the dominant bandwidth). Convex's own file egress pricing is a weak spot exactly where our workload is heaviest, unless you bolt on a CDN. Supabase storage egress is cheaper and we already use storage for PDFs.

**Pricing verdict:** Convex's pricing advantages are real but apply to the "many small projects" lifestyle, not a single PDF-heavy production app. On our actual workload (large binary PDFs), Convex's file-egress pricing is arguably *worse*.

### Real-time / sync claims

6. **"Every Convex query is automatically a live subscription; mutation invalidates query caches and pushes diffs; sub-50ms."** ✅ Architecturally true and genuinely elegant. Third-party numbers: Convex ~sub-50ms at 5k connections; Supabase Realtime ~100–200ms p99 under load. **But:** for human-visible annotation sync, the perceptual bar is ~100ms — both clear it. The 50ms-vs-100ms gap is real but not something a user drawing survey markers will feel.

7. **"Supabase realtime is a separate WAL pub/sub channel with no structural consistency; you manage cache invalidation yourself."** ✅ Fair characterization. This is the strongest *architectural* point in the video and the most relevant to us: a live multi-user layer is simpler in Convex because reads, writes, and reactivity share one consistent system. **However**, we already chose a **Yjs/CRDT** path for live sync, which solves consistency at the document layer independently of the database — so the Convex advantage here partly overlaps with work already designed and started.

8. **"Convex mutations run in a deterministic serialized runtime with automatic retry on conflict (OCC)."** ✅ True. Clean concurrency story. Worth knowing the flip side (see limits below): that determinism is *why* Convex caps how much a single transaction can touch.

### Developer experience / AI claims

9. **"All state lives in a folder (schema.ts + queries/mutations/actions); no ORM, no migration juggling; auto-deploy on save; schema validated against existing data."** ✅ True and genuinely nice. This is Convex's best feature and the core of why AI agents are productive in it.

10. **"AI agents love Convex because they just write TypeScript — no MCP jujitsu, no dashboard config."** ✅ Largely true and the most forward-looking argument, given this whole app is AI-built. If we were starting today, this would carry real weight.

11. **"No join syntax — just map + await N queries; trust the planner; 50–500 awaits is fine."** ⚠️ True *within Convex's limits* (see below). It's fine because Convex caps transaction size; it is not a license for unbounded fan-out. Relevant to us because our heavy docs have thousands of marks.

12. **"RLS is scary / legacy tech debt from devs too afraid to write servers."** ❌ **This is the most misleading point for us, and it's an opinion dressed as fact.** Row-level security is a *defense-in-depth security strength*: the database itself refuses unauthorized reads/writes even if app code has a bug. This app is multi-tenant with document sharing, invite tokens, and tier enforcement, and its RLS has been through a security audit. Moving all authorization into application mutations (the Convex model) means **one bug in one mutation = data exposure with no database backstop.** For a shared-document product, RLS-in-the-database is arguably the *safer* design, not the weaker one. The video sells a real DX win as if it had no security cost.

### Capabilities claims

13. **Components (Stripe, AI agent, work pools, crons, R2, Resend, Better Auth, collaborative editor, etc.).** ✅ Real and a genuine strength — installable backend capabilities without leaving the folder. Notably there IS a **ProseMirror/Tiptap collaborative-editor component** (server-authorized, OT-based). Relevant *if* we ever did rich-text collab — but our collab target is PDF annotations (Yjs), not a text editor, so it's adjacent, not a drop-in.

14. **Work pools (concurrency-limited queues with retry/completion).** ✅ Real and useful. Directly relevant: bulk-importing tens of thousands of marks under Convex's per-transaction limits would *require* exactly this batching pattern.

15. **Per-developer dev environments / instant onboarding via `npx convex dev`.** ✅ True and nice.

### Downsides Theo himself admits

16. **Env vars still must go through dashboard/CLI.** ✅ Minor.
17. **Not for arbitrary analytical queries / non-TypeScript clients / "select everything" huge queries.** ✅ Honest and important. He's upfront that Convex is an *application* database, not an analytics warehouse, and points to streaming exports (Snowflake/Databricks) and aggregate components.

---

## The decisive technical fact the video never mentions: Convex transaction limits

Confirmed from Convex's own docs (per single query/mutation):

- **Documents scanned: 32,000** · **Data read: 16 MiB**
- **Documents written: 16,000** · **Data written: 16 MiB**
- **Query/mutation user code: 1 second** · Actions: 10 minutes
- **Argument/return size: 16 MiB**

Why this matters for *this* app specifically:

- **Bulk import is our hot path.** Package 2 = **24,450 marks**. You cannot read or write that in one Convex transaction — you'd batch across many mutations behind a work pool. Doable, but it is real engineering, and it's the exact workload Theo's "just map + await" framing glosses over.
- A heavy survey doc whose total mark count approaches/exceeds ~32k would break any naive "load all annotations" query and force pagination. Our current per-page bounded reads/writes (the recent durability work) fit comfortably under these limits — but that design discipline becomes *mandatory* on Convex, not optional.
- Supabase/Postgres has no comparable hard per-statement ceiling; a bulk upsert of 24k rows is one statement. We already moved to bounded per-page ops + batched checkpoints, so we're fine either way — but Convex would not be "easier" here; it would impose more structure.

---

## Review of the Gemini doc

- Overall conclusion ("Convex for the real-time engine, Supabase for relational power / self-hosting") is a fair, conventional summary. ✅
- "Convex sub-50ms vs Supabase ~100ms" — matches third-party numbers; same caveat (both clear the human-perceptual bar). ✅
- Firebase verdict ("skip; query handcuffs; security rules tedious") — fair. ✅
- Neon verdict ("great Postgres, but you build the realtime layer yourself") — accurate; Neon is a DB, not a backend. ✅
- Airtable verdict ("hard no; rate-limited; record caps") — directionally correct (Airtable is unfit as an app backend), though the exact "5 req/sec" and record-cap numbers are stale/plan-dependent. ✅ conclusion, ⚠️ numbers.
- The schema advice ("one row per annotation object, never one giant array per PDF") is **exactly what this app already does** (`document_annotations`, one row per mark). So we're already following the recommended modeling regardless of vendor. ✅

---

## What actually limits this app's performance (grounded in our code)

1. **Rendering / zoom lifecycle (Syncfusion).** This is the north-star problem and the real source of lag. No database changes it. Owning the renderer (the planned Syncfusion removal + custom near-zero-lag zoom) is the performance project.
2. **Canvas/overlay work per page** (Fabric + SVG layers). CPU/GPU-bound on the client. Database-independent.
3. **Bulk import throughput** (the 24,450-mark baseline). This *is* data-layer adjacent — and here Convex would impose more constraints (batching under 16k-write limits), not fewer.
4. **Live multi-user sync (Pass 2, not yet shipped).** The one place a different backend *could* help DX — but we already chose Yjs/CRDT, which is transport- and database-agnostic and partly built.

**Conclusion: 3 of the 4 real limiters are client-side rendering/compute. The database is not the lever.**

---

## Cost of switching (what "go Convex" actually means here)

- Re-model ~35 SQL migrations into a Convex schema.
- Re-implement all row-level security as mutation-level auth checks **and re-audit it** (the current RLS was security-reviewed).
- Re-build Stripe tier enforcement, document sharing, invite tokens.
- Re-validate durability (the Pass-1 work we just proved green) on a new engine.
- Re-do realtime, and reconcile it with the in-progress Yjs/CRDT work.
- Verify the Convex JS SDK across **Capacitor iOS/Android + Electron + web** packaging.
- Re-tune the bulk-import path around Convex's per-transaction ceilings.

That is a multi-month, high-risk migration whose payoff does not touch the lag the user feels.

---

## Recommendation

1. **Stay on Supabase.** It is proven, audited, multi-platform, and not the bottleneck.
2. **Put the energy into the renderer/zoom rebuild** — that's the real, felt performance win.
3. **Finish the Yjs/CRDT live-sync layer** for multi-user; it's database-agnostic and already chosen, and it neutralizes Supabase Realtime's main weakness (consistency) without a migration.
4. **Keep Convex on the shelf** for a future greenfield product, or revisit only if Supabase Realtime hits a hard scaling wall we can measure.

If we ever DO want to test the real-time DX, the low-risk experiment is a tiny standalone Convex prototype of just the live-cursor + live-mark sync — a weekend spike, not a migration — to feel the difference before betting anything.

---

_Sources: Convex docs (limits, pricing), Supabase pricing/billing docs, Theo t3.gg "It's time to change your database" (transcript), the local Gemini export, and 2026 third-party comparisons (Makers' Den, DevToolsAcademy, Bytebase, ScratchDB). Latency figures are vendor/third-party estimates, workload-dependent._
