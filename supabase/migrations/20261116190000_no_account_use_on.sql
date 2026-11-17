-- KAL-658: turn 'device-files' and 'guest-sample' on for everyone.
-- Owner, 2026-11-16: a visitor must be able to open Survey, close the sign-in
-- card, upload a PDF, mark it up and export it with no account. Both flags
-- move from beta to rollout in src/featureFlags.js in the same change.
-- Nothing here touches the server side: a device file never leaves the
-- browser until its owner signs in and saves it to an account.
update public.feature_flags
   set mode = 'on'
 where key in ('device-files', 'guest-sample');
