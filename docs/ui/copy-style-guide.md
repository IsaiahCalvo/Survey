# Copy style guide — casing

Written: 2026-08-11
Last updated: 2026-08-19 (KAL-63 — modal-title casing conflict resolved)

One rule per kind of string. If you are adding user-facing text, find its row
here and follow it. Do not invent a new convention for one screen.

## The rule

| Kind of string | Case | Examples |
|---|---|---|
| Screen and modal **titles** | Sentence case | "Welcome back", "Keyboard shortcuts", "Create project", "Save to OneDrive" |
| **Buttons**, primary and secondary | Sentence case | "Sign in", "Save templates", "Send invite", "Open file", "Full page" |
| **Tabs** and ledger **column headers** | Sentence case | "Documents", "Last edited" |
| **Confirm-dialog titles** | Sentence case, ends in `?` | "Delete document?", "Move 3 documents?", "Delete forever?" |
| **Tooltips** and helper text | Sentence case, verb-first | "Open file", "Go to location", "Set location" — not "Click to set location" |
| **Eyebrows / section labels under 12px** | ALL CAPS via `text-transform` | "MODULE", "CATEGORIES", "DESTINATION PROJECT" |
| Anything typed by the **user** | Never re-cased | document titles, project names, marker labels |

### Before / after

Titles
- "Account Settings" → **"Settings"**
- "Excel File is Open" → **"Excel file is open"**
- "Create Project" → **"Create project"**

Only the first word is capitalised. Proper nouns keep their own capitals —
"Save to OneDrive", "Update Excel file?", "Company sign-in".

Buttons
- "Sign Out" → **"Sign out"**
- "Full Page" → **"Full page"**
- "Save Templates" → **"Save templates"**

Confirm titles
- "Delete Document" → **"Delete document?"**
- "Confirm Deletion" → **"Delete forever?"**
- "Move Documents" → **"Move 3 documents?"**
- "Update Excel File?" → **"Update Excel file?"**

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
- Every confirm-dialog title *that the sweep looked at* matched "sentence case
  + `?`". (Corrected 2026-08-19: `ExcelSyncConfirmModal`'s "Update Excel File?"
  was missed and has now been fixed — see the KAL-63 section below.)

**Known remaining**

`src/components/AccountSettings.jsx` renders "Yes, Delete My Account" inside the
delete-account confirm. That whole flow is being replaced (KAL-68), so the string
is left for that change rather than re-cased twice.

## Resolution — modal titles are sentence case (KAL-63, 2026-08-19)

The guide previously said modal titles were Title Case while the shipped auth
modal used sentence case. That conflict is closed: **the rule is sentence case,
and the auth modal was already right.**

The decision was made by counting, not by preference. Every modal/dialog title
string in `src/` was enumerated. Sentence case won 15 modals to 1:

**Already sentence case (15 modals)**

| Modal | Title |
|---|---|
| `src/components/AuthModal.jsx` | "Welcome back", "Create account", "Check your email", "Company sign-in", "Reset password" |
| `src/components/KeyboardShortcutsOverlay.jsx` | "Keyboard shortcuts" |
| `src/components/CreateCategoryModal.jsx` | "Create category" |
| `src/home/CreateProjectModal.jsx` | "Create project" |
| `src/components/OneDriveFileSaveModal.jsx` | "Save to OneDrive" |
| `src/components/TemplateOverwriteWarningModal.jsx` | "Different template detected" |
| `src/components/NewColumnsModal.jsx` | "Column changes detected" (and its dynamic variants) |
| `src/components/DuplicateUploadModal.jsx` | "You already have this file" / "…this file name" |
| `src/components/collab/ReSignInModal.jsx` | "Sign back in" |
| `src/components/collab/CleanupResidueReviewPanel.jsx` | "{n} annotations to clean up" |
| `src/components/PrintPanel.jsx` | "Print — {document name}" |
| `src/home/BulkModals.jsx` (RenameModal) | "Rename", "Rename document" |
| `src/home/BulkModals.jsx` (MoveCopyModal) | "{n} documents" |
| `src/home/TemplatesEditor.jsx` (move/copy) | "{n} items" |
| `src/components/AccountSettings.jsx` | "Settings" (single word — case-neutral) |

**Was Title Case, now fixed (1 modal + 1 confirm title)**

| File | Was | Now |
|---|---|---|
| `src/components/ExcelLockedModal.jsx` | "Excel File is Open" | "Excel file is open" |
| `src/components/ExcelSyncConfirmModal.jsx` | "Update Excel File?" | "Update Excel file?" |

The second one is a confirm-dialog title, which the table above already required
to be sentence case ending in `?`; it was simply missed in the 2026-08-11 sweep.

**Not violations — the eyebrow exemption**

These literals are Title Case in source but render ALL CAPS through
`text-transform: uppercase` at 10.5px, so their source casing is never visible.
They are eyebrows above a real title (usually a user-typed name) and are
**compliant — do not "fix" them**:

- `src/home/ShareModal.jsx` — `Share {noun}` above the document name
- `src/home/ManageTeamModal.jsx` — "Manage Team", "Invite User", "Activity" above the project name
- `src/home/AccessManagementModal.jsx` — "Document Access" / "Template Access" above the document name
- `src/home/BulkModals.jsx` — "Move or copy" above the document count
- `src/home/TemplatesEditor.jsx` — "Move/Copy" above the item count
- `src/home/DocumentsLedger.jsx` — "Document details" (10px) above the document name

**Why sentence case rather than Title Case**

The shipped auth modal is the most-seen dialog in the app and was signed off in
sentence case under KAL-67. Sentence case is also what the rest of the app
already does, 15 modals to 1 — re-casing to Title Case would have been the
larger and riskier sweep, and would have contradicted a signed-off screen.
