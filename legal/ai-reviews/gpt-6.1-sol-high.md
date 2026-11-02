**I would not launch with these documents.** The main risks are false privacy promises, undisclosed AI processing, unclear training rights, and incomplete subscription terms. The draft fixes some gaps but creates new ones.

This review uses your packet as the product record and current official sources for legal and store requirements. I did not inspect the code, test the app, or edit files. Suggested wording needs the owner’s factual checks; brackets mark unresolved facts.

1. **High — Privacy: “How your documents are handled.” The processor promise is false.**

   **Why it matters:** Supabase itself is a third-party processor. The service also uses Vercel, Brevo, Groq, OpenAI and connected services; the draft adds Builder.io. Sharing needed survey data with an AI provider still counts even if Survey never sends the whole PDF. False privacy promises can breach FTC Act §5. [FTC privacy guidance](https://www.ftc.gov/business-guidance/privacy-security)

   **Suggested wording:** “We use service providers to host and secure Survey, store content, process payments, send service emails, and provide the features you use. These include Supabase, Vercel, Stripe, Brevo, and the AI providers described below. We share the data needed for each task.”

   Add a provider list with each provider’s role and data received. Distinguish providers acting for Survey from outside tools users choose.

2. **High — Privacy: missing AI and voice disclosures.**

   **Why it matters:** The policy omits prompts, audio, transcripts, AI responses, survey context, and the Groq/OpenAI data flows. Apple guideline 5.1.2(i) requires clear disclosure and explicit permission before sharing personal data with third-party AI. A buried policy clause alone is insufficient. [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing)

   **Suggested wording:** “When you use the Survey agent, we send your request and the survey data needed to answer it to Groq. Voice requests may include audio and transcripts. We may use OpenAI as a fallback to transcribe speech. Before sending personal data to these providers, we explain the sharing and ask for permission.”

   Separately explain device speech recognition, including any Apple/Google processing. Check actual provider contracts and settings before promising no training or no retention. Groq, for example, describes limited logging unless the relevant retention controls are enabled. [Groq data handling](https://console.groq.com/docs/your-data)

3. **High — Draft privacy and content terms: the training opt-in is too broad.**

   **Why it matters:** A worker may lack permission to contribute employer, architect, client, or project-owner data. Marks and corrections can still contain personal data or reveal protected plans. “Not your whole documents” does not make them anonymous. One user’s consent cannot supply everyone else’s consent or override confidentiality duties. GDPR consent must be specific, informed, freely given, and open to withdrawal. [European Commission guidance](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data_en)

   **Suggested wording:** “Optional contributions are off by default. Before you contribute, we identify the exact data, purpose, recipients, and retention period. You may contribute only material you have authority to provide for this separate use. Refusing will not reduce your paid features.”

   Use separate personal and company permissions where needed. Do not treat the account holder’s checkbox as permission from people named in a plan.

4. **High — Draft training section: cross-customer learning conflicts with other promises.**

   **Why it matters:** Improving tools “for other customers” needs a clear explanation of what crosses company boundaries. “We do not share” conflicts with outside processing unless carefully qualified. “Keep each company’s data separate” could imply that learning never carries information between customers.

   Turning the setting off must also address continued use of earlier contributions. If consent is the legal basis, merely stopping collection of *new* work may not stop the processing covered by withdrawal. Removing training records and removing their effect from a trained model are different tasks. Models are not automatically anonymous. [EDPB AI opinion](https://www.edpb.europa.eu/documents/opinion-of-the-board-art-64/opinion-282024-on-certain-data-protection-aspects-related-to_en)

   **Suggested wording:** “Turning this off stops new contributions and further use of identifiable contributions for optional improvement. We explain separately how deletion affects stored examples and models already trained.”

   Do not publish that wording until the process supports it. If Survey cannot meet withdrawal duties, change the training design before launch.

5. **High — Draft training and optional integrations: Google data needs a firm exclusion.**

   **Why it matters:** Google Workspace policy restricts using API data to train or improve models beyond the specific user’s permitted personalized use. The draft’s cross-customer purpose may violate that rule if Sheets data or covered derived data enters the training set. An opt-in does not override Google’s restrictions. [Google Workspace policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)

   **Suggested wording:** “We do not use data obtained through Google Workspace APIs, or covered data derived from it, to train or improve generalized or cross-customer AI models. Our use complies with Google’s applicable Limited Use requirements.”

   Enforce that exclusion in the data flow. Review Microsoft’s terms separately.

6. **High — Terms: subscriptions and the seven-day trial lack key terms.**

   **Why it matters:** Neither version states the post-trial price, billing period, exact conversion point, trial eligibility, or full cancellation terms. ROSCA requires material disclosures before billing information, express informed consent, and a simple way to stop recurring charges. California adds consent, acknowledgment, reminder, cancellation, and change-notice duties. These need checkout controls and records, not just terms text. [ROSCA §4](https://www.govinfo.gov/content/pkg/PLAW-111publ345/html/PLAW-111publ345.htm), [California AG guidance](https://www.oag.ca.gov/news/press-releases/attorney-general-bonta-issues-consumer-alert-california%E2%80%99s-automatic-renewal-law)

   **Suggested wording:** “Your trial ends on the date and time shown at checkout. Unless you cancel before then, we charge [price and currency, plus applicable tax] for each [month/year], starting on [date], until you cancel. Cancel through [exact path]. We send confirmation of your subscription and cancellation.”

   Display the actual terms beside the purchase control. California’s special trial reminder rule for trials longer than 31 days does not itself cover this seven-day trial; other duties still apply. Do not cite the vacated 2024 federal “click-to-cancel” rule as current law. [FTC’s 2026 rulemaking notice](https://www.govinfo.gov/content/pkg/FR-2026-03-13/html/2026-04952.htm)

7. **High — Terms: Stripe-only billing may not fit mobile distribution.**

   **Why it matters:** Digital subscriptions sold in mobile apps generally fall under store billing rules, subject to the exact region, program, and distribution model. Some companion or enterprise models qualify for exceptions. The packet does not establish one. [Apple payment rules](https://developer.apple.com/app-store/review/guidelines/#payments), [Google Play payment rules](https://support.google.com/googleplay/android-developer/answer/10281818)

   **Suggested wording, if store billing is offered:** “Web subscriptions are billed through Stripe. Subscriptions bought through Apple or Google are billed through that store. Manage cancellation through the provider shown on your receipt. Store billing and refund rules apply, subject to your legal rights.”

   Confirm the permitted purchase flow for each storefront before adopting this clause.

8. **High — Privacy deletion and draft backups: the timeline is incomplete.**

   **Why it matters:** “Permanently purged after 30 days” conflicts with another five weeks in backup. On the supplied facts, copies may remain roughly 65 days from document deletion. Account deletion has no stated completion time, and nothing explains AI logs, analytics, email records, connected-service copies, or shared project records.

   Apple requires an in-app account-deletion path; Google requires an in-app path and an outside web resource. Existing self-service tools may satisfy part of this, but the packet does not prove both paths or complete deletion. [Apple deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [Google deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)

   **Suggested wording:** “Deleted documents remain recoverable in the archive for 30 days. We then remove them from active storage. Backup copies expire within [verified maximum] after active removal. Account deletion follows [separate process and deadline]. We retain [specified records] for [period or clear criteria] where needed for legal obligations.”

   Explain backup access limits and how deletions are reapplied after restoration. “Up to about” is too vague for a claimed maximum.

9. **High — Draft downgrade clause: “archived, not deleted” may be misleading.**

   **Why it matters:** The existing archive purges after 30 days. If downgrade uses that archive, ending a paid plan can lead to document loss despite the draft’s reassurance. It also fails to explain which projects lose access, what collaborators see, and how users export them.

   **Suggested wording:** “When Pro ends, [selection rule] determines which projects exceed Free limits. Those projects become [read-only/inaccessible] on [date]. You can export them until [date]. They are deleted after [period], following notice.”

   If downgrade storage has no deletion deadline, state that separately from the trash archive. Do not use “archived” for two different retention rules without explaining both.

10. **High — Both documents: identify the legal operator.**

   **Why it matters:** “Survey” is a product name, not the identified contracting party. GDPR requires controller identity and contact details where it applies. Consumer distance-selling rules may also require a business address. A sole proprietor remains personally exposed; wording alone creates no liability shield. [GDPR Article 13](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679), [UK seller disclosures](https://www.gov.uk/online-and-distance-selling-for-businesses)

   **Suggested wording:** “Survey is operated by Isaiah Calvo, a sole proprietor based in [state], United States. ‘We’ and ‘us’ mean Isaiah Calvo. Contact: [business email and lawful business address].”

   Use an entity name only after forming it and putting the relevant contracts and accounts in that entity.

11. **High if EU/UK users are in scope — Privacy: core GDPR disclosures are missing.**

   **Why it matters:** A US location does not settle GDPR scope. Offering services to people in the EU/UK or monitoring their behavior can bring the laws into scope. The notice lacks purpose-specific legal bases, legitimate interests, full rights, complaint routes, required-versus-optional data, and relevant indirect sources such as invitations and employer SSO. [GDPR Articles 3, 13–14](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679), [ICO notice checklist](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/)

   **Suggested wording:** “We use account data to provide the service, billing records to meet legal duties, and necessary security logs for our interest in preventing abuse. Optional improvement uses [verified basis]. Depending on applicable law, you may request access, correction, deletion, restriction, or portability, object to certain uses, and withdraw consent. Contact [address]. You may complain to [relevant authority].”

   Add a short purpose/data/legal-basis table. Assess EU/UK representatives; a DPO is not automatically required.

12. **High for business personal data — Terms: a content license is not a data-processing agreement.**

   **Why it matters:** Survey may act as a processor for customer project data and as a controller for its own account, billing, and improvement uses. GDPR Article 28 requires suitable processing contracts where applicable. Relevant state laws also impose processor/service-provider contract terms. [ICO contract requirements](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/contracts/)

   **Suggested wording:** “For personal data we process on a business customer’s behalf, our Data Processing Addendum applies. We process it on documented instructions and use authorized subprocessors under suitable contracts.”

   The actual addendum must cover confidentiality, security, subprocessors, incident assistance, rights requests, return/deletion, and audits. Do not claim it exists until it does.

13. **High if relevant international transfers occur — Privacy: no countries or transfer safeguards.**

   **Why it matters:** “United States” identifies the operator but does not explain where data is stored or accessed. EU/UK transfers may need adequacy coverage or approved safeguards. A provider’s certification does not automatically cover Survey or every onward transfer. [ICO transfer guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/a-guide-to-international-transfers/)

   **Suggested wording:** “We and our providers process data in [verified countries]. For transfers subject to EU or UK restrictions, we use [actual applicable safeguards]. Contact us for information or a copy.”

   Put the required agreements and transfer assessments in place before making that statement.

14. **High — Terms: refunds cannot rest solely on discretion.**

   **Why it matters:** “Exceptional situations” and “case by case” fail to preserve mandatory remedies. EU/UK consumer sales can carry cooling-off and digital service rights. Starting a trial or accepting terms does not by itself waive them; services and downloaded content have different rules. [EU withdrawal rights](https://europa.eu/youreurope/citizens/consumers/shopping/returns/), [UK implementation guidance](https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/429300/bis-13-1368-consumer-contracts-information-cancellation-and-additional-payments-regulations-guidance.pdf)

   **Suggested wording:** “This refund policy does not limit refunds, cancellation rights, or other remedies required by law. Where a statutory withdrawal right applies, we provide its terms and exercise process before purchase. We may also grant discretionary refunds.”

   Use a region-specific process where needed.

15. **High — Terms: the liability cap and warranty clause are too thin.**

   **Why it matters:** The cap can become zero for free users. It cannot safely cover every type of misconduct, injury, statutory claim, or regulator action. “To the extent permitted by law” helps but does not cure an unfair clause. The warranty wording addresses uptime while leaving accuracy and fitness unclear. UK consumer law expressly protects certain service rights and prohibits excluding death or injury caused by negligence. [Consumer Rights Act §§49, 57, 62, 65](https://www.legislation.gov.uk/ukpga/2015/15/enacted)

   **Suggested wording:** “Nothing in these terms limits liability that the law does not allow us to limit, including fraud and death or personal injury caused by negligence. Subject to those limits and your mandatory rights, our total liability is [counsel-approved cap, including treatment of free users].”

   Have counsel choose the cap, exclusions, and any separate treatment of confidentiality or data claims. A consequential-loss exclusion is a business choice, not a launch law.

16. **High — Terms: construction and AI reliance risks are unaddressed.**

   **Why it matters:** Wrong measurements, annotations, sync results, or AI answers can cause real project losses. The terms should describe the limits of the tool without trying to excuse faulty performance or misstate advertised features.

   **Suggested wording:** “Survey supports document review and markup. AI answers, automated marks, measurements, and synced data may contain errors. Check results against source documents and site conditions before using them for design, ordering, installation, code compliance, or safety decisions. Survey does not provide licensed engineering, architectural, or land-surveying advice.”

   Reflect this in product claims and relevant screens. Preserve mandatory warranties and remedies.

17. **Medium — Draft analytics: its absolute claims need proof.**

   **Why it matters:** A random session ID can still be personal data. Error details, URLs, timestamps, and custom fields may identify users or projects. Sending events through Survey’s server does not make Builder.io first-party processing. “We remove … before anything is sent” is a strict promise that must hold for every event.

   **Suggested wording:** “We send a limited set of tool-use and error events to Builder.io’s Agent Native Analytics. Events include [verified fields] and a session ID. We do not intentionally include document content or account contact details. We retain events for [period] and provide [actual control].”

   That wording does not excuse leaks. Use a fixed allowed-field list, review errors, and check Builder.io’s retention, reuse rights, and contract.

18. **Medium — Privacy/draft analytics: no browser-storage or consent account.**

   **Why it matters:** Explain login storage, session identifiers, analytics storage, and third-party access. EU ePrivacy rules may require prior consent for nonessential storage/access. UK rules now include a narrow statistical exception with conditions, including information and an easy objection route; do not assume all analytics qualifies. Server-side collection does not settle these questions. [ICO storage/access exceptions](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/)

   **Suggested wording:** “We use [listed technologies] for sign-in and [listed optional purposes]. You can manage optional analytics through [control]. Where required, we ask permission before enabling it.”

   Retain the no-advertising claim only after checking provider reuse rights.

19. **Medium — Privacy: state privacy rights need an applicability review.**

   **Why it matters:** Do not assume CCPA applies, or that small size exempts Survey everywhere. California currently uses an adjusted revenue threshold of $26.625 million, alongside separate data-volume and revenue-from-sale/sharing tests. Other states differ; Texas includes a specific small-business rule for selling sensitive data. CalOPPA has no comparable large-business threshold. [California thresholds](https://cppa.ca.gov/regulations/cpi_adjustment.html), [California rights](https://cppa.ca.gov/faq), [Texas law](https://tcss.legis.texas.gov/resources/BC/htm/BC.541.htm), [CalOPPA guidance](https://oag.ca.gov/sites/all/files/agweb/pdfs/cybersecurity/making_your_privacy_practices_public.pdf)

   **Suggested wording:** “Depending on your location and applicable law, you may have rights to access, correct, delete, or obtain your data and to opt out of certain uses. Submit requests through [methods]. We explain identity checks, authorized-agent requests, and any available appeal process at [location].”

   If covered, add the required categories, sources, purposes, recipients, retention, rights, and notices at collection. Distinguish ordinary disclosure from statutory “sale” and advertising “sharing”; assess required opt-out signals rather than adding needless controls.

20. **Medium — Privacy: collection, payment, and sharing details are incomplete.**

   **Why it matters:** The packet includes SSO, invites, comments, mentions, connector permissions, and voice data beyond the collection list. Stripe webhooks may supply more than status and a customer reference; the packet does not prove which fields Survey stores. Mention emails may expose comment or project details outside Survey.

   **Suggested wording:** “We collect account and sign-in details, project content, collaboration records, connected-service permissions and credentials, AI requests, and technical records as described below. Service emails may include [verified content]. Stripe processes payment details; we retain [actual billing fields].”

   Keep the narrower statement that full card numbers bypass Survey only if verified. Include sources such as invited users and company identity providers.

21. **Medium — Both documents: access, sync, and outside tools need clearer limits.**

   **Why it matters:** “Visible only to you” omits necessary provider or support access and may omit company-admin access. Two-way sync can change external files; scheduled reads continue when the app is closed. An outside AI connector may retrieve or change data under its permissions.

   **Suggested wording:** “Project access follows assigned roles. [Describe actual administrator powers.] Authorized staff and providers may access content only where needed for [verified purposes]. Connected sync may read and update selected files in the background until disconnected. Disconnecting stops future access but does not remove copies already held elsewhere.”

   Explain connector scope, revocation, and which party handles copied data. Verify that OneDrive access is truly restricted to selected files, rather than merely using selected files under broader permission.

22. **Medium — Terms: assent and changes need a real process.**

   **Why it matters:** “By creating an account” cannot prove that users saw and accepted the terms. This matters for Google login, SSO, and invited users too. Courts require adequate notice and assent. In-app notice alone is weak for dormant users and changes to billing or data use. [Berman decision](https://www.govinfo.gov/app/details/USCOURTS-ca9-20-16900/context)

   **Suggested wording:** “Before you create an account, we ask you to accept these Terms. We give advance notice of material changes by [email and in-app notice], with the effective date and any cancellation rights. Where law requires fresh consent, we obtain it before the change.”

   Keep version and acceptance records. Treat the privacy notice as a disclosure; obtain separate consent where required.

23. **Medium — Terms: account closure, disputes, and content rights are incomplete.**

   **Why it matters:** Define company authority, account security, notice and cure where practical, emergency suspension, export after closure, paid-service shutdown, and refunds. Choose governing law and forum while preserving mandatory consumer protections. Arbitration and class waivers are optional and need bespoke review.

   “You own” also overstates the position where an employer or architect owns uploaded content.

   **Suggested wording:** “You and your licensors retain your rights in uploaded content. You authorize us and our service providers to process it to provide the features you enable. If you act for an organization, you must have authority to bind it. We may suspend access where reasonably needed to address serious misuse or security risks, with notice where practical.”

   Add a clear exit/export period and a fair service-closure process. Any customer indemnity should be narrow and separately reviewed.

24. **Medium — Terms/apps: license, age, and store disclosures need completion.**

   **Why it matters:** Add a limited software license, update behavior, support scope, and third-party notice terms. If supplying a custom Apple EULA, it must meet Apple’s minimum terms, including developer contact details, support responsibility, and Apple’s beneficiary rights. [Apple minimum EULA terms](https://www.apple.com/legal/internet-services/itunes/dev/minterms/)

   **Suggested wording:** “We grant you a limited license to use Survey subject to these Terms and applicable store rules. Desktop versions may install updates automatically [describe controls]. Survey is intended for users aged [chosen age] and older.”

   An 18+ limit is a business choice, not a universal requirement. An age clause alone does not satisfy COPPA if Survey has actual knowledge of under-13 users. [FTC COPPA guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)

   Also check Apple guideline 4.8: Google sign-in may require an equivalent privacy-preserving login option unless an exception applies. [Apple login rules](https://developer.apple.com/app-store/review/guidelines/#login-services)

25. **Medium — Acceptable use/AI: reporting and transparency need product support.**

   **Why it matters:** A general ban on unlawful use does not supply abuse reporting or response procedures. Google’s AI-content policy requires an in-app reporting or flagging feature for covered apps. EU AI Act transparency rules may also require clear notice that users interact with AI; “Survey agent” may not convey that. [Google AI policy](https://support.google.com/googleplay/android-developer/answer/13985936), [European Commission guidance](https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems)

   **Suggested wording:** “The Survey agent uses AI. Report harmful output or misuse through [in-app control]. We review reports and may restrict content or accounts that breach these Terms.”

   Assess content-hosting duties separately. If seeking US DMCA safe-harbor protection, a policy sentence alone does not replace the required agent and procedures.

26. **Low — Both documents: dates and policy maintenance.**

   **Why it matters:** The August effective date should not imply that unpublished October changes already applied. New disclosures must match the released app, consent screens, store privacy labels, and Google Data safety answers. A policy cannot cure a conflicting implementation.

   **Suggested wording:** “Effective: [actual date]. Last updated: [date]. This notice covers Survey’s website, desktop apps, and mobile apps. [Link to prior versions or a short change record.]”

**Questions for the owner and retained counsel**

- Will launch serve only businesses, or also consumers? Which countries and US states?
- Will Isaiah contract personally, or will an entity own and operate Survey? What business address can be published?
- What data does each provider receive, retain, or reuse, under which signed terms and settings?
- Does optional learning involve model training, shared examples, shared rules, or only company-specific changes? Can prior contributions and identifiable model effects be removed?
- Can employees contribute client plans, and will company administrators control that permission?
- Does downgrade archive data expire after 30 days? What exactly happens on account deletion and backup restoration?
- What are the trial price, conversion time, renewal periods, cancellation paths, and mobile purchase models?
- What authority do company admins, support staff, and outside AI tools actually have?
- Which liability cap, insurance cover, governing law, and consumer remedies fit the intended launch?