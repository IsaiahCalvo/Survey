# KAL-261 — Baseline + Dedup-Preview Report (read-only ground truth)

Generated 2026-06-11T14:38:44.892Z (attempt 1) against `cvamwtpsuvxvjdnotbeg.supabase.co` — GET-only, zero writes.

## Validation vs audit expectations

| Claim | Expected | Observed | Verdict |
|---|---|---|---|
| heavy doc 70dadd86… unique embedded refs | 3056 | 3056 | CONFIRMED |
| heavy doc 70dadd86… raw embedded rows | 24449 | 24448 | MISMATCH |
| total user-drawn marks (~) | 489 | 615 | MISMATCH |
| SE-011-ARCH 97f95b32… user-drawn | 388 | 388 | CONFIRMED |
| Package2-ARCH d30ac66b… user-drawn | 30 | 30 | CONFIRMED |
| table total at audit time (~, drift expected) | 53216 | 53229 | CONFIRMED |

## Snapshot stability

Cutoff `created_at <= 2026-06-11T14:38:44.892Z`; before/after row count 53229/53229, max updated_at 2026-06-10T21:32:37.147345+00:00 / 2026-06-10T21:32:37.147345+00:00 — no drift detected during the run. 54 keyset pages of ≤1000.

## Anomaly buckets

None. Every row classified cleanly (boolean import flags, integer pages, dedupable embedded refs).

## Survivor-policy divergence (DECISION INPUT for Isaiah / Step 3)

1244 of 10960 dedup keys pick a different survivor under the three candidate policies (`app_exact` = shipping preferFabricRow semantics; `latest_updated_at`; `latest_created_at` = readiness-doc Step-3 wording). KAL-266 must pick ONE policy; this baseline records all three so the choice stays data-informed. Note for Step 4: the planned `import:<page>:<pdfAnnotationId>` deterministic ID scheme is delimiter-ambiguous if a pdfAnnotationId ever contains `:`; this baseline keys on JSON tuples — recommend Step 4 hash or base64url-encode components.

## What downstream tasks consume

- **KAL-260 (backup)**: nothing consumed; this report confirms current row counts to verify the backup against.
- **KAL-262 (zero-loss harness)**: `user_drawn_marks_checkpoint.json` (per-mark payload_sha256, hash_scheme header) and `embedded_dedup_survivors.json` (per-key survivor hashes, all three policies). The harness must reproduce the documented hash scheme byte-exactly.
- **KAL-266 (snapshot bootstrap)**: per-doc expected counts in `migration_baseline.json` + the survivor-policy decision above.

## Output integrity

- `user_drawn_marks_checkpoint.json` sha256 `f486c4de5adf6e6b938f3b168d7f0a3b06366c33ddb47c3bc748a7256cae8d2f`
- `embedded_dedup_survivors.json` sha256 `b022cf128c7b9e2cad658abd3c67d63d6f107ec57f64bb18a765618b8d782f84`
- `migration_baseline.json` sha256 `4673619ca2cd62a0ff62e730639d55d0c7125492e4f74e06b6b63a030a49d57e`
## Analyst addendum — mismatch reconciliation (2026-06-11, manual; re-running the script overwrites the sections above but not the conclusions here)

Both MISMATCH rows are explained and neither indicates data loss:

1. **Total user-drawn 615 vs ~489.** The audit's ~489 was computed against a 66-document table; production now holds 120 documents. The extra ~126 user-drawn marks sit on e2e/diag artifacts created by live-contract test runs since the audit (three `Fix19 Live Contract …` docs at 8 marks each, `Fix19 Survey Region Contract` ×2, `Fix26 RLS Live Validation`, `KAL-bundle-UAT…`, `test.pdf`/`sync-test.pdf`/`clickable-link-test.pdf`, etc. — full list in `migration_baseline.json` documents[]). Every irreplaceable real-work number matches EXACTLY: SE-011-ARCH 97f95b32 = 388, Package2-ARCH d30ac66b = 30, and SE-011 live 00e1cde9 = 51 (the precise Step-7 dual-write baseline from PRE-REBUILD-READINESS §4).
2. **70dadd86 embedded 24,448 vs 24,449.** The doc's TOTAL is 24,450 exactly as audited, but it splits 2 user-drawn + 24,448 embedded, not 1 + 24,449. One row carries no `isPdfImported=true` flag under both the SQL and strict-boolean predicates (anomaly buckets are empty), so it is genuinely user-drawn-classified. The acceptance-critical number — **3,056 unique embedded refs — is exact**, and the dupe factor is 8.0 (8 full re-import sessions surviving, audit estimated 9 sessions over a slightly different raw count).

Additional planning-relevant observations:

- **00e1cde9 ("SE-011 live") is now `archived: true`.** Step 7 plans its dual-write validation on this doc as the "live" document. If it stays archived, the §7 archived-doc decision and the Step-7 target choice interact — flag for Isaiah before KAL-268.
- **Survivor-policy divergence is material, not theoretical**: 1,244/10,960 keys (11.3%), 748 of them on 70dadd86. KAL-266 must not treat the policy choice as a cosmetic default.
- **content_sha256 is absent on all legacy docs** (e.g. 70dadd86) — confirms Step 6 backfill is still pending, as planned.
- Embedded totals for KAL-262: 52,614 raw embedded rows → 10,960 unique keys table-wide.
