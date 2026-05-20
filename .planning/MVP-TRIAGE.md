# Linear Triage — Pre-MVP vs Post-Release

_Written: 2026-05-17 — source: Linear workspace "Kal Voe", Survey project._

35 open issues total. 4 belong to the separate **Walkthru** product (speech-to-text)
and are excluded here. The remaining 31 Survey issues are split below.

## Pre-MVP — needed before public release (11)

These either break a core feature, risk losing a user's work, or define the MVP itself.

- **KAL-15** — Map end-to-end annotation workflow as product spec. _Do this first; it defines what the MVP actually is._
- **KAL-17** — Survey highlight jump accuracy. Core Survey navigation is off-target.
- **KAL-18** — Survey panel dropdown blocked by right rail. Survey panel is partly unusable.
- **KAL-24** — Windows catch-up race; Mac marks disappear on Windows. Looks like data loss.
- **KAL-28** — Yellow highlighter sync + erase bugs. Core annotation type broken cross-device.
- **KAL-30** — Remaining callout issues. Core annotation type is buggy.
- **KAL-10** — Final two-user collaboration validation. Must prove collab works before shipping it.
- **KAL-29** — Phase 35 mixed-author deletion UAT. Must validate multi-user delete correctness.
- **KAL-32** — Sync-fail local copy + merge fallback. Protects users from losing work when cloud sync fails.
- **KAL-26** — Audit plan gates: confirm Free keeps personal cloud sync; only multi-user editing is paid. _Code audit + copy cleanup; the real invite-flow enforcement is KAL-31._
- **KAL-42** — Remove white viewport border. Cheap, visible to every user, bad first impression.

## Judgment calls — depends on launch scope (4)

- **KAL-31** — Share-link flow. Pre-MVP **if** sharing is part of the launch pitch; post-release if the MVP is "annotate + sync" only.
- **KAL-9** — Test imported PDF edge cases with real PDFs. Pre-MVP if users open real-world annotated PDFs (likely). Otherwise defer.
- **KAL-21** — Clean PDF render failure state. Graceful failure matters for trust; defer only if launch scope is tight.
- **KAL-23** — Upload/share error banners + loading states. Same — error feedback matters but can be a fast-follow.

## Post-release — safe to defer (16)

UX polish, nice-to-have features, QA verifications, and tech debt. None block a credible public release.

- Polish: KAL-41 (export button position), KAL-40 (horizontal rail tabs), KAL-39 (right-rail expand arrow), KAL-25 (move Survey icon), KAL-22 (empty states)
- Features: KAL-34 (text box mini-toolbar), KAL-33 (line/arrow mini-toolbar), KAL-19 (Syncfusion form designer)
- Bugs/QA, low impact: KAL-27 (Save Log double-push), KAL-20 (verify unsupported-annotation warning)
- Export pipeline: KAL-7 (decide export scope — _cheap decision, can make early_), KAL-8 (print/export UI mockups)
- Tech debt: KAL-11 (split App.jsx), KAL-12 (organize utils), KAL-13 (review duplicate components), KAL-14 (bundle size)

## Excluded — separate product (4)

KAL-35, KAL-36, KAL-37, KAL-38 — all Walkthru (speech-to-text). Not part of this repo.
