# Private source, public app files

The source repository can be private. App users do not need GitHub access.

## Public files

Only compiled installers, Android APKs, update manifests and a stripped status
snapshot belong in the `app-public` Supabase Storage bucket. Its public root is:

https://cvamwtpsuvxvjdnotbeg.supabase.co/storage/v1/object/public/app-public

- Windows feed: `desktop/latest.yml`
- Mac feed: `desktop/latest-mac.yml`
- Desktop files: `desktop/vX.Y.Z/<installer or blockmap>`
- Android files: `android/survey-stable.apk` and `android/survey-nightly.apk`
- Status: `status.json`, served by the site at `/api/public-status.json`

Customer PDF, media, brand and backup buckets are separate. No storage policy
grants app users write access to `app-public`. Only the service role publishes.
The project upload ceiling is 1 GiB for app installers; customer upload buckets
keep their own 50 MiB caps. App downloads count toward the Supabase plan's storage
and file-download allowances; keep an eye on those before adding old versions.

## Publishing

The release and Android workflows retain GitHub releases as build archives and
copy compiled files to public storage. They use the existing
`SUPABASE_ACCESS_TOKEN` secret to read the project's service key at run time.
They never place that key or a GitHub token in the app or public bucket.

`scripts/publish-app-downloads.mjs <directory> vX.Y.Z` checks the installer size
and SHA-512 against the update manifest before publishing. Versioned files go
first, feeds last. It refuses to overwrite different bytes at the same version
or replace a newer feed. Bump the version before rebuilding an app release.
For Android use `app-stable` or `app-nightly` as the tag.

Mac builds include a ZIP because electron-updater needs it for in-app updates.
The generic public provider comes first in package.json so it is written into
the installed app's `app-update.yml`. GitHub is the second provider so older
installs can still find the migration release while this repository is public.

`scripts/publish-public-status.mjs` reads all alert issues and sends only a
fixed kind, open/closed state, and dates to storage. It never copies issue text,
private links or users. The monitor and backend checks refresh it after their
issue changes. A small workflow also refreshes it hourly and on human issue
changes. The page refuses snapshots more than two hours old. This heartbeat is
needed even when there are no new incidents.

## Before changing visibility

1. Merge and deploy the status page and its rewrite. Verify `/status` in a fresh
   browser session and verify `/api/public-status.json` without signing in.
2. Publish v0.1.48 (or a later version) from the tested main branch. Check both
   public update feeds and the installer checksums without GitHub credentials.
   Test the new installed app's update check.
3. Update existing desktop installs while the old GitHub feed is public.
   Apps through v0.1.47 keep their old feed until a new installer is installed;
   hiding this repo cannot change the feed in an old binary. Users who miss
   this step can install the new version directly from the public host.
4. Check the current GitHub plan. Private branch rulesets need Pro or higher.
   Do not drop the main/backup/build rules to work around the plan limit.
5. Choose and approve a build budget or move builds to trusted private runners.
   Pro's included use does not make busy hosted CI free. Preserve the required
   checks; never expose private source in a public build job to save money.
6. Check private-repo access for each connected GitHub app, change visibility,
   then verify a fresh build, deploy, desktop update, Android download and status
   read. Do not change visibility while any earlier check is still blocked.

Changing visibility or buying a paid plan is a separate owner action. This
change does neither.
