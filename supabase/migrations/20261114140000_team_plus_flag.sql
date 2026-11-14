-- Nightly flag `team-plus` (keep in step with src/featureFlags.js): on the
-- Manage team page, a note in the invite email, invite many people at once
-- from a CSV file (Email, Role), and download the team list as a CSV.
-- Beta, so only Survey Nightly shows it; the row starts off. No schema change:
-- invites keep using create_project_invite and the invite email's message.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('team-plus', 'off', 'Team page: note in the invite email, invite from a CSV file, download the team list as a CSV.')
ON CONFLICT (key) DO NOTHING;
