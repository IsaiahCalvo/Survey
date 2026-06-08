# Plan Review Log: Stage 1 row-key (re-tie stored Survey Marker ↔ Excel row)
Started session 2026-06-08. MAX_ROUNDS=5. Plan: STAGE1-IDENTITY-PLAN.md.

---

## Round 1 — Codex (VERDICT: REVISE)

- False-binds: Pass B field-count lets common blanks/defaults dominate → wrong bind after reorder+rename. Fix: unique mutual-best + score margin, else ask.
- Ambiguity too narrow: misses near-equal winners above floor, duplicate identities, stale metadata, column ambiguity. Fix: explicit quarantine reasons, block writes.
- Duplicate rows unsolved: ordinal tiebreak unsafe under reorder. Fix: never ordinal for identical rows; carry unresolved group until user chooses.
- Confidence floor hand-wavy. Fix: exact thresholds/margins/fixtures up front.
- Greedy can misassign globally. Fix: optimal bipartite OR mutual-best only.
- Fingerprint canonicalization undefined (ExcelJS dates/richtext/formulas/numbers/blanks). Fix: one canonical serializer + round-trip tests.
- FNV-1a too weak as identity key. Fix: versioned SHA-256 over typed delimited cells.
- Old-exporter migration still risks name-binding placed markers. Fix: backfill only on unique app-derived match, else ask.
- Export-ack stamping underspecified vs current code (stamps ALL markers). Fix: stamp exportedAt + lastExportedFingerprint only for markers actually written as rows.
- Metadata/visible drift underdefined. Fix: metadata version/export id/scope ids/row counts/header hash; fail closed per scope on mismatch.
- Checklist column re-binding not solved by "id in header order"; rename+reorder/dupe headers still ambiguous. Fix: persist column schema block (ids, header text, ordinal, header hash); quarantine ambiguity.
- Entity "anchor" invalid: visible row has entity NAME, not id. Fix: match on entity-name fingerprint; resolve to id only after identity established.
- Leftovers called "new" too eagerly. Fix: new only when trusted metadata exists for scope; else unresolved.
- Observability missing. Fix: journal version/hash/exact-fuzzy-new-missing counts/scores/margins/reasons/prevented writes.
- Simpler safer alternative: skip weighted similarity for Stage 1 — ship exact-unique-fingerprint + strict-unique-anchor binding, everything else → "Needs your choice."

### Claude's response (revising)
Accepting nearly all of it. Adopting the simpler alternative as the core, with one refinement Codex's version missed: a pure exact-full-row binder would send the COMMON, intended edit (user changes an answer/note in Excel) to "Needs your choice" every time, which is bad UX. Fix: add a **stable-anchor** layer between exact and ask — an anchor hash over the fields the user is NOT editing (Item name + entity name + the checklist-item-id structure), excluding answer values and notes. So: (L1) exact full-row fingerprint unique → bind (reorder of unchanged rows); (L2) stable-anchor unique among remaining → bind (the normal "edited an answer/note" case, reorder-proof); (L3) everything else → explicit quarantine reason. Weighted similarity / greedy / Hungarian all DROPPED for Stage 1 — no fuzzy scoring at all, so no false-bind surface and no threshold to calibrate. Also accepting: SHA-256 versioned identity hash (FNV stays only for the unrelated dirty-state hash); single canonical visible-value serializer + round-trip tests; per-scope drift guard (version/exportId/scope-ids/rowcount/headerHash, fail closed); column schema block with header hash; entity matched by NAME fingerprint; stamp ack only on rows actually written; old-exporter backfill only on unique app-derived match; leftovers "new" only under trusted metadata; a match journal for observability. Rejecting only: Hungarian/optimal-assignment (moot once fuzzy scoring is gone) and any numeric similarity threshold (no longer exists).

---

## Round 2 — Codex (VERDICT: REVISE)

