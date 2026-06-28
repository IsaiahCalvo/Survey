# Database / Backend Platform Re-Evaluation — Survey BetaSafeS2

**Date:** 2026-06-28
**Author:** Final analyst (synthesis of 15 researched candidate profiles + adversarial fact-check verdicts)
**Status:** Decision report. Where an adversarial verdict refuted or corrected a profile claim, the verdict's correction is authoritative below.

---

## 1. Executive Summary & Recommendation

**Recommendation: STAY ON SUPABASE.** This re-evaluation confirms — with high confidence and against 14 alternatives — that Supabase remains the correct platform for Survey BetaSafeS2. The app's value is not at the client-SDK surface (228 `.from()` / 18 `.rpc()` calls are mechanical to rewrite) but in the **server-side Postgres investment that encodes the security model and business logic**: ~134 RLS policies as the *sole* permission-enforcement layer, ~50 SECURITY DEFINER RPCs (including the LIVE-on-prod `excel-apply-changeset` keystone with single-transaction ACID + `FOR UPDATE` locking + TOCTOU concurrency control), 25+ load-bearing triggers, and a purpose-built realtime/collab stack (Yjs over Broadcast + `postgres_changes` CDC + JWT `setAuth` bridge). Every one of the 14 alternatives scores a migration effort of 4–5/5, and *all* of them force one of two outcomes: either (a) a non-Postgres target that requires rebuilding the schema/RPC/trigger investment from scratch and re-expressing the permission model in an application trust boundary — a genuine security regression for the enterprise target — or (b) a Postgres-compatible target that preserves the schema but still requires rebuilding Auth, Realtime, Storage ACL, and Edge Functions as separate services. No candidate addresses the app's actual, locked bottleneck (the renderer, not the DB).

