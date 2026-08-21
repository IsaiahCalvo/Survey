# Account-settings overlap — intact vs repaired

Date: 2026-08-20
Status: **repaired**
File: `src/components/AccountSettings.jsx`

Last-write had stomped both workers. The file on disk was the pre-audit baseline (disabled delete, `signInWithGoogle` Connect, always-on Change password, no Capacitor Microsoft hide, combined profile save).

## Checklist

| Behavior | Before overlap pass | After |
|---|---|---|
| Google Connect uses `linkIdentity` (not sign-in) — P2-08 | **missing** (`signInWithGoogle`) | restored (`linkGoogleIdentity`) |
| Capacitor hides Microsoft Connect/Reconnect — P2-13 | **missing** | restored |
| Delete-account collaborator block + typed DELETE — P2-03/P2-15 | **missing** (permanently disabled) | restored |
| Google-only “Set a password” — P2-32 | **missing** | restored |
| Partial name/password save reporting — P2-31 | **missing** | restored |

## What was missing

All five. Neither worker’s `AccountSettings.jsx` edits survived. Supporting helpers those imports need were also gone (`linkGoogleIdentity`, `describeProfileSaveOutcome`, `passwordChangeKind`, `accountDeletionUserMessage`).

## Repair (minimum viable merge)

Re-applied the account-settings UI, then the Microsoft hide, so both coexist:

- Connect Google → `linkGoogleIdentity` / `auth.linkIdentity` (same-user check).
- Microsoft Connect/Reconnect hidden when Capacitor native or `capacitor://` / `ionic://`; copy: “Not available in the iOS/Android app. Connect on web or desktop.” Also honors `microsoftConnectAvailable` from `useMSGraph` when present.
- Delete account enabled; typed `DELETE` confirm; collaborator-block copy via `accountDeletionUserMessage`.
- No email identity → “Set a password”, no current-password field / re-auth.
- Name and password save in separate try blocks; `describeProfileSaveOutcome` reports partial success.

Supporting restores required for those imports to resolve (not new work): `src/utils/accountPlatform.js`, `src/contexts/AuthContext.jsx`.

## Tests

```
node --test tests/accountSettingsLogic.test.mjs tests/accountNativeE2EContracts.test.mjs tests/accountPlatformParity.test.mjs tests/authAccountFlows.test.mjs
```

**52/52 pass.**