- dataRowCount trust gate contradicts insert/delete: normal row add/remove changes visible count → whole scope review-only before L3 can classify. Fix: validate metadata's internal record count, allow visible-count delta, let L3 classify leftovers.
- scopeHeaderHash blocks legit answer-column reorder/add/remove before columnSchema/NewColumnsModal act. Fix: split system-column trust from per-answer-column resolution; route answer-column drift to the modal/column quarantine.
- Entity edits won't auto-bind: anchor includes Entity name, but Entity is an allowed attribute edit. Fix: entity-edit binder, or exclude Entity from anchor and quarantine only collisions.
- Rename conflicts with PLAN.md acceptance (PLAN expects a renamed row to re-tie + update name; plan asks on every rename). Fix: safe unique rename binder (full-row-minus-Item when unique) or amend acceptance.
- Anchor "ordered set" of checklist ids makes column reorder look like drift. Fix: canonical (sorted/schema-order) checklist-id set, computed after column binding.
- Column binding by headerHash+ordinal too strict (renamed/reordered column unresolvable even when headerHash unique). Fix: bind by unique headerHash first; ordinal only as duplicate tiebreaker.
- Stale workbook import still a blocker: an older export can pass matching and apply stale attributes. Fix: persist accepted exportId/workbook baseline in app record; fail closed when importing older-than-baseline.
- Migration "write identity block going forward" but Stage 0 writeback disabled. Fix: persist adopted identity only in app sync record; write _SurveyMetadata only on next explicit export.
- App-side sync schema undefined beyond lastExportedFingerprint. Fix: define durable app record (exportId, scopeId, identity fingerprints, per-field fingerprints, written-row set) alongside the sheet block.

