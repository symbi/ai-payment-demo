# Intercepta live decision policy plan

Target: current `main` after `1577a8fcc7ff2b97a044732801b11361c5cf4000`.

This document supersedes the earlier parser-only plan. The non-empty trait parsing / bounded evidence work is now largely implemented in `main`; do not redo it unless a regression is found.

## Current state

The latest code already does several important things correctly:

- calls the real Intercepta/W3A quick-scan endpoint from the buyer backend;
- keeps the API key inside the server-side request header;
- accepts non-empty provider traits;
- bounds the number of parsed traits and labels;
- strips provider free text from the public/internal evidence shape;
- preserves timeout / no-retry / fail-closed behavior;
- keeps provider semantics and chain coverage explicitly unverified;
- keeps payment disabled after a live scan.

Relevant files include:

- `apps/buyer/src/intercepta.ts`
- `apps/buyer/src/intercepta-response.ts`
- `apps/buyer/src/intercepta.test.ts`
- `shared/contracts.ts`
- `apps/buyer/src/service.ts`

The next task is therefore **not another parser rewrite**. The next task is to turn the live Intercepta evidence into a clear, reviewable payment-decision policy and a stronger three-minute demo.

## Official challenge alignment

ETHGlobal Tokyo 2026 / Intercepta says the important moment is the payment decision. A live Intercepta call must happen before a payment is signed or accepted, and its result must decide what happens next. Their own examples include:

- pay;
- refuse;
- cap the amount;
- ask a human.

They also require a demo with one payment that goes through and one that is blocked or held, with the reason visible.

Official source:
https://ethglobal.com/events/tokyo2026/prizes

This means `ALLOW WITH LIMIT` / capped payment is a first-class challenge-aligned action, not an invented extra.

## Product direction

The live demo should no longer look like:

`manually tune weights -> calculate our own score -> show allow/hold/deny`

Instead, it should look like:

`recipient -> live Intercepta evidence -> agent payment policy -> payment action`

The provider evidence and the agent decision must be visually and logically separate.

### Provider evidence

Read-only facts from Intercepta, for example:

- toxicScore;
- trait labels / bounded risk evidence;
- scan timestamp;
- provider;
- transport status.

Do not let the user edit these values.

### Agent payment decision

Our policy consumes the provider evidence plus payment context and returns an action such as:

- `ALLOW`
- `ALLOW_WITH_LIMIT`
- `HOLD`
- `DENY`

The reason must be visible and specific enough that a judge can understand why the action happened.

## Important correction: do not assume a 0..100 Toxic Score scale yet

The current parser deliberately accepts any finite numeric `toxicScore`, and the code still marks provider semantics as unverified.

Therefore:

- do not hard-code a 0..100 progress bar yet;
- do not call 50 "medium" or 90 "high" before the provider semantics are verified;
- do not invent a threshold table from intuition;
- first run real scans on the private Mac and record observed values;
- verify the official response semantics before choosing score thresholds.

If official docs or the live provider response establish a bounded range later, update the UI and tests at that point.

## Recipient candidate pool

Keep a pool of roughly 15-20 real **mainnet** addresses for live scanning.

Do **not** present the dropdown as:

- Safe
- Medium Risk
- High Risk
- Blacklist

Those labels reveal the expected answer before the live check and make the demo look hard-coded.

Instead, present neutral case labels, for example:

- Case 01
- Case 02
- ...
- Case 20

The underlying address can still be visible after selection.

### Ordering

After real scans have been performed on the private Mac, the internal candidate catalog may be ordered by **observed** Toxic Score from lower to higher for operator convenience.

Do not derive that order from public reputation labels alone.

This gives the presenter a practical way to choose:

- a lower-score case;
- a middle-range case;
- a high-score case;

without telling the judge the expected result before clicking the live assessment.

### Most valuable cases

The most useful demo cases are not simply "very low score" and "very high score".

Prefer to discover several addresses with **similar observed Toxic Scores but different trait evidence**, because that lets the demo prove that the agent is not just doing:

```text
if score > threshold:
    deny
```

