# Database / Realtime Stack Research — Survey BetaSafeS2

Date: 2026-06-06
Repo: `/Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2`
Video reviewed: https://www.youtube.com/watch?v=B6C-MWCFfAg

## Executive recommendation

Do **not** migrate the whole app off Supabase right now. Supabase is not the wrong system of record for Survey: it is already doing the hard durable-backend work well enough — Auth, Postgres, RLS, Storage, Edge Functions, Stripe, Resend, document metadata, permissions, subscription state, and audit/version tables.

The likely weak spot is narrower: **Supabase Realtime/Postgres changefeeds are not an ideal high-frequency collaboration transport**, and the app has already hit Supabase/Postgres-shaped pain around RLS-heavy reads, offset pagination, exact counts, auth locks, and realtime payload limits. Keep Supabase for durable data, but treat live collaboration as a separate architecture concern: continue hardening the Yjs snapshot/op-log path, or evaluate Liveblocks/other collaboration infrastructure for presence, cursors, comments, and room coordination.

Convex is the most interesting full-backend alternative, especially for TypeScript/agent-friendly development, but moving Survey wholesale to Convex would be a major rewrite and would not automatically solve PDF storage, Yjs-grade collaboration, SQL reporting, or existing Stripe/Resend/Supabase Storage flows.

## Current live Supabase shape

Connected project: `Survey` (`cvamwtpsuvxvjdnotbeg`) via Supabase CLI and REST/OpenAPI.

Public API exposed 32 tables/views and 33 RPCs. Important tables/views include:

- Core product: `users`, `projects`, `spaces`, `documents`, `templates`, `user_settings`
- Billing/usage: `user_subscriptions`, `usage_metrics`, `daily_usage_summary`, `user_quota_status`, `archived_projects_summary`, `project_status`
- Document sharing: `document_collaborators`, `document_invites`, `project_collaborators`
- Legacy annotations: `document_annotations`, `annotations`, `survey_items`, `survey_sessions`, `survey_sync_log`
- Presence/realtime: `document_presence`, `survey_presence`
- History/versioning: `document_history_events`, `document_revisions`
- CRDT/Yjs: `doc_yjs_state`, `doc_yjs_updates`, `annotation_snapshots`, `annotation_updates`
- Integrations: `connected_services`, `excel_schema_mapping`, `activity_log`

Live approximate row counts sampled through PostgREST count headers:

- `documents`: 119
- `document_annotations`: 53,209
- `document_presence`: 64
- `document_collaborators`: 26
- `document_history_events`: 152
- `user_subscriptions`: 13
- `usage_metrics`: 589
- `doc_yjs_state`: 113
- `doc_yjs_updates`: 0
- `annotation_updates`: 0
- `annotation_snapshots`: 0
- `document_revisions`: 0

Interpretation: the app is still heavily using legacy `document_annotations` and `doc_yjs_state`; the newest `annotation_updates` / `annotation_snapshots` source-of-truth path exists but currently has no live rows in this project.

## How Survey currently uses Supabase

### 1. Auth and sessions

File: `src/supabaseClient.js`

- Creates a singleton Supabase client from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Supports offline mode if env vars are absent.
- Uses persistent Supabase Auth sessions.
- Implements a custom `clampedAuthLock` because Supabase/auth-js lock behavior previously caused authed requests to stall behind `navigator.locks` for up to 5 seconds during cold document open.

File: `src/contexts/AuthContext.jsx`

- Owns session load, Google OAuth, email/password auth, SSO, password reset, profile updates, token-refresh handling, and subscription-tier refresh.
- Reads `user_subscriptions` for tier/status.
- Avoids replacing stable user objects during pure token refresh because that previously triggered unnecessary PDF/document rehydration.

### 2. Core product data

File: `src/hooks/useDatabase.js`

