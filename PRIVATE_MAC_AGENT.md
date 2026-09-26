# Private Mac Agent Guide

Use this guide only on Sheng's private Mac. It describes the authority and safety boundaries for a Codex session working in this repository on that machine.

## Purpose

This computer may access cryptocurrency-related websites, the Intercepta risk service, testnet tooling, and Sheng's `symbi/ai-payment-demo` GitHub repository. The repository was verified as public on 2026-09-27; the private-Mac environment does not make repository uploads private. That access exists so the project can validate real provider behavior separately from the offline demo.

It does not turn a simulated demo result into a verified payment result.

## Tools and skills on this computer

No Self Learning skill pack is required for the agreed private-Mac task. The coordinator used `self-learning-work-map` to prepare the plan; the resulting task prompt contains the actual steps, boundaries, evidence format, and acceptance requirements. Read `docs/DUAL_MACHINE_PLAN.md` and `docs/PRIVATE_MAC_SYMPHONY_PROMPT.md` for the handoff.

Required tools are Git with access to this personal repository, the repository's Node/npm version and locked dependencies, and a logged-in Codex CLI capable of `app-server` mode for Symphony. Use `.nvmrc` (currently 26.6.0), not an independently chosen Node version. The desktop Codex app alone does not prove that the CLI is installed and usable.

Symphony also needs the reviewed project workflow, GitHub tracker configuration, model assignment, and single-run/stop controls. Its source installation needs the Elixir/Erlang versions from that Symphony checkout; the current pilot launcher additionally uses Python 3. This portable configuration handoff is still pending. Verify exact versions and paths before dispatch; do not treat this guide as an installed runtime.

Private-side skills required: **none**. Taskboard, Self Learning, OKF, a copied MEMORY.md, and this computer's skill inventory are not prerequisites. Use ordinary file, terminal, Git, and authorized browsing capabilities; existing repository commands provide the tests and scanner. A browser-control plugin is optional for automated UI checks; manual local-browser validation can be recorded honestly when automation is unavailable.

Do not copy the company machine's global Codex configuration, memories, credentials, or plugins. If a later task genuinely requires an extra skill or tool, its handoff must name the exact source/version, purpose, permissions, and an available fallback before execution. Missing optional skills do not block the current evidence task.

## Before starting work

1. Confirm that the repository is `symbi/ai-payment-demo` and that the current branch and working tree are understood.
2. Read `README.md` and `docs/PRIVATE_MAC_RISK_CHECK.md` before any provider check.
3. Keep `.env`, API keys, seed phrases, private keys, wallet exports, cookies, and screenshots containing secrets local. Never commit, paste, print, upload, or request them.
4. Label every finding as one of: offline simulation, live risk check, wallet-signing test, or testnet payment. Do not combine those claims.

## Allowed work

- Clone, pull, edit, test, commit, and push this personal repository when Sheng has asked for it; publish only content authorized for its current visibility.
- Run local services bound to `127.0.0.1` and inspect their local browser pages.
- Access official provider, wallet, block explorer, testnet, faucet, and cryptocurrency websites when needed for an explicitly requested private-Mac validation.
- Make a bounded live Intercepta address-risk request following `docs/PRIVATE_MAC_RISK_CHECK.md`.
- Prepare code and evidence for a testnet signing or payment test after the required code path and provider response have been reviewed.

## Actions that still require Sheng's explicit confirmation

- Connecting a wallet to a website or dapp.
- Signing a message, signing a transaction, approving a token allowance, sending a transaction, requesting test tokens, or paying any amount.
- Enabling `ENABLE_TESTNET_PAYMENTS` or otherwise changing a setting that could enter a payment path.
- Creating a public repository, public deployment, release, pull request, merge, or publishing evidence beyond the specific content Sheng has authorized for public sharing. This handoff's publication does not authorize automatically publishing later scan batches.

## Required behavior for live validation

1. First run the offline tests and record the commit being tested.
2. Use a public test address or an address Sheng is authorized to check. Confirm the intended network separately.
3. Start with one provider request. If the response is unavailable, malformed, or semantically unclear, stop and report it; do not weaken validation to obtain an allow result.
4. Store only sanitized evidence: address, requested network, UTC time, HTTP/schema outcome, bounded score/trait facts, and the project's decision. Keep raw secrets and unrelated provider fields out of GitHub.
5. A real risk result may inform a hold/deny/allow policy only after the response schema, network coverage, and score meaning are understood. A score of zero is not proof that an address is safe.
6. A live risk check does not authorize signing, submission, settlement, or a claim that payment succeeded.

## Collaboration and delivery

- Do not change an unhanded-off module owned by another active task. Make a separate reproduction or test when a scope-external defect is found.
- Keep changes small and run the relevant tests before asking for review.
- Never use force-push. Do not merge automatically.
- State the commit, tests run, evidence location, and remaining uncertainty in every handoff.

## Starting a Codex task on this computer

At the start of a new task, tell Codex: `Read PRIVATE_MAC_AGENT.md first. This is the private-Mac environment; follow its boundaries for this task.`

For a real check, also state the exact target activity, such as: `Perform one Intercepta scan only; do not connect a wallet or initiate payment.`
