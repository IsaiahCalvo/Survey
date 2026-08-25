# Archived documents no longer count toward the free-tier cap

**This-pass (2026-08-25):** product + proof for receipts-comment bug (a).

## Change

`src/hooks/useSubscriptionLimits.js` document-count query now matches
`useDatabase.js`'s library list: `.eq('archived', false)` and
`.is('user_archived_at', null)`.

## Proof

- Node `tests/subscriptionLimitsArchiveCount.test.mjs` **3 / 3**
- Playwright `e2e-subscription-archive-count.spec.mjs` **1 / 1 (5.3s)** on
  reused Vite `http://127.0.0.1:5173`
- hubPreview Usage still shows Documents; served hook has the archive filters
  (Vite rewrites quotes — assertion accepts both)
- Did **not** click Start trial / Subscription apply / Delete account / Sign out
- Did **not** apply `20260820*.sql`
- Isolated **8448** still standing