- `useProjects`: CRUD over `projects`.
- `useDocuments`: reads owned docs and collaborated docs through `document_collaborators`; creates documents with provenance and content-hash dedupe.
- `useTemplates`: templates.
- `useConnectedServices`: Microsoft/other connected services.
- `useDocumentToolPreferences`: localStorage plus `documents.tool_preferences`.

The app already has performance protections here: read coalescing and single-flight metadata resolving because opening a document previously fetched the same `documents` row multiple times.

### 3. File storage

File: `src/hooks/useDatabase.js`, `useStorage()`

- Uses Supabase Storage bucket `documents`.
- Upload/download/remove/get public URL.
- Newer document uploads use content-addressed paths: `<user.id>/<contentSha>.pdf`.
- Legacy fallback path: `<user.id>/<projectId>/<timestamp>.<ext>`.

Migrations:

- `20241226000001_add_storage_tracking_triggers.sql`: updates `user_subscriptions.storage_used_bytes` from `documents.file_size` on insert/delete.
- `20260513003000_allow_collaborators_to_read_document_storage.sql`: adds collaborator read access for owner-path files by joining `storage.objects.name` to `documents.file_path` and `user_can_access_document`.

Storage is a good fit for now. If PDF bandwidth/storage becomes expensive, the low-risk migration is PDFs to R2/S3 while keeping Supabase metadata, not replacing the whole database.

### 4. Legacy annotation persistence

Files:

- `src/services/documentAnnotationService.js`
- `src/services/annotationCloudSync.js`
- `src/services/annotationTypeSerializers.js`

Primary table: `document_annotations`.

This table is still the big live data table: ~53k rows. It stores survey markers and many annotation types. The code has already split responsibilities:

- `documentAnnotationService.js`: mostly survey-marker legacy path.
- `annotationCloudSync.js`: all-types/Fabric annotation path.

Documented pain points:

- Legacy loader once fetched all annotation types and pushed non-survey-marker rows back as survey markers, causing cross-device data loss. Fixed by filtering ownership/types.
- Large-doc reads hit timeouts when using OFFSET pagination with RLS checks. Fixed with keyset pagination and `(document_id, id)` index in `20260602120000_kal241_document_annotations_keyset_index.sql`.
- Exact counts/max-watermark reads hit statement timeouts under RLS. Fixed with denormalized `documents.annotations_changed_at` in `20260603130000_db_sync_annotations_changed_at.sql`.

### 5. Yjs / CRDT collaboration

There are two generations visible.

#### Older Yjs foundation

Migration: `20260428000000_phase27_crdt_foundation_schema.sql`

- `doc_yjs_updates`: append-only binary Yjs updates.
- `doc_yjs_state`: per-document Y.Doc snapshot.
- `activity_log`: audit trail.

File: `src/lib/collab/SupabaseYjsProvider.js`

- Uses Supabase Realtime Broadcast channel `yjs:<documentId>` for Yjs protocol frames and awareness.
- Binary frames are base64-in-JSON.
- Has `SOFT_PAYLOAD_CAP_BYTES = 600 * 1024` to stay below Supabase Broadcast payload ceilings after base64 inflation.
- Large updates are skipped from realtime and expected to be covered by durable snapshot/op-log hydration.

This is a real Supabase limitation: Broadcast is not a native binary CRDT transport; the app has to work around JSON/base64 payload ceilings.

#### New annotation source-of-truth path

Migration: `20260606120000_rebuild_yjs_source_of_truth.sql`

- `annotation_updates`: append-only Yjs op log with `(document_id, client_id, client_seq)` idempotency and `(document_id, seq)` index.
- `annotation_snapshots`: compacted Y.Doc snapshots per document.
- Adds `annotation_updates` to Supabase Realtime publication.
- RLS allows viewers to read and editors to insert updates/snapshots.

File: `src/services/annotationDocSync.js`

