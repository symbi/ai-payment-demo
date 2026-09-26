# Private Mac Agent Guide

Use this guide only on Sheng's private Mac. It describes the authority and safety boundaries for a Codex session working in this repository on that machine.

## Purpose

This computer may access cryptocurrency-related websites, the Intercepta risk service, testnet tooling, and the project's private GitHub repository. That access exists so the project can validate real provider behavior separately from the offline demo.

It does not turn a simulated demo result into a verified payment result.

## Before starting work

1. Confirm that the repository is `symbi/ai-payment-demo` and that the current branch and working tree are understood.
2. Read `README.md` and `docs/PRIVATE_MAC_RISK_CHECK.md` before any provider check.
3. Keep `.env`, API keys, seed phrases, private keys, wallet exports, cookies, and screenshots containing secrets local. Never commit, paste, print, upload, or request them.
4. Label every finding as one of: offline simulation, live risk check, wallet-signing test, or testnet payment. Do not combine those claims.

## Allowed work

- Clone, pull, edit, test, commit, and push this private repository when Sheng has asked for it.
- Run local services bound to `127.0.0.1` and inspect their local browser pages.
- Access official provider, wallet, block explorer, testnet, faucet, and cryptocurrency websites when needed for an explicitly requested private-Mac validation.
- Make a bounded live Intercepta address-risk request following `docs/PRIVATE_MAC_RISK_CHECK.md`.
- Prepare code and evidence for a testnet signing or payment test after the required code path and provider response have been reviewed.

## Actions that still require Sheng's explicit confirmation

- Connecting a wallet to a website or dapp.
- Signing a message, signing a transaction, approving a token allowance, sending a transaction, requesting test tokens, or paying any amount.
- Enabling `ENABLE_TESTNET_PAYMENTS` or otherwise changing a setting that could enter a payment path.
- Creating a public repository, public deployment, release, pull request, merge, or sharing evidence outside this private repository.

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