**The single best alternative is AWS Aurora Serverless v2 / RDS Postgres** — and only as a *contingency*, triggered by a specific enterprise procurement mandate (AWS-region data residency, FedRAMP, or an AWS-only BAA). It is the only candidate that preserves the entire Postgres investment (schema, RPCs, triggers, RLS, pgcrypto, `pg_cron`, JSONB, `FOR UPDATE`) with zero SQL changes while still being a credible enterprise platform. Its blockers are real but bounded: the `auth.uid()` → `current_setting()` claim-injection rework across ~134 policies, the API Gateway WebSocket 128 KB hard ceiling (below the app's ~600 KB Yjs frames, requiring a chunking protocol), and the need to assemble Cognito + S3-proxy + Lambda + a self-operated Hocuspocus realtime tier. **Switching is worth it only if** an enterprise contract makes Azure/AWS-region hosting or a compliance posture Supabase cannot meet a hard requirement; absent that, staying on Supabase is strictly correct.

---

## 2. Requirements Rubric

Scoring legend per requirement: **2** = native / full support, no rebuild; **1** = partial / workaround / immature / requires bolt-on; **0** = absent / full rebuild / disqualifying. Weighted score = Σ(score × weight). MustHave weights total **81**; NiceToHave weights total **44**. Max possible = 250.

### Must-Haves (the binding constraints)

| # | Requirement | Weight |
|---|-------------|--------|
| M1 | Row-level / per-row server-enforced permission model keyed on auth identity (RLS-equivalent), no client-side trust | 10 |
| M2 | Realtime pub/sub transport suitable for a Yjs CRDT (per-doc channel, multi-hundred-KB binary frames within the Broadcast ceiling — 3 MB on Pro/Team — self-echo suppression, mid-session token refresh) | 9 |
| M3 | Server-side row-change notifications (CDC / `postgres_changes` equiv) with full old-row payload on DELETE | 8 |
| M4 | Server-side ACID transactional business logic (multi-table atomic writes with row locking / optimistic concurrency) | 9 |
| M5 | Enterprise SAML SSO + OAuth + email/password auth, JWT issued for the permission layer | 9 |
| M6 | Private object storage with authenticated per-object access tied to the app's permission model | 8 |
| M7 | Serverless functions runtime that can run trusted server-role logic (Stripe, transactional Excel apply, email) | 7 |
| M8 | JSONB-style document column with server-side path/containment query operators | 7 |
| M9 | SOC2 / enterprise compliance posture, audit logging, data-residency options | 8 |
| M10 | Triggers / server-side automation hooks (auto-provision, watermark bump, immutability, storage accounting) | 6 |

### Nice-to-Haves

| # | Requirement | Weight |
|---|-------------|--------|
| N1 | Native pgcrypto-equivalent crypto at the data layer (gen_random_bytes, SHA-256/HMAC) | 5 |
| N2 | Single-binary local/dev parity with cloud (CLI, branchable preview DBs) | 4 |
| N3 | Built-in subscription/tier table + quota enforcement pattern | 3 |
| N4 | Scheduled jobs (pg_cron equivalent) for the annotation-trash sweep | 3 |
| N5 | Realtime-broadcast payload headroom well beyond the app's 600 KB soft cap (Supabase Pro/Team Broadcast = 3 MB) | 5 |
| N6 | BYTEA/large-binary column support for gzip Yjs snapshots (up to 12MB) | 4 |
| N7 | Keyset-pagination-friendly stable primary keys + unique-constraint upsert (onConflict) | 4 |
| N8 | Postgres compatibility specifically (makes the 66-migration / ~50-RPC investment portable nearly as-is) | 7 |
| N9 | Transparent, predictable pricing that does not penalize realtime message volume or CDC throughput | 5 |
| N10 | Managed connection pooling for serverless function fan-out | 3 |

---

## 3. Current Supabase Usage Map (the thing being migrated)

The coupling is overwhelmingly **server-side**, not at the SDK surface:

| Layer | Footprint | Why it is load-bearing |
|-------|-----------|------------------------|
| **Tables** | ~26–30 tables; ~13 hit directly via `.from()`. Rest are server-role/RPC-internal (excel_sync_*, rowid_signing_secrets, document_revisions, annotation_trash_events, survey_items, survey_presence, 3 views). | Annotation row volume is the real scale driver — a single large survey doc can hold thousands of `document_annotations` rows. |
| **Permissions** | ~134 RLS policies; helper fns `user_can_access_document` / `_kal48_can_access`. **Sole** permission layer — no app-layer fallback exists. | 228 `.from()` reads gated entirely by RLS. Enterprise owner>editor>viewer is MANDATORY and server-enforced. |
| **Business logic** | ~50 SECURITY DEFINER RPCs (18 invoked via `.rpc()`). The `kal308_apply_changeset` keystone (LIVE on prod) chains `FOR UPDATE` lock + idempotency + TOCTOU fingerprint + 5-table atomic write in ONE transaction. `kal48_restore_revision` does nested-call + bulk DELETE + bulk re-INSERT atomically. | Single-transaction ACID is the hardest single thing to port. |
| **Realtime** | Custom `SupabaseYjsProvider`: one channel per doc (`yjs:<docId>`), 4 broadcast events, base64-in-JSON binary, conservative 600 KB soft cap (well under the real Broadcast ceiling — 3 MB on Pro/Team; the oft-cited 1,024 KB is the *Postgres Changes* limit, not Broadcast). Plus `postgres_changes` on `document_annotations` (REPLICA IDENTITY FULL) and `document_collaborators` DELETE for <3s proactive kick. `authSessionBridge` forwards refreshed JWTs past ~55min expiry. | Yjs CRDT + dual-write queue + IndexedDB local persistence. Highest-risk realtime dependency. |
| **Storage** | Single private `documents` bucket: PDFs (SHA-256 content-addressed, upsert dedup) + JSON sidecars. Collaborator-read policy JOINs back into `public.documents` via `user_can_access_document` — access control is **data-driven**. Privacy tripwire test enforces never-public. | Needs storage ACL that can reference app tables, or an app-layer signed-URL proxy. |
| **Edge Functions** | 6 Deno functions: 3 Stripe, 2 Resend email, `excel-apply-changeset` (auth.getUser + 3 service-role RPCs + realtime broadcast in one request). | Value is transactional/service-role chaining, not throughput. |
| **Other** | pgcrypto extension, `supabase_realtime` publication, 25+ triggers (`on_auth_user_created_subscription`, `bump_doc_annotations_changed_at` watermark fast-open skip, audit-immutability, storage-accounting, forgery-defense). Prod hand-managed via dashboard/Management API. | Without `bump_doc_annotations_changed_at`, every open reverts to ~25 sequential SELECTs. |

**Usage profile:** Unlaunched. Launch: <500 MAU, tens of GB PDFs, tens of concurrent RT channels. Moderate scale (12–18mo): ~2–5k MAU, low-single-digit TB storage, low-thousands peak concurrent RT connections during review sessions. Read-heavy on open, write-bursty during annotation, realtime-heavy during multi-user review.

---

## 4. Full Comparison Matrix (all 15 candidates)

Score legend: **2** native / **1** partial-or-bolt-on / **0** absent-or-rebuild.

### 4a. Must-Have capability matrix

| Candidate | M1 RLS | M2 Yjs RT | M3 CDC | M4 ACID | M5 SAML/Auth | M6 Storage ACL | M7 Funcs | M8 JSONB | M9 Compliance | M10 Triggers |
|-----------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **Supabase** | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| **Neon** | 1 | 0 | 1 | 2 | 1 | 0 | 0 | 2 | 2 | 2 |
| **SpacetimeDB** | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 1 |
| **Convex** | 0 | 0 | 0 | 1 | 1 | 0 | 1 | 0 | 2 | 1 |
| **PlanetScale** | 1 | 0 | 1 | 2 | 0 | 0 | 0 | 2 | 2 | 2 |
| **Turso (libSQL)** | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 2 | 1 |
| **Firebase/Firestore** | 1 | 0 | 0 | 0 | 1 | 1 | 1 | 0 | 2 | 0 |
| **AWS Aurora/RDS** | 2 | 1 | 1 | 2 | 2 | 1 | 1 | 2 | 2 | 2 |
| **CockroachDB** | 1 | 0 | 0 | 2 | 0 | 0 | 0 | 2 | 2 | 1 |
| **Xata** | 1 | 0 | 1 | 2 | 0 | 0 | 0 | 2 | 2 | 2 |
| **Nile** | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 1 | 0 |
| **Cloudflare D1+Stack** | 0 | 1 | 0 | 0 | 1 | 1 | 1 | 0 | 2 | 1 |
| **Azure SQL+Entra** | 2 | 1 | 1 | 2 | 2 | 1 | 2 | 1 | 2 | 2 |
| **InstantDB** | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| **Electric/PowerSync** | 1 | 1 | 1 | 2 | 1 | 0 | 0 | 2 | 1 | 2 |

> Key matrix calls (verdict corrections applied):
> - **Neon M3=1:** logical replication / CDC *is* available (verdict refuted "coming soon"), but needs direct (non-pooled) connection and disables scale-to-zero; no broadcast plane (M2=0).
> - **Aurora:** Postgres 17 IS supported (verdict refuted profile omission). pg_cron + auto-pause caveat under N4.
> - **CockroachDB M3=0:** RLS+CDC mutual exclusion (changefeeds blocked on RLS tables; unfiltered changefeeds leak past RLS). pgcrypto IS supported (verdict refuted profile — affects N1).
> - **Azure M3=1:** CDC exists but 20s capture interval, no subsecond, no SLA. Azure SQL is T-SQL (M8=1 via JSON functions). PG-compatible escape hatch = Azure DB for PostgreSQL Flexible Server.
> - **Electric/PowerSync** are *additive* sync layers, not replacements — scored as "what they themselves provide."
> - **Convex M9=2:** verdict found conflicting Type I (enterprise page) vs Type II (security page); treated compliant, low-confidence on exact type.

### 4b. Nice-to-Have capability matrix

| Candidate | N1 pgcrypto | N2 branch/dev | N3 quota | N4 cron | N5 RT headroom | N6 BYTEA | N7 upsert | N8 PG-compat | N9 pricing | N10 pooling |
|-----------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **Supabase** | 2 | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| **Neon** | 2 | 2 | 1 | 1 | 0 | 2 | 2 | 2 | 2 | 2 |
| **SpacetimeDB** | 0 | 1 | 1 | 2 | 1 | 1 | 1 | 0 | 2 | 2 |
| **Convex** | 0 | 1 | 1 | 2 | 1 | 0 | 1 | 0 | 1 | 2 |
| **PlanetScale** | 2 | 2 | 0 | 2 | 0 | 2 | 2 | 2 | 1 | 1 |
| **Turso (libSQL)** | 0 | 2 | 0 | 0 | 0 | 1 | 1 | 0 | 2 | 2 |
| **Firebase/Firestore** | 0 | 1 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 2 |
| **AWS Aurora/RDS** | 2 | 1 | 1 | 1 | 0 | 2 | 2 | 2 | 1 | 1 |
| **CockroachDB** | 2 | 1 | 0 | 0 | 1 | 1 | 2 | 1 | 1 | 2 |
| **Xata** | 2 | 2 | 0 | 2 | 0 | 2 | 2 | 2 | 2 | 2 |
| **Nile** | 1 | 1 | 1 | 0 | 0 | 1 | 1 | 1 | 2 | 2 |
| **Cloudflare D1+Stack** | 0 | 1 | 0 | 1 | 2 | 1 | 1 | 0 | 2 | 2 |
| **Azure SQL+Entra** | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 2 |
| **InstantDB** | 0 | 1 | 1 | 0 | 0 | 1 | 1 | 0 | 2 | 1 |
| **Electric/PowerSync** | 2 | 2 | 1 | 1 | 2 | 2 | 2 | 2 | 2 | 1 |

### 4c. Weighted total scores

| Rank | Candidate | MustHave (/162) | NiceToHave (/88) | **Total (/250)** | Migration Effort (1–5) |
|:--:|-----------|:--:|:--:|:--:|:--:|
| 1 | **Supabase** | 162 | 84 | **246** | 1 |
| 2 | **AWS Aurora/RDS** | 130 | 56 | **186** | 5 |
| 3 | **Electric/PowerSync** (additive) | 92 | 67 | **159** | 4 |
| 4 | **Azure SQL + Entra** | 122 | 33 | **155** | 5 |
| 5 | **Neon** | 90 | 62 | **152** | 5 |
| 6 | **Xata** | 81 | 67 | **148** | 5 (4 additive) |
| 7 | **PlanetScale** | 76 | 54 | **130** | 5 |
| 8 | **CockroachDB** | 74 | 41 | **115** | 5 |
| 9 | **Cloudflare D1+Stack** | 56 | 41 | **97** | 5 |
| 10 | **Convex** | 56 | 31 | **87** | 5 |
| 11 | **Firebase/Firestore** | 53 | 23 | **76** | 5 |
| 12 | **SpacetimeDB** | 37 | 35 | **72** | 5 |
| 13 | **Turso (libSQL)** | 35 | 33 | **68** | 5 |
| 14 | **Nile** | 30 | 28 | **58** | 5 |
| 15 | **InstantDB** | 27 | 27 | **54** | 5 |

> Electric/PowerSync's total is misleading: it is *additive* — it does not replace Supabase's Auth/RLS/Storage/Functions, so it both understates (offline sync value) and overstates (it is not a replacement). The honest ordering of *replacement* candidates is: Supabase > Aurora > Azure > Neon/Xata > PlanetScale > CockroachDB > the rest.

**Cost rank** (cheapest at moderate scale → most expensive): Supabase, Neon, Xata, PlanetScale, Turso, Cloudflare, SpacetimeDB, CockroachDB, InstantDB, Nile, Electric/PowerSync (additive), Firebase (read-amplification penalty), Convex, AWS, Azure.

---

## 5. Per-Candidate Deep-Dives

> Each entry incorporates the adversarial verdict's corrections. All 15 verdicts returned overallConfidence: high.

### 5.1 Supabase — INCUMBENT (Total 246/250, Migration 1) — RECOMMENDED

**Strengths:** Zero migration cost — entire server-side investment (RLS, RPCs, triggers, migrations, LIVE `excel-apply-changeset` keystone) already deployed. Native Postgres: full JSONB operators, BYTEA/TOAST for 12MB Yjs snapshots, pgcrypto. RLS gold standard with SECURITY DEFINER helpers + storage policies that JOIN app tables. Broadcast at **3 MB ceiling on Pro+** (far above the app's ~600 KB frames), `setAuth()` mid-session JWT refresh, `postgres_changes` CDC with REPLICA IDENTITY FULL. SAML 2.0 with Microsoft Entra confirmed. pg_cron all plans. PgBouncer/Supavisor pooling. SOC2 Type 2 confirmed.

**Weaknesses / verdict corrections (high confidence):**
- **Team does NOT include 10,000 concurrent realtime connections** — verdict refuted: both Pro and Team = **500 peak** + `$10/1,000` overage. 10K is the spend-cap-off ceiling, not an entitlement.
- Edge function per-project count limits omitted: Free=100, Pro=500, Team=1,000. App has 6.
- ISO 27001 unverified from docs (marketing label); SOC2 Type 2 report access on Team/Enterprise confirmed.
- **SAML does NOT support Single Logout (SLO)** — enterprise gap to flag.
- HIPAA BAA is a paid add-on (Team/Enterprise), not auto-included.
- Broadcast drops under sustained bursts without throttling (600KB soft-cap already mitigates); `postgres_changes` adds 50–200ms WAL latency + DB CPU pressure on hot tables.

**Pricing:** Free $0; Pro $25/mo; Team $599/mo (SOC2 report + SAML dashboard SSO); Enterprise custom. SAML app SSO $0.015/SSO MAU (50 free). Compute add-ons $15–210/mo.

**Fit:** Correct and only-justified choice. Realtime maps exactly to Broadcast + setAuth + postgres_changes. Enterprise pitch met by Team; Pro→Team delta is the compliance cost. **Confidence: high.**

### 5.2 AWS Aurora Serverless v2 / RDS Postgres (Total 186, Migration 5) — BEST ALTERNATIVE / CONTINGENCY

**Strengths:** Full Postgres wire compatibility — all 66 migrations, ~50 RPCs, 25+ triggers, ~134 RLS policies, JSONB, **pgcrypto**, **pg_cron**, BYTEA, `FOR UPDATE` transfer with **zero SQL changes**. Strongest compliance posture: SOC 2 Type II, HIPAA BAA, FedRAMP, PCI DSS, ISO 27001, GovCloud. Full data-residency control (any region, Outposts). Cognito SAML with **no enterprise-tier gate**. Aurora Serverless v2 scales 0–256 ACU. **Postgres 17 supported** (verdict refuted profile omission).

**Weaknesses / verdict corrections (high confidence):**
- No integrated realtime — build + operate Hocuspocus + ElastiCache Redis on ECS/Fargate.
- **API Gateway WebSocket hard 128 KB ceiling** — below the ~600 KB Yjs frames; mandatory binary chunking.
- No managed CDC equivalent — EventBridge Pipes + Lambda or polling.
- `auth.uid()` → `current_setting()` claim injection across ~134 policies (RDS Proxy + Lambda interceptor). Highest-risk auth task.
- S3 IAM cannot JOIN app tables — Lambda presigned-URL proxy per access.
- **pg_cron jobs silently skipped while instance auto-paused** — sweep needs auto-pause off or external wake (verdict correction).
- **RDS Proxy priced per vCPU-hour, not per ACU-hour** (verdict correction).
- Composite cost estimates unverified.

**Pricing:** Aurora Serverless v2 $0.12/ACU-hr (Std)/$0.156 (I/O-Opt); storage $0.10/GB-mo. Cognito SAML $0.015/MAU (50 free). Lambda 1M free then $0.20/1M. Full stack ~$200–400/mo launch, ~$600–1,400/mo moderate.

**Fit:** Right choice **IF AND ONLY IF** an enterprise buyer mandates AWS-region residency, FedRAMP, or AWS BAA. Not a perf/cost fix — 3–4x Supabase at startup; 128KB WS ceiling demands a chunking redesign first. **Confidence: high.**

### 5.3 Azure SQL + Entra ID (Total 155, Migration 5)

**Strengths:** Native Entra ID SAML SSO — **no plan gate** for gallery apps; M365/ADFS shops already run Entra (strongest differentiator for the target). Azure SOC 2 Type 2 umbrella; mature data residency (EU Data Boundary, 60+ regions). Azure SQL RLS engine-enforced (Filter + Block predicates). `EXECUTE AS OWNER` = SECURITY DEFINER equiv. Web PubSub message size **1 MB** (above the app's 600 KB soft cap, but *below* Supabase's actual 3 MB Pro/Team Broadcast ceiling). Functions ~free for 6 low-volume functions.

**Weaknesses / verdict corrections (high confidence):**
- **NOT Postgres-compatible** — Azure SQL is T-SQL. Full ground-up T-SQL rewrite (2–4mo DB engineering alone). Highest-effort migration.
- **CDC runs every 20s, non-configurable, no SLA, no subsecond** (verdict verbatim) — breaks <3s eviction + subsecond sync.
- **CDC can leak entire rows past RLS to db_owner/gating-role members** (verdict verbatim).
- RLS trust shift: middleware must call `sp_set_session_context` per pooled connection.
- No native JSONB/GIN; no T-SQL HMAC (HASHBYTES = SHA-256 only).
- **"SAML no plan gate" overstated** — Free caps SaaS integrations; Conditional Access needs P1 ($6/user/mo).
- **Web PubSub SOC2 scope unverified**; per-unit price unverified.
- Cost 5–10x Supabase.

**Pricing:** Azure SQL Serverless $0.5218/vCore-hr (~$75–250/mo light); GP 4-vCore ~$730/mo. Web PubSub Std ~$49–85/unit/mo (unverified). Entra P1 $6/P2 $9/user/mo. All-in ~$150–350 launch, ~$1,200–3,500 moderate.

**Fit:** Correct **only if** Azure-only hosting is contractually mandated — target **Azure DB for PostgreSQL Flexible Server**, NOT Azure SQL. **Confidence: high.**

### 5.4 Xata (Total 148, Migration 5; 4 additive)

**Strengths:** Vanilla unmodified Postgres (14–18) — schema, 50 RPCs, triggers, JSONB, **pgcrypto**, pg_cron port near-as-is. Sub-second copy-on-write branch clones. BYOC for residency. SOC 2 + HIPAA (BYOC). `pgstream` open-source CDC pipeline.

**Weaknesses / verdict corrections (high confidence):**
- No auth (requires Auth0/Clerk/WorkOS incl. SAML), no client realtime/pub-sub, no client `postgres_changes`, no edge functions.
- `auth.uid()` session-variable missing — all ~134 policies rewritten to inject custom `SET LOCAL`.
- No object storage as core (**Files API still on paid plans, maintained** — verdict corrected "removed" — but roadmap-deprecated, path-ACL only).
- Managed cloud only us-east-1 + eu-central-1.
- **Open Source self-host IS free forever** (verdict corrected "no free tier"); Cloud = $100/14-day credit.

**Pricing:** Open Source $0; Cloud ~$9–$1,121/mo + $0.28/GB/mo, EU +15%; BYOC custom.

**Fit:** Not viable — solves branch cloning while missing auth/realtime/CDC/storage/functions + the `auth.uid()` binding. **Confidence: high.**

### 5.5 ElectricSQL / PowerSync (Total 159 standalone; Migration 4, ADDITIVE)

**Strengths:** 100% Postgres-compatible — preserves the *entire* investment because they sit OVER your Postgres. Eliminates the ~25-sequential-SELECT cold-open (local SQLite/PGlite cache). PowerSync has a documented working Yjs pattern (row-per-update BYTEA) sidestepping per-message payload ceilings entirely. PowerSync SOC 2 Type 2 + HIPAA on Team/Enterprise; self-host for residency.

**Weaknesses / verdict corrections (high confidence):**
- **Neither replaces Supabase** — no auth, storage, or serverless functions. Cannot reduce Supabase spend; increases total cost.
- No drop-in `SupabaseYjsProvider`. Electric's `y-electric` is **experimental, not production-grade** (verdict refuted; open issue #2121). PowerSync awareness channel still needs a separate low-latency transport.
- No `postgres_changes` CDC with old-row DELETE for the <3s eviction path.
- PowerSync Sync Rules duplicate the 134 RLS policies — drift risk.
- **Electric has NO SOC 2** (verdict confirmed). PowerSync E2E encryption planned, not shipped. Durable Streams "no payload ceiling" claim unverified.

**Pricing:** Electric PAYG $0 + $1/1M writes; Pro $249/mo; Scale $1,999/mo. PowerSync Free $0; Pro $49/mo; Team $599/mo (SOC2+HIPAA); Enterprise custom.

**Fit:** Additive sync layer, not a replacement. If ever adopted: **after** the renderer migration confirms the perf ceiling; PowerSync is the stronger of the two. **Confidence: high.**

### 5.6 Neon (Total 152, Migration 5)

**Strengths:** Full Postgres (PG14–18) — schema, triggers, SECURITY DEFINER, **pgcrypto**, pg_cron, JSONB port without rewrite. DB branching. Scale-to-zero pricing. SOC 2 Type I+II, ISO 27001/27701, HIPAA (Scale). `pg_session_jwt` + `auth.user_id()` clean JWT→RLS path (works with Azure AD).

**Weaknesses / verdict corrections (high confidence):**
- No native broadcast/pub-sub — `SupabaseYjsProvider` cannot port; needs Hocuspocus + Ably/Pusher.
- **Logical replication / CDC IS available** (verdict refuted "coming soon") — Debezium works — BUT needs direct (non-pooled) connection and disables scale-to-zero while subscribed.
- LISTEN/NOTIFY killed by scale-to-zero.
- No SAML in Neon Auth — enterprise SAML needs third-party IdP.
- Neon Storage private-preview (us-east-2, credential-ACL only); Neon Compute private-preview, no GA.
- `auth.uid()` → `auth.user_id()` across 134 policies + JWT rewiring.

**Pricing:** Free $0; Launch $0.106/CU-hr + $0.35/GB-mo; Scale $0.222/CU-hr + SOC2 + HIPAA. (Verified.)

**Fit:** Excellent Postgres *layer* alone, not a replacement today — realtime, SAML, policy-driven storage all need separate immature stacks. Best as complement or pure-Postgres contingency. **Confidence: high.**

### 5.7 PlanetScale (Total 130, Migration 5)

**Strengths:** Real Postgres (v17/v18) with **pgcrypto, pg_cron, wal2json** — schema portable. Best-in-class DB perf (Metal/NVMe). Branching. SOC 2 + SOC 1 + HIPAA + PCI (Managed). `wal2json` CDC with old-row payloads. Single-tenant Managed.

**Weaknesses / verdict corrections (high confidence):**
- No app auth, no realtime, no object storage, no edge functions — four vendors needed.
- **PlanetScale publicly recommends AGAINST RLS** — PgBouncer pooling breaks `SET ROLE`/client-identity. Direct conflict with the RLS-as-sole-enforcement model.
- No free tier (removed April 2024). SAML dashboard-only (WorkOS, $199/mo).
- Verdict corrections: "$39 Base Plan" conflates the Vitess PS-10 cluster price (no org-level fee). PlanetScale **NOT** acquired by Supabase (snippet misinformation).

**Pricing:** Postgres EBS Non-HA $5/mo; EBS HA $15/mo; Metal M-10 $50/mo; SSO add-on $199/mo. (Cluster prices confirmed.)

**Fit:** Poor — excellent DB, zero platform pillars, philosophy hostile to RLS. **Confidence: high.**

### 5.8 CockroachDB (Total 115, Migration 5)

**Strengths:** Postgres-wire compatible; SQL/JSONB port mechanically. Distributed active-active. Serializable ACID. RLS (GA v25.2), SECURITY DEFINER (v24.3+). SOC 2 Type II + ISO. **pgcrypto IS supported** — `gen_random_bytes`, `hmac`, `digest` (verdict refuted profile; N1=2).

**Weaknesses / verdict corrections (high confidence):**
- **RLS + CDC mutual exclusion — hard blocker** (verdict confirmed): CDC queries fail on RLS tables AND unfiltered changefeeds leak past RLS. App needs both — impossible.
- CDC DELETE emits PK + null only — breaks eviction.
- No app auth (SAML console-only); no object storage, no edge functions, no pg_cron. Triggers preview (no INSTEAD OF/statement-level).
- **Standard/Advanced monthly estimates wrong** (verdict refuted): per-vCPU rates → 2-vCPU Standard ≈ $259/mo (not $130), 4-vCPU Advanced ≈ $1,728/mo (not $432).

**Pricing:** Basic $15/mo free credit then $0.20/1M RUs; Standard ~$259+/mo per 2-vCPU; Advanced ~$1,728+/mo per 4-vCPU.

**Fit:** Poor — RLS+CDC conflict alone disqualifies; four missing pillars. **Confidence: high.**

### 5.9 Convex (Total 87, Migration 5) — re-evaluation of the LOCKED rejection

**Strengths:** SOC 2 (Type I/II — see correction), HIPAA BAA, GDPR. ACID serializable via OCC. Truly reactive queries. TS-native DX. Native cron. VPC deployment for residency.

**Weaknesses / verdict corrections (high confidence):**
- **Application-layer RLS only — bypassable via dashboard edits, `npx convex import`, or a forgotten wrapper. Convex's own CTO docs flag IDOR verbatim.** Violates the mandatory server-enforced RLS requirement.
- No native Yjs provider (`convex-yjs` is a demo; the collab blog uses ProseMirror OT). Hocuspocus still required.
- **20MB HTTP action cap breaks authenticated serving of PDFs >20MB** (file URLs otherwise unauthenticated by default).
- No `FOR UPDATE` — TOCTOU-safe keystone idempotency has no equivalent.
- No Postgres compat, no JSONB containment, no old-row-on-DELETE. App-SAML needs WorkOS/Auth0.
- Business plan min **$2,500/mo**. Verdict: "skipped Type I" claim is wrong — enterprise page leads with Type I.

**Pricing:** Free $0; Pro $25/dev/mo; Business/Enterprise $2,500/mo min.

**Fit:** Poor — 2026-06-06 rejection **strengthened**. Three hardest blockers each individually require multi-month rework. **Confidence: high.**

### 5.10 Cloudflare D1 + Stack (Total 97, Migration 5)

**Strengths:** Zero R2 egress. Durable Objects WebSocket message size **32 MB** (well above Supabase's 3 MB Broadcast ceiling). Workers colocation with D1. Scale-to-zero ($5/mo base). Managed SAML via Cloudflare Zero Trust (Azure AD/Entra). SOC 2 Type II + ISO 27001.

**Weaknesses / verdict corrections (high confidence):**
- D1 is SQLite — no RLS (app-layer in Workers, fail-open), no `FOR UPDATE`/`BEGIN`-`COMMIT` (only `batch()`), no SECURITY DEFINER, no `postgres_changes`, no JSONB containment, no pgcrypto.
- `excel-apply-changeset` keystone cannot port — needs Durable Object single-writer redesign.
- **10 GB hard per-database ceiling (non-increasable)** — annotation rows + 12MB Yjs snapshots + audit could exceed it; sharding breaks atomicity.
- No built-in user auth. Verdict: **Access alone is $3/user/mo** (not $7); 32MB WS landed **Oct 2025**; D1 `CREATE TRIGGER` broken via migrations.

**Pricing:** Free $0; Workers Paid $5/mo base + usage; R2 $0.015/GB-mo + free egress; Access $3/user/mo (free ≤50).

**Fit:** Poor — further from Supabase than Convex was; full rewrite, security-regression risk. **Confidence: high.**

### 5.11 Firebase / Firestore (Total 76, Migration 5)

**Strengths:** Mature, auto-scaling. Security Rules enforce server-side per-document access. Cloud Functions `onDelete` provides before-state. Storage Rules cross-reference up to 2 Firestore docs. SAML via Identity Platform (Azure AD via OIDC). SOC 1/2/3 + ISO 27001.

**Weaknesses / verdict corrections (high confidence):**
- No Postgres — full rewrite. Security Rules (CEL, max 10 `get()`/eval, no JOINs) cannot express multi-table JOIN RLS — requires denormalizing roles into every document.
- Cloud Function triggers **ASYNC, not in the write transaction** — the `kal308` ACID keystone is architecturally impossible (≤500 ops, no FOR UPDATE).
- No broadcast / no `postgres_changes`; 1 MiB document limit hard-blocks 12MB Yjs snapshots. `y-fire` makes every frame a billed write.
- **Firebase Auth is US-datacenter-only** (verdict verbatim) — EU residency blocker.
- Verdict: Firestore per-op pricing **stale**; $0.015/MAU SAML unverified. Read-amplification conclusion holds.

**Pricing:** Spark free; Blaze pay-as-you-go (read-amplification penalty); Enterprise custom.

**Fit:** Poor / net regression — JOIN-based RLS + ACID keystone architecturally incompatible. **Confidence: high.**

### 5.12 Turso (libSQL) (Total 68, Migration 5)

**Strengths:** Extreme cost-efficiency for DB-per-tenant. Sub-ms embedded-replica reads. 35+ edge PoPs. SOC 2 Type II, HIPAA (Pro), BYOK.

**Weaknesses / verdict corrections (high confidence):**
- Not Postgres-compatible — schema, RLS, RPCs, pgcrypto, JSONB `@>` non-portable.
- No native RLS (DB-per-tenant ≠ within-tenant roles; app-proxy bypassable). No realtime pub/sub (CDC poll-based). No app auth, object storage, serverless functions, SECURITY DEFINER.
- Verdict: **Turso Cloud runs on libSQL (C fork), not the Rust rewrite**. Free tier likely allows overages. Pro $416.58 (was $499).

**Pricing:** Free $0; Developer $4.99/mo; Scaler $24.92/mo; Pro $416.58/mo; Enterprise custom.

**Fit:** Wrong tool — five platform pillars absent. **Confidence: high.**

### 5.13 SpacetimeDB (Total 72, Migration 5)

**Strengths:** Exceptional realtime throughput (150K+ tps, in-memory). Unified runtime. ACID reducers. Scheduled reducers. Self-hostable.

**Weaknesses / verdict corrections (high confidence):**
- No Postgres compat — full rewrite (verdict: real but limited PGWire exists; migrations/RLS still non-portable).
- Experimental, read-only RLS — **writes enforced in reducer code, not the DB**.
- No SAML (OIDC-only); **no SOC 2/HIPAA/GDPR** found — disqualifying.
- No JSONB; no native private object storage; no CDC; no `setAuth` equivalent. RAM-bound DB problematic for 12MB snapshots.

**Pricing:** Free $0; Pro $25/mo; Team $250/mo; Enterprise custom. (Confirmed.)

**Fit:** Compelling realtime but disqualified by no compliance, no SAML, no JSONB, experimental write-RLS. **Confidence: high.**

### 5.14 Nile (Total 58, Migration 5)

**Strengths:** Native multi-tenant page-level isolation. Scale-to-zero. Per-tenant regional placement. SOC 2 on Scale ($350/mo).

**Weaknesses / verdict corrections (high confidence):**
- **Triggers NOT supported; RLS/CREATE POLICY NOT supported; SECURITY DEFINER NOT supported** (verdict verbatim — UDFs unsupported). The three highest-weight server-side dependencies — all absent.
- No realtime/pub-sub/CDC. No object storage, no edge functions. No pg_cron, no cross-tenant atomic transactions.
- Verdict: SOC 2 on Pro is "Coming soon"; **SAML has no doc page (404)** — treat as not-yet-shipped. MFA genuinely available.

**Pricing:** Free $0; Pro $15/mo; Scale $350/mo (SOC2); Enterprise custom.

**Fit:** Wrong choice — no RLS, no triggers, no SECURITY DEFINER. Revisit in 12–18mo. **Confidence: high.**

### 5.15 InstantDB (Total 54, Migration 5)

**Strengths:** Genuine server-enforced per-entity CEL permissions. Excellent multiplayer/presence DX. Offline IndexedDB cache. WAL-tailed subscriptions. Webhooks + idempotency. Apache-2.0 + self-host.

**Weaknesses / verdict corrections (high confidence):**
- Triplestore EAV — no Postgres API, no SQL, no `pg_dump`, complete lock-in.
- **No multi-step ACID transactions with row locking** — the keystone is impossible.
- **No SAML; no SOC2/HIPAA/compliance** — each disqualifying.
- No native edge/serverless functions; no `postgres_changes` (webhooks strip entity links — verdict confirmed). No pgcrypto, no JSONB filtering, no residency. Default allow-all.

**Pricing:** Free $0; Pro $30/mo; Startup $600/mo; Enterprise custom. (Confirmed.)

**Fit:** Poor — fails three of the four highest-weight must-haves. **Confidence: high.**

---

## 6. TCO / Pricing Comparison

> Launch = <500 MAU, tens of GB PDFs, tens of concurrent RT channels. Moderate = ~2–5k MAU, low-single-digit TB, low-thousands peak concurrent RT. "Enterprise floor" = the SOC2/SAML tier the stated target effectively requires.

| Candidate | Launch /mo | Moderate /mo | Enterprise compliance floor | Notes |
|-----------|-----------:|-------------:|------------------------------|-------|
| **Supabase** | $25–75 | $300–900 (usage) | **Team $599/mo** | Binding cost is the plan tier, not usage. |
| **AWS Aurora/RDS** | ~$200–400 | ~$600–1,400 | included in AWS BAA | 3–4x Supabase at startup; SAML no tier gate. |
| **Azure SQL+Entra** | ~$150–350 | ~$1,200–3,500 | Entra P1 $6/user/mo | 5–10x Supabase; cheap Entra SAML if on M365. |
| **Neon** | ~$5–50 | usage (cheaper bursty) | Scale (SOC2+HIPAA) usage-priced | Cheapest at low MAU; CDC kills scale-to-zero. |
| **Xata** | ~$9–50 / $0 self-host | ~$100s | BYOC custom | Plus Auth0/Ably/S3 vendors. |
| **PlanetScale** | $5–50 (cluster) | $50–609 (cluster) | SSO $199/mo (dashboard-only) | Plus four platform vendors. |
| **CockroachDB** | $15 credit → usage | $259–1,728+ (corrected) | SOC2 across tiers | Plus four vendors; RLS+CDC blocker. |
| **Cloudflare D1+Stack** | ~$5 base | usage; free R2 egress | Access $3/user/mo | 10GB DB ceiling; full rewrite. |
| **SpacetimeDB** | $0–25 | $250 (Team) | none (no SOC2) | Cheap, no compliance. |
| **Turso** | $0–25 | ~$417 (Pro) | Pro SOC2/HIPAA | Not PG-compatible. |
| **Convex** | $0–25/dev | $2,500/mo (Business floor) | $2,500/mo | Most expensive enterprise floor. |
| **Firebase** | usage | read-amplification penalty | Identity Platform $/MAU | EU residency blocker. |
| **Nile** | $0–15 | $350 (Scale) | Scale $350 (unverified) | Missing RLS/triggers/SECURITY DEFINER. |
| **InstantDB** | $0–30 | $600 (Startup) | none | No SAML, no compliance. |
| **Electric/PowerSync** | +$49–249 on top of Supabase | +$599 (PowerSync Team) | PowerSync Team SOC2/HIPAA | Additive — increases total cost. |

**Headline:** Supabase is the cheapest *complete* platform at both scales, and at the enterprise target the binding cost (Team $599/mo) buys the compliance story rather than raw usage. Every Postgres-compatible alternative that looks cheaper at the DB line (Neon, Xata, PlanetScale) requires bolting on 3–4 paid vendors, erasing the apparent savings and adding operational surface.

---

## 7. Migration Effort & Risk

| Candidate | Effort | Schema portable? | Top risk |
|-----------|:--:|:--:|----------|
| Supabase | 1 | N/A | None — nothing to migrate. |
| AWS Aurora/RDS | 5 | **Yes (zero SQL changes)** | 128KB WebSocket → Yjs chunking; `auth.uid()`→session-var across 134 policies; transition security gap. |
| Azure SQL+Entra | 5 | No (T-SQL rewrite) | Full T-SQL rewrite (6–12mo); 20s CDC latency; CDC-RLS row leak. |
| Neon | 5 | Yes | No broadcast plane; SAML external; storage/compute previews; CDC disables scale-to-zero. |
| Xata | 5 (4 additive) | Yes | No auth/realtime/storage/functions; `auth.uid()` rewrite; 3–4 vendors. |
| PlanetScale | 5 | Yes | Four missing pillars; philosophy hostile to RLS. |
| CockroachDB | 5 | Mostly | **RLS+CDC mutual exclusion**; CDC DELETE no before-image. |
| Convex | 5 | No | App-layer RLS IDOR; no Yjs; 20MB PDF cap; no FOR UPDATE. |
| Cloudflare D1 | 5 | No (SQLite) | 10GB ceiling; fail-open RLS; no ACID keystone path. |
| Firebase | 5 | No (NoSQL) | JOIN-based RLS impossible; async triggers; EU Auth blocker; 1MiB doc cap. |
| Turso | 5 | No (SQLite) | Five missing pillars; not PG-compatible. |
| SpacetimeDB | 5 | No | No SOC2/SAML; experimental write-RLS; no JSONB. |
| Nile | 5 | Partial | **No RLS, no triggers, no SECURITY DEFINER**; no realtime/storage/functions. |
| InstantDB | 5 | No (EAV) | No ACID RPC; no SAML; no compliance. |
| Electric/PowerSync | 4 | Yes (keeps PG) | Additive only; immature Yjs provider; Sync-Rules/RLS drift; Electric no SOC2. |

**Cross-cutting risk:** For any *non-Postgres* target, the permission model must be rebuilt in an application trust boundary — a genuine **security regression** for the enterprise target, plus a window of weakened enforcement during transition. For any *Postgres-compatible* target, you keep the database but lose the platform (Auth/Realtime/Storage RLS/Edge Functions all rebuilt). The `excel-apply-changeset` keystone is the single hardest thing to port; only Postgres-compatible targets (Aurora, Neon, PlanetScale, Xata) preserve it without redesign.

---

## 8. Final Decision & Conditions

**Decision: STAY ON SUPABASE.** Supabase scores 246/250 with migration effort 1; next-best replacement (Aurora) scores 186 with effort 5. No candidate addresses the locked perf bottleneck (the renderer, not the DB), and every alternative forces either a security-model rebuild (non-Postgres) or a platform rebuild (Postgres-compatible).

**One candidate to keep on the shelf: AWS Aurora Serverless v2 / RDS Postgres** — the only target that preserves the entire Postgres investment with zero SQL changes while remaining a credible enterprise platform.

**Switch to Aurora ONLY IF one of these hard conditions becomes true:**
1. An enterprise customer contractually mandates AWS-region data residency, FedRAMP, or an AWS-only BAA that Supabase cannot satisfy.
2. (Azure variant) An enterprise customer mandates Azure-only hosting — target **Azure Database for PostgreSQL Flexible Server**, NOT Azure SQL, to preserve the schema.
3. Supabase pricing/availability becomes untenable and a Postgres-compatible exit is forced — Aurora/Neon/Xata keep complexity "hard" (keep the DB, rebuild the platform) rather than "rewrite-the-security-model" catastrophic.

**Before any switch:** prototype the Yjs transport replacement (Hocuspocus + a broadcast plane handling >128KB frames) and validate `auth.uid()` → session-variable injection against the live `excel-apply-changeset` keystone under concurrency. Do not begin until the Syncfusion/pdf.js renderer migration has confirmed the real perf ceiling.

**Operational note (no migration):** the only "migration" Supabase requires for the enterprise pitch is a plan-tier change Pro → Team ($599/mo) to unlock SOC2 report access + SAML — a dashboard change. Flag the **SLO-not-supported** SAML gap and the **500-connection Team cap** to enterprise buyers proactively.

---

## 8b. Recommended actions INSTEAD of migrating (convergent second-opinion review, 2026-06-28)

An independent second-opinion review reached the same verdict (stay on Supabase; Neon = best DB-only alternative; Convex/SpacetimeDB = high rewrite; Firebase/Turso/D1 = poor fit; AWS = strongest full replacement but heavy infra) and surfaced concrete optimizations that beat any migration on ROI:

1. **Switch the Yjs Broadcast transport from base64-in-JSON to native binary Broadcast.** ✅ **VERIFIED + already eligible.** Supabase Realtime Broadcast now accepts binary payloads (raw `ArrayBuffer`/`Uint8Array` frames over WebSocket; the `application/octet-stream` content-type applies to the REST-Broadcast path, not WS), auto-received from **supabase-js ≥ 2.91.0**. Installed version is **2.104.0** (the `package.json` range `^2.81.1` resolves to 2.104.0 in the lockfile), so no upgrade is needed. The current `SupabaseYjsProvider.js` still does `uint8ArrayToBase64` (`SupabaseYjsProvider.js:81`, plus ~77–93, 224, 260) and pays a ~33% inflation tax — the `SOFT_PAYLOAD_CAP_BYTES = 600KB` pre-base64 → ~800KB on the wire. ⚠️ **Two corrections to the in-code assumptions (both now stale):** (a) the provider comment says "Supabase Broadcast is JSON-only" — no longer true since supabase-js 2.91.0; (b) the comment cites a "~1MB Broadcast ceiling" — **that 1,024 KB figure is the *Postgres Changes* payload limit, not Broadcast.** Actual **Broadcast** payload size is **Free 256 KB · Pro/Team 3,000 KB (~3 MB) · Enterprise 3,000+ KB** (source: Supabase Realtime limits docs). So on Pro/Team there is ~3 MB of headroom and the 600 KB soft cap is far more conservative than necessary — dropping base64 *and* raising the cap toward the real ceiling removes nearly all large-frame fallbacks. ⚠️ **Rollout caveat:** binary payloads are **silently dropped** for clients on supabase-js < 2.91.0 — safe here because the Electron app ships one controlled SDK version, but any mixed-version rollout (web + old desktop builds) must gate on a capability flag. _(The stale "JSON-only / ~1MB" comments live in `SupabaseYjsProvider.js`; correct them as part of the actual binary-Broadcast change rather than as a standalone edit.)_
2. **Add/expand RLS regression tests.** The single biggest *real* risk is that RLS — the sole permission layer (~134 policies) — silently regresses. This is cheaper and higher-value than any platform change. Test owner/editor/viewer matrices + the `update_rejected`/42501 path per table.
3. **If PDF storage/egress cost grows, offload blobs to R2/S3, keep Supabase for metadata + RLS.** §6 flagged storage/egress as the largest variable cost line; a hybrid object store (Cloudflare R2 has zero egress fees) controls it without touching the security model. Keep the `documents` row + RLS in Postgres, store the blob externally behind a signed-URL edge function.
4. **If collaboration becomes painful post-renderer, evaluate PowerSync / Electric / Liveblocks as an ADD-ON** over the existing Postgres — never as a DB replacement. (See §5.5.)

These are the actual roadmap items this evaluation produces. The migration analysis (§1–8) stands; this section is what to *do* given "stay."

---

## 9. Confidence & Data-Quality Notes

All 15 verdicts returned overallConfidence: high. Material corrected/low-confidence items:

- **Supabase:** Team 10K-connection claim **refuted** (Pro/Team = 500 + overage); ISO 27001 unverified; SLO not supported; edge-function count limits omitted. **Realtime payload limits corrected (2026-06-28):** Broadcast = Free 256 KB / Pro+Team 3,000 KB / Enterprise 3,000+ KB; the 1,024 KB figure is the *Postgres Changes* limit, NOT Broadcast. The "~1MB Broadcast ceiling" referenced in earlier analysis and in the `SupabaseYjsProvider.js` comments conflated the two. Binary Broadcast payloads supported from supabase-js ≥ 2.91.0 (silently dropped for older clients).
- **Aurora:** Postgres 17 support refuted-into-existence; pg_cron skipped under auto-pause; RDS Proxy per-vCPU not per-ACU; composite costs unverified.
- **Azure:** Web PubSub SOC2 scope unverified; per-unit price unverified; "SAML no plan gate" overstated.
- **CockroachDB:** Standard/Advanced monthly estimates **wrong** (per-vCPU rates); pgcrypto **supported** (refuted).
- **Convex:** SOC2 Type I vs Type II conflicting; Node-action 5MB arg sub-limit omitted.
- **Neon:** logical-replication/CDC **available** (refuted "coming soon"); Compute/Storage still preview.
- **Firebase:** per-op pricing **stale**; $0.015/MAU SAML unverified; read-amplification holds.
- **Cloudflare:** Access $3 (not $7); 32MB WS shipped Oct 2025; D1 CREATE TRIGGER broken via migrations.
- **Turso:** ships on libSQL (C fork); free-tier "hard caps" likely allow overages; Pro $416.58.
- **Xata:** Open Source self-host free forever (refuted "no free tier"); Files API still on paid plans.
- **Nile:** SOC2 on Pro "coming soon"; SAML 404 — not-yet-shipped.
- **SpacetimeDB:** real but limited PGWire (profile skepticism too strong); no compliance found.
- **Electric/PowerSync:** Electric Yjs provider experimental; Durable Streams payload-ceiling unverified; Electric no SOC2.
- **PlanetScale:** "$39 Base Plan" is a cluster-price conflation; NOT acquired by Supabase.

### Sources (selected, by candidate)

- **Supabase:** supabase.com/pricing · /docs/guides/realtime/pricing · /docs/guides/realtime/limits · /docs/guides/database/postgres/row-level-security · /docs/guides/auth/enterprise-sso/auth-sso-saml · /docs/guides/functions/limits
- **AWS Aurora:** aws.amazon.com/rds/aurora/pricing · /cognito/pricing · docs.aws.amazon.com/.../ServerlessV2.Feature · /apigateway/.../websocket-limits · /.../aurora-serverless-v2-auto-pause
- **Azure:** learn.microsoft.com/.../change-data-capture-overview · /.../row-level-security · /.../azure-web-pubsub/concept-billing-model · microsoft.com/.../microsoft-entra-pricing
- **Neon:** neon.com/pricing · /docs/guides/logical-replication-kafka-confluent · /docs/guides/row-level-security · /docs/security/compliance
- **PlanetScale:** planetscale.com/pricing · /docs/postgres/extensions · /blog/rls-sounds-great-until-it-isnt · /docs/security/sso
- **CockroachDB:** cockroachlabs.com/pricing · /docs/stable/row-level-security · /docs/stable/change-data-capture-overview · github.com/cockroachdb/cockroach/issues/21001
- **Convex:** convex.dev/pricing · /enterprise · /security · stack.convex.dev/row-level-security · docs.convex.dev/file-storage/serve-files
- **Cloudflare:** developers.cloudflare.com/d1/platform/pricing · /d1/platform/limits · /durable-objects/platform/pricing · /r2/pricing · blog.cloudflare.com/teams-plans
- **Firebase:** firebase.google.com/pricing · /docs/firestore/security/rules-conditions · /docs/functions/firestore-events · /support/privacy
- **Turso:** turso.tech/pricing · docs.turso.tech/libsql · /blog/introducing-change-data-capture
- **SpacetimeDB:** spacetimedb.com/pricing · /docs/how-to/rls · /docs/docs/sql/pg-wire
- **Xata:** xata.io/pricing · /security · /blog/changes-free-tier
- **Nile:** thenile.dev/pricing · /docs/postgres/postgres-compatibility · /docs/auth/introduction
- **InstantDB:** instantdb.com/pricing · /docs/permissions · /docs/webhooks · /essays/architecture
- **Electric/PowerSync:** electric.ax/pricing · /docs/integrations/yjs · powersync.com/pricing · docs.powersync.com/.../rls-and-sync-rules

*All pricing as of 2026-06-28. Items flagged "unverified" in §9 should be re-checked at the live source before use in sales collateral.*
