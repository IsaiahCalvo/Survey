# KAL-260 Backup Manifest

Generated: 2026-06-11T19:13:28.322Z
Host: `cvamwtpsuvxvjdnotbeg.supabase.co`
Output dir: `/Users/isaiahcalvo/SurveyBackups/kal260/2026-06-11T19-11-29-612Z`

## Counts

- Rows: 53229
- Raw pages: 54
- Precision warnings: 0

## File SHA-256s

- `document_annotations.jsonl`: `da0deb5ba5aca1a6ceac018d5b43aaaefe732567f26dcdb7c9758aa9061e8310`
- Raw pages combined: `2a8a0c73d3d5c1732ba88513c4351f982df6785d51063e296b2f1063c3b6a87c`
- `schema.openapi.json`: `171d3ccc21fbaab40528ee2d006b2eb4b107ba132fb49a72195e0d0b14f655a6`

## Snapshots

Before: 53229 rows, max_updated_at 2026-06-10T21:32:37.147345+00:00
After:  53229 rows, max_updated_at 2026-06-10T21:32:37.147345+00:00

## Sweep

Result: PASS

## Checkpoint Integrity

PASSED (pinned sha256s verified)

## Ground-Truth Cross-Check (dump-derived)

PASS — UD matched=615 drift=0; EM matched=10960 drift=0 (dump-derived inputs)

## Schema Completeness

PASS — row-key union covers all 9 required columns and exactly equals the OpenAPI column set (26 columns); extras beyond required: ["bounds","category_id","changed_by","changed_date","checklist_responses","color","entity_id","entity_name","font_size","last_modified_by","module_id","name","notes","opacity","space_id","stroke_width","version"]

## File Integrity (disk reread)

PASS — 54 raw pages + JSONL reread, re-parsed, re-hashed OK

## Gate B1 Verdict

Exit code: **0** — **PASS**

Gate B1 SATISFIED. Off-database export confirmed complete (count + file-hash + ground-truth verified); restore path documented, schema-grounded, and unit-tested — live restore drill remains a human-gated residual.

## Restore Runbook

Target table: `document_annotations`
FK prerequisites: parent documents rows and auth.users must exist, or FK constraints must be temporarily dropped before restore; restore documents table first, then annotations
Conflict mode: resolution=merge-duplicates on id (upsert); batch size <= 1000 (PostgREST cap)
Batch size: 500
Sequence note: document_annotations.id is a UUID (no sequence); no identity reset needed
Verification after restore: export the restored table with an equivalent keyset GET pagination (select=*&order=id.asc&limit=1000, id=gt.<last> cursor) and compare per-row content against document_annotations.jsonl from this backup. NOTE: this script hard-pins the production origin (https://cvamwtpsuvxvjdnotbeg.supabase.co) and will refuse to run against any restore target — adapting the origin pin for a drill is a deliberate manual step, not something this tool does automatically.
Residual: restore drill into a scratch schema/project on Isaiah's go; FK parents do not exist in survey-test and seeding that project autonomously is the wrong call
