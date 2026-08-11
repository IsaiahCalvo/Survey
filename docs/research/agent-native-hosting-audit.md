# Agent Native analytics hosting audit

Date: 2026-08-10

## Bottom line

- A paid Netlify site and a second paid Supabase project are **not required** by Agent Native.
- Builder provides a hosted version at `analytics.agent-native.com`. The author says in the launch video that its MCP is "hosted for free" and that users can use the free hosted version until they have a reason to fork/customize. The current FAQ is more cautious: it says Builder operates the hosted version as a per-seat plan. Treat the video's free offer as a free tier/credits, not a promise of unlimited free use. [Video at 00:58](https://www.youtube.com/watch?v=PSDjomv7RxA&t=58s), [video at 05:18](https://www.youtube.com/watch?v=PSDjomv7RxA&t=318s), [current FAQ](https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/faq.mdx#L92-L107)
- Agent Native's docs publish `https://analytics.agent-native.com/track`; the live hosted setup UI currently supplies `https://analytics.agent-native.com/api/analytics/track`. Both returned HTTP 202 in the 2026-08-10 cutover verification. Survey uses the UI-provided `/api/analytics/track` route. [First-party analytics documentation](https://github.com/BuilderIO/agent-native/blob/main/templates/analytics/docs/schemas/first-party-analytics.md#L5-L31)
- Therefore our separate Netlify deployment and its separate paid database were an optional self-hosting choice, not something the GitHub project required.

## What the hosted service is

