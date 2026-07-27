# Production release process

Production releases are intentionally ordered:

1. GitHub CI tests the exact commit.
2. Pending Supabase database migrations are applied.
3. Every local Supabase Edge Function is deployed. This includes Stripe checkout,
   customer portal, and webhook code.
4. The release-integrity check confirms migration history, active functions,
   JWT settings, required Stripe secrets, CORS preflights, and Stripe webhook
   signature enforcement.
5. Only then does a project-scoped Vercel deploy hook build the tested `main`
   revision.
6. `surveytool.app/release.json` must report that exact Git commit before the
   workflow succeeds.

Vercel Git auto-deploy is disabled in `vercel.json`. Do not re-enable it: an
independent frontend deploy can put code into production before its required
database or functions. GitHub stores only the project deploy hook, not a broad
Vercel account token.

Run the same checks locally:

```bash
node scripts/release-integrity.mjs --static
supabase db push --linked --dry-run
node scripts/release-integrity.mjs --remote --project-ref cvamwtpsuvxvjdnotbeg
```

The `Deploy production` GitHub workflow runs automatically after CI succeeds on
`main`. It can also be started manually for recovery. A failed backend step
stops the workflow before Vercel is touched.
