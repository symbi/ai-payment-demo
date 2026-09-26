# Execution handoff — contract v1

Authorized 2026-09-26: local basic demo first. This is personal work; no company code, accounts, keys or data. Reviewed and locally verified modules may be committed and pushed to the user's verified SYMBI personal repository. No public release, paid LLM calls or real-money payments. Do not fake development history or claim simulated results are live. User requested separate A/B Codex tasks. Keep Taskboard labels separate from actual task/thread binding.

## Agent Payment Guard (2026-09-27)

The private page now presents payment intent, Intercepta evidence, a project policy decision, and execution gating. The primary flow is English; diagnostics, the original v2 scan receipt and spending-policy management remain collapsed. The requested amount defaults to 0.005 USDC. Selecting a recipient or editing the amount only recomputes locally; a saved scan cannot be repeated.

`Project/Intercepta Payment Policy v1` is this project's deterministic demonstration policy, not an Intercepta verdict or backend execution permission. It preserves Toxic Score as a raw value without weighted scores or numerical thresholds. In priority order:

1. Invalid amounts or unavailable/invalid live evidence produce HOLD.
2. Missing or positive unknown-trait count produces HOLD.
3. Observed `sanction_address`, `blacklist` or `known_scammer` produces DENY.
4. Incomplete saved trait labels produce HOLD; an already observed hard-deny trait still denies.
5. `mixer_transfers`, `non_kyc_transfers`, `sanction_address_communication`, `fake_phishing_transfer`, `fake_phishing_contract_communication` or `rug_pull_trader` produces ALLOW WITH LIMIT, with a project-defined 0.001 USDC cap. Amounts above the cap require reduction; the application does not change the entered amount automatically.
6. A complete live HTTP 200 record with zero traits produces ALLOW under this policy; it does not certify address safety. Other recognized but unmapped evidence produces HOLD.

Every outcome retains `Execution: NOT CONNECTED`. No wallet connection, signing, payment, budget reservation or settlement was added. A saved spending grant shows its actual budget, single-payment limit and expiry only; absent grants show Not configured. This page does not claim that a grant covers the selected recipient or that remaining budget is known. Historical scans, candidates, the configured quota, scanner/parser, server-only key handling, receipt filtering and payment backend are unchanged.

On a private machine, update the existing authorized checkout of `demo/permission-and-risk-v1`, preserving local configuration and journals. Run `npm run ci:local` with installed dependencies (it already builds the private page), then use the existing `npm run demo:live` entrypoint and its printed loopback URL. Existing saved records are evaluated locally. A manual Assess Payment for a previously unscanned recipient consumes the existing scan allowance; do not clear journals or retry saved recipients. No provider API or payment call is needed to validate the page offline.

The fully intercepted browser acceptance is `node --import tsx tests/policy-v8/browser-check.mjs` with an existing Chrome installation. Its screenshots are explicitly marked OFFLINE FIXTURE and cover allow, limit, deny, unavailable/unknown HOLD, amount edits, reload recovery, actual saved-grant fields and a 390px viewport. They are not live-provider or payment evidence.

## Sequential local verification

`npm run ci:local` is the deterministic pre-push verification command. It reports the Node version, full Git HEAD and dirty state, then runs these steps sequentially and stops at the first nonzero exit:

1. TypeScript typecheck.
2. The complete offline Vitest discovery set with one worker; no test-name or path filter is applied.
3. The private risk page build.
4. The buyer production build.

Each started step prints a PASS or FAIL result and exit code. Later steps are reported as not run after a failure. The command uses only already-installed project dependencies and never installs or replaces packages.

### Local evidence versus hosted CI

Local `ci:local` success is local evidence only; it is not a hosted-CI pass or deployment evidence. Hosted GitHub Actions evidence checked on 2026-09-27 for run `36268364761` showed zero runners and no steps, with an account-locked-due-to-billing annotation even though Actions was enabled and allowed actions were set to all. This is a hosted account/billing availability failure, not an application test failure. Do not rerun or change billing from this handoff; keep `ci:local` as the required pre-push check until the hosted account is unlocked. The command was introduced from baseline Git commit `2d7b8661c19038e5cc075d2ed7f152e960f7186d`; record the actual HEAD and dirty state printed by each later run with its result.

