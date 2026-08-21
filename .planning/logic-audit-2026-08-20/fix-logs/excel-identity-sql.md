# excel-identity-sql

## P2-10 — SharePoint-tier can mint duplicate Survey Markers for one Excel row
- Date: 2026-08-20
- Status: fixed
- Files changed: `supabase/migrations/20260820230000_kal309_create_identity_guard.sql` (new; live `kal308_apply_changeset` create branch + partial unique index)
- Intended behavior confirmed: create looks up `(document_id, template_id, scope_id, identity_vector_fingerprint)` for a non-empty fingerprint and converts a match to apply-against-existing (`outcome=applied`, same marker id). Unique index `excel_sync_state_identity_fingerprint_uidx` excludes empty fingerprints.
- Break / adversarial attempts: empty fingerprint never matches (two blank imports still mint). A `secret` / unknown `answer:` key is rejected by P2-21 before mint. Open `client_conflict_review` on the existing row routes to `review` instead of a second mint.
- Edges covered: same fingerprint on another `scope_id` does not collide; unique index is partial (`fingerprint <> ''`).
- Test command + result: `node --test tests/excelIdentityCreateGuard.test.mjs` → 9/9 pass.
- Remaining risk: migration is not yet applied to prod. Offline tests assert SQL + JS contract, not a live two-client RPC race. Clients that ignore `outcome=applied` and locally mint a second marker still need the client matcher (out of this allowlist).

## P2-21 — Excel `create` ops skip the field/template whitelist `apply` enforces
- Date: 2026-08-20
- Status: fixed
- Files changed: `supabase/migrations/20260820230000_kal309_create_identity_guard.sql` (create branch)
- Intended behavior confirmed: create runs the same key whitelist (`changedBy|changedDate|item|entity|notes` + `answer:`/`answer.`) and, when `p_template_config` is present, the same checklist-id / entity-value checks as apply. Missing `changedFieldKeys` falls back to `fields` object keys.
- Break / adversarial attempts: `secret`, `answerKeys`, `answer:missing`, and an entity not in the template all route to `review` (no mint, no state write).
- Edges covered: `p_template_config` NULL is structural-only (unknown `answer:anything` allowed); empty/absent fields are ok.
- Test command + result: `node --test tests/excelIdentityCreateGuard.test.mjs` → 9/9 pass.
- Remaining risk: same as P2-10 (unapplied migration; no live service-role RPC this wave). Client `overlayChangedFields` still does not validate `answer:<id>` (out of allowlist).
