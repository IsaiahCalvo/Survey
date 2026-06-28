# DB / Backend Re-Evaluation — One-Page Summary

**Date:** 2026-06-28 · Full report: [`REPORT.md`](./REPORT.md)

## Recommendation: STAY ON SUPABASE

Re-evaluated against 14 alternatives. Supabase scores **246/250 (migration effort 1)**; the next-best replacement (AWS Aurora) scores **186 (effort 5)**. The coupling is server-side, not at the SDK surface: ~134 RLS policies (the *sole* permission layer), ~50 SECURITY DEFINER RPCs incl. the LIVE `excel-apply-changeset` ACID keystone, 25+ triggers, and the purpose-built Yjs-over-Broadcast + `postgres_changes` + JWT-`setAuth` realtime stack. Every alternative forces either a **non-Postgres rewrite** (rebuild the security model in an app trust boundary = security regression) or a **Postgres-compatible swap** (keep the DB, rebuild Auth/Realtime/Storage/Functions). None addresses the locked perf bottleneck (the renderer, not the DB). The only Supabase "migration" needed for the enterprise pitch is a Pro → Team ($599/mo) plan change for SOC2 + SAML — a dashboard click, not a project.

## Score Table

| Rank | Candidate | Total /250 | Migration Effort | Verdict |
|:--:|-----------|:--:|:--:|---------|
| 1 | **Supabase** | **246** | 1 | KEEP — correct + only-justified choice |
| 2 | AWS Aurora/RDS Postgres | 186 | 5 | Best alternative; contingency only |
| 3 | Azure SQL + Entra ID | 155 | 5 | Only if Azure-only mandated (use Azure PG, not Azure SQL) |
| 4 | Neon | 152 | 5 | Great PG layer, not a platform; complement/contingency |
| 5 | Xata | 148 | 5 | Vanilla PG + branching, but no auth/realtime/storage/functions |
| 6 | PlanetScale | 130 | 5 | Excellent DB, philosophy hostile to RLS |
| 7 | CockroachDB | 115 | 5 | RLS+CDC mutual exclusion = hard blocker |
| 8 | Cloudflare D1+Stack | 97 | 5 | SQLite; 10GB cap; fail-open RLS |
| 9 | Convex | 87 | 5 | Rejection 2026-06-06 strengthened (app-layer RLS IDOR, no Yjs, 20MB cap) |
| 10 | Firebase/Firestore | 76 | 5 | JOIN-RLS impossible; async triggers; EU Auth blocker |
| 11 | SpacetimeDB | 72 | 5 | No SOC2/SAML; experimental write-RLS |
| 12 | Turso (libSQL) | 68 | 5 | Not PG-compatible; 5 missing pillars |
| 13 | Nile | 58 | 5 | No RLS, no triggers, no SECURITY DEFINER |
| 14 | InstantDB | 54 | 5 | No ACID RPC, no SAML, no compliance |
| — | Electric/PowerSync | 159* | 4 | *Additive sync layer, NOT a replacement |

\* Electric/PowerSync sit *over* your own Postgres — they keep Supabase, don't replace it. Worth revisiting only *after* the renderer migration confirms the perf ceiling (PowerSync is the stronger of the two).

## Top 3 Alternatives (if a switch is ever forced)

1. **AWS Aurora Serverless v2 / RDS Postgres** — only candidate preserving the full Postgres investment (schema/RPCs/triggers/RLS/pgcrypto/pg_cron/JSONB/FOR UPDATE) with zero SQL changes + strongest compliance (FedRAMP, GovCloud, AWS BAA). Switch *only if* an enterprise contract mandates AWS-region residency/FedRAMP/AWS BAA. Blockers: 128KB WebSocket ceiling (Yjs chunking), `auth.uid()`→session-var across 134 policies.
2. **Azure DB for PostgreSQL Flexible Server** (not Azure SQL) — switch *only if* Azure-only hosting is contractually required; native Entra SAML is a strong M365-target fit, and the PG variant preserves the schema.
3. **Neon / Xata** — pure-Postgres exit targets if Supabase pricing/availability ever becomes untenable; keep the DB, rebuild the platform layer (auth/realtime/storage/functions).

**Prior decision reconciliation:** The 2026-06-06 Convex rejection (renderer, not DB, was the bottleneck) holds and is reinforced — this broader 15-way re-evaluation reaches the same conclusion with more evidence.
