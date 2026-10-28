# PDFs from Cloudflare R2

Supabase charges for every byte downloaded from Storage past the plan's
allowance, and every PDF open downloads the file. Cloudflare R2 charges nothing
for downloads. So opens can read a copy of each PDF from R2 while Supabase keeps
doing everything else: sign-in, the database, live editing, uploads, and the
decision about who may open which file.

## How it works

1. Uploads go to Supabase Storage exactly as before. Storage stays the home of
   every PDF; R2 only holds copies.
2. With the `pdf-r2` flag on, the app asks the `pdf-file-url` edge function for
   a link before it opens a PDF (`src/services/pdfR2Source.js`).
3. The function asks Storage for the file's details **with the person's own
   token**, the same per-open check the app already makes. The storage.objects
   access rules decide, unchanged. Refused or missing: 404, and R2 is never
   touched.
4. If R2 holds a copy whose ETag and size match Storage's, the function signs a
   10-minute R2 link. Otherwise it copies the file into R2 in the background
   (8 MB parts, so big drawing sets fit) and answers 202; the app reads from
   Supabase that one time.
5. Anything else (flag off, R2 not set up, R2 down, slow answer over 3 s) and
   the app reads from Supabase exactly as before.

A page edit rewrites a PDF in place: its ETag changes, so the old copy is never
served and a new one is made on the next open. A deleted or moved PDF lands in
`public.pdf_r2_deletes` (trigger on storage.objects), and the daily
`archive-purge-sweep` deletes its R2 copy. A copy waiting there is never served,
because the access check fails first.

Code: `supabase/functions/pdf-file-url/`, `supabase/functions/_shared/pdfFileUrl.js`
and `r2.js` (S3 signing with fetch + Web Crypto, no SDK),
`supabase/functions/archive-purge-sweep/r2CopySweep.js`, migration
`20261028090000_pdf_r2_mirror.sql`. Tests: `tests/pdfR2.test.mjs` and, against
a real S3 server (MinIO in the e2e stack), `tests/e2e-signed-in/pdf-r2.spec.mjs`.

## Setting it up

Owner, once:

1. Make a free Cloudflare account and turn on R2 (it asks for a card; the first
   10 GB stored is free and downloads are always free).
2. Create a bucket, e.g. `survey-pdfs`. Keep it private (no public access).
3. Create an R2 API token with **Object Read & Write** on that bucket only.
   Note the Access Key ID, Secret Access Key and the account's S3 endpoint
   (`https://<account id>.r2.cloudflarestorage.com`).

Then (Claude can do these):

4. Set the Supabase edge function secrets:
   `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
5. Set the bucket's CORS rule so browsers can stream the links:
   `node scripts/r2-copy-pdfs.mjs --cors` with the four `R2_` variables set, or
   paste this in the bucket's CORS settings:
   ```json
   [{ "AllowedOrigins": ["*"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["range"],
      "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"], "MaxAgeSeconds": 3600 }]
   ```
   `*` is right here for the same reason as the edge functions' CORS: the app
   runs on the web, Electron (`file://`) and the mobile apps, and each link is
   its own permission.
6. Optional: warm R2 with every existing PDF so first opens are fast too:
   `node scripts/r2-copy-pdfs.mjs --production` (with `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`). Skipping it is fine; each file is copied the
   first time someone opens it. `--prune` also deletes copies with no PDF.
7. Turn `pdf-r2` on for testers at /flags, check opens, then for everyone.

Turning it off: set the flag to off. Opens go straight back to Supabase; the R2
copies can stay or be deleted.

## Costs

R2: $0.015 per GB a month stored, first 10 GB free, no download fees. Each PDF
is downloaded from Supabase once more to make its copy. See
`/mnt/project-files/security/supabase-alternatives-and-compliance.md` for the
sums (about $830 a month down to about $190 at 10,000 users).
