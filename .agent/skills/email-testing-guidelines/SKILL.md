---
description: Guidelines for generating test users, managing emails, and interacting with Supabase Auth to prevent bounce rate warnings.
---

# Testing Email & User Guidelines

When writing or executing tests, performance scripts, automation tools, or any code that creates new user accounts in Supabase Auth, you MUST adhere to the following rules:

## 1. NEVER use fake or unmonitored email addresses
- **DO NOT** use `@example.com`, `@test.com`, or `@test.org` domains.
- **DO NOT** use generated strings for the username portion of a real domain if the address does not exist (e.g., `codex.perf.20260224+run1@gmail.com` if `codex.perf.20260224` is not a real inbox).
- **Why?** Supabase immediately sends confirmation and welcome emails to new users. If the email does not exist, it results in a hard bounce. High bounce rates will cause Supabase to temporarily or permanently restrict the project's email-sending privileges.

## 2. ALWAYS use valid alias emails
When you need to create a test user, use a valid, monitored email address formatted with a `+` alias.
For this project, use the standard convention based on a valid owner email. For example, use:
- `isaiahcalvo123+test1@outlook.com`
- `isaiahcalvo123+perf_run_2026@outlook.com`
- `isaiahcalvo123+dummy_user@outlook.com`
*(Any email sent to these aliases will be delivered to the real `isaiahcalvo123@outlook.com` inbox, preventing bounces.)*

## 3. Mocking or Bypassing Auth in Automated Tests
If you need to generate hundreds of users for load testing and do not want to flood the real inbox:
- Contact the administrator to temporarily disable **"Confirm email"** in the Supabase Dashboard.
- Provide a clear log of the test accounts that were created so they can be securely cleaned up (deleted from `auth.users`) after the test concludes.

By following these rules, we ensure our Supabase project remains healthy and maintains a high standard of email deliverability.
