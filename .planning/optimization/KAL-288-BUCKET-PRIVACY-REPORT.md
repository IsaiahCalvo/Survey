# KAL-288 — Storage Bucket Privacy Audit (read-only)

**Date:** 2026-06-11 · **Session:** autonomous loop · **Method:** read-only GETs against
production (Storage API + PostgREST); service-role key used only for metadata/row reads and
the object-existence gate; all object probes `Range: bytes=0-0` (≤1 byte moved); auth headers
via `umask 077` temp files, never argv. Zero production writes. Plan: `PLAN-KAL288.md` r1
(Codex-reviewed, log `PLAN-KAL288-REVIEW-LOG.md`).

## Verdict

**The `documents` bucket is PRIVATE — flag AND behavior agree on existence-verified
objects.** The ticket's fear ("getPublicUrl hints it may be public — path-guessable PDF
read") is unfounded in production today: no anonymous or logged-out request can read PDF
bytes via any route the app constructs. The substantive findings are the inverse of the
ticket's premise:

1. the app still *calls* `getPublicUrl()` on a private bucket, so the thumbnail fallback
   that depends on it fails on every execution (dead code), and
2. at least one `documents` row points at an object that does not exist in storage
   (orphaned row — separate side-find).

## Probe evidence (2026-06-11, production)

**Bucket config** — `GET /storage/v1/bucket/documents` (service key) → 200:
`public: false`, `file_size_limit: 52428800` (50 MB), MIME allowlist = PDF + 5 Excel types,
created 2025-11-18. Defense-in-depth: `GET /storage/v1/bucket` → exactly ONE bucket exists
in the entire project (`documents`, private) — there is no other bucket to leak from.

**Object matrix** — 3 sample paths (newest / oldest / mid-recency) from
`documents.file_path` via GET-only PostgREST. Existence gate: service-key GET on
`/object/authenticated/documents/<path>` with `Range: bytes=0-0` (206 = object exists).
Anonymous probes run only against existence-verified paths, using the byte-exact routes the
SDK builds (verified in `node_modules/@supabase/storage-js/dist/index.mjs` — `getPublicUrl`
at :1260-1268 string-concats `/object/public/<bucket>/<path>`; `download()` at :1122-1130
GETs `/object/<bucket>/<path>`):

| Path (masked) | exists? (svc key) | anon, public route | anon key, SDK download route | anon key, authenticated route |
|---|---|---|---|---|
| `170d91…3f9f3d.pdf` (newest) | **206 — exists** | 400 | 400 | 400 |
| `170d91…118814.pdf` (mid) | **206 — exists** | 400 | 400 | 400 |
| `170d91…188924.pdf` (oldest) | 400 — **NOT in storage** | 400 (not evidence — fails existence gate) | 400 (same) | 400 (same) |

Interpretation per the plan's pre-committed matrix: `public:false` + anonymous 400 on
existence-verified objects = **PRIVATE confirmed**. (Anonymous public-route responses say
"Bucket not found" — Supabase hides private buckets; anon-key responses say "Object not
found" — the row is RLS-filtered for the anon role.)

## Honest limits of this audit

- **Anon denial proves only that anonymous/logged-out access is denied.** The positive path
  (owner/collaborator reads under the `TO authenticated` SELECT policies) was NOT probed —
  no user JWT is available headlessly — but it is exercised every time the app renders a
  document, and the collaborator policy is in the repo
  (`20260513003000_allow_collaborators_to_read_document_storage.sql`). This audit makes no
  broader RLS-correctness claim.
- Production `pg_policies` is not readable via PostgREST, so policy *contents* are known
  from migrations + behavior, not catalog reads. Behavior is the stronger evidence here — a
  misconfiguration would have produced a 200/206.

## What the code does today (verified this session)

- `src/hooks/useDatabase.js:600-606` — `getDocumentUrl()` returns
  `getPublicUrl(filePath)`: client-side string building, never contacts the server. That is
  why code reading "hinted public" while production is private.
- Sole consumer chain: `Dashboard.jsx:139` / `DocumentsLedger.jsx:154` →
  `PdfPageThumb.jsx:45-77`. Thumbnails try authenticated `downloadDocument()` first; the
  public-URL fetch runs only when that throws — and against this private bucket it returns
  400 every time (`res.ok` false → thumbnail silently blanks). Dead-code claim grounded in:
  existence-verified objects + byte-exact SDK URL + anon 400 on those same paths.
- Upload key shapes (`useDatabase.js:535-545`): `<owner-uid>/<contentSha>.pdf` (new),
  `<owner-uid>/<projectId>/<timestamp>.<ext>` (legacy). Guessability is moot while private.

## Side-find — orphaned document row (NEW, for ticketing)

The oldest sampled `documents.file_path` does not exist in storage (service-key existence
check: 400/not-found). At least one DB row references a missing object — plausibly
local-era/legacy data from before cloud storage, or residue of a partial delete. Not a
privacy issue; it IS a data-hygiene issue adjacent to KAL-286 (bug-residue cleanup) and the
KAL-267 content-hash work. Recommend: fold an orphan-scan (rows whose objects are missing,
objects no row references) into an existing hygiene slice rather than a new ticket.

## Residual risks (none block closing the confirmation half)

1. **One-click regression risk:** a single dashboard toggle (`public` → true) would make
   every PDF readable to any path holder; nothing in the repo or tests would notice. (S2.)
2. **Dead fallback masks real failures:** when `downloadDocument()` throws for a transient
   reason, the dead public-URL fallback eats the retry opportunity and the thumbnail
   silently blanks. (S1.)
3. **Policy record gap:** bucket creation + owner-path storage policies live only in the
   dashboard; the repo cannot rebuild a fresh environment (already proven by survey-test
   needing a hand-built bootstrap script). (S3.)

## Slice plan (all human-gated; none performed this session)

- **S1 — remove or sign the dead fallback (code change; needs cap slot or Isaiah ack):** in
  `PdfPageThumb.jsx`, delete the `getDocumentUrl` branch (simplest — authenticated download
  is the working path) or replace it with `createSignedUrl(filePath, <short TTL>)` if a
  second attempt is wanted; then drop `getDocumentUrl` from `useDatabase.js` once
  unconsumed. Gate: vite build + node tests + real-app thumbnail check.
- **S2 — privacy regression tripwire (test-only, cap-free, RECOMMENDED NEXT-LOOP PICK):**
  integration test asserting `GET /storage/v1/bucket/documents` → `public:false` and the
  anonymous public-route probe → non-2xx on an existence-verified object, so a dashboard
  toggle becomes a red test instead of a silent exposure. Follows the KAL-257 §2.5
  conditional-skip pattern (`SUPABASE_INTEGRATION=1`).
- **S3 — policies into SQL migrations (Isaiah-run):** capture live storage policies + bucket
  definition (`select * from pg_policies where schemaname='storage'` in the dashboard SQL
  editor), commit as a migration so the repo is the record. Pairs with the queued KAL-287
  drop slices.

## Ticket disposition

The "confirm" half of KAL-288 is DONE — bucket private, evidence above. The "switch to
signed URLs" half is **re-scoped by the evidence**: nothing public exists to switch away
from; remaining work is S1 (dead fallback) + S2 (tripwire) + S3 (policy record). Recommend
S2 first (cap-free, locks in the good state).
