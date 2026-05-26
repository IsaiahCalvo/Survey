# Playgrounds

This directory contains intentional regression fixtures.

`ReorderPlayground.jsx` is the canonical reorder fixture for current drag-to-rearrange behavior. It covers flat list reorder behavior and PDF bookmark tree reorder behavior, including nesting, un-nesting, collapse/expand, auto-expand/recollapse, drag overlays, and real-row movement.

Root-level HTML playground and prototype files are also intentional. Keep them at the repository root while they are used as direct Vite URLs:

- `/reorder-playground.html` loads `ReorderPlayground.jsx`.
- `/ball-in-court-reorder-playground.html` preserves the legacy standalone flat-list reorder exploration. Keep the file name for fixture continuity; do not use that term in new UI.
- `/prototype-*.html` files preserve UI prototype snapshots for auth, toolbar, empty states, save/loading, destructive confirmation, color variants, and before/after review.

Do not delete this playground as dead code. If it is replaced, document the replacement coverage first and update the related Linear cleanup issues: KAL-83, KAL-84, and KAL-87.
