# Linear reconciliation — detail sheet

Written: 2026-08-19 (overnight session). Audited against production commit `d8e92cb6`,
which is exactly what https://surveytool.app was serving at the time.

Every verdict below came from reading current code, querying the live production
database read-only, or both. No verdict was taken from a status document — several
of those in this repo are month-old snapshots that have caused false conclusions before.

## The shape of the backlog

91 items were open at the start. They are **not** all the Survey app:

| Project | Open items |
|---|---|
| Survey (the PDF app) | 47 |
| Walkthru (audio/transcription — separate product, separate database) | 17 |
| EDC Calculators (pricing calculators — separate product) | 14 |
| Takeoff (measurement tool) | 3 |
| No project assigned | 10 |

Of the ten unassigned, five were the Excel Security V1 epic and its slices — they are
Survey work and have been moved into the Survey project along with their five completed
siblings. The other five were "Reference:" notes rather than tasks.

## Closed as already done

| Ticket | Why |
|---|---|
| KAL-58 empty states | One shared `EmptyState` component now serves all three hub tabs with icon, headline, supporting line and a gold call-to-action. |
| KAL-267 content-hash dedup | The column, the unique index and the server-authoritative dedup path all exist; every document created since 2026-06-11 carries a hash. |
| KAL-416 thumbnail panel | The panel already does everything the ticket listed as a candidate gap, and the reference builds it was to be compared against no longer exist. |

## Cancelled as outgrown

| Ticket | Why |
|---|---|
| KAL-425 architecture reference | Describes Syncfusion, Fabric 5.5.2 and a 1.3MB `App.jsx` — none of which exist. |
| KAL-424 workflow reference | Pins a repo path that is no longer where the project lives; not a task. |

## Cancelled items re-audited — all eleven stay cancelled

KAL-395, KAL-396, KAL-392, KAL-408, KAL-268, KAL-276, KAL-35, KAL-25, KAL-391, KAL-39,
KAL-41, KAL-71. Each was checked against current code and each was cancelled for a
reason that still holds; evidence is recorded as a comment on the ticket itself. The two
most worth knowing:

* **KAL-395/396** were cancelled on the theory that shipped functionality was unreachable.
  It is reachable — the arrowhead dropdown and the full rich-text row both live in the top
  tool strip today.
* **KAL-268/276** were steps in a persistence rollout that was replaced rather than
  abandoned: expansion now happens automatically per document on open, sealed by a
  cutover stamp. The only residue is tracked by KAL-275 and KAL-266.

## Duplicates

There are effectively none. The backlog is densely cross-linked with `related` and
`blocks` relations and carries **zero** duplicate relations; one ticket (KAL-50) was
already parked in the Duplicate state. The only genuine overlap found was KAL-367 and
KAL-368 against KAL-371, which is definitionally their umbrella — those two are now
children of KAL-371 rather than being closed, since each is a separately measurable
workstream.

Nothing was deleted. Two ordering inconsistencies are worth the owner's eye: KAL-38 is
recorded as blocking KAL-36, but KAL-36 is closed while KAL-38 is open; the same pattern
appears with KAL-367 blocking the already-closed KAL-366. Some `blocks` links look like
they were entered backwards.

## Tickets whose premise turned out to be wrong

These are the ones worth reading, because acting on them as written would have wasted time:

* **KAL-419** asked to market "your PDFs never leave your machine". They do — every path
  uploads to cloud storage. The marketing page also claimed end-to-end encryption, which
  is not what the product does; that line has been corrected in this session.
* **KAL-397** says the auto-fit behaviour exists and only the settings UI is missing. The
  opposite is true: the behaviour is creation-time only, the flag does not exist, and there
  is no Preferences surface at all.
* **KAL-287** feared that collaborative updates were being silently dropped because a table
  was empty. That table is a superseded predecessor; the live one holds 3,313 rows with a
  write from two days ago. Two of its "dead table" claims were also wrong.
* **KAL-266** targeted a snapshot table that has been frozen since 2026-06-06. Its real
  payload — a 78% row reduction in the annotation table — is still entirely valid.
* **KAL-282** describes a slow reader on a table that does not exist under that name, and
  the function has no callers in the app at all.
* **KAL-389** was a one-line Syncfusion property flip; Syncfusion is gone.
* **KAL-253** references a file and a feature flag that have never existed in this repo —
  it belongs to the separate Takeoff codebase, so it was left untouched rather than cancelled.
* **KAL-420** listed six live tests; three are already invalidated by a permissions change,
  one is a design question rather than a test, and two are worth running.

## New tickets filed from what the audit found

* **KAL-440** — the two permission layers disagree about whether authorship matters, and a
  delete the database refuses is reported to the app as a success. **Note:** this was first
  filed as a confirmed data-loss bug; tracing the write paths showed that was overstated and
  the ticket has been corrected in place. What remains proven is the silent-success shape and
  the inconsistency itself, which KAL-314 will make live.
* **KAL-441** — values typed into a PDF form are not written into the exported PDF.
* **KAL-442** — the annotation properties panel is 805 lines of unreachable dead code.
* **KAL-443** — copying a document into a project writes a fake content fingerprint.

## Needs the owner personally

* **KAL-414** — the Stripe test-to-live switchover. Five settings, and one real card.
* **KAL-325** — leaked-password protection is off on production. One toggle. Deliberately
  not flipped here because production authentication settings are owner-gated.
* **KAL-281 / KAL-286 / KAL-287 / KAL-266** — all rewrite or delete rows in the production
  database. Backed up first, owner present.
* **KAL-291** — the Azure portal change and the work-account sign-in.
* **KAL-63** — one copy decision: the style guide says modal titles are Title Case, the auth
  modal shipped in sentence case.
