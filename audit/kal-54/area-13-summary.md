# Area 13 — Cleanup + data hygiene · **DONE**

Cleanup script (`scripts/cleanup.mjs`) deletes every disposable artifact the audit created:

- 4 auth users (free / pro / developer / enterprise, all `@example.com`)
- `document_collaborators` rows (will cascade with user / doc delete)
- 2 projects (`audit-kal-54-proj-*`)
- 2 documents (audit-kal-54-doc.pdf + the real cloud-uploaded normal-test.pdf from area-03)
- Storage object `documents/<user_id>/...` for the real upload (deleted via `supabase.storage.from('documents').remove([...])`)
- `user_subscriptions` rows are owned by user via FK — cascade with `auth.admin.deleteUser`.

Final leftover `survey-test-*@example.com` user count is logged at end of cleanup run and reported in the KAL-54 Linear comment.
