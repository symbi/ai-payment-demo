# Intercepta live test address candidates

Purpose: candidate **Ethereum mainnet** addresses for live Intercepta scans during the hackathon demo.

Important: these are **candidates**, not pre-labeled Intercepta results. Final Low / Gray / High demo grouping must be chosen **after** scanning them with the real Intercepta API. Do not hard-code expected scores or claim an address is safe because of this file.

## 0) Priority live-scan candidates — official OFAC source, Intercepta result still unknown

Use these first when looking for non-zero / differentiated live Intercepta evidence. They are prioritized because the addresses are explicitly present in dated OFAC SDN updates, not because this project already knows what Intercepta will return.

**Do not pre-label these as High / Medium / Low in the UI.** The source establishes sanctions-list context on the cited date; the live Intercepta result remains unknown until scanned.

Recommended operator order:

1. `P1` `0xFda1Ec4A6178d4916b001a065422D31EBE5F62FF` — OFAC 2026-03-12
2. `P2` `0xcB74874f1e06Fcf80A306e06e5379A44B488bA2D` — OFAC 2026-03-12
3. `P3` `0x9Be599d7867f5E1a2D7Ec6dB9710dF2b98A15573` — OFAC 2026-03-12
4. `P4` `0x76EA76CA4Eb727f18956aB93445a94c5280412B9` — OFAC 2026-03-12
5. `P5` `0x0330070FD38Ec3bB94F58FA55D40368271E9e54A` — OFAC 2026-03-12
6. `P6` `0xFb3eFf152ea55D1BfA04Dbdd509A80fD7b72cdEB` — OFAC 2026-03-12
7. `P7` `0x8d79c73daae8630c88de372ba8f57592fa987607` — OFAC 2026-08-07
8. `P8` `0xbb69e01921b17cd22080968bcc96ba6115da6062` — OFAC 2026-08-07
9. `P9` `0xe05f529f5284d75624eba386cb716928c3b54a2a` — OFAC 2026-08-07
10. `P10` `0x6b69e2a7545c166417a80c61a77562052bffa9c5` — OFAC 2026-08-07

Official sources:
- https://ofac.treasury.gov/recent-actions/20260312
- https://ofac.treasury.gov/recent-actions/20260807

### Scan-budget rule

Do **not** blindly consume all ten candidates. Scan in priority order and stop once there are enough useful, differentiated live cases for the demo. A provider `404` / unavailable result is still useful as a fail-closed example, but it should not consume the whole candidate budget.

Historical/delisted cases such as G1/G2 remain useful for gray-area/provider-coverage behavior, but they are no longer first-priority candidates for finding a stable sanctions-related live result.

## 1) High-risk candidates — current OFAC-listed ETH addresses

### Candidate H1
- Address: `0x1d19b52b54e7ef5ea1a4b40b616165e798eac9f8`
- Why selected: ETH address listed in an OFAC cyber-related designation update dated 2026-07-13.
- Source: https://ofac.treasury.gov/recent-actions/20260713
- Demo expectation: strong candidate for a blocked/held path if Intercepta surfaces sanctions/AML-related evidence.

### Candidate H2
- Address: `0x2C7DcD774b33e10367F7d6385479e04F97d179dc`
- Why selected: alternate ETH address in the same OFAC 2026-07-13 designation update.
- Source: https://ofac.treasury.gov/recent-actions/20260713
- Demo expectation: second high-risk backup candidate.

## 2) Gray-area candidates — historically designated Tornado Cash addresses later delisted

These are useful because they demonstrate that historical risk context and current sanctions status are not the same thing.

### Candidate G1
- Address: `0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc`
- Why selected: Tornado Cash address that appeared in prior OFAC action and was explicitly removed from the SDN list on 2025-03-21.
- Delisting source: https://ofac.treasury.gov/recent-actions/20250321
- Demo expectation: useful candidate for a review/HOLD story if Intercepta reports historical/mixer exposure; do not assume it will.

### Candidate G2
- Address: `0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936`
- Why selected: another Tornado Cash address explicitly included in the 2025-03-21 OFAC deletion record.
- Delisting source: https://ofac.treasury.gov/recent-actions/20250321
- Demo expectation: gray-area backup candidate.

## 3) Lower-risk / institutional candidates — scan first, never call these "safe"

These addresses are publicly labeled by Etherscan as Kraken hot wallets. That label is **not** a risk score and does not prove safety. They are included only as plausible lower-risk comparison candidates for live Intercepta scanning.

### Candidate L1
- Address: `0x05ff6964D21e5dAE3b1010D5AE0465b3c450F381`
- Public label: `Kraken: Hot Wallet 4`
- Source: https://etherscan.io/address/0x05ff6964D21e5dAE3b1010D5AE0465b3c450F381
- Demo expectation: candidate for the payment-goes-through path **only if** the live Intercepta result and project policy allow it.

### Candidate L2
- Address: `0xf30ba13e4b04Ce5dC4D254Ae5FA95477800F0EB0`
- Public label: `Kraken: Hot Wallet 2`
- Source: https://etherscan.io/address/0xf30ba13e4b04Ce5dC4D254Ae5FA95477800F0EB0
- Demo expectation: lower-risk backup candidate, subject to the same live-scan rule.

### Candidate L3
- Address: `0xaA8ba7D4611437141192e7ceCed531Bc0A133efb`
- Public label: `Kraken: Hot Wallet 5`
- Source: https://etherscan.io/address/0xaa8ba7d4611437141192e7ceced531bc0a133efb
- Demo expectation: additional institutional comparison candidate.

## 4) Strongest source for hackathon-specific known-risk test addresses

The ETHGlobal Intercepta prize page states that Intercepta pins **test addresses with known risks in their Discord channel**. If accessible, prefer those addresses for the final judged demo because they are challenge-specific and likely chosen to produce meaningful Intercepta results.

Prize page: https://ethglobal.com/events/tokyo2026/prizes

## 5) Live scan procedure on the private Mac

For every candidate above:

1. Put `INTERCEPTA_API_KEY` only in local `.env`; never commit it.
2. Run a live Intercepta address scan before any payment signing.
3. Record only non-secret output:
   - address;
   - timestamp;
   - HTTP success/failure;
   - `toxicScore`;
   - bounded trait labels/count;
   - project verdict/reason;
   - whether provider semantics/chain coverage are verified or still unverified.
4. Do not classify an address as Low / Gray / High until the real scan has returned.
5. Choose the final three demo recipients based on actual results.

Recommended final demo set:
- one address that live-scans clean enough for the project policy to allow;
- one address that leads to HOLD / human review;
- one address that leads to DENY / refuse.

## 6) Hackathon alignment

Official Intercepta qualification points relevant to this address set:
- working agent payment flow, x402 preferred;
- at least one **live** Intercepta API call before a payment is signed or accepted;
- the scan result must decide what happens next;
- mainnet addresses should be screened even if payment runs on testnet;
- demo must show one payment that goes through and one that is blocked/held, with the reason visible;
- mocked/hard-coded risk responses do not qualify.

Source: https://ethglobal.com/events/tokyo2026/prizes

## Guardrails

- Do not label a real address criminal, sanctioned, safe, malicious, or low-risk beyond what a cited source and the live provider response actually establish.
- OFAC-listed addresses may be described specifically as OFAC-listed, with date/source.
- Tornado Cash addresses above should be described as historically listed and later delisted, not currently OFAC-listed based on the 2025 deletion record.
- Etherscan exchange labels are identity/context labels only, not risk assessments.
- Keep the final demo driven by live Intercepta evidence rather than this file's candidate grouping.
