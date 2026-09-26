# Run on a second personal computer

## Requirements

- A personal computer, Git and Node.js (use `.nvmrc`: 26.6.0; supported range is >=22.12 and <27).
- Access to the private repository once its owner and upload are confirmed.
- Your own Intercepta key for the optional live scan. Never put it in Git, screenshots or chat.
- No Docker, cloud deployment or funded wallet is required for the current held-payment demonstration.

## Fresh installation

Clone the confirmed repository and open a terminal in its project folder. Then run:

```sh
npm ci
npm run setup:local
npm run doctor
npm run dev
```

Open http://127.0.0.1:5178 . The launcher starts the buyer backend on 4031 and the seller on 4032 as separate local programs. If a port is occupied, stop the old instance you own; do not kill unrelated services. Stop this launcher with Ctrl+C.

`setup:local` creates a new empty merchant wallet and `.env`; it refuses to overwrite existing local configuration. Do not copy the development computer's `.env` or `.runtime` into the repository. Keep the generated merchant wallet empty and never use real funds.

To enable only the address scan, edit the local `.env` and set `INTERCEPTA_API_KEY` to your own key. Keep `BUYER_PRIVATE_KEY` empty and `ENABLE_TESTNET_PAYMENTS=false`. Restart your local launcher after changing configuration. Never share the key in a screen recording.

## Expected demonstration

The default single-screen check is **Offline example · Synthetic evidence**. Its Check risk button changes display state only, without a new scan or payment. Continue is a synthetic illustration, not permission to sign. Use **Details → Report offer** to reach the real non-payment flow described below; Existing request stays empty until a request has been loaded in this session.

1. Open Contract Insights: the bundled sample's structure is visible, not an arbitrary smart-contract audit.
2. Request a quote: the seller returns HTTP 402 and the page shows 0.001 test USDC.
3. Explicitly click the risk-check control: this may consume an API request; it is not triggered by installing or simply opening the page.
4. Inspect scan results: the current flow remains held, signing and settlement stay at zero.

Without a key or if the provider is unavailable, expect a held/unavailable result, not a successful live scan. A successful scan is not a successful payment. Third-party Agents and completed payments remain pending.

## Local checks

```sh
npm run typecheck
npm test
npm run build
```

These checks do not replace a human run on the second computer. Record the commit, Node version, visible result and any error without credentials. The local buyer keeps request history in memory; restarting clears it. Keep all three services on loopback; public hosting and remote Agent access need separate authentication/security work.
