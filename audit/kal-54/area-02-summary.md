# Area 2 — Auth + account setup · **PASS + FIXED**

Provisioned 4 disposable users via service-role admin (`audit/kal-54/scripts/area-02-auth-setup.mjs`):

- `survey-test-free-1779477209996@example.com` — tier=free
- `survey-test-pro-1779477209996@example.com` — tier=pro
- `survey-test-developer-1779477209996@example.com` — tier=developer
- `survey-test-enterprise-1779477209996@example.com` — tier=enterprise

All four signed in OK against the anon client; tiers upserted into `user_subscriptions` table with `status='active'` (`scripts/area-02-set-tiers.mjs`, logs/area-02-tiers.json).

**Bug found + fixed inline:** the bottom-left identity badge in `src/home/HubShell.jsx` defaulted to the hardcoded string `"Synced · Pro"`, and no caller ever passed `userMeta`. Every user — free, pro, enterprise, developer — saw "Pro" in the chip, a release-blocking subscription-status lie. Fix: read `tier` from `useAuth()` and render `TIER_LABEL[tier]`. Confirmed visually:

- Free user: `screenshots/a08-01-free-dashboard.png` shows "Synced · Free"
- Pro user: `screenshots/a07-01-pro-dashboard.png` shows "Synced · Pro"
- Enterprise user: `screenshots/a07-02-ent-dashboard.png` shows "Synced · Enterprise"
