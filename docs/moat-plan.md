Written: 2026-10-20 18:45

# Survey moat plan

Source: Isaiah's ChatGPT chat "Building A Service Moat" (share link shows only its last six messages).

## The idea
Anyone can build an app with AI now, so the app alone is not a moat. What keeps customers paying:
- Trade-specific work tools built per customer (e.g. a wireless-lock planner that knows gateway limits, coverage and lock counts), kept as reusable, configurable parts instead of one-off code.
- Our know-how and the customer relationship.
- Every action reachable by script, so any AI (ours or the customer's) can create surveys, place marks and export.
- Learning from opted-in customer data (Smart fill) so the tools get better than a copy could.

## What Survey already has
- Smart fill slot: the Survey Marker tool asks a pluggable provider for an outline; only a dev stand-in exists today (src/survey/README.md).
- Scriptable backend: agent-cli/ drives the real backend headlessly.
- Two-way Excel sync per customer.
- Pricing in docs: Free, Pro $10/mo, Enterprise $20/user/mo.

## First steps
1. DONE (draft PR): Settings > Privacy opt-in, off by default, stored on the account with date + policy version; privacy and terms pages updated (marked draft — have a lawyer read before launch).
2. Store only opted-in survey shapes and Smart fill corrections, kept separate per company; server checks the opt-in before using anything.
3. Build the real Smart fill on that data; make the wireless-lock planner the first paid custom kit.
4. Sell custom kits on annual plans; include onboarding + existing kits in the subscription, tier by how much custom work a customer needs.
