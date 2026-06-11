# PLAN-KAL262 — Zero-loss verification harness (dry-run, NO WRITES)
_Round 2 — revised after Codex reviews r1 (13 findings) + r2 (3 findings)_

**Ticket:** KAL-262 (Urgent). PRE-REBUILD-READINESS.md §2.6 + §4 Step 5, Gate B4.
**Acceptance:** harness passes for every user-drawn mark in dry-run; dedup counts match Step-1 (KAL-261) expectations.
**Consumes:** the KAL-261 committed checkpoints in `.planning/optimization/migration-baseline/`:
`user_drawn_marks_checkpoint.json` (615 marks, per-mark `payload_sha256`, hash_scheme header),
`embedded_dedup_survivors.json` (10,960 keys × 3 survivor policies, per-key survivor hashes),
`migration_baseline.json` (per-doc expected counts, snapshot stats, output sha256s).
**Hard constraint:** zero writes of any kind — GET-only HTTPS, no `/rpc/`, no supabase-js, no request
bodies, `doc_yjs_state`/`doc_yjs_updates` untouched. All Y.Doc work is in-memory.

## Why this shape

Step 5 (the real migration verifier) will deserialize a *written* `doc_yjs_state` snapshot and verify it
against the pre-migration baseline. Gate B4 demands the same verifier be built and run **before** any
writes, against computed deduped sets. So the harness is two reusable halves:

1. **Materializer (dry-run stand-in for Step 4):** per document, compute the deduped canonical set
   (Step-3 logic) and build an in-memory `Y.Doc` from it.
2. **Verifier core (`verifyDocument`)** — shape-pluggable: takes the extracted Y map contents, an
   **entry adapter** (`extractedEntry → hashable normalized row, or null if unreconstructable`), and the
   baseline expectations; returns a structured verdict. In this task the adapter is identity (see payload
   shape below); in Step 5 the same function verifies whatever shape KAL-266 finalizes, by swapping the
   adapter. It REFUSES (verdict FAIL + typed diff log) — never throws on mismatch, never fudges.

### Payload shape decision (Codex r1 findings 1/2/11 — verified in code)

The live bridge (`src/lib/collab/crdtAnnotationBridge.js:249-303`) stores nested Y.Maps
`{ id, type, pageNumber, fabric: Y.Map(fabric JSON), meta: Y.Map(authorId/deviceId/createdAt/...) }`,
and the live fan-out (`useAnnotationCloudSync.js:670-`, Pitfall 30-4) **deliberately excludes
survey-marker and callout types** from `getMap('annotations')`. That shape carries only the fabric JSON
plus a few scalars — NOT the full DB row (`user_id`, `annotation_type`, `page_number`, `document_id`,
and any non-fabric `annotation_data` siblings are absent). Two distinct gaps, kept separate in the
report: (1) **hash-domain completeness** — neither the `annotations` bridge shape nor the `callouts`
shape (`{id,type,pageNumber,callout,meta}`, which DOES exist as an app read path) can reconstruct the
full normalized row, so neither can pass zero-loss verification as-is; (2) **representability** —
survey-markers (403/615 user-drawn) have NO Y.Doc path at all today (live fan-out excludes them);
callouts ARE representable/renderable via their dedicated map, just not hash-domain complete.

