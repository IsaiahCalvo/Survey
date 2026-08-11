# UI colours — the danger reds

Written: 2026-08-11

This file exists for one reason: the app has **two** reds on purpose, and every
few months someone decides that is a bug and collapses them. It is not a bug.

## The two-tier rule (locked)

| Tier | Value | Hover | What it means to the user |
|---|---|---|---|
| **Destructive** | `#d95a56` | `#c84c49` | "You are about to do something irreversible." |
| **Validation hint** | `#d97766` | — | "This field is empty, fill it in." |

The destructive red is **cooler and more serious**. The validation red is
**warmer and softer** — it marks a recoverable mistake the user fixes in the
next second, not a decision they cannot take back. Both are danger-semantic;
the temperature difference is the hierarchy. **Do not unify them.**

### Destructive `#d95a56`

Used for:

- every irreversible primary action button — Delete document, Delete
  annotation, Remove member, Delete forever
- the accent on every error banner (see below)
- destructive items in row/context menus

Token: `--accent-red` / `--accent-red-hover` in `src/App.css`. JS surfaces that
render outside a CSS-variable scope mirror the literal in their local palette
map (`C.danger`, `DANGER`) — those are copies of this token, not new decisions.

### Validation hint `#d97766`

Used only by the shared blank-input treatment: the bottom-edge flash and shake
on a required field left empty. Nothing else.

## Error banner pattern (one treatment, app-wide)

Any inline error banner — sign-in failure, save failure, invite failure — uses:

```
background:  rgba(217, 90, 86, 0.10)
border-left: 3px solid #d95a56
border-radius: 8px
color:       #f4f1ea        /* bone-cream body text */
```

The red is the **accent**, not the text colour. Red-on-dark body text is harder
to read and makes routine validation feel like a crash; a bone-cream message
with a red edge reads as "something went wrong here" without shouting.

Live examples: `.auth-error` (`src/components/AuthModal.css`), `.account-error`
(`src/components/AccountSettings.css`), and the inline banners in
`ShareModal.jsx`, `ManageTeamModal.jsx`, `InviteAcceptPage.jsx`,
`ResetPasswordPage.jsx`.

`StorageFailureBanner` is a deliberate cousin, not an exception: it is a
full-width system banner rather than an inline form error, so it keeps its 4px
left border and its own surface — but it draws that border from the same
`--accent-red` token.

## Confirm-dialog footer (locked)

Cancel on the **LEFT**, primary action on the **RIGHT**, 8px gap.

- Cancel is a ghost: transparent background, muted text (`#8d96a6`), no border.
- The right-hand button is `#d95a56` for destructive actions and brand gold
  (`#d8a84e`) for non-destructive ones.

Reference implementations: `ConfirmModal` in `src/home/BulkModals.jsx` and the
shared `useConfirmDialog` / `PromptModal` in `src/components/dialogPrompts.jsx`.

## Known exception

`src/home/ArchiveScreen.jsx` still carries the previous destructive red
(`#cf6f6f`) in its local `DANGER` constant. The Archive screen was signed off
by the owner immediately before this migration, so it was deliberately left
untouched rather than changed without review. Bringing it in line is a
one-line change to that constant.
