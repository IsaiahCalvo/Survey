# Plan Review Log: KAL-261 baseline + dedup-preview queries (read-only ground truth)
Started 2026-06-11 10:07 (autonomous loop session). MAX_ROUNDS=5. PLAN_FILE=PLAN-KAL261.md.

## Round 1 — Codex
14 findings, VERDICT: REVISE. Full critique:

- /rest/v1/ prefix still permits /rpc/* and arbitrary tables with service-role → whitelist only document_annotations + documents; reject /rpc/, bodies, non-GET.
- Shell env can retarget project → hard fail unless host is cvamwtpsuvxvjdnotbeg.supabase.co.
- created_at cutoff handles inserts only; updates/deletes skew multi-pass → before/after exact count + max updated_at; abort/retry on drift.
- Second full-payload fetch can differ from first pass → fetch by first-pass PK list, assert identical ID sets.
- Dedupe must use effective page (annotation_data.pageNumber ?? page_number per annotationTypeSerializers.js:96) → use effective page, flag mismatches.
- No deterministic survivor recorded; readiness says created_at-latest, app prefers updated_at (:108) → record survivor per key, tie-break by id.
- Hash over only annotation_data misses survey-marker top-level fields (documentSurveyMarkerMapper.js:69-93) → hash full reconstructable row.
- Raw hash vs Y.Doc payload divergence (deserializer adds fabricObject.data.id; clientSessionId volatile) → define normalized hash domain explicitly.
- Embedded payload validation missing → add embedded dedup survivor checkpoint.
- Rows with pdfAnnotationId but isPdfImported !== true silently user-drawn → anomaly bucket.
- import:<page>:<id> key encoding can collide on delimiters → JSON tuple keys internally; note Step-4 risk.
- Observability thin → page counts, first/last IDs, Content-Range, predicates, output SHAs, retries, anomaly totals.
- Output-leak guard missing → assert committed JSON has no raw payloads/secrets.
- Generic gates only → targeted unit tests (whitelist, hash vector, drift logic).

### Claude's response
Verified the two code citations (annotationTypeSerializers.js getPdfImportDedupeKey/preferFabricRow; documentSurveyMarkerMapper.js top-level reconstruction) — both accurate. ACCEPTED all 14. One adaptation: rather than unilaterally picking a survivor policy (finding 6), the checkpoint records survivors under BOTH policies (app updated_at-latest + readiness created_at-latest, PK tie-break) with divergence flags, and the report surfaces the policy choice to Isaiah — it's a Step-3 (KAL-266) decision this baseline should inform, not pre-empt. Plan rewritten (r1).

## Round 2 — Codex
5 findings, VERDICT: REVISE:
- ->> returns strings, JS truthiness makes "false" embedded → strict parse.
- dataPageNumber type not pinned; JSON/text number mismatch splits dedupe keys → parse finite integers, flag invalid.
- Survivor policy omits app's non-survey-marker preference (preferFabricRow) → record app_exact policy.
- Embedded survivor hash includes annotation_id but Step 4 mints deterministic IDs → class-specific hash domains (keep annotation_id for user-drawn, exclude for embedded).
- Leak guard substring scan false-fails on hash_scheme docs → structural key-path inspection only.

### Claude's response
ACCEPTED all 5. Switched pass-1 projections to JSON-typed `->` (types preserved at source, classification = strict `=== true`); pinned effective page to finite integers with anomaly buckets; added app_exact as a third recorded survivor policy (deterministic PK-asc iteration); split hash domains by class; leak guard now walks parsed object keys with hash_scheme header exempt. Plan rewritten (r2).

## Round 3 — Codex
VERDICT: APPROVED. Two non-blocking nits: "both policies" wording → "all three"; hash header should explicitly state disposition of nested embedded Fabric IDs (fabricObject.id / annotationId / data.id).

### Claude's response
Both nits applied: wording fixed; hash_scheme header now explicitly documents that nested IDs are preserved inside the hash (only top-level annotation_id is class-excluded for embedded). Plan FINAL (r3). Proceeding to implementation per loop protocol.

## Result review — Codex round 1
VERDICT: APPROVED, no blocking findings. Codex verified: read-only safety (single GET helper, whitelist, host pin, no supabase-js, no mutating calls); PAGE_SIZE 1000 deviation sound (54 pages sum to 53,229); unfiltered drift snapshot safe direction; output internal consistency (per-doc totals sum, survivor candidates sum 52,614); key targets exact (3,056 / 388 / 30 / 51); leak guard clean, hashes valid. Two non-blocking notes: report addendum lost on rerun (accepted — documented in the addendum itself); totals.documents label ambiguous.

### Claude's response
Fixed the label (totals.documents_total=120 + documents_with_annotations=68), regenerated outputs (deterministic — identical numbers, zero drift again), re-applied the addendum. RESULT FINAL.
