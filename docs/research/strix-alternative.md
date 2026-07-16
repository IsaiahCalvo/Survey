# Strix replacement using existing AI subscriptions

Research date: 2026-07-13. Sources are first-party and current as of that date.

## Recommendation

Stop using Strix. Use this stack instead:

1. **Codex Security** for the primary security review. It is the closest first-party equivalent: repository-specific threat modeling, finding discovery, sandbox validation, ranking, proposed patches, and revalidation. OpenAI currently lists it as a research preview for ChatGPT Pro, Business, Enterprise, and Edu. It can scan a local worktree through the Codex Security plugin or a connected GitHub repository through Codex Security cloud. No OpenAI/OpenRouter API key is configured for either workflow. [OpenAI overview](https://help.openai.com/en/articles/20001107-codex-security) · [plugin quickstart](https://learn.chatgpt.com/docs/security/plugin) · [cloud setup](https://learn.chatgpt.com/docs/security/setup)
2. **Normal Codex agents/subagents** independently verify each high-signal finding, patch only accepted findings in an isolated branch/worktree, run regression tests, and re-check the fix. This provides the adversarial second opinion Strix's multi-agent loop supplied.
3. **Deterministic scanners and tests** run in GitHub Actions within a hard `$0` overage budget, or locally. They complement—not replace—the semantic review. Codex Security itself says it complements conventional static analysis. [Codex Security FAQ](https://learn.chatgpt.com/docs/security/faq) · [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
4. **Docker only for dynamic validation that needs an isolated app/database/browser stack.** Do not make Docker the default for source review. This keeps risky runtime experiments away from the host and production, without making every audit local and slow.

For the current multi-worktree backlog, first reconcile and merge the intended code. Then scan the exact candidate branch locally. Once the canonical GitHub branch is clean, enable Codex Security cloud for commit-by-commit coverage.

## Why Strix created an unexpected bill

Strix's source code is open source, but its own quickstart requires both Docker and an LLM provider API key. Its GitHub Actions example also requires `LLM_API_KEY`. A local-model server is the only documented way to avoid a hosted model API while still using the open-source Strix agent. [Strix README](https://github.com/usestrix/strix) · [Strix provider docs](https://docs.strix.ai/llm-providers/overview)

The key distinction:

- The **Strix program** can be free.
- The **model it calls** is not free unless it is genuinely local.
- Docker isolates Strix's execution tools; it does not pay for model inference and does not keep prompts local when Strix is configured with OpenAI, Anthropic, or OpenRouter.
- Strix Cloud is a separate Strix product, not part of ChatGPT or Claude.

ChatGPT subscriptions and the OpenAI API use separate billing systems. A ChatGPT subscription cannot be converted into general API credit for Strix. [OpenAI billing explanation](https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform)

Claude has the same boundary. Anthropic says subscription usage is intended for native Claude applications, including Claude Code; third-party tools and open-source projects should use API-key authentication, and trying to route third-party traffic through subscription limits is prohibited. Therefore, Claude subscription credentials must not be wired into Strix. [Anthropic authentication policy](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)

## What each subscription actually covers

| Option | Uses existing subscription? | Runs in cloud? | Separate API key? | Important limit |
|---|---:|---:|---:|---|
| Codex Security plugin | Yes, if account is eligible | Model service is hosted; commands run in the selected Codex task | No | Codex usage is limited by plan; plugin availability can depend on plan/settings |
| Codex Security cloud | Yes, if account has Pro/Business/Enterprise/Edu preview access | Yes, connected GitHub repo in isolated OpenAI container | No | Research preview; initial scan may take hours or days |
| Generic Codex local/cloud task | Yes, across ChatGPT plans | Either | No | Included agentic allowance is shared; extra credits are optional after limits |
| Claude Code terminal/IDE | Yes on Pro/Max | Commands local; model hosted | No, if logged in with Claude subscription | Claude and Claude Code share plan limits |
| Claude Code on web | Uses Claude Code account access | Yes, isolated VM with GitHub repo | No when using subscription authentication | General coding agent, not a dedicated validated security scanner |
| Strix open source | No | Only if self-hosted elsewhere | Yes, unless local model | Provider API spend plus machine compute |
| GitHub Actions | Not an LLM subscription | Yes | No for deterministic tools | Private repos have included minutes, then metered overage |
| GitHub Codespaces | No | Yes | No | Separate compute and storage quota; not needed for this design |

OpenAI says Codex is included across ChatGPT plans, but usage varies with task size, model, runtime, and codebase size. Plan usage is consumed first; purchased credits are an optional pay-as-you-go extension. [Using Codex with a ChatGPT plan](https://help.openai.com/en/articles/11369540/) · [OpenAI flexible credits](https://help.openai.com/en/articles/12642688)

OpenAI's current Codex Security page lists eligible plans but does **not** promise unlimited or permanently free security scans. Therefore, do not infer zero marginal cost forever: verify the account Usage dashboard before the first cloud scan and keep auto top-up disabled. The safe promise is **no separately configured LLM API key and no unapproved overage**, not unlimited compute.

Claude Pro/Max includes Claude Code under the same subscription, including supported IDE use. When the included limit is reached, the safe choices are wait for reset or explicitly upgrade; API/usage-credit continuation is separate. [Claude Code with Pro/Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)

Anthropic warns that `ANTHROPIC_API_KEY` overrides subscription login and causes pay-as-you-go API charges even when the user is logged into a paid Claude plan. [Anthropic API-key precedence](https://support.claude.com/en/articles/12304248-manage-api-key-environment-variables-in-claude-code)

## Cloud versus local execution

### Codex cloud

Codex cloud checks out the selected repository revision into an OpenAI-managed container, runs setup, then runs the agent. Agent internet access is off by default. Setup-time secrets are removed before the agent phase. Network access can be constrained by domain and HTTP-method allowlists. [Codex cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environment) · [Codex security controls](https://learn.chatgpt.com/docs/agent-approvals-security) · [Codex internet controls](https://learn.chatgpt.com/docs/cloud/internet-access)

This is the best default after the backlog is merged because it offloads compute and can scan connected commits continuously. Use no production credentials, keep agent internet off unless a specific dependency domain is required, and require review before any pull request or merge.

### Claude Code on the web

Claude Code on the web clones a GitHub repository into an isolated, task-specific VM, supports asynchronous and parallel tasks, restricts network access, proxies GitHub credentials outside the VM, and can produce a branch/PR for review. It is a good independent reviewer or fallback when Codex Security is unavailable. [Claude Code on the web](https://support.claude.com/en/articles/12618689-claude-code-on-the-web)

### Local Codex or Claude Code

Local execution keeps shell commands and the working copy on the laptop, but model context still goes to the hosted model service. Local Docker adds process/filesystem isolation for test workloads; it does not make a hosted AI model local. Fully keeping code and prompts off provider infrastructure requires a local model, which is outside this recommendation.

For ChatGPT Plus/Pro, OpenAI says Codex content may be used for model improvement unless training is disabled in ChatGPT data controls. Business/Enterprise/Edu inputs and outputs are not used for training by default. [OpenAI Codex data controls](https://help.openai.com/en/articles/11369540/)

## Proposed audit workflow

1. **Select one immutable target.** Use an isolated worktree/branch and record commit SHA, app scope, exclusions, and threat assumptions. First pass is read-only.
2. **Run standard Codex Security scan.** Review coverage and deferred areas before findings. Reject claims lacking a reachable path, impact, or validation evidence. [Standard scan workflow](https://learn.chatgpt.com/docs/security/plugin/scans)
3. **Run a deep scan only after the standard scan is useful.** OpenAI describes deep scans as slower and higher-resource, so reserve them for release candidates or high-risk services. [Deep scan workflow](https://learn.chatgpt.com/docs/security/plugin/deep-scans)
4. **Run independent validation.** Give each candidate finding to a separate Codex subagent or Claude Code web task. It must prove reachability and impact against disposable test data, or downgrade/dismiss it.
5. **Patch narrowly.** One accepted root cause per patch when practical. Add a regression test. No automatic commit, push, merge, deployment, production data access, or external notification.
6. **Verify.** Run the relevant tests/build/type checks, re-run the targeted security check, inspect the diff, then use a normal code review before merge.
7. **Continuous lane.** After the canonical branch is clean, let Codex Security cloud scan new commits. Use GitHub Actions only for deterministic checks and ordinary test suites.

This reproduces the useful part of Strix: contextual discovery, real validation, consequence analysis, minimal remediation, and independent verification. It intentionally omits autonomous broad probing of production systems.

## Hard no-surprise-spend guardrails

Apply before another scan:

1. Do not run Strix again. Remove its stored provider credential. Revoke the dedicated OpenRouter/provider key if it was created only for Strix; do not revoke a shared key blindly.
2. In Codex Settings → Usage, disable auto top-up. Use included plan allowance only. When the limit is reached, stop and wait unless Isaiah explicitly approves spending.
3. In Claude Code, authenticate with the Claude subscription only, keep `ANTHROPIC_API_KEY` unset, confirm `/status`, decline usage credits, and disable Console auto-reload.
4. Set GitHub Actions and Codespaces overage budgets to `$0`. GitHub-hosted Actions are free for public repos on standard runners; private repos use a plan quota and bill beyond it. Personal Codespaces include a quota, but Codespaces meters compute and storage and organization accounts do not receive that personal quota. [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) · [Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)
5. Never give a cloud agent production secrets. Use test fixtures and disposable databases. Keep network access off or narrowly allowlisted.
6. Never run privileged workflows against untrusted pull-request code with secrets. GitHub specifically warns against privileged `pull_request_target`/`workflow_run` patterns that check out untrusted code. [GitHub Actions secure-use guide](https://docs.github.com/en/actions/reference/security/secure-use)

## Decision

- **Primary:** Codex Security plugin now; Codex Security cloud after branch/worktree reconciliation.
- **Second opinion:** Claude Code on the web, authenticated through the existing Claude subscription with no API key.
- **Runtime validation:** local Docker only when a finding actually needs an isolated running stack.
- **CI:** deterministic GitHub Actions with `$0` overage budget.
- **Never again:** Strix, OpenRouter, OpenAI API, Anthropic API, Codespaces, or any other metered service without Isaiah's explicit approval after the price is stated.
