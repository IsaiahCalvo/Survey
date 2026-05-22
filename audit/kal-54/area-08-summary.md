# Area 8 — Sign-off / lock state · **CHILD-FILED (KAL-55)**

- The `documents` table on remote Supabase already has the `locked_at`, `locked_by`, `locked_label` columns — confirmed via service-role schema probe (`logs/area-12-supabase.json:findings.documents_columns_present`). Migration shipped.
- **KAL-49 (document sign-off / release / lock state v1 UI + RLS) not in main** — `grep -rn "lockedBy\\|sign-off\\|Sign Off"` against `src/` returns only a single hit in `useAnnotationCloudSync.js`, no banner component, no toolbar disable, no editor 42501 RLS migration. The kal-49 commit (`9c0b961f`) is on its branch only.
- Tracked under **KAL-55**.
