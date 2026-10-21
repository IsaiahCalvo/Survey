-- Flag: retire the legacy collab layer, step 1. When on, YDocProvider skips
-- the legacy-row backfill, the PDF-import dedupe, the cleanup-residue audit
-- and the remote-delete Restore toast; marks, undo and live co-editing run on
-- annotationDocSync either way. Off for everyone until the coordinator turns
-- it on. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('legacy-collab-retired', 'off', 'Retire the legacy collab layer (step 1): skip the old per-device import, dedupe, residue audit and Restore toast.')
on conflict (key) do nothing;
