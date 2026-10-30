# Legal Audit: Survey (`surveytool.app`) Privacy Policy, Terms of Service & Draft PR #840

> **Disclaimer:** This review is structured as a technology, privacy, and commercial legal audit based on the packet provided, covering US federal and state privacy laws (FTC Act § 5, CCPA/CPRA, CalOPPA, state omnibus privacy laws, COPPA), GDPR/UK GDPR, consumer auto-renewal statutes (ROSCA, California ARL), Apple App Store and Google Play policies, Google OAuth/Workspace API policies, and SaaS contract law. It is not formal legal representation; consult a licensed attorney in your home state before public launch.

---

## Executive Summary of Top Launch Blockers (High Severity)

Before launching publicly or merging PR #840, the most urgent issues to fix are:
1. **Direct factual misrepresentations in the Privacy Policy (FTC Act § 5 & App Store 5.1.2(i) risk):** The policy explicitly promises *"We do not send your documents to third-party processors,"* while the product actually sends survey data, text, and audio to **Groq** and **OpenAI** (for the Survey AI agent), allows external AI access via an **MCP connector**, syncs in the background with **Google Sheets**, and uses **Vercel** and **Brevo**.
2. **Unlimited personal liability for a construction/field-survey tool:** Operating as an unincorporated individual (Isaiah Calvo) with no construction/measurement/AI accuracy disclaimer, no consequential damages waiver, and a `$0` liability cap for free/trial users exposes your personal assets to lawsuits over jobsite errors, bidding mistakes, or data loss.
3. **Draft PR #840 flaws:** The new ML training opt-in (*"Let Survey learn from my survey work"*) contradicts itself on cross-company data separation, allows invited contributors to opt in someone else's confidential project plans, and conflicts with Google Workspace API rules unless Google data is carved out. Additionally, the new downgrade rule uses the word *"archived"*, which elsewhere in the Terms means *"permanently purged after 30 days."*
4. **Missing statutory & app-store disclosures:** Missing controller identity/postal address, age limit, GDPR lawful bases/international transfers/rights, California privacy & auto-renewal notices, Google API "Limited Use" statement, and Apple/Google mobile app store subscription terms.

---

## 1. Places Where the Text Does Not Match What the Product Does

### 1.1 False Promise: "We do not send your documents to third-party processors" vs. AI Agent (Groq & OpenAI), MCP Connector, and Cloud Sub-processors
* **Severity:** **High**
* **Affects:** Privacy Policy → *How your documents are handled*, *What we collect*, and *Optional integrations*; Terms of Service → *The service*
* **Why it matters:**
  * **FTC Act Section 5 (15 U.S.C. § 45):** Making an affirmative, unqualified statement that *"We do not send your documents to third-party processors"* while sending user prompts, audio recordings, and survey data to **Groq** and **OpenAI** is a textbook deceptive trade practice.
  * **Apple App Store Review Guideline 5.1.2(i):** Apps must explicitly disclose where personal or user data is shared with third-party AI providers and obtain explicit consent before doing so.
  * **GDPR Art. 13(1)(e) & CCPA/CPRA:** Legally, cloud hosts, AI inference APIs, email providers, and analytics tools *are* "third-party processors" (or service providers/sub-processors). What you actually mean is that you do not sell documents to data brokers or share them with unaffiliated third parties for their own marketing purposes.
  * **MCP Connector risk:** Neither document mentions that users can connect external AI tools via an **MCP (Model Context Protocol) connector**, which grants third-party AI systems direct access to account and survey data under those third parties' own terms and privacy policies.
* **Suggested replacement / added wording (Plain English):**
  * *In Privacy Policy → How your documents are handled (replace sentence 3):*
    > "We share your data only with the service providers ('sub-processors') needed to run Survey and the features you choose to use—never with advertisers or data brokers. We do not use your documents or survey data to train machine-learning models unless you explicitly turn on the optional training setting below, and our AI providers are not permitted to train their models on your data."
  * *Add new section in Privacy Policy → AI Assistant ("Survey agent") and external AI tools:*
    > "### AI assistant and external AI connections
    > When you use the Survey AI assistant ('Survey agent'), the text or voice requests you submit and the relevant survey data from your active project are sent to our AI processing providers—**Groq** (running open-weights models) and, as a fallback for speech-to-text transcription, **OpenAI**—solely to transcribe your voice and answer your request. On mobile devices, voice input may also use your device's built-in speech recognition (Apple or Google).
    >
    > If you connect an external AI tool to your account using our Model Context Protocol (MCP) connector, that tool can read and modify the projects and survey data your account has access to. Any data accessed through an external AI tool you connect is governed by that tool provider's own privacy policy and terms."

---

### 1.2 Undisclosed Google Sheets Two-Way Sync & Background Server Job (and Google OAuth Policy Non-Compliance)
* **Severity:** **High**
* **Affects:** Privacy Policy → *Optional integrations*; Terms of Service → *The service*
* **Why it matters:**
  * **Factual omission:** *Optional integrations* in the Privacy Policy and *The service* in the Terms mention **Microsoft OneDrive/Excel** only, completely omitting **Google Sheets two-way sync** and the fact that **a server job reads the connected Google Sheet on a schedule** even when the user is not actively in the app.
  * **Google API Services User Data Policy (Workspace APIs):** To pass and maintain Google OAuth verification for Google Sheets scopes, your Privacy Policy must accurately describe how you access, use, store, and share Google user data—and must include Google's mandatory **Limited Use** disclosure. Crucially, Google strictly prohibits using Google Workspace API data to train generalized AI/ML models, so you must explicitly exclude Google Sheets data from the PR #840 ML training feature.
