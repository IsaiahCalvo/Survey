# PLAN — KAL-288 Storage bucket privacy AUDIT (read-only, cap-free) — r1

**Date:** 2026-06-11 · **Session:** autonomous loop · **Scope:** audit-only — ZERO writes
**to production** (no Storage/PostgREST/auth mutation of any kind). Repo deliverables ARE in
scope and are the task's output: the report file, the ticket-mirror/board Status-log update,
and one local commit (never pushed). This mirrors the KAL-287 audit pattern exactly.
(r1: scope wording fixed per Codex finding 6 — "zero writes" previously read as contradicting
the deliverables list.)

## Why now

KAL-288 (was BL-09, readiness §5 #4): "Confirm the documents bucket is public or private;
`getPublicUrl` hints it may be public (path-guessable PDF read)." The confirmation half is
read-only and eligible for an away-mode session. The fix half (signed URLs / bucket flag /
code changes) is explicitly OUT of scope — last code-change cap slot is held.

## What the code tells us (verified this session, incl. SDK source)

1. `src/hooks/useDatabase.js:600-606` — `getDocumentUrl()` calls
   `supabase.storage.from('documents').getPublicUrl(filePath)`. **Verified in
   `node_modules/@supabase/storage-js/dist/index.mjs:1260-1268`:** it is pure string
   concatenation returning `<url>/storage/v1/object/public/documents/<path>` — no server
   call. Its presence proves nothing about the bucket flag; live probe required.
2. The app's authenticated read is SDK `download()` — **verified at
   `index.mjs:1122-1130`:** it GETs `<url>/storage/v1/object/documents/<path>` (renderPath
   `object`, no `authenticated` prefix) with the client's auth headers. Probes must cover
   THIS exact route, not just `/object/authenticated/...` (Codex finding 3).
3. Sole `getDocumentUrl` consumer: `PdfPageThumb.jsx:45-77` (wired from `Dashboard.jsx:139`,
   `DocumentsLedger.jsx:154`) — thumbnails try `downloadDocument()` first, fall back to
   fetching the public URL only when the authenticated download throws.
4. Migration `20260513003000_allow_collaborators_to_read_document_storage.sql` documents the
   intent: collaborator reads via authenticated SELECT policy "without making the documents
   bucket public." No migration creates the bucket or sets its flag (tier-policy migration
   20241223000004 left storage policies as dashboard-managed comments) — flag state is
   unknowable from the repo.
5. Object key shapes (`useDatabase.js:535-545`): `<owner-uid>/<contentSha>.pdf` (new) and
   `<owner-uid>/<projectId>/<timestamp>.<ext>` (legacy).

## Live probes (production; read-only; service key for metadata/row reads only)

All object probes use `Range: bytes=0-0` so at most ONE byte of PDF content moves
(finding 2); `200` or `206` counts as "readable". All authenticated curls take headers from
`umask 077` temp files (`-H @file`), never argv; no `-v`; header files deleted at wind-down
(finding 7). Report shows statuses/booleans and masked paths only (first 6 + last 10 chars;
never a full owner UUID or full content sha — a full path is a reusable URL component).

- **P1 — bucket flag:** `GET /storage/v1/bucket/documents` (service key). Records `public`,
  `file_size_limit`, `allowed_mime_types`. If 404: report as misconfiguration/wrong-project
  finding and STOP object probes — do NOT chase other bucket names (finding 8). The
  all-buckets `GET /storage/v1/bucket` sweep is retained only as defense-in-depth evidence
  ("no other bucket exists to leak from"), not as a renaming fallback.
- **P2 — sample paths + EXISTENCE GATE (finding 1):** take ≥3 `documents.file_path` samples
  (newest, oldest, mid) via GET-only PostgREST. For each, first prove the object EXISTS in
  storage: `GET /object/authenticated/documents/<path>` with service key + Range → expect
  206. **Only existence-verified paths feed the anonymous probes.** A path that fails the
  existence gate is excluded from privacy conclusions and reported separately as an
  orphaned-row side-find.
- **P3 — anonymous public-URL probe:** the exact SDK-constructed URL
  `GET /object/public/documents/<path>`, no headers, Range-limited, on existence-verified
  paths only.
- **P4 — logged-out client probes (anon key, no user JWT):** the exact SDK download route
  `GET /object/documents/<path>` AND `GET /object/authenticated/documents/<path>`,
  Range-limited.
- **NOT tested (stated limitation, finding 4):** positive-path owner/collaborator access
  under the `TO authenticated` policy — no user JWT is available headlessly without driving
  dev login, and the app exercises that path daily. Anon denial proves ONLY that the anon
  role is denied; the report must not claim full RLS validation.

## Interpretation matrix (finding 5 — conclusions fixed BEFORE reading results)

| P1 `public` | P3 anon-public on verified object | Conclusion |
|---|---|---|
| false | 400/404 | PRIVATE confirmed (flag + behavior agree) |
| false | 200/206 | **ANOMALY — treat as EXPOSED**; behavior beats flag; investigate immediately |
| true | 200/206 | PUBLIC confirmed — High finding, slice plan pivots to signed URLs |
| true | 400/404 | ANOMALY — flag says public but object unreadable; report both, no privacy claim |

`200/206` anywhere anonymous = "anonymously readable", full stop — regardless of flag.
404s are only meaningful AFTER the P2 existence gate passes for that same path.

## Deliverables

1. `.planning/optimization/KAL-288-BUCKET-PRIVACY-REPORT.md` — verdict per the matrix, probe
   evidence, exposure analysis, and a human-gated slice plan (content depends on verdict:
   if PRIVATE — dead-fallback cleanup slice (code, gated), privacy-regression tripwire test
   (cap-free), policies-into-migrations slice (Isaiah); if PUBLIC/EXPOSED — flag flip +
   signed-URL migration slices, marked urgent).
2. Ticket file + board row Status-log updates (repo-side mirror only; Linear flip pending
   per baton).
3. One local commit (audit artifacts only — no `src/` changes). `npx vite build` +
   `node scripts/run-node-tests.mjs` run before commit as baseline re-confirmation.

## Risks / guardrails

- Keys never in argv/echoed (header files, umask 077, deleted after); no `-v`; no full
  paths/UUIDs/shas in any artifact.
- Object probes move ≤1 byte each (Range); no POST/PUT/DELETE anywhere (storage list
  endpoint skipped — POST-shaped).
- Production data never modified; matches KAL-287 precedent + no-Docker/cloud-CLI memory.
  No `supabase db push`, no dashboard changes.
- The dead-fallback claim (if PRIVATE) is grounded in: existence-verified objects + the
  byte-exact SDK URL construction (read from storage-js source) + anon 400 on those same
  paths (finding 9). Without all three legs the claim is not made.
