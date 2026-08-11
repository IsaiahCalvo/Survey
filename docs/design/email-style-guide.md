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

Top to bottom, one 600px card on a bone background:

1. **Header band** — dark ink surface (`#12151c`), the hosted logo
   (`https://surveytool.app/logo192.png`, alt "Survey", 32px) plus the
   wordmark "Survey" in bone. The text wordmark means the brand survives
   image-blocking clients.
2. **Body** — white surface, one sentence-case `<h2>` heading in gold-soft
   (`#b6904a`) — or destructive red for alert emails — then paragraphs built
   from the exported style fragments, and at most one CTA button.
3. **Footer** — faint band: `Survey — surveytool.app`.

## Palette

Literal hexes on purpose — email HTML cannot use CSS variables. These mirror
`docs/design/design.md`:

| Token | Hex | Use |
|---|---|---|
| Gold | `#d8a84e` | CTA button fill (the only button color) |
| Gold-soft | `#b6904a` | Headings, footer link |
| On-gold ink | `#15110a` | Button label text |
| Ink | `#1f2430` | Body text |
| Ink-deep | `#12151c` | Header band |
| Bone | `#f4f1ea` | Page background, wordmark |
| Destructive red | `#d95a56` | Headings of alert/removal emails only |
| Muted / faint | `#666666` / `#999999` | Secondary text / fine print |

## The button rule

One primary button style, app-wide: a **link styled as a button** — a padded
`<a>` with `background-color: #d8a84e`, `color: #15110a`, bold, 6px radius,
wrapped in its own table cell that also carries the background (so Outlook
fills it too). Never a `<button>` element (clients strip or ignore them),
never per-template button colors, at most one button per email. Labels are
sentence case ("Manage subscription", "Open invite").

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