Instead, the policy can demonstrate that similar aggregate scores may result in different actions because the evidence and payment context differ.

Example only — do not hard-code these numbers or traits:

```text
Case A
Observed score: similar to Case B
Traits: lower-severity / reviewable exposure
Payment amount: small
Action: ALLOW_WITH_LIMIT

Case B
Observed score: similar to Case A
Traits: hard-deny evidence
Action: DENY

Case C
Observed score: similar range
Traits: ambiguous / incomplete / review-required evidence
Action: HOLD
```

These cases must be selected **after** real live scans. Do not pre-label candidates to force this story.

## Decision policy design

### 1. Toxic Score is evidence, not the whole policy

Do not simply map one score threshold directly to a final payment decision.

The policy should be able to consider:

- provider Toxic Score;
- provider trait labels / risk categories;
- evidence availability and freshness;
- payment amount;
- task budget;
- destination consistency;
- payment authorization consistency;
- any hard-deny rules that are actually justified and documented.

### 2. Hard-deny evidence

If a provider trait has a clearly verified hard-deny meaning for the project policy, it may override an otherwise moderate aggregate score.

Do not infer "hard deny" from a trait name alone. Document the mapping and the evidence source.

### 3. Allow with limit

Support an amount-capping outcome.

Example:

```text
Requested amount: 0.005000 USDC
Policy cap:        0.001000 USDC
Decision:          ALLOW_WITH_LIMIT
```

The payment must not silently proceed at the original amount after a cap decision.

For the first implementation, it is acceptable to produce a clear policy result before wiring a real limited payment, as long as the UI does not falsely claim the capped payment settled.

### 4. Hold / human review

Use HOLD when:

- evidence is unavailable;
- response semantics are still unverified;
- chain/provider coverage is unverified;
- the traits are ambiguous;
- required context is missing;
- the result needs explicit human approval.

Provider failure must never fall back to ALLOW.

### 5. Deny

DENY should be reserved for clearly documented policy conditions.

The UI should show the specific reason that triggered refusal.

## Replace editable live-demo weights

The current `weighted-demo-v1` may remain for:

- offline fallback;
- test fixtures;
- deterministic UI development;
- explanation / regression tests.

But the **main judged live demo** should not ask the user to edit 40/25/15/10/10 weights or provider-confidence values.

Otherwise a judge can reasonably ask whether the result was manually tuned for the demo.

For the live path:

- Intercepta evidence is read-only;
- agent policy is a fixed, versioned configuration;
- policy reasons are displayed;
- any threshold / hard-deny / cap rule lives in code or a checked-in policy config;
- changes to the policy require code/config review, not a slider on the demo page.

If the old advanced weight panel stays in the UI, hide it from the primary live path and label it clearly as an offline simulation/development control.

## Proposed live demo UI

### 01 Payment

Show:

- recipient case selector;
- actual recipient address;
- requested amount;
- task budget;
- payment network / asset;
- clear statement that Intercepta runs before signing.

Primary action:

`Assess & Pay`

or, if signing is still disabled:

`Assess payment`

Do not claim payment occurs unless it actually does.

### 02 Live Intercepta evidence

After the live scan, show read-only provider evidence:

- Toxic Score;
- trait labels / bounded evidence;
- checked timestamp;
- provider;
- coverage/semantics status where relevant.

### 03 Agent decision

Show one of:

- ALLOW
- ALLOW WITH LIMIT
- HOLD / HUMAN REVIEW
- DENY

Also show:

- plain-language reason;
- maximum allowed amount if capped;
- whether signing occurred;
- whether submission occurred;
- whether settlement occurred.

Do not conflate a policy decision with proof of payment.

## Three-minute demo strategy

Prepare the candidate pool in advance by running live scans on the private Mac and recording non-secret outputs.

The presenter should know roughly where useful cases sit in the neutral case list, but the judge should still see a live scan during the demo.

Recommended story:

### Demo A — goes through

- choose a candidate whose live evidence has previously been suitable;
- run Intercepta again live;
- show provider evidence;
- policy returns ALLOW;
- payment proceeds if the real testnet payment path is ready.

