# KAL-262 — Zero-Loss Verification Harness, DRY-RUN Report (no writes)

Generated 2026-06-11T16:44:22.390Z against `cvamwtpsuvxvjdnotbeg.supabase.co` — GET-only, all Y.Doc work in-memory, zero writes. Verdict: **PASS** (exit 0).

## Acceptance (ticket: passes for every user-drawn mark; dedup counts match Step-1)

| Check | Expected | Observed | Verdict |
|---|---|---|---|
| user-drawn marks anchored to baseline | 615 | 615 | PASS |
| — of which survey-marker (no Y.Doc path in today's app) | 403 | 403 | PASS |
| — of which callout (dedicated callouts map) | 11 | 11 | PASS |
| embedded dedup keys | 10960 | 10960 | PASS |
| heavy doc 70dadd86… embedded unique | 3056 | 3056 | PASS |
| per-doc count cross-checks vs migration_baseline | pass | true | PASS |
| documents × policies round-trip verified | 68 × 3 | all pass | PASS |
| negative self-test (verifier can fail) | 7/7 | 7/7 | PASS |

## Stale-baseline guard

Live table: 53229 rows (baseline 53229), max updated_at 2026-06-10T21:32:37.147345+00:00 (baseline 2026-06-10T21:32:37.147345+00:00) — snapshot MATCHES. Post-cutoff rows: 0 (exact_filtered_count). The live table still IS the baseline.

## Baseline anchoring (fresh pull vs committed checkpoints)

- User-drawn: 615 matched, 0 drift-explained, 0 UNEXPLAINED.
- Embedded keys (all three policies): 10960 matched, 0 drift-explained, 0 UNEXPLAINED.
- Anomaly buckets in the fresh pull: none.
- Pinned-universe pull: 54 keyset pages.

## Self-test detections

- DETECTED — tampered survey-marker payload field → hash_mismatch
- DETECTED — deleted user-drawn mark → missing_mark
- DETECTED — deleted embedded key → missing_embedded_key
- DETECTED — extra embedded key → extra_key
- DETECTED — callout in wrong map → wrong_map
- DETECTED — wrong survivor on divergent key → hash_mismatch
- DETECTED — bridge-shaped stub entry → unreconstructable_entry

## Shape compatibility (DECISION INPUT for KAL-266 — verified in code, not decided here)

Two distinct gaps between this dry-run's zero-loss payload (the full normalized row) and what the live app reads today:

1. **Hash-domain completeness.** The live bridge shape (`crdtAnnotationBridge.js:249-303`: nested `{id, type, pageNumber, fabric, meta}` Y.Maps; callouts `{id, type, pageNumber, callout, meta}`) carries the fabric JSON plus scalars — NOT `user_id`, `annotation_type`, `page_number`, `document_id`, or non-fabric `annotation_data` siblings. Neither shape can reconstruct the row, so neither can pass zero-loss verification as-is. KAL-266 must either store full-row payloads and adapt the reader, or define a richer bridge shape. The verifier core takes a pluggable entry adapter so Step 5 verifies whichever shape is chosen.
2. **Representability.** The live fan-out (`useAnnotationCloudSync.js` Pitfall 30-4) deliberately excludes survey-marker and callout types from `getMap('annotations')`. **403 of 615 user-drawn marks are survey-markers with no Y.Doc representation today**; callouts are renderable via their dedicated map but not hash-domain complete. Reader paths for both must exist before cutover.

## Open decisions (restated, not advanced)

- Survivor policy (KAL-266): all three policies verified here; 1,244/10,960 keys divergent — the choice is material.
- Archived-document policy (§7/B3) and Step-7 dual-write target (00e1cde9 is archived).
- Step-4 deterministic embedded ID encoding: `import:<page>:<id>` is delimiter-ambiguous; this dry-run keys embedded entries by the canonical JSON tuple. Recommend hash or base64url-encoded components.

## What Step 5 reuses

`verifyDocument(extractedMaps, adapter, expectations, policy)` + `buildExpectations` + the integrity gate are input-agnostic: feed them maps extracted from a deserialized snapshot read back from the Yjs state table instead of the in-memory materialization, swap the adapter for the final payload shape, and the same refusal semantics apply (any diff ⇒ do not promote that document; keep it on the flat-table read path).