### Claude's response (revising)
Accepting all nine. Key structural change: there is NO truly stable visible field (Item, Entity, Notes, answers are all editable attributes), so "stable anchor" was wrong. Replacing it with a single uniform exact binder. Define an **identity vector** = canonical [Item, Entity, Notes, answers-by-checklist-id] EXCLUDING the Changed By/Changed Date audit columns (which move on any edit and must not be matching keys). Binders: L1 = identity vector exact + unique both ways. L2 = identity vector at Hamming distance ≤ 1 from exactly one stored record, mutually unique → bind (the one differing field is the edit; covers a single answer/note/entity edit OR a single Item rename — reconciles PLAN's "renamed row re-ties, only the name attribute changes" for the common single-edit case; multi-field edits ask). No weights, no threshold beyond k=1; mutual-uniqueness removes the false-bind surface. Trust gate relaxed: drop visible-row-count and global-header gating; only a missing/duplicated SYSTEM column kills a scope; answer-column drift goes to column binding (unique headerHash first, ordinal only tiebreaks) + NewColumnsModal, unresolvable answer column quarantines that column only. Added: stale-baseline fail-closed via an app-record excelBaseline (lastAcceptedExportId/workbookHash); migration persists adopted identity in the APP record only (no sheet write under Stage 0); full durable app sync-record schema defined alongside the sheet block. fullRowFingerprint retained for change-detection/journal but is not the matching key.

---

## Round 3 — Codex (VERDICT: REVISE)

- L1 content-swap false-bind: two rows exchange whole identity vectors → each matches the other's stored marker → L1 treats both as unchanged. Fix: document as unobservable-without-row-id limitation, or quarantine on swap-like ordinal signal.
- L1 false-bind when an edited row becomes identical to a deleted stored row. Fix: require a permutation/collision check when an exact match coexists with missing stored records in the same scope.
- exportId not defined monotonic/orderable, but stale gate depends on "older than baseline." Fix: make exportId a sortable sequence/timestamp; missing/non-orderable → fail-closed for auto import.
- Column quarantine leaves identity vector with unknown fields. Fix: rows with unknown identity fields must not L1/L2 bind; mark unresolved.
- NewColumnsModal timing underspecified vs "other columns still process." Fix: specify modal-before-row-binding; rows touched by unresolved columns review-only until resolved.
- App record "survives stripped metadata" but Step 1 still requires metadata. Fix: define the stripped-metadata fallback — run app-record L1/L2 or mark scope review-only, consistently.
- excelBaseline should update on successful EXPORT, not only import acceptance. Fix: set lastAcceptedExportId/hash at export so older imports fail closed immediately.

### Claude's response (revising)
Accepting six; documenting one as a limitation. (1) Content permutation: a pure swap of whole identity vectors among same-scope rows is genuinely unobservable without a row-carried id, which Amendment #5 forbids. Critically it is SAFE — matched content equals stored content so no attribute write reaches a wrong placed marker; the only cost is a missed swap-edit. REJECT the ordinal-based detection: ordinals change on every legitimate reorder too, so it would false-alarm "Needs your choice" on normal reordering. Documenting it as an explicit known limitation instead. (2) Edited-row-equals-deleted-row: already contained because placed-marker delete is guarded OFF — the "deleted" marker becomes a review-only candidate-delete, not a deletion, and the matched marker gets no write; adding a lightweight `provisional` journal flag when any L1 exact match coexists with leftover stored records in the same scope so review surfaces it. (3) exportId = a monotonic per-document export sequence (counter persisted in the doc) plus timestamp; missing/non-orderable baseline → fail-closed for automatic import. (4) Incomplete-vector guard: a row whose identity vector has ANY unresolved field (missing/renamed/unbound checklist column) cannot L1/L2 bind → `unresolved`. (5) Column resolution runs BEFORE row binding; rows touched by still-unresolved columns are review-only until the modal resolves them. (6) Stripped-metadata fallback: if _SurveyMetadata is absent but app excelSync records exist for the scope, run L1/L2 from the app record's mirrored fingerprints; if neither exists → review-only. (7) excelBaseline.lastAcceptedExportId/hash set at successful explicit export, so a later import of an older workbook fails closed immediately.

---

## Round 4 — Codex (VERDICT: REVISE) — "row-matching now basically sound; stripped-metadata fallback still has a hole"

- App-record fallback lacks scope schema (no columnSchema/systemColumns to compute current vectors when _SurveyMetadata stripped). Fix: persist a per-scope app sync record with metadataVersion, exportId, columnSchema, systemColumns, record count.
- Step 2 still requires metadataVersion, absent when source is app excelSync. Fix: app fallback gets its own schema version; trust gate branches on selected source.
- Sheet+app sources "never mixed" but their exportIds aren't required to agree. Fix: if both exist and scope/export ids disagree, fail closed instead of preferring the sheet.
- Monotonic export sequence risky under multi-client/offline export. Fix: allocate via durable single-writer transaction, or mark incomparable sequences review-only.

### Claude's response (revising)
Accepting all four. (1+2) Adding a per-scope durable app record, `excelScopeSync`, mirroring the sheet scope header: `{ appSchemaVersion, exportId, moduleId, categoryId, columnSchema, systemColumns, recordCount }`; the trust gate branches on the selected source and reads the schema version from whichever source is used (sheet's metadataVersion or app's appSchemaVersion). (3) If BOTH sources exist for a scope and their exportId or scope ids disagree, the scope is review-only (fail closed) — never prefer the sheet. (4) Making exportId CRDT-correct: not a single global integer but a causal tuple `{ clientId, counter }` allocated inside one durable doc transaction; comparison is causal — orderable only when causally related (same client, or one strictly dominates); two concurrent/incomparable exports from different offline clients → review-only with reason `incomparable-export`, never an assumed order. The stale gate uses this causal comparison.

---

## Round 5 — Codex (VERDICT: APPROVED) — "no material row-key blockers remain; conservative enough to implement with tests"

Remaining minor fixes (all folded in):
- exportId {clientId,counter} needs a stored vector clock → persist exportClock in sheet metadata, excelScopeSync, and excelBaseline.
- Old-exporter migration adoption writes BOTH excelSync and excelScopeSync.
- Risks wording "monotonic exportId sequence" → "causal export clock."
- Journal reason vocabulary adds source-disagreement, incomparable-export, stale-workbook, incomplete-vector, provisional-L1.

### Claude's response
Applied all four edits. Design APPROVED after 5 rounds. No code written yet — awaiting human sign-off (gate #2) before implementation begins with the build-order slices.

---

## PIVOT — 2026-06-08 (owner decision): visible `Row ID` column is now the primary key

The owner reversed Amendment #5 (PLAN.md Amendment #10). A visible first column `Row ID` carrying a stable unique per-marker token is the primary matcher (direct id lookup); the rounds 1–5 fingerprint/identity-vector/Hamming design is retained as the FALLBACK matcher (no-Row-ID-column / legacy workbooks) and the always-on change-detection layer. STAGE1-IDENTITY-PLAN.md rewritten around Row ID. The previously-approved design is unchanged in its fallback role, but the Row-ID-primary path introduces a NEW surface (a user-editable/deletable visible column: deleted column, edited/typo'd token, copied row → duplicate token, pasted foreign tokens) that warrants its own focused Codex pass before code.

## Round 6 — Codex (Row ID design, VERDICT: REVISE)

- Unexported valid token can bind: pasting/typing a valid same-scope Row ID for a marker never written to THIS workbook would mutate it. Fix: only auto-bind tokens present in the accepted exported-token set for that scope/export.
- Token not scoped/tamper-evident: SM-+app id exposes an internal id and doesn't prove document/scope origin. Fix: scoped signed token (document/scope + marker id + checksum/HMAC), validate all parts before lookup.
- Blank Row ID unsafe as "new" by default: clearing a token on an existing row spawns a duplicate new item while the original becomes candidate-delete. Fix: blank rows first compared to leftover exported markers via fallback; confident hit → missing-rowid review/re-attach, create new only when no leftover candidate.
- Missing export clock with Row ID present underspecified. Fix: fail closed (review-only auto-apply) with missing-export-clock unless user explicitly accepts manual import.
- Unknown vs malformed collapse loses signal. Fix: separate reasons malformed-rowid / foreign-rowid / unknown-rowid, same no-auto-bind behavior.

### Claude's response (revising)
Accepting all five. Central change: the Row ID token becomes a SIGNED SCOPED value — documentId : scopeId : markerId : checksum (HMAC over a per-document secret) — validated in parts before any lookup. That powers two findings at once: a bad checksum = malformed-rowid; a valid token whose documentId isn't this doc = foreign-rowid; valid + this doc but no live marker = unknown-rowid — all no-auto-bind, all distinct journal reasons. (1) Auto-bind only against the accepted exported-token set for the scope (from the app record / metadata), so a never-exported valid token can't mutate a marker. (3) Blank token → run the fallback fingerprint against LEFTOVER (unmatched) exported markers first; a confident unique hit → missing-rowid (surface for review/re-attach, no silent duplicate); only a blank with no leftover candidate becomes a genuinely new app-assigned item (honors the owner's blank→new rule for true new rows). (4) Missing/unreadable export clock → identity still resolvable by token, but recency is untrusted, so auto-apply is gated to review-only with missing-export-clock (manual accept allowed). (5) Reason vocabulary split as above.

## Round 7 — Codex (Row ID design, VERDICT: REVISE)

- Foreign-token branch unreachable: a per-document HMAC secret can't validate another doc's token, so it'd read as malformed not foreign. Fix: parse documentId BEFORE HMAC; documentId mismatch → foreign-rowid.
- Source disagreement undefined for Row ID metadata (exported-token set lives in both app state and _SurveyMetadata). Fix: app vs workbook metadata disagree on doc/scope/clock/token-set → scope review-only, never silently union/prefer.
- Duplicate detection must precede binding (row-by-row would bind the first copy before seeing the second). Fix: pre-scan all non-blank tokens per scope, mark duplicates first, bind only count==1.
- Missing HMAC secret unhandled (rotated/not-hydrated/restored-wrong → everything reads malformed). Fix: rowid-key-unavailable, block auto-apply, fallback in review mode only.
- missing-export-clock manual acceptance has no baseline rule. Fix: after accepting, require immediate re-export or mint a new app-side baseline clock before future auto-imports.
- Token grammar lacks version/key/canonical encoding (escaping, rotation, Excel text coercion). Fix: define a v1 grammar — text cell format, encoded parts, key id/version, HMAC over exact canonical bytes.

### Claude's response (revising)
Accepting all six. (1+6) Defining a v1 token grammar: `v1.<keyId>.<b32url(documentId)>.<b32url(scopeId)>.<b32url(markerId)>.<b32url(hmac)>`, forced to an Excel text cell; parse + version/keyId + documentId BEFORE any HMAC check, so documentId≠this-doc → foreign-rowid (we can't and needn't verify a foreign secret); keyId selects the verifying secret (enables rotation). (2) If the app record and _SurveyMetadata disagree on documentId/scopeId/export clock/exported-token set → scope review-only (source-disagreement), never union/prefer. (3) Row-ID matching is two-pass: first count all non-blank valid same-doc tokens per scope and mark every token with count>1 as duplicate-rowid; only then bind the count==1 tokens. (4) If the signing secret for a keyId is missing/unhydrated → rowid-key-unavailable: block auto-apply for the scope, fallback only in review mode (NOT malformed — it's a recoverable key problem). (5) Accepting a missing-export-clock import forces an immediate re-export (or minting a fresh app-side baseline clock) before any future auto-import is trusted.

## Round 8 — Codex (Row ID design, VERDICT: APPROVED) — "no remaining primary-path false-bind; round-7 changes close the material safety holes"

Implementation-tightening fixes (all folded in):
- Replace remaining colon-shape token examples with the exact v1.<keyId>... grammar.
- Key lifecycle: retain any signing key referenced by an accepted exported-token set until a re-export replaces all tokens using it.
- Pre-HMAC documentId/scopeId are unauthenticated — terminal no-bind classification only, never lookup/trusted display unless re-verified.
- Exclude markers tied up in duplicate-rowid from the blank-row missing-rowid fallback pool until resolved.
- Add wrong-scope-rowid (same-document, wrong scope) as its own no-auto-bind reason.

### Claude's response
Applied all five. Row ID design APPROVED (round 8). Full review arc: fingerprint-primary design approved over rounds 1–5, then owner pivoted to a visible Row ID column (Amendment #10), re-reviewed over rounds 6–8 and approved. No code written. Awaiting owner sign-off (gate #2) before the build slices.
