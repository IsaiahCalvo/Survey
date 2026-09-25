# Shared files and Microsoft Excel: data safety review

## Scope

Built from main `9f6c3f07`, which includes the earlier storage/data architecture work. This follow-up covers annotation REST sync, Microsoft account custody, OneDrive/SharePoint transport, Excel export receipts, registered imports and retry records. It does not claim full offline-first support or live Microsoft round-trip proof.

## Acceptance criteria

- Given queued edits from user A, switching to B never sends or loads A's work under B's token; pending work stays recoverable.
- Given two actors making separate edits, both survive a cold reopen without duplicate echo writes; rejected writes preserve accepted work.
- Given a Survey account change, old Microsoft clients and delayed restore/login/refresh results cannot take over the new account.
- Given a workbook request failure, preserve its status and retry delay; do not silently replay a write whose result is unknown.
- Given a moved row or replaced pending token, old work cannot write into the new row or clear the newer entry.
- Given a lost import response, reuse the same durable attempt ID, scoped to its document/template/workbook.
- Given simultaneous tabs, one registered import owns that workbook's pending record until submit, materialization and clear finish.
- Given an export in flight, acknowledge only its captured data; newer edits stay pending and a changed document/template/workbook receives no stale completion.
- Given a SharePoint file, reads, writes and open actions use its selected drive, not the user's personal OneDrive.

## DO NOT CHANGE

Keep RLS, annotation ownership, CORS, geometry, Zoom/SVG contracts, workbook registration and signed Row IDs unchanged. Keep both automatic Excel writeback gates off. Do not alter user subscriptions, provision accounts, delete files/history, migrate cloud data, or operate on a real Microsoft workbook without an exact test target.

Allowed changes: the specific annotation request wrapper, Microsoft context, Excel transport/retry/receipt helpers, small PDFViewer sync/export call-site changes, and regression tests. Other worktrees remain untouched.

## Changes

### Multi-user annotation sync

Every annotation REST request now checks the handle's actor and captures that user's JWT on the individual request builder. Shared-client auth cannot change attribution between queueing and sending. This covers WAL and snapshot reads/writes, cold open and reconnect. No shared headers or server access checks are bypassed.

### Microsoft accounts

Reset account-scoped tokens and clients when Survey identity changes. Reject stale login, restore and refresh replies, and retained Graph clients. Silent desktop restore requires the exact Microsoft account already linked to that Survey user. Web OAuth callbacks also check the initiating Survey identity. This does not clear the device's unrelated Microsoft accounts.

### Excel transport

- Retain Graph error status, code and Retry-After information.
- Follow bounded list pages through validated, canonical Graph URLs; never forward a raw continuation string after validating a different URL.
- Escape worksheet/range string literals, including apostrophes.
- Use the dedicated session refresh request instead of downloading worksheet lists for keepalive.
- Serialize same-workbook writes within each Graph client. Keep Row-ID pre-read/write/read-back together and recheck queued entry identity before reads and writes.
- Honor a reported cooldown for queued writes. Disable the SDK's default automatic replay for write requests; reads retain SDK retry behavior.
- Preserve newer queue entries and refuse malformed read responses instead of treating them as blank cells.

### Registered Excel imports

Save the retry ID before the first network request. Keep separate document/template/workbook records and clear only the completed attempt. Use a native cross-tab Web Lock for the entire production attempt, including pending read, submit, materialization and clear. Environments without Web Locks stop registered sync safely; local/unregistered import is unchanged.

Fingerprint the worksheet and physical row positions. If an unfinished attempt's rows changed, or a legacy retry lacks the fingerprint, retain it and request review rather than apply old row indices to new content. Recheck the source after waits and inside reducer writes. Exhausted merge retries report conflict instead of overwriting a newer marker.

### Exports and polling

Stop on partial worksheet failures. Never report a disabled or unwritten automatic export as successful. Store the baseline of the exported snapshot, not edits made during the upload. Preserve current content, newly added rows and deletes while merging receipts. Scope baselines by actor and stable cloud document ID; old ambiguous name/size baselines are not inherited.

Guard export completion and pending cleanup by source identity. Do not guess a local OneDrive account folder after cloud export; let OneDrive's own client handle its local copy. Cloud Open Excel resolves the selected file's web URL. Duplicate-check failures no longer authorize overwrite, and unknown metadata requires the existing explicit warning.

Polling never overlaps its own slow reads and ignores retired replies. Keep the worksheet comparison baseline across normal callback rerenders, but reset it when client/account, drive, file or session changes.

## Verification

Baseline: 4,032 tests, 3,978 passed, 54 skipped, zero failures. The final combined local run passed 4,057 of 4,111 tests with 54 skips, zero failures and zero cancellations. The final changed-path suite and fresh production build also passed. CI checks the exact commit separately.

New tests execute real callbacks and mounted React context behavior. Annotation transport tests use the installed Supabase request builder with fake HTTP/session data, including two actors, rejected writes, account switching and cold reopening. Graph tests also use the installed SDK with fake fetch to verify exactly one write attempt and safe next-link handling. These are not live-provider tests.

Real local browser: the PDF/form fixture renders; two separate tabs using the actual Excel lock module proved exclusion and release. The in-app browser was unavailable, so the connected Playwright browser was used. The dev server uses a separate dependency cache to avoid clashing with other worktrees.

Independent review reproduced two transport blockers (stale queued writes and raw next-link parsing) and the poll-baseline reset issue. They were fixed with regression tests. Review also led to source guards and a cross-tab lock for pending imports.

## Release limits and required live checks

Do not treat this branch as proof that Microsoft coauthoring is production-safe. All seven saved test identities still found in Supabase were free-tier; no paid test owner was available. No designated non-production Microsoft 365 workbook was supplied. No accounts were changed and no live workbook was written.

Before rollout, use exact leased Survey accounts and a designated Business Microsoft 365 workbook to test owner/editor/viewer roles, revocation, simultaneous edits, reconnect, account changes, Excel row moves, locked files, and round trips. Verify cleanup of exact test documents, shares, invites and storage paths before releasing leases.

Remaining work:

- Manual whole-workbook replacement still lacks a verified server-side conditional-write contract. It is not safe automatic coauthoring; both automatic writeback gates stay off.
- A local client write queue does not serialize other devices or Microsoft Excel itself. Server access checks, conflict review and read-back remain required.
- Realtime channel JWT/lifetime behavior still needs live role/account-switch verification; REST actor binding alone does not prove that path.
- The old workbook-session lifecycle can still create a session during teardown and needs a separate lifecycle change/test.
- Pending-attempt storage remains localStorage. The full-attempt Web Lock protects current production callers, not older app versions or unrelated code that ignores the lock. A transactional outbox migration remains the longer-term target.
- Browser cold-start offline, local document manifests, full offline import, and explicit local/cloud publishing remain in the previous architecture plan.

## Sources

- [Microsoft Excel request and session best practices](https://learn.microsoft.com/en-us/graph/workbook-best-practice)
- [Excel error handling](https://learn.microsoft.com/en-us/graph/workbook-error-handling)
- [Workbook session refresh](https://learn.microsoft.com/en-us/graph/api/workbook-refreshsession?view=graph-rest-1.0)

## Rollback

Code revert only; no database migration is added. Preserve all pending edits and retry records. The new scoped retry records are not read by older clients, so do not downgrade a client with unfinished new-format Excel retries without first resolving or migrating them.
