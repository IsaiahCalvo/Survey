# Area 5 — Templates + survey markers · **CHILD-FILED (KAL-55)**

- Survey marker plumbing (Plan A/B/C: full rename of universal annotation IDs from `highlightId/highlight_id` to `annotationId/annotation_id`, untangling Space vs Module, healing entity colour) is shipped on main (`d8edc6cf`, `e023d1e0`, `fbfe9ec2`).
- Templates table queries (`templates`, `template_modules`, etc.) and the Templates tab render cleanly. Free user sees Templates locked (lock icon, no click). Pro user sees it unlocked.
- **KAL-43 (preserve checklist item IDs across template normalization) not in main** — commit `17a24366` lives only on the `test-all-fixes-2026-05-21` branch.
- **KAL-44 (archive used checklist items instead of hard-delete) not in main** — `grep -r "archived\\s*=\\s*true" src/` against checklist items returns zero hits. The archive-instead-of-delete behavior is purely on the unmerged kal-44 branch.
- Both tracked under **KAL-55**.

Driving the full rename / reorder / move / add / recolor / delete / archive matrix against the as-shipped main is informative but not release-blocking on its own — the blocker is the unmerged branches.
