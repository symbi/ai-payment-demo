# Run Agent PayGuard

This guide is for reviewers running the current **main** branch on a personal
computer. The demo explains payment decisions using recipient evidence and
project policy. **Payment execution is NOT CONNECTED:** there is no wallet
connection, signature, settlement, or completed purchase.

You can inspect the **Decision Lab** without an Intercepta API key. A real
recipient check is a separate, optional step requiring your own authorized
provider access. Neither path requires a wallet private key or seed phrase.

This guide and the main decision walkthrough are in English. Some advanced
settings, source notes, and historical messages still use their original language.

## 1. Start a local review

Install Git and the Node version specified in [`.nvmrc`](../.nvmrc). The supported
runtime range is Node 22.12 through 26. Use a personal computer on which you are
allowed to run this project. The `personal` environment flag is an entry-point
requirement, not permission to bypass restrictions on a managed work computer.

For a first-time review, open a terminal and run:

```sh
git clone --branch main https://github.com/symbi/ai-payment-demo.git
cd ai-payment-demo
npm ci
npm run demo:prepare
```

Leave `.env` absent and ensure the review terminal does not inherit an existing
Intercepta key or a fully configured scanning environment. Start the existing
local app:

```sh
# macOS / Linux
PRIVATE_RISK_MACHINE=personal npm run demo:live
```

For Windows PowerShell:

```powershell
$env:PRIVATE_RISK_MACHINE = "personal"
npm run demo:live
```

Open **http://127.0.0.1:47915/** in your browser. Keep the terminal open; press
**Ctrl+C** there when you finish.

Without a key and confirmed scan settings, the live-check controls are not
ready. That is expected. The synthetic Decision Lab remains available and
does not call Intercepta, write scan records, or initiate payment.

This is key-free viewing, not a force-offline switch: an existing environment
with all scan settings can enable the live-check controls. Startup creates local
`.runtime` state, but does not itself make a provider request.

If you have already scanned from another checkout, use that existing checkout
and preserve its configuration and `.runtime/private-risk/` records. Starting
over in a new directory does not renew a provider quota or erase earlier calls.

## 2. Walk through the demo

1. Review **Payment intent**: the recipient and proposed USDC amount.
2. Read **Decision Factors** and **Evidence Quality** before interpreting the
   project policy result. A raw Toxic Score alone is not the decision.
3. Open **Decision Lab**, labelled **SIMULATED**. Its three fixed inputs use the
   same score of 50 and amount of 0.0005 USDC, but different evidence:

   | Synthetic recipient | Evidence | Project policy result |
   | --- | --- | --- |
   | SIM-001 | Mixer-related trait | `ALLOW_WITH_LIMIT` |
   | SIM-002 | Sanctions-related trait | `DENY` |
   | SIM-003 | Unknown trait | `HOLD` |

4. Read the reason and amount limit beside each result. The engine computes
   these outcomes from inputs; the examples are not live Intercepta responses.
5. Confirm **Payment execution — NOT CONNECTED**. A policy result does not prove
   a signature, payment, or safe recipient.

The normal evidence panel may show no usable record during a key-free review.
Do not present that missing evidence or the synthetic examples as a live scan.

## 3. Optional: check a real recipient

Only the operator with authorized provider access should perform this step.
Keep the key in an ignored local `.env` file or local environment, never in
browser code, screenshots, chat, or Git. Do not use a wallet private key.

Before enabling a request:

- Set `INTERCEPTA_API_KEY` to your actual local provider key.
- Set `PRIVATE_RISK_MACHINE=personal` on the authorized personal computer.
- Set `PRIVATE_RISK_FREE_QUOTA_CONFIRMED=true` only after confirming the actual
  free quota with the provider.
- Use `PRIVATE_RISK_PRIOR_REQUESTS=0` only when there are no unaccounted calls
  outside the preserved journal for this round. It does not mean that calls
  already in the journal are zero. If prior use is uncertain, stop and reconcile it.
- Keep `PRIVATE_RISK_MAX_REQUESTS` within the confirmed allowance. It defaults
  to 3 and accepts 1–1000; a higher local limit does not create provider credits.

Then run:

```sh
npm run demo:check
npm run demo:live
```

Stop an existing instance with Ctrl+C before restarting it. `demo:check` performs
no provider request and checks only local readiness; passing does not confirm
that the provider is available or that its evidence supports a payment.
It is expected to fail on a key-free review setup.

In the app, inspect saved results first. Select an authorized, previously
unscanned recipient and explicitly choose **Run Live Risk Check** only when you
intend to consume one request. Selecting a recipient or changing the amount
does not itself scan. Failed requests also count, and the app does not
automatically retry saved recipients. Do not delete the journal to retry or
reset the allowance.

Keep the requested network separate from the network covered by the evidence.
Zero score is not proof of safety, and a project policy result is not permission
to sign a payment.

## Task permissions and evidence

**Advanced spending policy** contains the task-permission controls. Optional
`BUYER_ADDRESS` and `SELLER_PAY_TO` settings are public addresses, not private
keys; without them, saving a task grant is unavailable. Saving a grant does not
start an agent, reserve funds, connect a wallet, or execute a payment. Wallet
balance and spent, reserved, and remaining budget are not connected.

With an existing valid scan record, **Technical / audit details** provides a
project decision snapshot. It uses saved evidence and makes no new provider
request. Treat the download as a diagnostic artifact, not a transaction receipt
or signed attestation. A key-free walkthrough has no live record to export.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Node or dependency error | Use the version in `.nvmrc`, run `npm ci`, then rebuild with `npm run demo:prepare`. |
| Missing local page | Run `npm run demo:prepare` from the repository root. |
| Live check not ready | Expected without a key; use Decision Lab, or complete the optional live-check prerequisites. Do not enter dummy credentials. |
| `budget_addresses=pending` | The optional grant addresses are not configured. This is separate from recipient-risk readiness. |
| Port already in use | Stop the existing demo instance; do not start competing processes against the same journal. |
| Pending, corrupt, or unavailable records | Preserve the records and report the error. Do not reset or blindly resubmit. |

For offline developer checks, run `npm run ci:local`. These checks do not prove
a real scan or payment. Use the commands in this guide for the current demo;
`npm run dev` and `npm run setup:local` belong to the earlier purchase setup.
