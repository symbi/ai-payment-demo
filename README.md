# Intercepta payment gate — local demo

## Current Demo: address assessment and task permission

This Demo is the same payment-related project, but the current second-computer
acceptance path supports address assessment and saving an application task permission. It is not a wallet,
payment, report purchase or security guarantee. The page is served only on
`127.0.0.1:47915` and must be used on a personal computer.

On the private Mac, follow [second-computer startup and acceptance](docs/SECOND_COMPUTER.md):

The coordinator-provided unified commands are:

```sh
npm run demo:prepare   # local page build; no risk request
npm run demo:check     # offline preflight; no network or service
npm run demo:live      # same Demo on the personal Mac, after quota/key checks
```

`demo:check` passing proves only local preparation. It does not prove provider
availability, response semantics, balance, signing or payment. A real risk API
response is evidence from one authorized manual request; local tests and
synthetic data are not API evidence. The page always keeps the project decision
at HOLD when coverage or field meaning is unconfirmed.

The old `private:risk` name remains an internal compatibility alias. The company
offline experiment does not make real risk requests. Do not run `npm run dev` or
`npm run setup:local` for this acceptance path.

The full project remains a work in progress. It is not production custody, a
complete security audit, an autonomous Agent or a completed payment flow.

![Current runtime architecture — planned components are explicitly labelled](docs/architecture.visual-check.2048x1320.light.png)

## Local checks

Task permission persistence, UI and transport have offline tests. Run `npm run typecheck` and the scoped tests recorded in the handoff. Distinguish these checks from a manual provider request and from payment evidence. Saving a permission does not start the task or connect it to a signer. Spent, reserved, available budget and wallet balance remain unknown until their real sources are connected.

## Sources and limits

- [x402 Foundation](https://github.com/x402-foundation/x402): SDK and official examples; prior learning sample remains separate from this new project.
- [Quick Scan Address](https://docs.web3antivirus.io/reference/quick-scan-address): address risk only, not complete authorization or token validation. Any correspondence must be stated honestly.

Do not replace missing provider or payment evidence with local tests or simulated receipts.
