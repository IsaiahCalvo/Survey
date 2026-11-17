# Email style guide — transactional email

Written: 2026-08-11 13:30

Every email Survey sends is a **transactional email** — triggered by something
the user (or a collaborator) did: sign-up confirmation, share notifications,
billing receipts, security alerts. There is no marketing email system; if one
ever appears, it gets its own guide.

## Terminology

| Term | Meaning |
|---|---|
| **Transactional email** | Any app-triggered email (auth, sharing, billing, security). |
| **Base layout** | The one shared branded frame every email renders through: `supabase/functions/_shared/emailLayout.ts` (`renderEmailLayout`). |
| **Template** | A named body that plugs into the base layout — e.g. `document-shared` in `supabase/functions/send-email/index.ts`, or a Supabase Auth mailer template. |

## Where templates live

1. **`send-email` edge function** — 8 app templates (`trial-ending`,
   `payment-failed`, `subscription-canceled`, `payment-succeeded`,
   `document-invite`, `document-shared`, `permission-changed`,
   `access-removed`). All render through `renderEmailLayout`.
2. **`send-profile-change-notification` edge function** — the account security
   alert. Same frame.
3. **Supabase Auth mailer templates** — stored in the hosted Auth config, not
   in this repo. Edited via the Management API
   (`PATCH /v1/projects/<ref>/config/auth`, fields `mailer_templates_*_content`).
   The confirmation / invite / magic-link / recovery four are the original
   visual precedent for this whole system. Pre-change snapshots of anything we
   modify live in `debug/email-templates-rollback/`.

## Anatomy of the frame

Top to bottom, one 600px white card on a light grey background:

1. **Header** — the hosted logo (`https://surveytool.app/logo192.png`, empty
   alt, 30px) beside the spaced wordmark "SURVEY" in ink. Account emails
   (sign-in, confirm, reset) carry the suite's name, "KAL VOE", with no logo.
   The text wordmark means the brand survives image-blocking clients.
2. **Coral rule** — a 2px coral line under the header.
3. **Body** — one sentence-case `<h1>` in ink (or danger red for alert
   emails), paragraphs built from the exported style fragments, and at most
   one button.
4. **Footer** — outside the card: who sent it, and the true reason the
   recipient got it.

## Palette

The suite's grey and coral (`docs/suite/SUITE-RULES.md`, "One colour set",
KAL-663). Literal hexes on purpose — email HTML cannot use CSS variables.
Light is written inline; the dark column applies in clients that honour
dark mode (Apple Mail, Outlook). Gmail ignores it and inverts the light one.

| Name | Light | Dark | Use |
|---|---|---|---|
| ground | `#f4f4f6` | `#131315` | Page background |
| panel | `#ffffff` | `#1c1c1e` | The card |
| raised | `#f5f5f5` | `#242426` | Code block, file card, quote |
| line | `#ececec` | `#3f3f43` | Rows inside the card |
| line-strong | `#d4d4d4` | `#3f3f43` | Card and tile frames |
| text | `#131313` | `#e8e7e2` | Headings, strong text |
| text-2 | `#4b4b4b` | `#d2d1cc` | Body |
| text-3 | `#666666` | `#9a9a97` | Fine print, footer |
| coral | `#ba4f2c` | `#e07a5e` | Button, rule, file badge |
| on-coral | `#ffffff` | `#131315` | Button label |
| danger-text | `#b42318` | `#f87171` | Headings of alert emails only |

No gold, no blue, no green accent.

## The button rule

One primary button style, app-wide: a **link styled as a button** — a padded
`<a>` with the coral fill and the on-coral label (re-declared on an inner
`<span>`), bold, 6px radius, wrapped in its own table cell that also carries
the background (so Outlook fills it too). In dark mode it takes the bright
coral with dark words, as the apps do. Never a `<button>` element (clients
strip or ignore them), never per-template button colors, at most one button
per email. Labels are sentence case ("Manage subscription", "Open invite").

One-time codes use `emailCode()` — a mono, high-contrast block — not a button.

## Email-client constraints (non-negotiable)

- **Table-based layout.** Flexbox/grid do not exist in email clients.
- **ALL styles inline.** Clients strip `<style>` blocks; the layout emits none.
- **Max-width 600px, centered**, `width:100%` so phones shrink it.
- **System font stack** (`-apple-system, 'Segoe UI', Roboto, Helvetica, Arial`).
- **Images may be blocked.** Every email must read fine without the logo — the
  wordmark text and alt text carry the brand.
- **Dark-mode clients recolor emails.** Every surface sets an explicit
  background color; nothing relies on a client-default white, and the header
  band is explicitly dark so the logo never sits on an inverted background.
- **Absolute URLs only** — for the logo and every link. Email clients cannot
  resolve relative paths.

## Copy

Sentence case throughout, per `docs/ui/copy-style-guide.md`: headings and
button labels are sentence case; user-entered strings (document names) are
never re-cased. Every template must keep working when optional data is missing
(the send-email templates default names/roles).

## Adding a new template

1. Add a key to the `templates` map in `supabase/functions/send-email/index.ts`.
2. Build the body from the exported fragments: `EMAIL_P_STYLE`,
   `EMAIL_MUTED_STYLE`, `EMAIL_FINE_STYLE`, `EMAIL_LIST_STYLE`, `emailButton`,
   `emailCode`. Do not hand-roll new inline styles.
3. Wrap it with `renderEmailLayout({ heading, bodyHtml })`; add
   `headingColor: EMAIL_DANGER` only for destructive/alert messages.
4. Remember the caller controls the subject line — keep it sentence case.
5. User-controlled strings are already HTML-escaped by the function's
   `escapeHtml` pass; URLs must be http(s) or they are dropped to `#`.
6. `node --test tests/emailLayout.test.mjs` guards the frame invariants.

Auth mailer templates follow the same frame but keep Supabase's Go-template
variables (`{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .Email }}`, …) intact.
Never touch any `smtp_*` field in the auth config — the SMTP setup is
owner-managed.

## Gmail sender avatar (deliberately deferred)

The logo next to the sender name in Gmail's inbox list is **BIMI**, not
something a template can set. It requires DMARC at an enforcing policy
(`quarantine`/`reject`) on surveytool.app plus a paid Verified Mark
Certificate (VMC) tied to a registered trademark. Parked until that trade-off
is worth it; the in-email header band carries the brand meanwhile.
