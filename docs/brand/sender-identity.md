# Sender identity — getting the Survey icon next to our emails

_Written: 2026-08-11. Owner-directed. Companion to docs/design/email-style-guide.md
(which covers the email BODY; this file covers the AVATAR next to the sender)._

## Reality by inbox (researched 2026-08-11)

| Inbox | Mechanism | Cost | Status |
|---|---|---|---|
| Yahoo / AOL / Fastmail | self-asserted BIMI DNS record | free | record ready below |
| Apple Mail (iOS 18.2+) | Apple Business Connect "Branded Mail" | free | needs owner Apple ID sign-in, logo ready |
| Gmail (unofficial) | Google account for the sending address + profile photo | free | needs owner to create account; works "most of the time" |
| Gmail (official) | BIMI + Common Mark Certificate | ~$650–1,100/yr | deliberately deferred |
| Outlook (all flavors) | none — Microsoft renders no sender logos, no roadmap | n/a | impossible today, paid or free |
| Spark & other 3rd-party apps | Gravatar for no-reply@surveytool.app | free | needs owner account |

## Assets (done)

- `docs/brand/bimi-logo.svg` — the Survey mark rebuilt as pure vector, SVG Tiny PS
  (BIMI's required flavor). Hosted live (public, no code push needed) at:
  `https://cvamwtpsuvxvjdnotbeg.supabase.co/storage/v1/object/public/brand/bimi-logo.svg`
- `docs/brand/apple-branded-mail-1024.png` — 1024x1024 for Apple Business Connect.

## DNS changes (Cloudflare, zone surveytool.app) — ALL DONE 2026-08-11, publicly verified

1. EDIT existing TXT `_dmarc` — from `p=none` to enforcement (prerequisite for
   BIMI and Apple Branded Mail; low-risk: all mail is Brevo-authenticated):
   `v=DMARC1; p=quarantine; rua=mailto:rua@dmarc.brevo.com`
2. ADD TXT `default._bimi` :
   `v=BIMI1; l=https://cvamwtpsuvxvjdnotbeg.supabase.co/storage/v1/object/public/brand/bimi-logo.svg`
3. Email Routing ENABLED: rule `no-reply@surveytool.app` → isaiahcalvo123@gmail.com is Active;
   Cloudflare MX x3 + DKIM + SPF records added. SPF was hand-extended to include
   `include:spf.brevo.com` alongside Cloudflare's, since Brevo is the actual sender.

## Owner-only steps (accounts; assistant may not create accounts or enter passwords)

- **Apple Branded Mail**: business.apple.com → sign in → add brand → upload
  `apple-branded-mail-1024.png` → link domain surveytool.app. Review ≤7 business days.
- **Google account trick**: accounts.google.com/signup → "Use your existing email" →
  no-reply@surveytool.app (verification arrives via the routing rule above) → set the
  profile photo to the Survey icon.
- **Gravatar**: gravatar.com → account for no-reply@surveytool.app → upload the icon.
