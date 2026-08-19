# Overnight backlog reconciliation — what happened

Written: 2026-08-19 (overnight). Starting point: production commit `d8e92cb6`.
Companion sheet with the per-ticket evidence: `AUDIT-DETAIL.md`.

---

## The one thing that blocks launch

**KAL-414 — switch Stripe from test to live.** Everything about the payment
plumbing is already correct and verified: both the test and the live webhook
endpoints exist, both are enabled, both carry all seven required events, and the
live products exist. The app is simply still running on test keys, so no real
money can move.

Five settings need to change, all in one place. The one that matters most is the
webhook signing secret: the live endpoint has its own, different from the test
one, and it is the setting people forget because everything else looks like a
straight key swap. Carry the test one across and **every real payment fails
silently** — the customer is charged by Stripe, the app never gets a valid
confirmation, and the account is never upgraded. No error appears anywhere. It
just looks like the app is broken while money is being taken.

Nobody has ever put a real card through this app end to end. That has to be
Isaiah, personally — agents are not permitted to enter card details.

## What shipped to production overnight

Six pieces of work, each built in its own workspace, each verified in the running
app rather than just built, all merged after the full test suite passed:

- **Tooltips no longer double up.** Twenty-six controls were showing the app's own
  tooltip and then the operating system's own tooltip fading in on top about a
  second and a half later. There is now one tooltip implementation for the whole
  viewer, replacing four — the sync status and active-users indicators included.
- **Single-tap pen dots in imported PDFs are visible again.** A dot someone taps in
  Acrobat or on an iPad used to vanish completely — on screen and from every
  export. They now render as a proper filled dot sized to the pen, and they
  survive export.
- **Text in a PDF can finally be selected and copied.** The machinery existed but
  nothing could switch it on. It is now a mode on the Select tool with a keyboard
  shortcut. Two genuine faults were found and fixed in the process — the layer was
  collapsing to zero size, and the annotation layer was swallowing the drag.
- **Excel rows that can't be placed are no longer thrown away silently.** When a row
  arrives from the linked workbook that the app can't match, it now appears in a
  short list at the top of the Survey panel with a plain-English reason. Before,
  it simply vanished. The severe case this fixes: when a whole batch is held back,
  the user's edits used to just not appear, with nothing explaining why.
- **Opening a document downloads 472 KB less.** The PDF-writing library was being
  fetched every time anyone opened a document, though it is only needed to export
  or print. It now loads when it is actually used.
- **About 1,100 lines of unreachable code deleted**, plus a slow, subtly incorrect
  data read replaced with the correct pattern.

Production was verified afterwards.

## Waiting on Isaiah

**One pull request** — [#799](https://github.com/Kal-Voe/Survey/pull/799), a
desktop sign-in security fix. It was held back for review rather than merged
because it touches authentication. Worth knowing what it found: the desktop app
would hand an authorization code to any site that asked, and a development-only
file server would serve any file on the machine through a symlink. Both proven
live, both closed, legitimate sign-in proven still working.

**One toggle** — leaked-password protection is currently off on the production
database (KAL-325). One switch, no downside before launch, deliberately not
flipped because production authentication settings are Isaiah's call.

**Four database clean-ups** (KAL-281, KAL-286, KAL-287, KAL-266) — all of them
rewrite or delete real rows, so they need a backup and a person present.

**One copy decision** (KAL-63) — the style guide says modal titles are Title Case;
the sign-in modal shipped in sentence case. Pick one.

## The backlog is smaller and truer than it looked

Ninety-one items were open. Only forty-seven are the Survey app at all — the rest
belong to Walkthru, the calculators, and the takeoff tool. Filtering by project
separates them cleanly.

Three items were already done and are now closed. Two were cancelled as outgrown.
About twenty were rewritten because what they described no longer matches the app.
All sixteen previously-cancelled items were re-checked; every one stays cancelled,
with the reason recorded on the ticket.

**There are no duplicates.** The backlog is densely cross-linked and carries none.
Nothing was deleted.

**Eight tickets were flatly wrong** in ways that would have cost a day each. The
most important: one asked us to advertise that PDFs never leave the user's
machine. They do — every path uploads to cloud storage. The marketing page also
claimed end-to-end encryption, which the product does not do; that line has been
corrected.

## New problems found along the way

- **KAL-441** — text typed into a PDF form is not written into the exported file.
  The user fills in a form, sends it, and the recipient opens a blank one.
- **KAL-445** — exporting a space appears to freeze the app. Pre-existing, and it
  needs reproducing by hand before anyone digs in.
- **KAL-443** — copying a document into a project stores a fake fingerprint, so
  copies opt out of duplicate detection.
- **KAL-440** — two permission layers disagree about whether authorship matters,
  and a refused delete is reported to the app as a success.
- **KAL-444** — the keyboard shortcuts list can't be opened from inside the viewer,
  which is the only place those shortcuts apply.

## What I'd tackle next

1. The Stripe switchover and the real-card test. Nothing else is a launch blocker.
2. Reproduce the space-export freeze by hand. If it is real, it is a launch blocker
   too — it is a paid feature failing silently.
3. The form-export bug. Silent data loss costs more trust than a missing feature.
4. Then the Excel security slice (KAL-314), which is the highest-value remaining
   work and is further along than the ticket list suggested.

## Two corrections I made to my own findings

Worth recording, because both were caught by looking harder rather than by
anything failing:

- I reported that an editor deleting a teammate's mark silently loses the delete.
  Tracing the actual write paths showed that overstated it — the routes that
  matter each pair with the matching permission rule today. The ticket is corrected
  and the real, narrower finding kept.
- I reported a dead button in the toolbar. It is not reachable; it was already
  hidden. Corrected.

One of the agents also pushed back on a finding of mine — a database query I
called unbounded turned out to be deliberately cross-document, and "fixing" it
would have broken template deletion. It refused, explained why, and wrote a test
to stop the next audit making the same mistake. That was the right call.