Consequence, made explicit (this is decision INPUT for KAL-266, not a decision): a zero-loss migration
cannot target today's bridge shapes as-is. The dry-run materializes the only shape that satisfies the
zero-loss criterion: **value = the full normalized DB row (the hash domain object)** — user-drawn:
`normalizeRowForHash(row)` (default normalization, `annotation_id` retained inside), keyed by original
`annotation_id`; embedded survivors: `normalizeRowForHash(row, { excludeAnnotationId: true })` (the
scheme's class-specific domain), keyed by the canonical JSON tuple (Step-4 ID encoding deliberately not
locked in; delimiter-ambiguity finding restated).
Survey-markers and callouts are **explicitly materialized** (no inherited live-fan-out exclusion);
callout-typed rows go to map `callouts`, everything else to `annotations` (the app's map split). The
report gets a dedicated **shape-compatibility section**: field-coverage delta between today's bridge
shape and the full row, the survey-marker/callout reader gap, and the requirement that KAL-266 either
store full-row payloads and adapt the reader, or define a richer bridge shape — with the verifier
adapter as the hook either way.

Rejected (Codex r1 finding 2's second alternative): storing a `payload_sha256` sidecar in the Y.Doc and
comparing hash *strings* — the verifier would pass on corrupted payloads. Hashes are ALWAYS recomputed
from stored content via the adapter.

## Byte-exact hash reproduction

By construction: the harness imports the generator's own functions from
`scripts/kal261-baseline-dedup-preview.mjs` (`canonicalStringify`, `normalizeRowForHash`, `payloadHash`,
`pickSurvivors`, `aggregate`, `classifyImportFlag`, `resolveEffectivePage`, `makeRoGet`,
`assertNoLeaks`, `HASH_SCHEME`). The same-code-both-sides circularity is intentional (migration compares
pre vs post under ONE scheme) and is anchored three ways: (a) the three baseline files' sha256 are
**pinned as literal constants** in the harness (values from KAL-261-BASELINE-REPORT.md) — not read from
`migration_baseline.json`, which would let a tampered baseline self-certify; (b) each checkpoint's
embedded `hash_scheme` must deep-equal the imported `HASH_SCHEME`; (c) a pinned known-answer hash vector
in the unit tests catches any accidental scheme change in the shared code.

## Files

- **`scripts/kal262-zero-loss-harness.mjs`** (new) — the harness. Pure helpers exported for tests.
- **`scripts/kal261-baseline-dedup-preview.mjs`** (touch, export-only) — add `export` to
  `snapshotTable`, `fetchAllPass1`, `fetchFullRowsByIds`, `DriftError`. No behavior change; existing
  tests stay green. (`runOnce` and its pass1-count-vs-live-total assert are NOT reused — see drift.)
- **`tests/kal262ZeroLossHarness.test.mjs`** (new) — unit tests, no network.
- **Outputs (committed):** `.planning/optimization/migration-baseline/KAL-262-DRYRUN-REPORT.md`
  + `kal262_dryrun_verdicts.json`. **Atomic writes:** build in temp files, leak-check, rename into place
  only on success — a failed run never deletes or truncates previously committed outputs.

No `src/` changes. Test-harness work → cap-free.

## Run phases

**A — Checkpoint integrity gate.** Read the three baseline JSONs. Recompute each file's sha256 and
require equality with the **pinned literals** (all three files, including `migration_baseline.json`
itself). Require `hash_scheme` deep-equality with the imported constant. Refuse to run on any mismatch.

**B — Fresh read-only pull, cutoff PINNED to the baseline.** HTTPS-origin assert
(`https://cvamwtpsuvxvjdnotbeg.supabase.co` exactly) before `makeRoGet`. Two-pass flow via the reused
primitives with `created_at <= migration_baseline.generated_at` (2026-06-11T14:38:44.892Z) — the same
row universe as the baseline, so post-baseline inserts never enter the comparison. Keyset pages ≤1000;
pass-2 full payloads for user-drawn ids + the union of survivor ids across all three policies, with
id-set equality assert. **Stale-baseline guard (no false exit-0):** the pinned universe alone could
verify 615/615 while a mark drawn after 14:38Z exists outside it. So Phase B also takes the live
snapshot (total + max updated_at) AND an exact count of `created_at > cutoff` rows (cheap: count-only
HEAD-style GET; if the timestamp-filtered count times out, fall back to live-total minus pinned-universe
count). ANY of: snapshot ≠ baseline `run.snapshot_before`, post-cutoff count > 0, or drift-explained
Phase-D diffs ⇒ the run cannot exit 0 — best outcome exit 2 ("table moved past the baseline:
re-baseline before migration"), with post-cutoff rows counted per document in the report. Within the
pinned universe, the authority for change detection remains the full per-id/per-hash comparison in
Phase D (a balanced insert+delete or an in-place edit that doesn't move max(updated_at) escapes the
snapshot heuristic but cannot escape an id+hash diff).

**C — Recompute ground truth from the fresh pull.** `aggregate` + `pickSurvivors` + per-class hashes —
the generator's own code paths.

**D — Baseline anchoring (fresh vs committed checkpoint).**
- User-drawn: identical id set; per-id identical `payload_sha256`.
- Embedded: identical dedup-key set; per key, identical survivor id + `payload_sha256` under EACH of the
  three policies (none pre-empted; KAL-266 stays open).
- Per-doc counts vs `migration_baseline.json.documents[]` (`user_drawn`, `embedded_unique`).
- **Drift discipline (anti-masking):** every difference must be POSITIVELY attributed or it is FAIL.
  - Baseline id missing from the fresh pull → **direct by-id GET**: row still present with
    `created_at <= cutoff` ⇒ the harness's own fetch dropped it ⇒ UNEXPLAINED FAIL; row absent ⇒
    DRIFT-EXPLAINED post-baseline deletion (listed id-by-id).
  - Hash mismatch on a present row → DRIFT-EXPLAINED only if that row's `updated_at` > baseline cutoff
    (post-baseline in-place edit); same-or-older `updated_at` with different content ⇒ UNEXPLAINED FAIL.
  - Fresh-pull id absent from baseline (created_at ≤ cutoff but not in checkpoint) ⇒ UNEXPLAINED FAIL
    (the baseline missed it or the universe shifted — either is disqualifying).
  - DRIFT-EXPLAINED-only runs exit with a distinct code and an explicit "re-baseline (re-run KAL-261,
    update pinned hashes) before migration" instruction — never silently passed.

**E — Materialize per document × per policy (3 in-memory Y.Docs per doc).** As per the payload-shape
decision above. One doc at a time, sequentially; freed after verdict (memory envelope ≈ KAL-261's
~11.6k full rows).

**F — Round-trip + verify (the §2.6 core).** `Y.encodeStateAsUpdate(doc)` → `Y.applyUpdate(fresh)` →
extract both maps → `verifyDocument(extractedMaps, adapter, expectations)` asserts, per doc per policy:
- (a) every user-drawn mark from the CHECKPOINT present by original `annotation_id`, in the
  type-correct map (survey-markers asserted present by name in the report's acceptance table);
- (b) embedded entry count === the doc's expected deduped count (checkpoint-derived, cross-checked
  against `migration_baseline.json.documents[].embedded_unique`);
- (c) per-entry payload hash recomputed **from extracted content** via the adapter and required equal
  to the COMMITTED checkpoint hash (user-drawn: per-mark `payload_sha256`; embedded: the policy's
  survivor `payload_sha256` per key) — asserted against the checkpoint directly, not just the fresh pull;
- no EXTRA keys in either map; each expected key consumed exactly once; adapter returning null
  (unreconstructable shape) is its own typed diff.
Typed diffs: `missing_mark`, `missing_embedded_key`, `wrong_map`, `hash_mismatch`, `count_mismatch`,
`extra_key`, `unreconstructable_entry` — ids/keys + expected/observed hashes only, never raw payloads.

**G — Negative self-test (the verifier must be able to fail).** On copies of real materializations
(picked to include a survey-marker doc, a callout doc, and a doc with divergent survivor keys), inject:
(i) tampered nested payload field, (ii) deleted user-drawn mark, (iii) deleted embedded key,
(iv) extra embedded key, (v) callout moved to the wrong map, (vi) divergent key carrying a LOSING
candidate's payload (wrong-survivor detection), (vii) an entry replaced with a bridge-shaped stub the
adapter can't reconstruct. Require the correct typed diff for each. Any miss ⇒ run INVALID (exit 1)
regardless of Phase-F results.

**H — Outputs + exit.** Report (per-doc × per-policy verdict table; acceptance checks: 615/615
user-drawn verified incl. 403 survey-marker + 11 callout, 10,960 keys, 3,056 unique on 70dadd86,
divergent count 1,244; shape-compatibility section; open decisions restated). Verdicts JSON written
under a **strict allowlist schema** (fixed key set per node: task/generated_at/doc ids/policy names/
counts/diff types/ids/hex hashes/booleans; anything else fails the writer) **plus** the KAL-261
structural blacklist guard — belt and suspenders. Temp-file + atomic rename. Exit codes: 0 = all PASS +
self-test pass; 2 = drift-explained differences only; 1 = any unexplained failure, self-test miss, or
integrity-gate refusal.

## Unit tests (`tests/kal262ZeroLossHarness.test.mjs`, pure, no network)

1. Round-trip pass: synthetic doc (user-drawn incl. survey-marker + callout; embedded with a cross-page
   duplicate `pdfAnnotationId`) → PASS; page-distinct keys intact; callout routed to `callouts`.
2. Tamper detection → exactly one `hash_mismatch`.
3. Missing user-drawn mark → `missing_mark` with that annotation_id.
4. Missing embedded key → `missing_embedded_key`.
5. Extra key → `extra_key`. 6. Wrong-map → `wrong_map`. 7. Count mismatch independent of hashes.
8. Wrong-survivor payload on a divergent key → `hash_mismatch` naming the policy.
9. Unreconstructable entry (bridge-shaped stub) → `unreconstructable_entry`.
10. Drift classification: post-cutoff `updated_at` → DRIFT-EXPLAINED; same-timestamp content change →
    UNEXPLAINED; missing-id attribution honors the by-id probe result (present ⇒ UNEXPLAINED).
11. Pinned known-answer hash vector (fixed synthetic row → expected sha256 hex literal).
12. Integrity gate refuses on file-sha mismatch and on hash_scheme inequality.
13. **Write-leak gate:** fake-fetch harness run asserts every request is GET, body-less, `/rest/v1/`
    + whitelisted table only; plus a source-level test on the harness module text: no `supabase-js`
    import, no `/rpc/`, no `method:` other than GET.
14. Allowlist schema writer rejects an out-of-schema key; atomic-rename leaves the previous file intact
    on a failed run.
15. Exit-code aggregation: PASS / DRIFT / FAIL precedence.

## Gates (in order)

1. `npx vite build` clean.
2. `node scripts/run-node-tests.mjs` — full suite; KAL-261 helper tests stay green after the export-only
   touch; baseline at last wind-down was 1447 total / 1441 pass / 0 fail / 6 skipped — restate observed.
3. Live dry-run: `node scripts/kal262-zero-loss-harness.mjs` (GET-only). Required: exit 0; 615/615
   user-drawn PASS across all 68 annotated docs (403 survey-marker + 11 callout explicitly counted);
   per-doc embedded counts match baseline (70dadd86 = 3,056); all three policies verified; self-test 7/7.
4. Codex result review until converged.

## Risks / notes

- **Yjs value fidelity:** Y.Map stores plain JSON values via lib0 `Any` encoding; key order may change —
  irrelevant (canonicalStringify sorts). Numbers/null/unicode round-trip losslessly; payloads originate
  from `res.json()` so no `undefined` exists.
- **The table may have drifted** since 14:38Z — the Phase-D attribution discipline keeps the run honest
  either way; drift-explained-only ⇒ exit 2 + re-baseline instruction.
- **What this does NOT decide:** survivor policy (KAL-266), archived-doc policy (§7/B3), Step-4 ID
  encoding, Step-7 target, final Y.Doc payload shape / reader changes (KAL-266 — but it now has the
  field-coverage evidence). The report restates each open decision without advancing any.
