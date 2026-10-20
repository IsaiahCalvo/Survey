Written: 2026-10-20

# Smart fill beta: where it stands

## What I could read
- The ChatGPT share link only shows a sign-in page, so I could not read "Building A Service Moat".
- The Codex chat "Smart Fill Cloud Latest" lives in the cloud and is not saved on your Mac. I read your other Codex chats about smart fill instead.
- None of the chats I could read talk about learning from user data or consent. That talk must be in the two chats I couldn't open.

## Where the work is
- Survey already has the three ways to draw a Survey Marker: Rectangle, Freehand and Smart fill. The Smart fill button stays hidden because no real fill engine is plugged in. Only a fake one runs, and only on the dev server.
- The real engine lives in the separate playground app, in an open pull request called "Release Smart Fill beta". In that app you tap a tag, see the whole outline, then press Apply. Unsure matches wait for you or get held back.
- No Survey branch holds anything newer than main. The other thread's open pull request on cloud pages doesn't touch smart fill.

## What's left to ship it as a beta behind a switch
1. Bring the engine into Survey. It's very large and built around its own copy of the PDF reader, so it has to be cut down and fitted to Survey's reader. This is the big job.
2. Add an on/off switch for the beta, off by default.
3. Add the "see the outline, then Apply" step. Today Survey saves the mark as soon as the engine answers.
4. Tell the user when no match is found. Today nothing happens.
5. Run the engine in the background with a time limit, so the page never freezes.
6. Test with the real engine, on desktop and on a phone.
7. Known engine gaps from the playground: faint or tiny borders, big clouds, tags joined by leader lines, reusing a sample tag across drawings, and scanned drawings that haven't been checked on customer files.

## Learning from user data: what users must agree to first
Nothing collects smart fill data today, and the playground keeps every PDF in the browser on purpose. Before you use customer drawings or their fixes to train anything, you need:
- A clear opt-in that is off by default, separate from signing up, and that each company's admin can turn off for their whole team.
- Updated terms and privacy policy saying what you keep (drawings, the outlines users accept or fix), why, how long, and who can see it.
- A data agreement for business customers. Enterprise buyers like Schneider usually forbid using their files to train anything without a signed agreement. Their contracts win over your terms.
- A way for users to see, export and delete what you kept, and to stop sharing later. Training already done should stop using their data from that point on.
- Stripping names, addresses and project details before anything is stored for training, and keeping each customer's data apart.
- If you serve people in Europe or California, extra rules apply (lawful basis, a right to object, data stays where promised).

A safe first step: let each company train smart fill on its own drawings only (their sample tags and fixes help only them). Pooling data across customers needs the opt-in and agreements above.
