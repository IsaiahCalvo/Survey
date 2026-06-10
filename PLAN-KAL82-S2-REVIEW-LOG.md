# Plan Review Log: KAL-82 slice 2 — Dashboard.jsx orphaned template-modal deletion

Started 2026-06-10 ~12:45 (scheduled loop session). MAX_ROUNDS=5. PLAN_FILE=PLAN-KAL82-S2.md.
Plan provenance: 88-symbol dead closure computed by workflow wf_e813041b-6bb (2 map agents + 3 adversarial verify lenses); two verification blockers (reachable setEntities calls in both modal openers) resolved by keeping the entities side effect inside the stubs.

## Round 1 — Codex (thread 019eb25c-c506-7713-8506-9d3cb881e714)

Findings:

- `entities` is wrongly listed as "now used by stubs"; after deleting `getTemplateSnapshot`/`saveTemplate`, only `setEntities` remains live. Fix: drop `entities` from Dashboard destructuring or explicitly mark it unused.
- Verification gate "zero-reference grep over every deleted symbol name" is too vague for generic names like `modules`. Fix: use exact identifier-scoped grep/AST check, not raw string grep.
- Stub contract depends on preserving the current `Date.now()` call pattern inside each literal. Fix: copy the existing entity blocks verbatim; don't factor a shared default helper in implementation.

No missed live refs found. `openTemplateModal` and `openEditTemplateModal` are the only live escape points; preserving `setEntities` covers the observable persisted-data side effect.

VERDICT: APPROVED

### Claude's response
Approved round 1. All three advisories accepted: (1) `entities` stays in the destructure for the prop contract but the plan text is corrected — only `setEntities` is used by the stubs; (2) zero-ref gate will use word-boundary identifier greps scoped to Dashboard.jsx (plus repo-wide for Dashboard-unique names); (3) entity literals copied verbatim, no shared helper (already in plan §A). Proceeding to implementation per loop protocol (post-approval, gates before commit).

## Result review — Codex (same thread, read-only resume)

Findings: none material.

Audited `git diff src/Dashboard.jsx`. Diff touches only `src/Dashboard.jsx` with 25 insertions / 1545 deletions. `openTemplateModal` entity block exact-matches original. `openEditTemplateModal` entity/default/normalization block exact-matches original, including `Template not found.`, rgba regex, and opacity clamp. Ref still exposes `openTemplateModal`, `openEditTemplateModal`, `closeTemplateModal`, `exitSelectionMode`; close is no-op.

Live symbols checked present: `persistTemplates`, `hubSaveTemplates`, `updateTemplates`, `templates` useMemo, `hasNameConflict`, `normalizeName`, `hexToRgba`, `serializeError`, `FONT_FAMILY`, `exitSelectionMode`, `selectedProjectId`. Deleted-symbol residue grep returned none. Comment edits match planned areas.

VERDICT: APPROVED

### Converged
Plan review: 1 round. Result review: 1 round. Gates: vite build clean; 1390 tests / 1384 pass / 0 fail / 6 skipped (baseline-identical); 88-symbol identifier-scoped residue grep empty.