### Demo B — similar score, different evidence

Choose two previously discovered candidates with similar observed scores but different trait evidence.

Use them to show that the policy is contextual rather than a single numeric cutoff.

Possible outcomes:

- one returns ALLOW_WITH_LIMIT;
- one returns HOLD or DENY.

### Demo C — explicit high-risk request if a judge asks

Keep one or two known-risk candidates near the end of the internal ordering so the presenter can quickly demonstrate a strong refusal path if requested.

Do not rely only on this obvious case for the main story.

## Candidate discovery workflow

Use `docs/INTERCEPTA_TEST_ADDRESS_CANDIDATES.md` only as a **discovery pool**.

Public reputation sources such as OFAC records, historical sanctions records, exchange labels, and challenge-provided test addresses are useful for finding diverse candidates, but they must not become the application's permanent risk database.

The runtime product should not maintain a giant local blacklist just to reproduce what the risk provider already does.

Instead:

1. candidate sources help us find interesting demo addresses;
2. live Intercepta scans produce the actual provider evidence;
3. the policy consumes that evidence consistently;
4. the candidate catalog stores only enough non-secret metadata for demo preparation.

## Live scan preparation on the private Mac

Never run this on the restricted company computer.

For each candidate, record:

- neutral case ID;
- address;
- timestamp;
- HTTP success/failure;
- observed Toxic Score;
- bounded trait labels/count;
- provider semantics verification status;
- project action under the current policy;
- reason code;
- optional amount cap.

Do not commit:

- API key;
- `.env`;
- wallet private key;
- seed phrase;
- executable signatures.

It is acceptable to commit sanitized, non-secret scan observations if they are clearly marked as historical preparation data and the live demo still performs a real API call.

## Wallet connection priority

Browser `Connect Wallet` is not the priority for this challenge.

The challenge requires a working agent payment flow and a live Intercepta decision before signing/acceptance; it does not require a browser-wallet connection UI.

Prioritize:

1. live Intercepta scan;
2. visible real evidence;
3. evidence -> policy action;
4. payment path is actually controlled by that action;
5. one successful testnet payment;
6. one blocked/held payment;
7. only then improve wallet connection UX if time remains.

A backend / agent signer is acceptable if the flow is real and safe.

## Next implementation task

Codex should first diff current `main` against this document and **preserve** the bounded evidence work already merged in `1577a8f`.

Then implement the smallest coherent next slice:

1. introduce a fixed/versioned live payment policy interface;
2. support `allow | allow_with_limit | hold | deny` as policy outcomes without falsely claiming settlement;
3. keep Intercepta evidence read-only;
4. remove or hide editable weighted-demo controls from the primary live-demo path;
5. add a neutral recipient-case selector backed by a separate candidate catalog;
6. add tests showing that equal/similar score values can produce different decisions when verified evidence differs;
7. keep provider failure fail-closed;
8. keep real signing/payment disabled unless the final guard is explicitly satisfied;
9. preserve existing request-recovery/idempotency protections;
10. do not weaken parser bounds or secret-handling protections.

## Acceptance criteria for the next slice

The next slice is complete when:

- the live path does not depend on user-editable risk weights;
- Intercepta score/traits are displayed as provider evidence, not user inputs;
- a fixed, reviewable policy returns one of four actions;
- similar score fixtures with different verified traits can exercise different policy outcomes;
- `ALLOW_WITH_LIMIT` exposes the cap clearly;
- HOLD remains the fallback for missing/unverified evidence;
- DENY has explicit documented reasons;
- no secret is committed;
- tests/typecheck/build pass;
- existing bounded evidence and request-recovery behavior remain intact;
- the UI never claims a payment was signed/submitted/settled unless the corresponding execution evidence exists.

## Guardrail

Do not optimize the code to manufacture a predetermined demo result.

The purpose of the candidate pool is to discover useful real cases. The live Intercepta evidence must remain authoritative at demo time, and unexpected results must be displayed honestly.