* **Suggested replacement / added wording (Plain English):**
  * *In Privacy Policy → Optional integrations (replace entire section):*
    > "### Optional integrations
    > - **Microsoft OneDrive / Excel:** If you connect OneDrive/Excel, we access and update only the files you select to provide two-way sync.
    > - **Google Sheets:** If you connect your Google account and select a Google Sheet, we read and write to that specific sheet to provide two-way sync, including through an automated server job that checks the sheet on a regular schedule so your survey data stays in sync.
    >
    > You can disconnect Microsoft or Google integrations at any time in Settings, or revoke access in your Microsoft or Google account security settings.
    >
    > **Google API Limited Use Disclosure:** Survey's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Data imported from Google Workspace APIs is never used to train machine-learning or AI models."
  * *In Terms of Service → The service (update sentence 1):*
    > "Survey lets you view, annotate, and survey PDF documents, use AI-assisted survey tools, collaborate with people you invite, and sync survey data with Microsoft Excel and Google Sheets."

---

### 1.3 Undisclosed Infrastructure & Email Sub-processors (Vercel and Brevo) and Collaborator `@mention` Emails
* **Severity:** **Medium**
* **Affects:** Privacy Policy → *What we collect* and *How your documents are handled*
* **Why it matters:**
  * **GDPR Art. 13(1)(e) & Art. 14 / CCPA:** Your website and web app are hosted on **Vercel** (which processes IP addresses, device headers, and web requests), and transactional/notification emails (sign-in links, project invitations, `@mention` comment notifications, and profile-change alerts) are sent via **Brevo**. Neither processor is disclosed.
  * Furthermore, when a user invites a colleague or `@mentions` someone in a comment, Survey processes that person's email address and sends them emails via Brevo, and collaborators within a shared project can see each other's names, email addresses, comments, and annotations.
* **Suggested replacement / added wording (Plain English):**
  * *Add to Privacy Policy → What we collect (or a unified "Our service providers" section):*
    > "When you collaborate on a project, your name, email address, role (owner, contributor, or viewer), annotations, and comments are visible to other members of that project. When you invite someone to a project or `@mention` them in a comment, we use their email address to send them the invitation or notification.
    >
    > To run Survey, we rely on the following core infrastructure providers: **Supabase** (database, file storage, and backend functions), **Vercel** (web application hosting), **Brevo** (sending transactional emails such as sign-in codes, invitations, `@mention` alerts, and account notices), and **Stripe** (payment processing)."

---

### 1.4 Undisclosed Company Single Sign-On (SSO) & Organization Administration
* **Severity:** **Medium**
* **Affects:** Privacy Policy → *What we collect*; Terms of Service → *The service*
* **Why it matters:**
  * **Facts:** Survey supports **company single-sign-on (SSO)** in addition to email and Google sign-in.
  * When a user signs in via company SSO or joins a company workspace, Survey receives identity attributes from the employer's Identity Provider (IdP), and the company/project owner may have administrative visibility and control over the user's access and work product. Failing to disclose this creates privacy disputes when an employer offboards an employee or audits a project.
* **Suggested replacement / added wording (Plain English):**
  * *In Privacy Policy → What we collect (replace sentence 1):*
    > "When you create an account, we collect your email address and, if you sign in with Google or a company single-sign-on (SSO) provider, the name, email address, and organization identifiers shared by that provider. If you use Survey through a company SSO account or on a project owned by another user or organization, the project owner or organization administrator can manage your access role (owner, contributor, or viewer) and view or export the documents, annotations, and comments in that project."

---

### 1.5 Incomplete Deletion & Export Disclosure vs. Self-Serve Features and Multi-Platform Scope
* **Severity:** **Medium**
* **Affects:** Privacy Policy → *Deletion* and *What we collect*; Terms of Service → *The service*
* **Why it matters:**
  * **Apple App Store Review Guideline 5.1.1(v) & Google Play User Data Policy (Account Deletion):** Both stores require clear disclosure of how users can delete their account in-app (and via web for Google Play) and what data is kept and for how long.
  * **GDPR Art. 15 & 20 / CCPA:** You have built self-serve **account export** and **account deletion**, which is a great compliance asset, but the Privacy Policy never mentions the self-serve export feature or where in the UI to trigger deletion.
  * **Desktop & Mobile permissions:** The policy does not mention that the desktop app checks for and installs **automatic updates**, or that the mobile apps access the **device microphone/speech recognition, local files, and system share sheet** when triggered by the user.
