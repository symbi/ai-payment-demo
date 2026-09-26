# Private Mac risk-check follow-up (payment off)

Status: **not run**. The provider's actual response schema, address/network coverage, score meaning, and compatibility remain unverified until this check is performed on the private Mac.

## Safety boundary

- Use only the existing `createInterceptaScanner` export in `apps/buyer/src/intercepta.ts`. It performs one bounded quick-scan request and always returns `decision: hold`.
- Do not start the buyer/seller service or any route that can reach payment code. Keep `ENABLE_TESTNET_PAYMENTS` absent or `false`; do not load a wallet or signing credential.
- Keep `INTERCEPTA_API_KEY` only in the private Mac's local environment. Do not paste it into a command, issue, report, screenshot, chat, or upload `.env`.
- Scan only an address that the operator is authorized to check. Confirm the intended network separately; the current request passes a requested-network label, but provider network coverage is unverified.

## One-shot scanner invocation

From the repository root, after `INTERCEPTA_API_KEY` is already present in the local shell environment, set only the public candidate address and requested network, then invoke the existing scanner directly:

```sh
INTERCEPTA_CHECK_ADDRESS=0x... INTERCEPTA_CHECK_NETWORK=eip155:84532 \
node --import tsx --input-type=module -e '
  import { createInterceptaScanner } from "./apps/buyer/src/intercepta.ts";
  const address = process.env.INTERCEPTA_CHECK_ADDRESS;
  const network = process.env.INTERCEPTA_CHECK_NETWORK;
  if (!address || !network) throw new Error("public address/network missing");
  const result = await createInterceptaScanner(process.env.INTERCEPTA_API_KEY)(address, network);
  console.log(JSON.stringify({
    address: result.address, checkedAt: result.checkedAt, source: result.source,
    decision: result.decision, reasons: result.reasons, scan: result.scan
  }, null, 2));
'
```

This calls the risk provider once. It does not start an app, sign, submit, settle, or retry a payment. Stop if the result is unavailable or the schema is rejected; do not loosen validation to make an unknown response pass.

## Evidence to retain locally

For each authorized candidate, record the address, requested network, UTC timestamp, success/failure, HTTP/schema compatibility outcome, raw `toxicScore`, bounded `traitsCount`, up to 20 allowlisted `traitLabels`, and the project decision (`hold`). If more than 20 validated traits are present, record that displayed labels were truncated and are not the full list.

Keep the sanitized result and the provider response shape locally for comparison, without the API key or unrelated response fields. Verify the actual field names/types, network/address coverage, timestamp/freshness behavior, and score/trait semantics before changing any project decision. A score of zero is not proof of safety, and no result from this check authorizes a funds action.