The repository calls `analytics.agent-native.com` the **live app**. It includes a built-in first-party event collector, dashboards, queries, monitoring, errors, and session replay. [Analytics README](https://github.com/BuilderIO/agent-native/blob/main/templates/analytics/README.md#L1-L22)

The documented hosted flow is:

1. Sign into the live Analytics app.
2. Create a public write key under **Data Sources > First-party Analytics**.
3. Put that `anpk_...` key in the emitting app.
4. Events go to Builder's hosted `/track` endpoint.

The GitHub docs explicitly describe that endpoint and key flow. [First-party analytics documentation](https://github.com/BuilderIO/agent-native/blob/main/templates/analytics/docs/schemas/first-party-analytics.md#L5-L31)

This means self-hosting is optional for initial use. Self-hosting becomes useful when we need to own/customize the analytics server or keep all captured data in infrastructure we control. The current FAQ says the framework is free, while hosting and AI usage can cost money depending on the chosen route. [Agent Native FAQ](https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/faq.mdx#L92-L107)

## What self-hosting requires

For local development, no external server or database is required. The template runs locally and defaults to a SQLite file. [Analytics README](https://github.com/BuilderIO/agent-native/blob/main/templates/analytics/README.md#L24-L35), [database documentation](https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/database.mdx#L69-L85)

For a durable deployed copy, Agent Native requires:

- A host capable of running its Nitro server/API.
- One persistent SQL database.

It does **not** mandate Netlify or Supabase. Official deployment targets include Node.js, Vercel, Netlify, Cloudflare, AWS, and others. [Deployment documentation](https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/deployment.mdx#L1-L16)

It does **not** mandate a new database project. Supported database choices include Supabase Postgres, Neon, Turso/libSQL, plain Postgres, Cloudflare D1, and other Drizzle-compatible SQL backends. [Database documentation](https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/database.mdx#L87-L109)

Full session replay has an extra production storage requirement: metadata lives in SQL, while replay chunks should use private/encrypted blob storage. That still does not require a separate Supabase project. [Tracking documentation](https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/tracking.mdx#L232-L292)

Whether it is safe to put Agent Native's tables in Survey's existing production database is a separate schema/security review. Nothing in the upstream documentation says to buy a second Supabase project.

## Why the Netlify credits disappeared

The upstream Netlify build emits a health request **every minute** to keep the function and database warm. The project documentation warns this is the wrong default on metered/free infrastructure and says to set `AGENT_NATIVE_DISABLE_KEEP_WARM=1` or use a slower cadence. [Netlify keep-warm warning](https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/deployment.mdx#L416-L450)

The Analytics template is also a substantial server application, not just a tiny tracking pixel. Its Netlify config includes long-running/background functions for the agent, dashboard reports, analytics alerts, uptime monitors, rollups, and session-replay retention. [Analytics Netlify configuration](https://github.com/BuilderIO/agent-native/blob/main/templates/analytics/netlify.toml#L28-L57)

Our local `survey-analytics` deployment used the Netlify preset and did not set the documented keep-warm disable flag in `netlify.toml`. That deployment choice explains why a nominally "free" analytics experiment could burn through a small metered quota even while no one actively used its dashboard.

## Hosted collector limits and billing: what is actually published

There is no current official page that states a hosted Analytics event allowance, replay-session allowance, storage allowance, overage rate, or account-level spend cap. The live app currently says **“Free forever. Open source for life.”** during onboarding, and the launch video calls the hosted service free. However, the current FAQ calls Builder's hosted service a **per-seat plan** without publishing a price. These claims do not establish an unlimited free collector. [Current FAQ](https://www.agent-native.com/docs/faq), [launch video at 00:58](https://www.youtube.com/watch?v=PSDjomv7RxA&t=58s)

Builder's separate **Agent Credits** documentation covers AI inference, not analytics ingestion or replay storage. Free AI usage stops at its daily/monthly limits; paid self-serve credits are bought in advance, while enterprise contracts can support pay-as-you-go. Nothing in that page says event collection consumes Agent Credits. [Builder Agent Credits](https://www.builder.io/c/docs/agent-credits/)

The open-source Analytics server contains these defaults and hard technical limits:

| Area | Upstream source default | Behavior at limit | Hosted contract status |
|---|---:|---|---|
| First-party events | 1,000,000 events per tenant per 30-day window | HTTP 429; tells the owner to connect another analytics database or BigQuery | Builder may override both values in the hosted environment; not published |
| Event batch size | 100 events/request | Request rejected | Fixed in current source |
| Replay retention | 30 days | Retention job deletes older recordings | Environment-overridable; hosted value not published |
| Replay ingest | 100 MiB/day/public key | HTTP 429; oversized single request can return 413 | Per-key default; hosted key creation currently uses it, but no contractual guarantee |
| Replay request rate | 120 requests/minute/public key | HTTP 429 | Per-key default; no contractual guarantee |
| Replay payload shape | 20 chunks/request; 2,000 chunks/recording; 1,000 replay events/chunk; 5 MiB/blob chunk | Request rejected when invalid/oversized | Fixed in current source |

Sources: [event-volume defaults and 429 behavior](https://github.com/BuilderIO/agent-native/blob/main/templates/analytics/server/lib/first-party-analytics-volume.ts#L4-L42), [100-event batch limit](https://github.com/BuilderIO/agent-native/blob/main/templates/analytics/server/lib/first-party-analytics.ts#L57-L57), [replay defaults and payload limits](https://github.com/BuilderIO/agent-native/blob/main/templates/analytics/server/lib/session-replay.ts#L245-L266), [replay quota enforcement](https://github.com/BuilderIO/agent-native/blob/main/templates/analytics/server/lib/session-replay.ts#L1110-L1185).

Important distinction: these are **source-code defaults**, not a published hosted-service SLA or billing plan. The hosted deployment can override event volume and retention with environment variables. Its ordinary health API does not expose those overrides.

No automatic analytics-storage overage billing path appears in the open-source collector. The documented/source behavior is to reject excess traffic. I found no official hosted Analytics page offering paid overages or a user-configurable hard spend cap. Therefore the safe operational assumption is: **no surprise collector overage is documented, but no enforceable hosted price/allowance promise is published either.** Keep replay sampling low until Builder publishes or confirms the hosted terms.

## Current hosted account state

On 2026-08-10, **First-party Analytics** was configured with a new public Survey write key. The hosted collector accepted verification events with HTTP 202. The workspace showed no Billing/Plan control or payment method. Session replay remains disabled. Survey additionally hard-limits its browser sender to 30 events/minute and 300 events/session, with no retries.

## Exact hosted collector setup

1. Sign in at [analytics.agent-native.com](https://analytics.agent-native.com/).
2. Open **Data Sources > First-party Analytics**.
3. Create a public write key and copy the full `anpk_...` value immediately. The full value is returned only when created; later listings expose only its prefix/status. [Create-key action](https://github.com/BuilderIO/agent-native/blob/main/templates/analytics/actions/create-analytics-public-key.ts#L14-L29), [list-key action](https://github.com/BuilderIO/agent-native/blob/main/templates/analytics/actions/list-analytics-public-keys.ts#L14-L28)
4. Configure Survey's Vercel server environment with:

   ```dotenv
   AGENT_NATIVE_ANALYTICS_PUBLIC_KEY=anpk_...
   ```

   Survey's browser calls its same-origin `/api/analytics/track` proxy. Do not
   expose this key through a `VITE_` or `EXPO_PUBLIC_` production variable.
   Agent Native also supports a public browser key for direct collector use,
   but Survey deliberately keeps its key server-side. [First-party setup](https://github.com/BuilderIO/agent-native/blob/main/templates/analytics/docs/schemas/first-party-analytics.md#L5-L31)

5. If session replay is intentionally enabled, keep signed-in-only capture (the default), leave input masking on, and begin with a conservative sample such as `0.1` rather than recording every eligible session. [Tracking and replay setup](https://www.agent-native.com/docs/tracking#session-replay)
6. Send one non-sensitive test event, confirm the collector reports success, then verify it in the hosted workspace before increasing volume. Batches are capped at 100; invalid keys return 401. [Collector request contract](https://github.com/BuilderIO/agent-native/blob/main/templates/analytics/docs/schemas/first-party-analytics.md#L29-L87)

These steps do not require Netlify, a second Supabase project, or a self-hosted Agent Native server.

## Survey migration completed

- Netlify showed the team on the **Free** plan at `$0.00`, with no saved card,
  no billing details, no invoices, and “no overage charges ever.” Its sole
  project was the paused `survey-analytics-796` self-host. The exact Netlify
  team was deleted on 2026-08-10 after the hosted cutover was verified.
- Vercel remains the Survey host on its Hobby plan. A bounded same-origin
  `/api/analytics/track` function forwards events to Builder's hosted collector;
  no separate analytics app or database runs on Vercel.
- The hosted collector key is server-only and is not embedded in the production
  Survey or Expo bundles. The proxy accepts only the two `surveytool.app`
  origins, caps body size and per-IP request rate, and redacts again server-side.
  Native recovery diagnostics are queued and emitted by the Survey WebView
  after it reloads.
- The second `survey-test` Supabase project was replaced by the main Survey
  project's leased bot accounts plus one RLS-enabled, service-role-only bytea
  fixture table. Integration tests create no customer documents.
- The main-project schema, bytea round trip, and private-storage tripwire passed
  with zero leaked test rows/files.
- Supabase would not pause `survey-test` because it was paid compute. The exact
  `survey-test` project was deleted on 2026-08-10, which removes its additional
  compute charge. The main `Survey` project remains active and healthy.
- Session replay is disabled. Survey redacts URLs, query strings, tokens, email
  addresses, absolute paths, and document names from diagnostic string values;
  events remain capped at 30/minute and 300/browser session client-side plus
  60/minute/IP at the proxy, without retries.

## Post-cutover billing and usage check

- Supabase organization: **Pro**, one active healthy `Survey` project, Spend Cap
  **enabled**. The dashboard says overages are not currently billed and no Pro
  quota is exceeded. Current cycle: 6.471/250 GB cached egress, 0.148/250 GB
  uncached egress, 0.581/100 GB storage, 9/100,000 MAU, 41/2,000,000 Edge
  Function calls, 2,671/5,000,000 realtime messages, and 11/500 peak realtime
  connections. The deleted second project's already accrued compute can still
  appear prorated on the current invoice; future default Micro compute for the
  sole project is covered by the organization's monthly compute credit.
- Vercel: **Hobby** (`$0/month`). Hobby cannot buy on-demand usage; Vercel pauses
  the exhausted feature instead of creating an overage bill. The analytics
  proxy uses one short serverless invocation per accepted event and inherits
  the client/proxy hard ceilings above.
- Agent Native hosted workspace: no Billing/Plan control or payment method was
  exposed. Session replay is off. The hosted UI observed the secured production
  verification events after the cutover.

## Can the self-hosted key and data migrate?

The existing self-hosted public key cannot be moved into the hosted collector. Each key is generated and stored in the database of the Analytics deployment that created it; the hosted collector validates against Builder's hosted database. Key-listing intentionally returns only prefixes, not secret values. [Key creation/storage](https://github.com/BuilderIO/agent-native/blob/main/templates/analytics/server/lib/first-party-analytics.ts#L105-L180)

Migration therefore means **key rotation**, not key transfer:

1. Create a new hosted key.
2. Replace Survey's endpoint and public key together.
3. Verify hosted ingestion.
4. Revoke/retire the old self-hosted key only after the cutover is confirmed.

Existing self-hosted events and replay recordings do not migrate automatically. The project documents no supported hosted import/backfill path, so historical data should be exported or retained separately if it matters.

## Correct interpretation for Survey

The launch video says the product can be used in either mode:

- Free hosted Agent Native Analytics/MCP.
- Self-hosted open-source copy on infrastructure and a database of our choosing.

It does **not** say users must pay for a separate Netlify service or a separate Supabase project. [Video at 00:58](https://www.youtube.com/watch?v=PSDjomv7RxA&t=58s), [video at 04:15](https://www.youtube.com/watch?v=PSDjomv7RxA&t=255s), [video at 05:18](https://www.youtube.com/watch?v=PSDjomv7RxA&t=318s)

Implemented direction: Survey no longer relies on the Netlify copy. It sends privacy-filtered events/errors to Builder's hosted collector, with hard client volume ceilings and session replay disabled. Only self-host later if ownership or published limits require it.
