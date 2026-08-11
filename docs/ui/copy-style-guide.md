# Copy style guide — casing

Written: 2026-08-11

One rule per kind of string. If you are adding user-facing text, find its row
here and follow it. Do not invent a new convention for one screen.

## The rule

| Kind of string | Case | Examples |
|---|---|---|
| Screen and modal **titles** | Title Case | "Account Settings", "Manage Team" |
| **Buttons**, primary and secondary | Sentence case | "Sign in", "Save templates", "Send invite", "Open file", "Full page" |
| **Tabs** and ledger **column headers** | Sentence case | "Documents", "Last edited" |
| **Confirm-dialog titles** | Sentence case, ends in `?` | "Delete document?", "Move 3 documents?", "Delete forever?" |
| **Tooltips** and helper text | Sentence case, verb-first | "Open file", "Go to location", "Set location" — not "Click to set location" |
| **Eyebrows / section labels under 12px** | ALL CAPS via `text-transform` | "MODULE", "CATEGORIES", "DESTINATION PROJECT" |
| Anything typed by the **user** | Never re-cased | document titles, project names, marker labels |

### Before / after

Titles
- "account settings" → **"Account Settings"**
- "manage team" → **"Manage Team"**
- "share document" → **"Share Document"**

Buttons
- "Sign Out" → **"Sign out"**
- "Full Page" → **"Full page"**
- "Save Templates" → **"Save templates"**

Confirm titles
- "Delete Document" → **"Delete document?"**
- "Confirm Deletion" → **"Delete forever?"**
- "Move Documents" → **"Move 3 documents?"**

## The eyebrow exemption, and why it is not a loophole

Small uppercase labels are a **hierarchy device**, not a casing choice. They are
allowed only when both are true: the font size is under 12px, and the string
functions as an eyebrow or column label rather than a heading. In practice these
are `.micro` (`src/home/TemplatesEditor.css`), `.section-label`
(`src/home/hub.css`), and the 10.5px `letter-spacing: 0.14em` inline labels in
the modals. A 17px heading never qualifies.

The Share modal's "SHARE DOCUMENT" is one of these: the literal string in
`src/home/ShareModal.jsx` is `Share {noun}` at 10.5px with
`text-transform: uppercase`. It is an eyebrow above the real title (the document
name). It is compliant — do not "fix" it to sentence case.

## Templates panel — module / category / entity names

These often appear ALL CAPS. **They are user data.** `src/home/TemplatesEditor.jsx`
applies no `text-transform` and no `.toUpperCase()` to `mod.name`, `cat.name`, or
an entity's `role` — users type them that way. Never re-case them, and never add
a `text-transform` that would.

The uppercase words *around* them — "MODULE", "CATEGORIES", "ENTITIES" — are the
`.micro` eyebrows covered by the exemption above.

## Audit — state as of 2026-08-11

Swept `src/home/`, `src/components/`, `src/sidebar/`, `src/mobile/`.

**Fixed in this pass**

| File | Was | Now |
|---|---|---|
| `src/home/HubShell.jsx` (×2) | "Sign Out" | "Sign out" |
| `src/mobile/MobilePdfViewerChrome.jsx` | "Full Page" | "Full page" |

**Already compliant — the ticket's named targets were stale**

- Auth submit button already reads "Sign in", not "Sign In".
- "Company Sign-In" no longer exists; the heading is "Company sign-in" and the
  link is "Sign in with company SSO (enterprise)".
- No "Save Templates" string exists — the button is just "Save".
- Every confirm-dialog title already matches "sentence case + `?`".

**Open conflict — needs an owner decision**

The auth modal's headings are sentence case in code — "Welcome back", "Create
account", "Reset password", "Check your email", "Company sign-in" — but the rule
above says modal titles are Title Case. KAL-67 was closed as Done with the
sentence-case wording in place, so this was left alone rather than re-cased
against a signed-off screen. Either the auth modal moves to Title Case or the
rule gains an explicit "auth modal is sentence case" exception. Pick one; do not
leave it ambiguous.

**Known remaining**

`src/components/AccountSettings.jsx` renders "Yes, Delete My Account" inside the
delete-account confirm. That whole flow is being replaced (KAL-68), so the string
is left for that change rather than re-cased twice.
