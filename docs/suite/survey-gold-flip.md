# Survey goes gold for everyone

Survey's accent is gold (owner 2026-11-24) (docs/suite/SUITE-RULES.md, "One colour set").
Today it shows only under the Nightly flag `one-look`. The parts everyone
sees, and that can't sit behind a flag, still wear coral: the tab icon, the
public pages, the free tools and the emails.

This page is the whole switch, for the day the owner says the look leaves
Nightly. Don't do it before then.

## 1. Turn the public face gold

```
node scripts/survey-gold-flip.mjs           # lists what will change
node scripts/survey-gold-flip.mjs --apply   # changes it
```

`--apply` swaps each coral tone for its gold one in the hand-written pages,
`public/welcome/site.css` and `supabase/functions/_shared/emailLayout.ts`;
copies the gold icons from `public/brand-gold/` over the coral ones;
rebuilds the public pages, the free tools and the 13 sign-in email templates;
and stops with a list if coral is left anywhere visitors look.

It also takes out the test guards that kept gold off the public pages, and
removes `public/brand-gold/` once its icons are copied. Then run the tests
near the change:

```
node --test tests/suiteMarks.test.mjs tests/emailLayout.test.mjs tests/surveyGoldFlip.test.mjs tests/suiteLook.test.mjs
```

## 2. Turn the look on for everyone

In `src/featureFlags.js`, move `one-look` from `beta` to on for all, the way
other flags left Nightly. Check both modes on screen, signed in and out.

## 3. Push the emails live

Merging changes the emails the app sends. The sign-in emails live in
Supabase: run the "Supabase auth settings" workflow, `emails-check` first,
then `emails-apply`.

## 4. Things the script can't do

- The phone app's native colours in `mobile-expo/App.tsx` and its icons in
  `mobile-expo/assets/`. New icons show after the next store build.
- The desktop app icon, `build/icon.png` and `build/icon.icns`.
- The app pictures on the public pages (`public/welcome/*.webp`): retake them
  once the look is on.
- Drop the "still wear coral" lines from `docs/suite/SUITE-RULES.md` in all
  three repos.