### Environment setup

For a fresh isolated or fresh private checkout, install the locked dependencies once with `npm ci`, then run `npm run ci:local`.

For an existing private or shared working environment whose dependencies are already installed, run only `npm run ci:local`. Do not reinstall or replace the current `node_modules` as part of verification.

## Browser request recovery and candidate handoff (2026-09-27)

The buyer page stores only its request ID and whether a check was attempted in this browser origin. Reload queries the original request; it never automatically creates or checks another request. A lost response can be recovered through Refresh status. If the backend restarted and lost its memory record, or browser storage is unavailable/corrupt, status remains unknown and new quote/check actions stay blocked. Do not clear storage or create a fresh checkout to conceal that state. This is browser identity continuity, not a durable backend ledger or cross-tab execution lock. Payment remains disabled.

The existing Report offer under Details retains the explicit new-quote action after a confirmed result. No Grant, risk result, quote, key or payment permission is saved in browser recovery storage.

Private Mac update: use the existing checkout and its existing journals, pull `demo/permission-and-risk-v1` with fast-forward only, run `npm run demo:prepare`, and restart the existing private entry with `npm run demo:live`. Preserve `.env`, `.runtime`, saved Grant and scan records; keep the existing configured `PRIVATE_RISK_MAX_REQUESTS` (20 for the user's current run). Updating or refreshing the page does not scan. No limit increase or reset is part of this change.

The upstream candidate additions `8bdfd9c`/`1ab83f1` are retained. P1–P10 appear in the private address selector after rebuilding. Their descriptions are user-provided source clues, unverified here, not provider findings or predicted scores. No local candidate loader or separate pool was added. On the private computer only, manually select one unattempted candidate (P1 first if that is the intended case), scan once, then inspect HTTP/transport/shape evidence before choosing another. Stop on 404 or unavailable evidence rather than blindly trying more. Existing records are query-only and failed attempts still count. The company-machine validation uses only fixtures and makes no provider/crypto/source-website requests.

## Task permission preflight handoff — current boundary

The existing private entry at `127.0.0.1:47915` remains the only entry that can save a TaskGrant or perform an address assessment. These are separate records and separate actions: opening the page, viewing existing results, and saving permission do not scan an address. The existing buyer API at `127.0.0.1:4031` and buyer web page at `127.0.0.1:5178` are the connected checkout path; it is preflight-only and reads the server-held permission. It does not construct a scanner, save a Grant, write either budget journal, or create a ledger, signature, transaction, or payment.

The private entry and buyer must refer to the same checkout/root identity and the same public `BUYER_ADDRESS` and `SELLER_PAY_TO`. A saved permission is usable only when its task, account, recipient, network, asset, resource, and quoted intent match. A different checkout has a different journal; it must HOLD rather than copy, reset, or recreate the old journal. Preserve the existing scan journal, including any H1/G1/H2/G2 records already present. The H2 parser fix is included from published commit `2522289`; the preflight slice was published as `80c0d2c`. Do not rescan existing candidates, and do not treat candidate notes as provider evidence.

Before any private-machine handoff, the existing `demo:check` may be used as a no-network preparation check. It checks local prerequisites and configuration shape only; `local-preparation-only` is not evidence that a Grant scope matches, the backend is ready, the seller is ready, the provider is reachable, or a real risk decision was obtained. Keep the private live entry off company machines. No automatic start, retry, or real verification is implied.

On the private computer only, the existing `npm run demo:live` serves the address-assessment/Grant page, while `npm run dev` starts seller, buyer and the buyer web page from that same project directory. Do not run the latter on the company computer: it includes the seller entry, not just an offline frontend. Obtain a quote in the buyer page, then use **Check request**; this new buyer path reads the saved Grant and always stops before scanning or execution. Existing expired or mismatched Grants remain HOLD; do not delete them to force a pass.

The connected page may show the quote and recipient, the permission preflight contract/reason, and—only for a passing scope check—the Grant ID, intent hash, and checked atomic amount. It may also show separately labelled risk evidence or unavailable/fixture status. A passed check is scope evidence only: it is not remaining budget, risk approval, payment confirmation, report delivery, or execution permission. The page must keep payment disabled and make unknown or stale results explicit.

Budget and execution capabilities remain unconnected. Accounting stays `not_connected`; spent, reserved, available, and wallet balances are unknown. Saving a new ledger fact does not enable execution. There is no Grant renewal or revocation capability in this handoff, and no change to payment core, quota UI, infrastructure, or scan journals is authorized.

## Current control point — manual starts and module checkpoints

QA reporting clarification: independent QA task `01a0d98f-4c49-7aa0-b8d9-4988f54198b3` reports results and defects to K02. K02 directs A/B fixes, hands the fixed snapshot back to QA for retest, then reports to the user. QA retains independent verification; M is not its approval gate. This supersedes earlier wording that QA routinely delivers directly to the user. Existing final-flow dependencies remain unchanged.

Latest user clarification: K02 is an independent stage-02 delivery owner and reports/demonstrates directly to the user for acceptance. M is not an approval gate for K02. Informing M preserves cross-stage context only; it must not delay a stage-02 delivery. M retains overall direction and single-writer ownership of shared files. Stage 02 has delivered its locally demonstrated, independently reviewed basic page/backend flow (real 402, missing-key hold, zero signing/settlement); see ETH-35 for exact snapshot evidence. User acceptance, Git upload, personal-computer reproduction and real risk/payment remain separate uncompleted gates.

Latest user decision: stage 02 has a dedicated coordinator K02, task `01a0d93a-adbc-7dc2-bb05-e41bf29afb86`, fully bound to ETH-35. K02 receives A/B evidence and reviews, checks integration, and maintains stage 02 handoffs; M retains overall/cross-stage decisions and shared-file ownership. Each A/B implementation task arranges an independent capable read-only reviewer, fixes findings through its original writer after an explicit start, then submits the exact reviewed snapshot to K02. Reviewers do not self-approve their own implementation. Reuse the ongoing B review and A findings; do not create duplicate review work. K02's first action is acceptance of this coordination handoff, not automatic new coding or stage 03 execution.

Updated authorization, 2026-09-26: the user explicitly asked K02 to coordinate A/B through a working local demo and open it for inspection. K02 has dispatched ETH-25 to the existing B task: Chinese React/Vite page, real local interfaces and independent delta review. A handles any seller findings through its original writer. K02 may coordinate fixes and revalidation within this slice without requesting the same authorization again. Stage 03 and other cards still require their own applicable start and dependencies. A is task `01a0d923-7df1-7232-87b5-7bd2212a62bb`; B is task `01a0d923-90e3-7801-a43e-c4b00c829de6`. Both tasks run from `/Users/v-sheng.huang/sboai`; the repository is its `ai-payment-demo` child, not a claimed Codex task working directory.

K02 owns unified local demo startup and browser presentation at 127.0.0.1 ports 5178 (web), 4031 (buyer) and 4032 (seller). Check existing listeners before starting; M and A/B must not independently start duplicate standard-port services. This authorization covers necessary local service startup, not dependency installation, paid calls, payments, GitHub push or stage 03. Root/package/lock/shared files and this handoff remain M's single-writer scope; route required changes to M. K02 reports that real local A/B HTTP integration passed with missing-key hold and zero signing/settlement; the page and user-visible demo remain pending until actually verified.

For each deliverable module: self-tests → independent review of an exact snapshot → local visible demonstration → local commit → push to the verified personal repository → reproduce that commit on the user's personal computer. Fixes return to the original writer and affected checks rerun. Record reviewer identity and actual model/depth when known, not historical suggestions. Model price/rank alone is not acceptance evidence.

The user reaffirmed `SYMBI`. The current GitHub CLI was verified as `ShengHuang21`; this repository has no remote. Do not push under the mismatched account, silently switch global login, or infer that browser login authorizes CLI credentials. No commit or push has happened. Repository ownership/authentication must be resolved before upload; default private. Never commit `.env`, `.runtime`, API keys or wallet secrets.

Taskboard owner verified that complete existing-task identity binding is supported, but `Start planning` and `Execute next` create managed coordination/developer/validator conversations rather than resume existing A/B. The local Taskboard project has no workspace mapping, and its current `project map` command only affects cloud mapping. Until that product gap is resolved, use linked existing tasks plus explicit single-card instructions and evidence comments; do not claim managed Start works.

## Scope and ownership

Project `/Users/v-sheng.huang/sboai/ai-payment-demo` is new and separate from prior official x402 learning samples. M owns root config, lockfile, shared contracts and this handoff. A owns `apps/seller/` and `docs/working-log-A.md`. B owns `apps/buyer/`, `apps/web/` and `docs/working-log-B.md`. Ask M before shared edits. Both use the one root npm install. Do not run installs concurrently. Do not modify Taskboard product code.

- M: ETH-10/11/12, current coordination task.
- A: ETH-3 and ETH-13→14→15 seller implementation.
- B: ETH-5 and ETH-19→20→21→16→17, then ETH-25 frontend; continue ETH-22/32/23/18/26 only when actual dependencies are ready and the user explicitly starts that card.
- C/D: independent validation after a fixed integrated version. Do not mark `done`; self-verification is `in_review`.

## Local interfaces

TypeScript, React+Vite (127.0.0.1:5178), Express buyer (4031), Express seller (4032). Use localhost only. Shared fields in `shared/contracts.ts` v1. Npm scripts: `npm ci`, `npm run doctor`, `npm run typecheck`, `npm test`, `npm run build`, `npm run dev`. No Docker required. M pins versions and owns package-lock.

Seller `GET /health` returns truthful readiness without secrets; `GET /api/weather` returns x402 v2 402 before payment, then 200 demo-fixture JSON only after SDK validation/settlement. Use @x402/express + ExactEvmScheme; configurable public test facilitator. Network eip155:84532, USDC 0x036CbD53842c5426634e7929541eC2318f3dCF7e, amount 1000 = 0.001 test USDC. Missing SELLER_PAY_TO gives 503, never invent a configured merchant. SDK tests can inject fake facilitator; never claim test doubles settled funds. A may consult the existing official source `/private/tmp/sheng-x402-official-learning` but not its .env or wallet files; document reuse.

Buyer `GET /api/health` reports configuration booleans and seller connection. `POST /api/inspect` body `{requestId,prompt}` fetches fixed configured seller URL and parses 402 without signing. Returns PurchaseResult. `POST /api/pay` body `{requestId}` requires a server-held inspected request, rechecks live risk and identical terms before any signature; missing key / unsupported risk / disabled payments must hold. `GET /api/requests/:id` returns result. No arbitrary URL proxy, no browser-provided `allow`, no client-supplied signer or keys. Vite proxy `/api` to buyer. Bound request size, timeout and localhost origins; frontend rendering is text, not arbitrary HTML.

## Basic gate — fail closed

Check network/USDC/positive atomic amount ≤1000 and exact configured payTo locally. Intercepta Quick Scan Address must check that same payTo. Address scan is not a transaction/message/token scan. Actual response fields must be validated against current official documentation or an actual redacted response. No invented score threshold; unknown structures/statuses, timeout, missing key = hold. Real API risk data is mainnet; test payments are testnet. Do not attach risk of unrelated address to another recipient. No key is currently verified. No fake API result in the normal payment route. Inject fixtures only into tests or a completely separated, explicitly labelled offline preview that cannot sign.

Private key belongs only in the backend signer. x402 automatic wrappers can sign: hook BEFORE payment creation, and enforce exact conditions inside guarded signer. LLM has no signer and cannot expand authorization. Initially return actual purchased JSON; if no authorized personal model, label `aiMode:not_configured` / manual tool request. Do not reuse Codex account credentials as an application API key. No real LLM calls this slice.

Payment policy flag defaults false. Do not enable or run live payments while key/coverage unverified. Build/test the adapter without secrets. A timeout after signature is settlement_unknown; do not create a new payment blindly. Duplicate request ID must not repeat signing; reject ID reuse with changed intent. Client disconnect is not evidence of failed payment. Counters only report actual observed invocations, not inferred chain state.

## User-visible first slice and evidence

One understandable page: service readiness → view seller terms → risk decision/reason → payment/result status. Show missing configuration and blocked work; not a green mock success. Three final acceptance cases: live safe+payment+data; live risk blocked before sign; scan failure held before sign. Budget failures are additional policy tests, not a substitute for live risk rejection.

At each card completion/pause, comment with Input/version; Output files/start command; tests actually run; Working Log path; remaining gaps; next recipient. Review current Task Capsule before execution using taskctl. Use exact existing CLI `/Users/v-sheng.huang/sboai/dashi-taskboard/cli/taskctl.mjs --runtime-file /Users/v-sheng.huang/sboai/dashi-taskboard/.data/launcher-runtime.json --json`; loopback may need escalation. Do not invent protected bindings or bypass a rejected mutation. No overwriting another task's claim. Use current version guard. Record actual Codex task ID after dispatch, not a model label as proof of execution.

Checkpoint comments also record the reviewed commit or uncommitted content digest, independent review findings, visible demo evidence, local commit SHA, push outcome and personal-computer reproduction outcome. Unperformed steps remain unverified. A clean install in a second directory on this machine is not another-computer verification. Partial-module checks do not replace final C/D full-flow acceptance.

References: https://ethglobal.com/events/tokyo2026/prizes/intercepta ; https://docs.x402.org/advanced-concepts/lifecycle-hooks ; https://docs.web3antivirus.io/reference/quick-scan-address


## Current project decision snapshot (v9)

Open **Technical / audit details** in Execution gating, then **Download project decision snapshot**. This separate local JSON includes the currently selected recipient, literal amount, canonical project policy result, original scan receipt v2, local export time, and `NOT_CONNECTED`. Changing recipient or amount changes the next snapshot; loading or invalid/missing current input disables export. Saved evidence is reused without scanning. The original v2 download remains unchanged and can still report HOLD independently of project policy.

The snapshot is a local diagnostic artifact, not a signed attestation, a new provider response, or proof of payment. User-provided U1–U3 candidate clues are available with unverified provenance; adding or selecting them does not scan. Numeric trait-detail preservation is deferred, and older missing observations cannot be reconstructed. The user reports one private U1 scan with Toxic Score 0 / traits 0; it is not verified here or imported into the journal. Do not repeat U1 because a local record is absent. U2/U3 remain unknown.

Offline validation: 1,194 tests, typecheck, both builds, current-intent JSON download checks, and desktop/mobile browser checks passed. Browser evidence uses explicit intercepted fixtures; no real provider, wallet, signature or payment was exercised. Cloud CI status is separate and is not represented by these local results.


## Reusable policy core and present limits

The decision path is saved Intercepta record → validated adapter → normalized evidence → shared pure payment policy. Explicit synthetic inputs use a separate adapter into the same engine. The existing live entry point remains a compatibility wrapper. This separation is not a generic guarantee about other providers' trait meanings; the versioned rules still use the current project's vocabulary and fail-closed priorities. Raw Toxic Score is evidence, never a numeric decision threshold.

The small **Policy Sandbox — Synthetic Scenarios** compares three fixed score-50 inputs (mixer, sanction and unknown) at 0.0005 USDC. They contain inputs only; the engine computes their outcomes. The section is explicitly SIMULATED and is not a live Intercepta response. It does not create scan records, consume quota, modify receipts or initiate payment.

The live scanner, key handling, saved-record schema and journal persistence remain as before this refactor. Existing source/network/time/coverage limitations remain in the live evidence and receipt views; normalized decision data does not certify freshness or network coverage. User-reported private scan results have not been independently verified on this machine.

Existing spending grants can be saved and displayed, but this is not a connected, unified budget enforcement and payment path. Actual wallet signing, payment and settlement remain **Execution NOT CONNECTED**. No synthetic outcome demonstrates real execution or complete competition eligibility.

After the demo: optional numeric trait preservation, additional provider adapters and executor integration remain separate future work. Numeric producer/consumer work is preserved outside this release; missing historic risk/transaction-count values cannot be backfilled from labels or scores. No new provider/executor placeholder or dependency is part of this core extraction.