* **Suggested replacement / added wording (Plain English):**
  * *In Privacy Policy → Deletion (replace section, incorporating and fixing the PR #840 backup disclosure):*
    > "### Exporting and deleting your data
    > You can export your account data or delete your account at any time from Settings.
    > - **Document deletion:** Deleting a document moves it to an archive (trash) you control, where it can be restored for 30 days before an automated job permanently purges it from our active database and storage.
    > - **Account deletion:** Deleting your account removes your profile, personal information, and the projects you solely own from our active systems.
    > - **Backups and legal records:** Encrypted copies of deleted files and database records may remain in our internal disaster-recovery backups for up to 5 additional weeks after active deletion before being overwritten. We also retain billing and transaction records as required for tax, accounting, and fraud-prevention purposes."
  * *Add to Privacy Policy → What we collect (Desktop & Mobile):*
    > "On iPhone and Android, Survey requests access to your microphone/speech recognition (when you use voice input) and your device files and share sheet (when you import or export PDFs). Our Mac and Windows desktop apps automatically check for and download software updates to keep the app secure and up to date."

---

## 2. Problems with the Draft Changes (Pull Request #840)

### 2.1 Draft ML Training Section ("Helping improve Survey") Has Multi-Tenant, Shared-Project Permission, and Google API Conflicts
* **Severity:** **High**
* **Affects:** Draft Privacy Policy → *How your documents are handled* & *Helping improve Survey (optional, off by default)*; Draft Terms → *Your content*
* **Why it matters:**
  1. **Contradiction between "improve those tools for you and other customers" and "we keep each company's data separate":** If you train a shared model (e.g., *Smart fill*) using Company A's marks so that the model improves *"for you and other customers,"* the model weights are shared across companies. Stating *"we keep each company's data separate"* in the very next sentence could lead business customers to believe models are strictly tenant-isolated. You need to clarify that *raw training data* is never visible to other customers, while *trained model improvements* benefit all users (and lack any customer-identifiable information).
  2. **Technical accuracy of "We use the marks, not your whole documents":** If *Smart fill* is a visual/geometric tool that detects regions on a PDF drawing, training a model on user corrections typically requires capturing the cropped PDF visual/vector region underneath the mark—not just bare `(x, y)` coordinates in a vacuum. If any cropped patch or local snippet of the underlying plan is stored with the mark, saying *"We use the marks, not your whole documents"* must be phrased accurately (e.g., *"the marks and the specific plan regions they apply to, rather than your full PDF files"*) so you don't violate **FTC Act § 5**.
  3. **Shared-project authorization flaw (Contributor vs. Project Owner):** In Survey, projects have **owners, contributors, and viewers**. If an external contributor turns on *"Let Survey learn from my survey work"* in their personal Settings while working on a project owned by a client or general contractor, that contributor has no legal right to license the owner's confidential blueprints for ML training. Training must only apply when the **project owner** (and user) has enabled it.
  4. **Promise to remove "past contributions" vs. already-trained model weights:** Once a neural network is trained, you can delete a user's stored training samples from your training dataset and exclude them from future training runs, but you cannot instantaneously "un-bake" weights from an already-deployed model until the next retraining cycle. Promising unqualified removal without explaining this creates an impossible obligation under **GDPR Art. 17 / Art. 7(3)**.
  5. **Google API conflict:** Must explicitly exclude Google Workspace synced data from ML training.
* **Suggested replacement wording (Plain English):**
  * *In Privacy Policy → Helping improve Survey (optional, off by default):*
    > "### Helping improve Survey (optional, off by default)
    > In Settings → Privacy, you can turn on **'Let Survey learn from my survey work.'** This setting is off by default. Only if both you and the project owner have this setting turned on, we may use the shapes you mark on plans, your corrections to tools like Smart fill, and the immediate plan regions around those marks (rather than your full PDF documents) to train and improve Survey's tools for you and other customers.
    >
    > We never show your training data or marks to other customers, we never sell them, and we never use data synced from Google Workspace or Microsoft OneDrive for model training. You can turn this setting off at any time in Settings, which immediately stops collection of new training data. To have your previously collected training samples deleted from our training datasets and excluded from future model training runs, contact us at the email below."
  * *In Terms of Service → Your content (replace the Draft PR #840 addition):*
    > "If you turn on 'Let Survey learn from my survey work' in Settings, you grant us a non-exclusive, worldwide, royalty-free license to use your survey marks, Smart fill corrections, and the associated plan regions from projects you own (or are authorized by the project owner to include) to train, develop, and improve Survey's machine-learning models and features, as described in our Privacy Policy. This setting is off by default and can be turned off at any time for future work. We own any generalized model weights and algorithm improvements that result, which do not contain or output your identifiable documents."

---

### 2.2 Draft "Subscriptions and billing" Uses the Word "Archived" (Which Elsewhere Means "Deleted After 30 Days") and Fails Auto-Renewal Laws
* **Severity:** **High**
* **Affects:** Draft Terms of Service → *Subscriptions and billing*
* **Why it matters:**
  1. **Dangerous terminology collision ("archived"):** In the Live Privacy Policy (*Deletion*) and Live Terms (*Availability and changes*), the word **"archive"** means the **trash bin that permanently purges items after 30 days** (*"archived items are permanently purged after 30 days"*). In PR #840, you add: *"When a paid plan ends, your account moves to the Free plan; projects and documents over the Free limit are **archived, not deleted**."* If a user reads both clauses together, "archived" means their over-limit projects will be permanently purged in 30 days! And if your backend uses the same `archived` status flag for both trash and plan downgrades, your scheduled 30-day purge job could accidentally delete downgraded customers' data! Use a distinct term (e.g., *"placed in read-only storage"* or *"frozen"*) and verify the backend job does not purge downgraded projects.
  2. **Violation of ROSCA (15 U.S.C. § 8401 et seq.) and California Automatic Renewal Law (Cal. Bus. & Prof. Code § 17600 et seq.):** When offering a 7-day free trial that converts to a paid recurring subscription, US federal and state auto-renewal laws require clear and conspicuous disclosure that: (a) the subscription **automatically converts to a paid recurring plan** at the end of the 7-day trial unless cancelled before the trial expires, (b) the recurring billing amount and frequency disclosed at checkout will be charged to the payment method on file each billing cycle until cancelled, and (c) how to cancel.
* **Suggested replacement wording (Plain English):**
  * *In Terms of Service → Subscriptions and billing (replace entire section):*
    > "### Subscriptions, free trials, and billing
    > - **7-day free trial and automatic renewal:** Pro plans begin with a 7-day free trial (limit one trial per user or organization). **Unless you cancel before the end of your 7-day trial, your subscription will automatically convert into a paid recurring subscription** at the price and billing period (monthly or annual) shown at checkout. After that, your subscription automatically renews at the end of each billing period and we will charge your payment method on file unless you cancel before the renewal date.
    > - **How to cancel:** If you subscribed on our website or desktop app via Stripe, you can cancel at any time in Settings → Billing. If you subscribed through the Apple App Store or Google Play, you must cancel through your Apple ID or Google Play subscription settings. When you cancel during a paid period, your Pro access continues until the end of the current paid period, and you will not be charged again.
    > - **Moving to the Free plan:** When a trial or paid plan ends without renewal, your account moves to the Free plan. Any projects and documents above the Free plan limit are locked in read-only mode (not deleted and not subject to our 30-day trash purge); you can still export them, delete older items to get below the Free limit, or upgrade again to restore full editing access.
    > - **Refunds:** Payments are non-refundable except where required by law or in exceptional situations handled case by case—contact us."

---

### 2.3 Draft "Usage statistics" (Agent Native Analytics / Builder.io) Overstates Anonymity, Omits Desktop/Mobile Scope, and Lacks an Opt-Out / Lawful Basis
* **Severity:** **Medium**
* **Affects:** Draft Privacy Policy → *Usage statistics* and *What we don't do*
* **Why it matters:**
  * **Pseudonymous vs. Anonymous under GDPR & CCPA:** Sending events when a user is signed in through your own server with a random session ID is **pseudonymous personal data**, not anonymous data, under GDPR (Art. 4(1)) and CCPA.
  * **Platform scope:** The draft says *"Each event carries a random ID for your browser session"*, which ignores that Survey also runs as a Mac/Windows desktop app and iOS/Android mobile apps.
  * **GDPR Lawful Basis & Right to Object (Art. 6(1)(f) & Art. 21):** Under GDPR, product usage telemetry that is not strictly necessary to deliver the service relies on legitimate interests (or consent under ePrivacy/UK PECR if stored on the device), meaning users must be informed of their right to object/opt out.
* **Suggested replacement wording (Plain English):**
  * *In Privacy Policy → Usage statistics (replace Draft PR #840 text):*
    > "### Usage statistics
    > When you are signed in across our web, desktop, or mobile apps, Survey sends basic usage and error events (for example, which tools were used and whether an action failed) through our server to our analytics processor, **Agent Native Analytics** (`analytics.agent-native.com`, operated by **Builder.io**). Each event uses a random session identifier rather than your name or email address, and our server strips email addresses, file names, links, authentication tokens, document content, and survey marks before forwarding the event. We use these statistics only to fix bugs and understand which features are useful—never for advertising or cross-site tracking."

---

## 3. Missing Sections or Disclosures a Launch-Ready Policy and Terms Need

### 3.1 Controller / Operator Identity and Physical Mailing Address
* **Severity:** **High**
* **Affects:** Privacy Policy → Header & *Contact*; Terms of Service → Header & *Contact*
* **Required by:** **GDPR/UK GDPR Art. 13(1)(a)** (mandatory controller identity and contact details), **Cal. Bus. & Prof. Code § 17538(d)** (California online commercial provider name and address requirement), **CAN-SPAM Act (15 U.S.C. § 7704(a)(5))** (postal address required for commercial emails), and **Apple App Store / Google Play Developer Guidelines** (legal entity name in policies must match the developer listing).
* **Why it matters:** "Survey" is a product name, not a legal entity. Without naming the legal person (ideally a newly formed LLC, or "Isaiah Calvo d/b/a Survey") and providing a physical mailing address (a P.O. Box or virtual mailbox/registered agent address is fine—do not use your home address), the Privacy Policy violates GDPR and California law, and the Terms do not clearly identify the contracting party.
* **Suggested added wording (Plain English):**
  * *In both Privacy Policy and Terms → Contact:*
    > "### Contact and operator information
    > Survey is operated by **[Survey LLC / Isaiah Calvo d/b/a Survey]**, located in the United States.
    > - **Email:** isaiahcalvo123@gmail.com
    > - **Mailing address:** [Insert P.O. Box or Registered Agent Business Address, City, State, ZIP, USA]"

---

### 3.2 Apple App Store & Google Play Mandatory Terms (Subscriptions & Apple Standard EULA Minimum Terms)
* **Severity:** **High**
* **Affects:** Terms of Service → *Subscriptions and billing* and new section *Mobile apps (Apple App Store and Google Play)*
* **Required by:** **Apple App Store Review Guidelines 3.1.2 & 5.1.1**, **Apple Developer Program License Agreement Schedule 1, Section 3.2 (Minimum EULA Terms)**, and **Google Play Developer Program Policies**.
* **Why it matters:** Because Survey ships on iPhone and Android:
  1. Saying *"Paid plans are billed through Stripe"* and *"You can cancel any time from Settings"* without accounting for App Store / Google Play in-app purchases or multi-platform reader rules will cause App Store review rejection.
  2. When you provide custom Terms of Service for an iOS app instead of relying solely on Apple's standard EULA, Apple's Developer Agreement legally requires you to state that the Terms are between the user and you (not Apple), that Apple is not responsible for the app, warranty, maintenance, or third-party claims, and that Apple is a third-party beneficiary of the Terms.
* **Suggested added wording (Plain English):**
  * *Add new section to Terms of Service → Mobile apps (Apple App Store and Google Play):*
    > "### Mobile apps (Apple App Store and Google Play)
    > If you download Survey from the Apple App Store or Google Play Store:
    > - These Terms are between you and us, not Apple Inc. ('Apple') or Google LLC ('Google'). We—not Apple or Google—are solely responsible for the Survey app, its content, maintenance, support, warranty (to the extent not disclaimed), and addressing any claims relating to the app (including product liability, legal compliance, or intellectual property claims).
    > - Your license to use the iOS app is limited to a non-transferable license to use the app on Apple-branded devices that you own or control, as permitted by the Apple Media Services Terms and Conditions.
    > - Apple and its subsidiaries are third-party beneficiaries of these Terms with respect to the iOS app, and upon your acceptance of these Terms, Apple will have the right to enforce these Terms against you as a third-party beneficiary."

---

### 3.3 GDPR / UK GDPR Mandatory Disclosures (Lawful Bases, International Transfers, and Data Subject Rights)
* **Severity:** **High**
* **Affects:** Privacy Policy → new section *Your privacy rights and international transfers*
* **Required by:** **GDPR / UK GDPR Articles 13, 14, 15–22, and Chapter V (Arts. 44–49)**.
* **Why it matters:** Even as a US operator, offering a downloadable desktop/mobile app and SaaS website globally triggers GDPR/UK GDPR when used by individuals in the EEA, UK, or Switzerland. The current policy omits every required statutory element under Article 13: lawful bases for processing, international transfers to the United States, data subject rights, and the right to lodge a complaint with a data protection authority.
* **Suggested added wording (Plain English):**
  * *Add new section to Privacy Policy:*
    > "### Your privacy rights (EEA, UK, Switzerland, and US states)
    > Depending on where you live, you have the right to:
    > - **Access and export** a copy of your personal data (available any time in Settings);
    > - **Correct** inaccurate personal data or **delete** your data and account (available in Settings);
    > - **Object to or restrict** certain processing (such as usage analytics), or **withdraw consent** at any time where we rely on consent (such as optional ML training or third-party integrations);
    > - **Not be discriminated against** for exercising your privacy rights.
    >
    > **Lawful bases (EEA/UK users):** We process your account data, documents, and integrations to **perform our contract** with you; we process optional ML training data and microphone access based on your **consent**; we process security logs and usage analytics based on our **legitimate interests** in keeping Survey secure and reliable; and we keep billing records to comply with **legal obligations**.
    >
    > **International data transfers:** Survey is operated in the United States, and we and our service providers (Supabase, Vercel, Stripe, Brevo, Groq, OpenAI, and Builder.io) store and process data in the United States. Where required for EEA, UK, or Swiss users, we rely on the European Commission's Standard Contractual Clauses (and the UK Addendum) or the EU-U.S. Data Privacy Framework to protect transferred data.
    >
    > **Complaints:** If you are in the EEA, UK, or Switzerland, you also have the right to lodge a complaint with your local data protection authority (such as an EU Data Protection Authority or the UK Information Commissioner's Office)."

---

### 3.4 US State Privacy Disclosures (CalOPPA, CCPA/CPRA, Do Not Track / Global Privacy Control)
* **Severity:** **High**
* **Affects:** Privacy Policy → *What we don't do* and *Your privacy rights*
* **Required by:** **California Online Privacy Protection Act (CalOPPA, Cal. Bus. & Prof. Code § 22575)** (applies to *all* commercial websites/apps with California users, with **zero revenue or user threshold**), **CCPA/CPRA**, and state privacy statutes (e.g., Texas Data Privacy and Security Act, Virginia CDPA, Colorado CPA).
* **Why it matters:** CalOPPA requires disclosing how you respond to browser "Do Not Track" (DNT) signals, categories of personal information collected, and categories of third parties with whom data is shared. State privacy laws also look for clear confirmation that you do not "sell" or "share" personal information for cross-context behavioral advertising.
* **Suggested replacement wording (Plain English):**
  * *In Privacy Policy → What we don't do (replace section):*
    > "### What we don't do
    > We do not sell your personal information or share it for cross-context behavioral advertising (as defined under California and other US state privacy laws). We use no third-party advertising cookies or cross-site tracking. Because we do not track you across third-party websites, our service treats all users with the same privacy protections regardless of browser 'Do Not Track' or Global Privacy Control (GPC) signals."

---

### 3.5 Minimum Age Requirement & Children's Privacy (COPPA / GDPR Art. 8)
* **Severity:** **High**
* **Affects:** Privacy Policy → new section *Children's privacy*; Terms of Service → *The service*
* **Required by:** **Children's Online Privacy Protection Act (COPPA, 15 U.S.C. § 6501 et seq.)**, **GDPR Art. 8**, **CCPA**, and **Apple/Google Store age rating rules**.
* **Why it matters:** Neither document sets an age limit. Because Survey is a professional B2B/prosumer construction tool that enters users into recurring paid subscriptions and processes voice/AI inputs, you should restrict the service to users **18 years or older** (or at minimum 16+) and explicitly forbid use by children under 13/16.
* **Suggested added wording (Plain English):**
  * *Add to Terms of Service → The service:*
    > "You must be at least 18 years old (or the age of legal majority where you live) and able to form a binding contract to create an account and use Survey."
  * *Add to Privacy Policy → Children's privacy:*
    > "### Children's privacy
    > Survey is designed for professional and business use and is not directed to children under 16. We do not knowingly collect personal information from anyone under 16 (or under 13 under US COPPA). If you believe a child has provided us with personal data, contact us and we will promptly delete it."

---

### 3.6 Copyright / DMCA Takedown Procedure (17 U.S.C. § 512)
* **Severity:** **Medium**
* **Affects:** Terms of Service → *Acceptable use* or new section *Copyright and DMCA*
* **Required by:** **Digital Millennium Copyright Act (17 U.S.C. § 512(c) & § 512(i))**.
* **Why it matters:** Users upload architectural plans, engineering blueprints, and PDFs and share them with third parties. To qualify for DMCA safe-harbor protection against copyright infringement lawsuits over user-uploaded files, your Terms must include a repeat-infringer termination policy and a copyright notice procedure (and you should register a DMCA Designated Agent online with the U.S. Copyright Office for $6).
* **Suggested added wording (Plain English):**
  * *Add to Terms of Service:*
    > "### Copyright and DMCA notices
    > If you believe content stored on Survey infringes your copyright, please send a written notice meeting the requirements of the US Digital Millennium Copyright Act (17 U.S.C. § 512(c)(3)) to isaiahcalvo123@gmail.com. We respond to valid takedown notices and terminate the accounts of repeat infringers in appropriate circumstances."

---

### 3.7 Cookies and Local Storage Disclosure
* **Severity:** **Low**
* **Affects:** Privacy Policy → *What we collect*
* **Required by:** **ePrivacy Directive / UK PECR / CalOPPA**.
* **Why it matters:** Even without ad trackers, Survey uses strictly necessary authentication cookies / browser local storage tokens to keep users signed in and maintain session state.
* **Suggested added wording (Plain English):**
  * *Add a sentence to Privacy Policy → What we collect:*
    > "We use strictly necessary cookies and local storage tokens to keep you signed in, secure your session, and remember your app preferences."

---

## 4. Risky or Unenforceable Wording, and Anything That Exposes the Owner to Liability

### 4.1 Personal Liability Exposure & No Construction / Field Survey / AI Accuracy Disclaimer
* **Severity:** **High**
* **Affects:** Terms of Service → *Availability and changes* and new section *Professional responsibility and AI disclaimer*
* **Why it matters:**
  * **Catastrophic construction/surveying reliance risk:** Survey is used for **construction and field survey work**, includes an **AI assistant ("Survey agent")** and **Smart fill**, and syncs quantities/data to **Excel and Google Sheets**. In the construction industry, a single scaling error, miscalculated takeoff/survey mark, corrupted spreadsheet sync, or hallucinated AI response can cause a contractor to underbid a project by hundreds of thousands of dollars, order wrong materials, or build to incorrect specifications.
  * Currently, the Terms contain **zero disclaimer** regarding measurement accuracy, AI outputs, spreadsheet sync errors, or professional engineering/surveying reliance.
  * Combined with operating as an unincorporated individual (Isaiah Calvo), a single construction dispute could put your personal assets at risk.
* **Suggested replacement / added wording (Plain English):**
  * *Add a prominent section to Terms of Service → Professional responsibility and AI disclaimer:*
    > "### Professional responsibility, measurement accuracy, and AI outputs
    > **Survey is a software tool, not a licensed land surveyor, engineer, architect, or contractor.** All measurements, annotations, takeoffs, Smart fill detections, spreadsheet syncs (Excel and Google Sheets), and responses from the Survey AI assistant are provided for convenience only and may contain errors, inaccuracies, or omissions.
    >
    > **You are solely responsible for independently verifying all measurements, quantities, calculations, AI outputs, and synced spreadsheet data against original plans and field conditions before relying on them for bidding, procurement, construction, engineering, or safety-critical decisions.** We are not responsible for any construction defects, project delays, bidding or estimating errors, material costs, or jobsite damages resulting from your use of Survey."

---

### 4.2 Defective Limitation of Liability Clause (Missing Consequential Damages Waiver & The "$0 Paid" Free-Tier Trap)
* **Severity:** **High**
* **Affects:** Terms of Service → *Liability*
* **Why it matters:**
  * **Live text:** *"To the extent permitted by law, our liability for any claim related to the service is limited to the amount you paid us in the twelve months before the claim arose."*
  * **Defect 1 — Missing consequential damages waiver:** A standard SaaS liability clause requires two separate shields: (1) a waiver of indirect, consequential, incidental, special, punitive, and lost-profit/lost-data/construction-delay damages, AND (2) a dollar cap on direct damages. Your current clause has only #2.
  * **Defect 2 — The "$0 paid" trap:** For users on the **Free plan** or during the **7-day free trial**, *"the amount you paid us in the twelve months before the claim arose"* is **$0**. Many US courts treat a $0 liability cap as a complete exculpatory clause that is unconscionable or fails of its essential purpose—striking the entire clause down and leaving you with **unlimited liability**. Adding a floor (e.g., *"the greater of $100 or the amount you paid us..."*) fixes this.
* **Suggested replacement wording (Plain English):**
  * *In Terms of Service → Liability (replace entire section):*
    > "### Limitation of liability
    > **TO THE MAXIMUM EXTENT PERMITTED BY LAW:**
    > 1. **NO INDIRECT DAMAGES:** IN NO EVENT WILL WE OR OUR SUPPLIERS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, BIDS, CONSTRUCTION DELAYS, BUSINESS, OR DATA, ARISING OUT OF OR RELATED TO THESE TERMS OR THE SERVICE, EVEN IF WE KNEW OR SHOULD HAVE KNOWN SUCH DAMAGES WERE POSSIBLE.
    > 2. **LIABILITY CAP:** OUR TOTAL CUMULATIVE LIABILITY FOR ALL CLAIMS ARISING OUT OF OR RELATED TO THESE TERMS OR THE SERVICE WILL NOT EXCEED **THE GREATER OF (A) THE AMOUNT YOU PAID US FOR THE SERVICE IN THE 12 MONTHS IMMEDIATELY BEFORE THE EVENT GIVING RISE TO THE CLAIM, OR (B) $100 USD**."

---

### 4.3 Unenforceable Implied Warranty Disclaimer Under UCC § 2-316
* **Severity:** **High**
* **Affects:** Terms of Service → *Availability and changes*
* **Why it matters:**
  * **Live text:** *"We work to keep Survey reliable but provide it 'as is', without warranty of uninterrupted availability."*
  * Under **Uniform Commercial Code (UCC) § 2-316(2)** (applied to software/SaaS across US states), a disclaimer of the **implied warranty of merchantability** and **implied warranty of fitness for a particular purpose** is legally ineffective unless it is **conspicuous** (e.g., bold uppercase text) and specifically uses the words *"merchantability"* and *"fitness for a particular purpose."* Right now, your lowercase sentence only disclaims *"uninterrupted availability"* and leaves implied warranties of fitness and accuracy intact.
* **Suggested replacement wording (Plain English):**
  * *In Terms of Service → Availability and changes (replace first sentence):*
    > "### Availability, changes, and warranty disclaimer
    > We work to keep Survey reliable, but features may change as the product evolves. Deleted items are recoverable from your archive for 30 days; always keep your own independent backups of critical files.
    >
    > **THE SERVICE (INCLUDING ALL AI FEATURES, INTEGRATIONS, AND DESKTOP AND MOBILE APPS) IS PROVIDED 'AS IS' AND 'AS AVAILABLE.' TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY, QUIET ENJOYMENT, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR COMPLETELY SECURE, OR THAT MEASUREMENTS OR AI OUTPUTS WILL BE ACCURATE.**"

---

### 4.4 Missing Governing Law, Venue/Jurisdiction, and Dispute Resolution
* **Severity:** **High**
* **Affects:** Terms of Service → new section *Governing law and disputes*
* **Why it matters:** Without a governing law and exclusive venue clause, a user or construction company anywhere in the world can sue you in their local court under their local laws.
* **Suggested added wording (Plain English):**
  * *Add new section to Terms of Service → Governing law and disputes:*
    > "### Governing law and disputes
    > These Terms are governed by the laws of the State of **[Insert Your State, e.g., Delaware / California / Texas]**, USA, without regard to conflict-of-law principles. Any legal action or proceeding arising under these Terms will be brought exclusively in the state or federal courts located in **[Insert County and State]**, and you and we consent to personal jurisdiction and venue in those courts."

---

### 4.5 Missing User Indemnification Clause
* **Severity:** **High**
* **Affects:** Terms of Service → *Your content* or new section *Indemnification*
* **Why it matters:**
  * **Live text:** *"You are responsible for having the right to upload what you upload."*
  * Saying *"you are responsible"* does not legally obligate a user to pay your legal defense costs if a third party sues you because the user uploaded stolen architectural plans, violated jobsite confidentiality, or misused the service.
* **Suggested added wording (Plain English):**
  * *Add new section to Terms of Service → Indemnification:*
    > "### Indemnification
    > To the extent permitted by law, you agree to defend, indemnify, and hold us harmless from and against any third-party claims, liabilities, damages, losses, and expenses (including reasonable attorneys' fees) arising out of or related to: (a) the documents, data, or content you upload or share through Survey; (b) your reliance on Survey outputs in construction, surveying, or field work; or (c) your violation of these Terms or applicable law."

---

### 4.6 Overly Narrow License Grant in "Your content" ("grant us only the rights...")
* **Severity:** **Medium**
* **Affects:** Terms of Service → *Your content*
* **Why it matters:**
  * **Live text:** *"You grant us only the rights needed to store, display, and process them so the service can work."*
  * Using the restrictive word *"only"* without mentioning reproduction/backups, format conversion, transmission to sub-processors (Supabase, Groq, OpenAI, Brevo), syncing with connected third-party services (Excel, Google Sheets, MCP clients), and sharing with collaborators invited to the project creates unnecessary contract vulnerability.
* **Suggested replacement wording (Plain English):**
  * *In Terms of Service → Your content (replace paragraph 1):*
    > "### Your content
    > You keep ownership of the documents, annotations, and data you upload or create in Survey ('Your Content'). To operate the service, you grant us a worldwide, non-exclusive, royalty-free license (with the right to use our service providers and sub-processors) to host, store, back up, reproduce, process, transmit, and display Your Content solely as needed to provide, secure, and support the service—including sharing it with collaborators you or your project owner invite, processing your requests through the Survey AI assistant, and syncing it with third-party integrations (such as Microsoft Excel, Google Sheets, or MCP tools) that you enable. You represent and warrant that you have all rights and permissions needed to upload Your Content and share it through Survey."

---

### 4.7 Absolute Security & Visibility Promise in Privacy Policy ("Documents are visible only to you and the people you explicitly share them with")
* **Severity:** **Medium**
* **Affects:** Privacy Policy → *How your documents are handled*
* **Why it matters:**
  * **Live text:** *"Documents are visible only to you and the people you explicitly share them with."*
  * What if a *project owner* (rather than you) shares the project with another team member? What if you ask support to troubleshoot a corrupted PDF? What if Survey receives a valid subpoena, court order, or search warrant? Making an absolute promise with zero carve-outs for authorized support, legal process, and user-enabled integrations exposes you to breach claims.
* **Suggested replacement wording (Plain English):**
  * *In Privacy Policy → How your documents are handled (replace sentence 2):*
    > "Within Survey, your documents are accessible only to you and the collaborators who have been granted access to that project, except when you enable third-party integrations or AI features, ask our support team to troubleshoot an issue with your permission, or where we are required to disclose information by law or valid legal process."

---

### 4.8 Weak Suspension/Termination Rights, Unenforceable Update Clause, and Missing Assignment Clause
* **Severity:** **Medium**
* **Affects:** Terms of Service → *Acceptable use*, *Contact* (updates), and new section *General terms*
* **Why it matters:**
  * **Suspension vs. Termination:** Currently, *Acceptable use* only says *"We may suspend accounts that do."* You also need the right to **terminate** accounts for violations, non-payment, security risks, or extended inactivity.
  * **Updating Terms / Privacy Policy:** US courts frequently refuse to enforce unilateral modifications announced only via passive in-app notices unless users are given reasonable advance notice (e.g., by email or prominent in-app prompt) and told that continuing to use the service after the effective date constitutes acceptance.
  * **Assignment (Critical for sole proprietor → LLC transition!):** Because you are currently an individual and will likely form an LLC or corporation (or eventually sell Survey), without an **Assignment** clause allowing you to assign these Terms and transfer data upon forming a company or during a merger/acquisition, moving customer contracts to your new LLC would technically require affirmative consent from every user.
* **Suggested replacement / added wording (Plain English):**
  * *In Terms of Service → Acceptable use (replace last sentence):*
    > "We may suspend or terminate your access to Survey if you violate these Terms, fail to pay fees when due, or create a security or legal risk for us or other users."
  * *In both Privacy Policy and Terms (replace the final update sentence):*
    > "We may update these terms as Survey evolves. If we make material changes, we will notify you at least 30 days before they take effect by email or an in-app notice. By continuing to use Survey after the updated terms take effect, you agree to the changes; if you do not agree, you may export your data and close your account before the effective date."
  * *Add to Terms of Service → General terms:*
    > "### General terms
    > These Terms are the entire agreement between you and us regarding Survey. If any part of these Terms is found unenforceable, the remaining parts remain in full effect. Our failure to enforce a provision is not a waiver of our right to do so later. You may not assign these Terms without our written consent; we may assign these Terms (and transfer associated data under our Privacy Policy) to a newly formed corporate entity, affiliate, or successor in connection with an incorporation, reorganization, merger, or sale of the business."

---

## 5. Questions Only the Owner (or a Human Lawyer) Can Answer

Before finalizing the text for launch, you need to decide or verify the following facts:

1. **Legal Entity & Business Address:** Will you form an LLC or corporation before launch (strongly recommended given construction/field survey liability), or launch as a sole proprietorship (*Isaiah Calvo d/b/a Survey*)? What business mailing address or P.O. Box will you list for GDPR, California law, and CAN-SPAM compliance?
2. **State of Governing Law & Venue:** Which US state and county do you live in (or where will your LLC be formed) for the Governing Law and Exclusive Venue clause? (Also decide whether you prefer standard court litigation in your home county or binding individual arbitration with a class-action waiver.)
3. **Mobile App Monetization (iOS & Android):** Can users subscribe to the Pro plan *inside* the iPhone and Android apps (using Apple In-App Purchase / Google Play Billing), or are mobile apps strictly "companion/reader" apps where users must subscribe on the web via Stripe?
4. **How "Smart fill" ML Training Actually Works in Code:** When a user turns on *"Let Survey learn from my survey work,"* what exact payload is saved for training? Is it strictly vector coordinates, or does it also store a cropped raster/vector snippet of the underlying PDF blueprint around the shape? And does the code currently check whether the **project owner** (not just an invited contributor) has authorized training on that project?
5. **What Happens to Downgraded Projects in the Database:** When a paid subscription ends and over-limit projects are *"archived, not deleted"* (per PR #840), does your backend use the same `archived` status column that the 30-day permanent purge cron job uses? If so, will the 30-day purge job accidentally delete downgraded users' projects?
6. **Zero-Data-Retention / Training Settings with Groq and OpenAI:** Are you calling Groq and OpenAI via their paid commercial APIs where inputs/outputs are contractually excluded from training their models, and how long do Groq and OpenAI retain abuse-monitoring logs on your API tier?
7. **Analytics Opt-Out:** Does Settings → Privacy include (or will you add) a toggle allowing signed-in users to opt out of Agent Native Analytics (Builder.io) telemetry, or is telemetry mandatory for all signed-in sessions?
