# Leftover-18 notes — owner-local receipts fold (2026-08-25)

Supersedes the secret-provisioning plan in PR 800 comment `5411980649`. Authoritative host evidence is PR 800 comment `5414370572` ("Leftover-18: local receipts delivered"). Full receipt texts are inline there. This VM did not replay those slices and will not apply `20260820*.sql`.

**Does not mark the audit goal complete.**

## Host-proved (owner-local)

- **X-01** — identity-churn / signed-in cloud save
- **X-05** — cloud persist of form values on a real `file.id`
- **U-04** — Dashboard + Supabase live usage meter
- **UL-13** — real `updateProfile` persist
- **A-06 / UL-45** — second signed-in collab roster

Receipt source: https://github.com/kal-voe/survey/pull/800#issuecomment-5414370572

## Still human-gated (parked)

- **A-01 / UL-15** — live Turnstile
- **UL-22** — live Google OAuth
- **A-02 / X-06 / UL-21** — live MSAL / Graph / writeback
- **UL-03** — native NSOpenPanel
- **UL-16** — live account wipe (not authorized)
- **A-05 / UL-20** — live Stripe Checkout
- **A-03 / UL-24** — live invite email

Do not spin on these. Fail-closed local slices stay dedicated.

## New product bugs (from the same receipts; not leftover-18)

1. Archived documents still count toward the free-tier 5-document cap.
2. Invite links falsely report "already accepted" to a second real account; `?docId=` does not resolve the invite row. Remove collaborator leaves invite rows in the DB.
3. Saved profile first/last name cannot be cleared back to blank.

Goal stays open.
