# Signed-in E2E tests (local Supabase)

A real, signed-in end-to-end setup any agent can use: a throwaway local
Supabase stack (every repo migration replayed on a fresh database), seeded test
accounts with known passwords, the app on Vite, and Playwright specs that sign
in through the real sign-in dialog. Nothing touches production: the seed script
refuses non-local hosts, the Playwright config refuses a non-local
`VITE_SUPABASE_URL`, and specs block every non-local request.

## Requirements

- Docker running. In a Claude cloud container: `docker ps` fails, then run
  `(dockerd >/tmp/dockerd.log 2>&1 &)`.
- `npm install` done. The Supabase CLI is used from `PATH` when it is 2.111.0
  (same pin as CI), otherwise through `npx supabase@2.111.0`.
- Chromium: the config uses `/opt/pw-browsers/chromium` when it exists (cloud
  container) or `PW_CHROMIUM_PATH`; otherwise Playwright's own browser. Never
  run `playwright install` in the cloud container.

## One command: stack up and seeded

```bash
npm run e2e:stack:up
```

Starts the stack (first run pulls images, a few minutes; later runs ~1 min),
applies all migrations, writes `.env.e2e` (git-ignored: local URL, anon key,
service-role key) and seeds. Re-seed any time (idempotent, also resets the
sample document's name / lock / archive state):

```bash
npm run e2e:seed
```

Ports are 544xx (API `http://127.0.0.1:54421`, DB `54422`), so it does not
clash with a dev `supabase start` on 543xx. `npm run e2e:stack:status` shows it.

## Test accounts

Password for all of them: `E2e-local-only-123!` (local stack only).

| Key      | Email                     | Plan | Access to the sample document            |
|----------|---------------------------|------|------------------------------------------|
| `free`   | `e2e-free@example.com`    | free | none                                     |
| `pro`    | `e2e-pro@example.com`     | pro  | none                                     |
| `owner`  | `e2e-owner@example.com`   | pro  | owner (owns project + document)          |
| `editor` | `e2e-editor@example.com`  | free | `editor` on the document and the project |
| `viewer` | `e2e-viewer@example.com`  | free | `viewer` on the document and the project |

Seeded data: project **E2E Sample Project** (`e2e00000-0000-4000-8000-000000000001`)
holding document **E2E Sample Drawing.pdf** (`e2e00000-0000-4000-8000-000000000101`,
bytes from `debug/fixtures/clickable-link-test.pdf`, stored at
`<owner id>/<document id>.pdf` in the `documents` bucket). Plans live in
`user_subscriptions.tier`; sharing in `document_collaborators` and
`project_collaborators`. Everything is defined once in
`tests/e2e-signed-in/accounts.mjs`.

## Run the specs

```bash
npm run test:e2e:signed-in
```

Re-seeds, starts Vite on `http://127.0.0.1:5199` with `--mode e2e` (reuses one
already running there outside CI) and runs `tests/e2e-signed-in/*.spec.mjs`.
One spec: `npx playwright test --config playwright.e2e-signed-in.config.mjs -g "viewer"`.

To click around by hand with the same data:
`npx vite --mode e2e --host 127.0.0.1 --port 5199` and sign in with an account above.

Not part of `npm test` / `scripts/run-node-tests.mjs` (it needs Docker). CI runs
it in `.github/workflows/e2e-signed-in.yml` (manual dispatch, and pull requests
that touch app/migration/E2E files). That workflow is informational: deploys do
not depend on it.

## Write a new spec

Add `tests/e2e-signed-in/<name>.spec.mjs`:

```js
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, openSampleDocument, signIn, test } from './helpers.mjs';

test('editor sees the sample document', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.editor);   // real sign-in dialog
  await openSampleDocument(page);
  await expect(page.getByText('View-only access')).toHaveCount(0);
});
```

- Import `test` from `helpers.mjs`, not `@playwright/test`: it blocks
  non-local network requests.
- `clientFromPageSession(page)` gives a Supabase client using the session the
  UI sign-in produced, for server-side checks (RLS, RPCs).
- `adminClient()` (service role) is for setup/teardown only. Undo anything you
  change on the shared seed rows, or create your own rows and delete them.
- Need another account or document? Add it to `accounts.mjs` and to `seed()` in
  `scripts/e2e-local-supabase.mjs`, keeping it idempotent (fixed ids, upserts).

## Tear down

```bash
npm run e2e:stack:down
```

Stops the containers and deletes their data volumes. The next `up` starts from
a fresh database.

## How the fresh database is built

The stack runs from `.e2e/supabase-stack/` (git-ignored), not `supabase/`:
its config is `supabase/config.toml` with its own `project_id`, ports and unused
services off (studio, mail, analytics, edge runtime, pooler). Its migrations are
a plain copy of `supabase/migrations/`; that folder alone builds the database:

1. `20241220000000_baseline.sql` sorts first and recreates what production had
   before the chain began: `projects`, `documents`, `templates`, `spaces`,
   `users` (and the auth.users triggers that fill it), the `documents` and
   `brand` buckets, a few hand-made functions and the old default table grants.
   Production already has all of it; the version was recorded as applied there
   by hand, and `scripts/check-migration-order.mjs` allows this one file to sort
   before the newest migration.
2. Every other migration, unchanged.
3. `20261021050000_fresh_database_parity.sql` records changes production got by
   hand: it puts `search_path = public` back on the functions
   `20260211224035_fix_function_search_path.sql` emptied (with `''` sign-up and
   every project/document insert fail), drops the legacy tables production
   dropped, and codifies the hand-applied `supabase/proposed/` w36 / w54 / w55
   schema changes. On production every statement is a no-op.

Not reproduced: production's pg_cron jobs (no pg_cron locally).
