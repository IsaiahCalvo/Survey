Written: 2026-10-30 20:30 UTC

# Survey privacy policy and terms: AI legal review

Not legal advice. Three AI "lawyers" were asked to audit the Privacy Policy and Terms
of Service (live pages plus the draft changes in PR #840) before launch. This file
merges what they said into one list. The proposed text fixes are in the held pull
request that adds this file; a human lawyer should review that pull request before
anything goes live.

| Reviewer | How it ran | Result |
|---|---|---|
| Gemini 4 Argon (High) | Google's Antigravity CLI (`agy --model gemini-4-argon-high --mode plan`); the old Gemini CLI was retired by Google | [ai-reviews/gemini-4-argon-high.md](ai-reviews/gemini-4-argon-high.md) |
| GPT 6.1 Sol (High) | Codex CLI (`codex exec -m gpt-6.1-sol -c model_reasoning_effort=high --sandbox read-only`); it also looked up current sources | [ai-reviews/gpt-6.1-sol-high.md](ai-reviews/gpt-6.1-sol-high.md) |
| Meta Muse | Desktop app, driven by computer use | **Not run yet.** The Mac declined the request to control Muse. Rerun once Isaiah allows it; paste the same prompt. |

Both reviewers got the same prompt and packet: [ai-reviews/prompt.txt](ai-reviews/prompt.txt)
(packet alone: [review-packet.md](review-packet.md)).

Both said, in effect, **do not launch with the current text**. They agreed on nearly
every serious point. Where only one raised something it is marked.

Status key: **Text** = fixed in the held PR's wording. **Code** = needs a product
change before the wording is true. **Owner** = needs a fact or decision from Isaiah.
**Lawyer** = a human lawyer should decide.

## High

1. **The policy says we don't send documents to third parties, but we do.** Supabase,
   Vercel, Brevo, Groq, OpenAI and (draft) Builder.io all get user data; Cloudflare R2
   may hold PDF copies (found while checking, not in the packet). An untrue privacy
   promise is the classic FTC "deceptive practice". *Both.* Fix: list every provider
   and what it gets. **Text**; Owner to confirm R2 is on in production.
2. **The AI assistant is not mentioned at all.** Typed requests, voice recordings and
   survey data go to Groq, with OpenAI as a speech-to-text fallback; outside AI tools
   can connect to an account. Apple's rule 5.1.2(i) also needs a clear in-app notice
   and permission before personal data goes to a third-party AI, which a policy line
   alone does not meet. *Both.* **Text** for the policy; **Code** for an in-app
   notice/permission before first AI use.
3. **Google Sheets sync is not mentioned, and Google's rules forbid using Sheets data
   for cross-customer AI training.** The policy needs Google's "Limited Use"
   statement, the scheduled background read must be disclosed, and the "learn from my
   work" setting must exclude Google (and Microsoft) data. *Both.* **Text**; **Code**
   to make sure the learning data never includes synced sheet data.
4. **"Learn from my survey work" (PR #840) is too loose.** One contributor could opt in
   an employer's or client's plans; "improve for other customers" sits badly next to
   "we keep each company's data separate"; "not your whole documents" may be untrue if
   plan snippets are stored; and "remove past contributions" can't undo a model
   already trained. *Both.* **Text** rewritten; **Code**: decide whether the project
   owner must also allow it; **Owner**: say exactly what the setting stores.
5. **Free trial and auto-renewal terms are incomplete.** US federal (ROSCA) and
   California auto-renewal law want the price, billing period, that the trial turns
   into a paid plan automatically, and how to cancel, shown clearly at checkout with
   a confirmation. *Both.* **Text**; **Code**: checkout screen must show these and
   send confirmations.
6. **"Archived, not deleted" on downgrade clashes with the 30-day Archive that is
   deleted.** Readers will think downgraded projects vanish in 30 days. Checked in the
   code: downgrade uses a separate flag and the 30-day sweep does not purge it, so this
   is a wording problem, not data loss. *Both.* **Text**; **Owner**: confirm what a
   user can still do with locked projects.
7. **No one is named as running Survey.** "Survey" is a product, not a legal party.
   GDPR, California law and the app stores want the operator's name and a mailing
   address. Both noted a sole proprietor is personally exposed. *Both.* **Text** with
   placeholders; **Owner**: state, mailing address (a P.O. box or registered-agent
   address is fine), and whether to form an LLC first.
8. **Liability cap can be $0.** "What you paid in 12 months" is nothing for free and
   trial users, and a court may throw out a $0 cap entirely. There is also no
   exclusion of indirect losses (lost bids, delays). *Both.* **Text**: greater of what
   you paid or $100, plus an indirect-loss exclusion and the usual carve-outs. Lawyer
   to set the number.
9. **No "check your results" disclaimer for a construction tool.** Wrong measurements,
   marks, synced numbers or AI answers can cost a contractor a lot. *Both.* **Text**.
10. **Warranty disclaimer is too weak.** It only disclaims uptime; US law (UCC 2-316)
    needs a conspicuous disclaimer naming merchantability and fitness. *Gemini; GPT
    agreed in substance.* **Text**.
11. **No governing law or court.** *Both.* **Text** with placeholders; **Owner**: state
    and county; **Lawyer**: arbitration or not.
12. **No real agreement to the terms at sign-up.** "By creating an account you agree"
    is weak; courts want a clear notice and a click. Checked: only guest links have an
    "I agree" box; normal sign-up has none. *GPT.* **Code**: add a sign-up checkbox and
    keep a record of who agreed to which version.
13. **Deletion timeline is unclear.** 30-day Archive plus about 5 weeks in backups
    means about 65 days; no deadline for account deletion; "up to about" is vague.
    App stores require in-app deletion (Survey has it). *Both.* **Text**; **Owner**:
    exact backup maximum and account-deletion time.
14. **Billing only mentions Stripe, but there are phone apps.** If plans are sold in
    the iPhone/Android apps, Apple and Google billing rules apply; a custom iOS terms
    page must also include Apple's minimum terms. *Both.* **Text** (Apple clause, store
    billing line in brackets); **Owner**: are plans sold inside the phone apps?
15. **GDPR basics missing** (legal bases, rights, complaints, transfers out of the EU).
    *Both.* **Text**; **Owner**: will EU/UK users be served at launch? **Lawyer**:
    transfer safeguards and whether a data-processing agreement is needed for business
    customers (*GPT*).
16. **Refunds "case by case" only** may cut off rights the law gives (EU/UK cooling-off).
    *GPT.* **Text**: added "nothing here takes away a legal right".

## Medium

17. **"Visible only to you and the people you share with" is absolute.** Ignores
    project owners sharing, support access and legal process. *Both.* **Text**.
18. **Usage statistics wording overstates anonymity** and says "browser session"
    though the apps send too; no retention period; maybe needs an opt-out in the EU.
    *Both.* **Text**; **Owner**: retention period; **Code**: consider an off switch.
19. **Company sign-on, invites and @mentions not disclosed** (we get data about
    people from others). *Both.* **Text**.
20. **No age limit.** *Both.* **Text**: 18+ (a business choice).
21. **No cookies/storage line, no Do Not Track line** (California's CalOPPA asks for
    one). *Gemini.* **Text**.
22. **No copyright (DMCA) takedown process.** Users upload other people's drawings.
    *Both.* **Text**; **Owner**: register a DMCA agent with the U.S. Copyright Office
    for safe harbour.
23. **Content licence too narrow, and "you own" overstates it** when an employer or
    client owns the plans. *Both.* **Text**.
24. **No indemnity, termination, assignment or "whole agreement" clauses.** Assignment
    matters if Survey later moves into an LLC. *Gemini.* **Text** (narrow indemnity;
    *GPT* warned to keep it narrow).
25. **Changes announced "in the app" only** are weak; give notice by email ahead of
    time. *Both.* **Text**.
26. **US state privacy laws** (CCPA etc.) probably don't apply yet at Survey's size, but
    check; CalOPPA applies regardless. *GPT.* **Lawyer**.
27. **AI transparency and abuse reporting.** Google Play's AI policy wants a way to
    report harmful AI output in the app; the EU AI Act wants clear "this is AI"
    notice. *GPT.* **Code**.
28. **Apple sign-in rule.** If the iPhone app offers Google sign-in, Apple may require a
    privacy-preserving login option too (guideline 4.8). *GPT.* **Owner/Code**.

## Low

29. **Dates.** The August effective date shouldn't cover October changes; add "last
    updated" and say the policy covers web, desktop and phone apps. *GPT.* **Text**
    (date left as a placeholder).

## Questions only Isaiah or a lawyer can answer

- Which state are you in, and what mailing address can be published? Form an LLC
  before launch?
- Are plans sold inside the iPhone/Android apps, or only on the website?
- Will EU/UK customers be served at launch?
- What exactly does "learn from my survey work" store (just marks, or plan snippets
  too)? Must the project owner also allow it?
- Are Groq and OpenAI used on paid API terms that bar them from training on our data,
  and how long do they keep logs?
- Is the Cloudflare R2 copy turned on in production?
- What can a user still do with projects locked after a downgrade?
- How long until an account deletion is complete, and what is the true backup
  maximum?
- How long does Builder.io keep usage events, and should users get an off switch?
- What liability cap, governing state, court, and arbitration choice do you want?