- Local persistence with `y-indexeddb`.
- Fast open: load snapshot, replay update tail.
- Live sync: subscribe to Postgres INSERTs on `annotation_updates` and apply remote Yjs updates.
- Snapshot compaction: gzipped Y.Doc snapshot every 40 ops, debounced by 1200ms, with retries.

Important live finding: the new `annotation_updates` and `annotation_snapshots` tables currently have 0 rows, so this path may be built but not yet carrying production data in this project.

### 6. RLS and access control

Core helper: `public.user_can_access_document(doc_id, required_role)`.

This is used across document rows, annotations, storage, invites, presence, revisions, and Yjs tables. It protects data well, but the migrations show it has also been a source of fragility:

- `20260215183000_fix_document_presence_access.sql`: fixed docs without projects causing 403s on presence upserts.
- `20260513000000_allow_collaborators_to_select_documents.sql`: collaborators could sync annotations but could not open/list shared PDFs until document SELECT policy was fixed.
- `20260522010000_kal49_fix_user_can_access_document.sql`: hotfix for a remote-only migration referencing nonexistent `documents.created_by`, which blocked non-owner access.

RLS is powerful but not friction-free; it needs tests and migration discipline.

### 7. Stripe and Resend

Supabase Edge Functions:

- `supabase/functions/create-checkout-session/index.ts`
- `supabase/functions/create-portal-session/index.ts`
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/send-email/index.ts`

Stripe writes subscription state into `user_subscriptions`. Resend is used by `send-email`, invoked by invite flows and Stripe email helpers. This is all reasonable to keep on Supabase Edge Functions unless background jobs become heavier than Edge Functions are comfortable for.

## Where Supabase is actually hindering the app

### Real hindrance 1: high-frequency collaboration transport

Supabase Realtime is fine for presence, small broadcasts, and database-change notifications. It is not ideal as a high-frequency, binary CRDT transport for large PDF annotation documents. The app already works around this with payload caps, base64 encoding, snapshots, op logs, and compaction.

Recommendation: keep Yjs, but do not rely on raw Supabase Broadcast/Postgres changes as the only collaboration backbone. Evaluate Liveblocks for room/presence/comments/cursors, or a dedicated Yjs websocket/Hocuspocus-style service if collaboration becomes the differentiator.

### Real hindrance 2: RLS-heavy read performance

The code/migrations show repeated fixes caused by RLS and large annotation tables: OFFSET timeouts, count timeouts, and per-row access checks. These were fixable, but they are the pattern to watch.

Recommendation: keep denormalized freshness columns, keyset pagination, narrow select lists, explicit indexes, and benchmark hydration against large docs before adding features.

### Real hindrance 3: permission logic spread across SQL, client code, storage policies, and functions

Convex’s video critique is valid here: Supabase permissioning is not as easy for agents or humans to reason about as source-controlled TypeScript functions. Survey already has multiple migrations fixing permission drift.

Recommendation: if staying on Supabase, add policy tests and a generated schema/type workflow. Treat every RLS change like high-risk backend code.

### Real hindrance 4: background jobs are not first-class

If Survey adds OCR, AI extraction, batch exports, document conversion, large PDF processing, or queues, Supabase Edge Functions alone may be insufficient.

Recommendation: use a worker/queue layer when needed: Cloudflare Workers/Queues, Trigger.dev, Inngest, Modal, Fly worker, or similar. Do not force long-running jobs through the database/realtime path.

## Where Supabase is not the problem

Supabase is still a strong fit for:

- relational document/project/user/permission data
- SQL/admin/debuggability
- audit trails and version history
- Stripe/Resend edge functions
- object storage for PDFs
- mature auth/session handling
- Postgres indexes and operational tooling

The current pain is not “Supabase bad.” It is “PDF collaboration is hard, and Supabase Realtime is not a full collaborative editing platform.”

## Video analysis: what applies and what does not

The video argues strongly for Convex over Supabase.

Claims that apply to Survey:

- Convex is more agent-friendly: schema, queries, mutations, actions, and backend logic live in TypeScript files.
- Convex reactive queries reduce manual realtime wiring for normal app state.
- Convex permissions in functions may be easier to reason about than complex RLS.
- Convex actions/components/work pools may be nicer than stitching Supabase Edge Functions plus external queues.

Claims that only partially apply:

- Supabase pricing/project limits matter for prototypes and many side projects; less important for one serious production app.
- Convex realtime query invalidation is not the same as Yjs CRDT collaboration for PDF annotations.
- Convex file storage exists, but the video itself notes Convex file bandwidth can be expensive; PDF apps should be careful.

Claims that are hype/not enough evidence:

- “It’s time to get off Supabase.” The speaker admits he has not built anything serious with Supabase, so this is not enough to justify a production migration.
- “Convex is the best database platform ever made.” Useful enthusiasm, not architecture evidence.
- A 20-minute AI demo does not prove fit for a production Electron/PDF/Yjs/RLS/Storage app.

## Option comparison

### Supabase / Postgres / Storage / Realtime

Best for Survey’s durable backend. Keep it.

Main risk: realtime collaboration and RLS complexity.

### Convex

Best full-backend alternative if Isaiah wants TypeScript-first app data, agent-friendly backend iteration, and built-in reactive queries.

Not an obvious full migration target for Survey today because it would rewrite a lot and does not automatically replace PDF storage or Yjs-grade collaboration.

### Firebase / Firestore

Mature realtime/offline mobile backend, but document-model constraints and Security Rules are not better than the current Postgres/RLS fit for Survey.

Not recommended as a migration target.

### Liveblocks + Supabase

Most promising add-on path. Keep Supabase for durable data; add Liveblocks for collaboration UX primitives: presence, cursors, comments, threads, notifications, room state, and possibly Yjs coordination.

Worth prototyping if collaboration UX is a priority.

### ElectricSQL / PGlite

Interesting later for local-first/offline desktop behavior while keeping Postgres. Not a full backend replacement and not the first fix for live collaboration.

### Replicache / Zero

Strong local-first sync direction, but requires more custom architecture and careful conflict design. Prototype only around a narrow annotation slice if offline-first becomes core.

### Neon + custom realtime

Good Postgres unbundling option, but replacing Supabase means rebuilding auth/storage/realtime/functions. Not worth it unless Supabase platform constraints become severe.

### Appwrite

All-in-one alternative, but not better suited than Supabase for this app. Not recommended.

### R2/S3/Backblaze for files

A better future storage migration than a database migration if PDF size/bandwidth becomes costly. Keep metadata and access in Postgres; move blobs to R2/S3 when economics require it.

## Recommended next steps

1. Keep Supabase as the source of truth.
2. Finish/verify the new `annotation_updates` + `annotation_snapshots` Yjs source-of-truth path, because live rows are currently 0.
3. Add an RLS/policy regression test harness for owner/viewer/editor/free/pro states across `documents`, `document_annotations`, `annotation_updates`, `annotation_snapshots`, `document_presence`, storage reads, invites, and locks.
4. Fix/verify document locking for the new Yjs tables: KAL-49 explicitly gated `document_annotations`, but may not gate `annotation_updates` / `annotation_snapshots` unless later migrations added it.
5. Prototype Liveblocks against one feature slice: document presence + cursors + comments, while leaving durable annotations in Supabase/Yjs.
6. Only consider Convex if the team decides that developer velocity/agent-friendliness is worth a backend rewrite; start with a small greenfield module, not a full migration.

## Decision

Supabase is not currently a fatal limitation. It is a solid durable backend that needs a purpose-built collaboration layer and stricter policy/performance discipline. The highest-leverage move is **hybrid hardening**, not migration: Supabase for data/storage/billing, Yjs or Liveblocks for collaboration, and external workers when PDF/AI jobs outgrow Edge Functions.
