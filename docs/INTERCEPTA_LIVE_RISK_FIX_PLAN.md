# Intercepta live-risk parser fix plan

Target: current `main` after `1f390eeeca5546e25e7fe22681257c57d198adbf`.

## Problem

`apps/buyer/src/intercepta.ts` calls the real Intercepta/W3A quick-scan endpoint with `X-API-KEY`, but `parseQuickScan()` currently accepts only responses where `traits` is an empty array.

That means a real risky address with one or more risk traits may be treated as `Unsupported scan response` instead of surfacing the provider evidence. This blocks the most important live demo path.

## Goal

Accept and safely expose a bounded summary of non-empty `traits` while preserving fail-closed behavior. Do **not** enable payment in this task.

## Files to inspect

- `apps/buyer/src/intercepta.ts`
- `apps/buyer/src/intercepta.test.ts`
- `shared/contracts.ts`
- `apps/buyer/src/intercepta-response.ts` and tests if UI parsing needs adjustment
- `apps/buyer/src/service.ts` only if required for display plumbing

## Required changes

1. Broaden `RiskResult.scan` so `traitsCount` can be a bounded non-negative integer instead of only `0`.
2. Optionally add a bounded `traitLabels?: string[]` field for safe display.
3. Replace the empty-traits-only parser. Require a finite numeric `toxicScore` and an array `traits`, but allow non-empty traits.
4. Parse only minimal observed trait fields. Do not dump arbitrary provider JSON into the app contract.
5. Keep all existing scanner protections: response size limit, timeout, no redirects, no retries, `credentials: 'omit'`, secret API key only in `X-API-KEY`.
6. Keep `coverage: 'unverified'` and `semantics: 'unverified'` unless separately verified.
7. A successful live response must still fail closed: showing a score/traits is not permission to auto-pay.
8. Never interpret `toxicScore === 0` as automatically safe.

## Suggested bounded shape

```ts
scan?: {
  transport: 'received' | 'unavailable';
  toxicScore?: number;
  traitsCount?: number;
  traitLabels?: string[];
  requestedNetwork: string;
  coverage: 'unverified';
  semantics: 'unverified';
}
```

Suggested bounds: `traitsCount` 0..100; at most 20 labels; max 120 chars each. Adapt only after observing the actual provider response schema.

## Tests required

- empty traits still parse;
- one valid trait parses;
- several valid traits parse and are bounded;
- malformed trait fails closed;
- oversized traits are capped or rejected consistently;
- missing/non-finite `toxicScore` fails closed;
- non-200 stays unavailable;
- timeout stays unavailable with no retry;
- API key never appears in returned data/logs;
- existing scanner tests still pass after updating expectations.

Use fake/injected `fetch`; unit tests must not call the real API.

## Acceptance criteria

The task is done when a realistic non-empty `traits` response is no longer reported as unsupported, the returned evidence is safe/bounded for display, malformed responses still fail closed, typecheck/tests/build pass, no secret is committed, and payment remains disabled.

## Next phase

After this parser fix is merged, run real scans on the private Mac using `INTERCEPTA_API_KEY` from local `.env`. Record only non-secret results for candidate addresses: address, timestamp, success/failure, toxicScore, bounded traits, and resulting project decision.

Then choose the final low-risk / gray / high-risk demo recipients based on **actual live Intercepta results**, not hard-coded expectations.

The later policy flow should be:

`recipient -> live pre-sign Intercepta scan -> visible evidence/reason -> allow / hold / deny -> payment can proceed only on allow`

## Non-goals

Do not enable a signer, settlement, wallet custody, or real/testnet payment in this parser task. Do not redesign the offline weighted demo. Keep the patch narrow.
