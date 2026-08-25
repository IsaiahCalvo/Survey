# Profile first/last name can clear back to blank

**This-pass (2026-08-25):** product + proof for receipts-comment bug (c).

## Change

`src/components/AccountSettings.jsx` — first/last inputs are no longer
`required`. Save trims and persists empty strings (`full_name` joins the
remaining parts).

## Proof

- Node `tests/profileNameClear.test.mjs` **3 / 3**
- Playwright `e2e-profile-name-clear.spec.mjs` **1 / 1 (3.1s)** on reused Vite
  `http://127.0.0.1:5173`
- Empty / whitespace names are HTML-valid; Save attempts persist and
  hubPreview still fail-closes (`Preview cannot save profile changes`)
- leftover18-save-export UL-13 updated: empty names valid locally; cloud
  persist still throws
- Did **not** click Delete account / Sign out / Subscription apply
- Isolated **8448** still standing
