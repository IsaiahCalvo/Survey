# Active local draft index

Date: 2026-09-10

## Decision

Keep discarded-session tombstones as stale-writer fences, but list recoverable
drafts through a native IndexedDB index rather than reading every tombstone.
Writable draft storage moves from version 2 to version 3. Live session rows have
`active: 1`; discarded rows have `active: 0`. The `active` index is non-unique,
not multi-entry, and has exactly the `active` key path.

A separate singleton `draftMeta` row records the active count. First capture
adds one in the same transaction as the session, PDF reference and state.
Discard subtracts one in the same transaction as its tombstone and payload
cleanup. Updating a draft does not change the count. Repeated discard fails
without changing either the count or another draft.

Listing reads the index count, saved count and active cursor in one readonly
transaction. A mismatch fails closed; a missing index flag must not silently
hide saved work. Each returned row still receives the full metadata check.
Opening version 3 checks the new index contract before allowing writes. A
mutation also rejects a live row whose active flag is damaged.

## Migration and rollback

The version-change transaction validates all old session rows, writes their
active flags, and records the count. Malformed rows abort the entire upgrade;
no partial version-3 index becomes visible. The upgrade preserves PDF bytes,
draft state, writer identities, sequence checks and tombstones.

Existing-only recovery readers can still read version 1 or 2 without upgrading
them. Those versions keep the old full-session scan. Unknown future versions
remain unsupported, with data retained. After a version-3 upgrade, old writable
version-2 code cannot reopen the database; it must fail rather than write rows
that omit the index and count. A code rollback must not delete this database or
try to force its version down. Recovery needs a compatible reader.

## Scope and evidence

This changes local recovery-list work, not cloud storage, document ownership or
Microsoft sync. Tombstones remain small but still accumulate. The index reduces
JavaScript cursor work to live drafts; it does not prove a fixed disk bound or
constant-time native index counting.

The focused test uses 24 tombstones and two live drafts and observes two cursor
continuations. Separate tests cover atomic migration, malformed schema and row
rejection, count overflow, repeated discard, concurrent stores, shared-PDF
reference cleanup and aborted transactions.

The in-app browser fixture uses native IndexedDB and an exact temporary database.
Two runs migrated a version-2 database containing 40 tombstones and one live
draft, captured another draft, discarded it, rejected a repeated discard, and
cold reopened the store. Both runs reported 41 tombstones, one live row, equal
index and recorded counts, and exact PDF bytes and state before and after reopen.
The fixture's cleanup button completed for its exact database. Only the expected
missing-cloud-credentials warning appeared. This proves the native store path,
not the Dashboard recovery UI or a live cloud flow. The focused local-draft and
recovery checks passed 77 tests. The final checkpoint's full `npm test` run
passed with 6,961 tests: 6,865 passed, 96 skipped, zero failed or cancelled across
696 files. `npx vite build` passed with the existing large-chunk warning.
