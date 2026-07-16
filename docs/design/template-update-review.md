# Live Template Update Review

Historical design reference recovered during July 2026 consolidation.\n\nTracking: KAL-383. This is a concept prototype, not an approved final specification.

Open the interactive mockup:

- `docs/design/template-update-review-mockup.html`

Agents implementing live template sharing must use this mockup as the v1 UX contract.

## Required UX

- Show a full-screen review, not a dense modal.
- Review one template at a time.
- Show Before and After side by side.
- Highlight changed items only in the After panel.
- Let the user click a highlighted item to decide that specific change.
- Supported decisions: `Keep current`, `Skip for now`, and `Apply and archive old data`.
- Keep undo/redo available only before `Save decisions`.
- After `Save decisions`, the decision is permanent for v1.
- Do not show checklist answer counts in the template rows unless a later requirement explicitly adds them.

## Validation Cases

Implementation must test each change type one at a time and then together:

- Rename a category while keeping existing marker mapping.
- Change an entity color.
- Add a checklist item.
- Archive a checklist item.
- Move a category to another module.
- Reorder checklist items while preserving stable item IDs.

Use a generated test PDF and test template with survey markers before validating the review flow.
