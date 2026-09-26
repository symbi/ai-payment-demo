---
tracker:
  kind: github
  provider:
    repo: symbi/ai-payment-demo
    token: $GITHUB_TOKEN
  required_labels:
    - machine:private-validation
    - symphony-private-m0-disabled
  active_states: [open]
  terminal_states: [closed]
polling:
  interval_ms: 30000
workspace:
  root: ./workspaces
agent:
  max_concurrent_agents: 1
  max_turns: 1
codex:
  command: python3 "$PRIVATE_SYMPHONY_HOME/once.py"
  approval_policy: on-request
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
    networkAccess: true
server:
  host: 127.0.0.1
  port: 47910
hooks:
  before_run: |
    python3 "$PRIVATE_SYMPHONY_HOME/once.py" --check || exit 1
    gh issue view 9 --repo symbi/ai-payment-demo --json labels --jq '[.labels[].name]' | python3 -c 'import json,sys; x=set(json.load(sys.stdin)); assert "machine:private-validation" in x and "symphony-private-m0-ready-20260927" in x and "machine:company-offline" not in x'
  after_run: |
    gh issue edit 9 --repo symbi/ai-payment-demo --remove-label symphony-private-m0-ready-20260927 --add-label symphony-human-review
---
Execute ONLY GH-9, the private-machine M0 issue. Do not claim any other issue or total-goal card.
{{ issue.title }}
{{ issue.description }}

The coordinator already prepared the environment. Reuse existing candidates, evidence and tests; no installation demonstration or repeated full suite. Write only docs/private-validation/m0-20260927/REPORT.md, FIELD_MAP.md and observations.json. Existing product code, tests, configuration, policy and payment are read-only. No subagents, other tasks, commits, pushes, merge, wallet, signature or payment.

Public provider documentation may be read on this PRIVATE machine. The coding worker receives no provider key. Only the private coordinator may run the existing dedicated scan-only command after the no-added-cost quota check, at most 3 requests total and one per candidate, no retry. Consume its sanitized result; do not search for or read credentials, .env, auth files, tokens or signing material. Missing scan results do not block completing source-based FIELD_MAP: mark gaps and finish.

Unknown provider semantics stay unknown; current app HOLD does not prove a dangerous address. Do not invent score scales, thresholds, network coverage or live guard acceptance. Preserve historical/live distinction and provenance. Post only short sanitized progress to this Issue through host github_api if available. Detailed address batches and scan results stay local pending publication approval.

End with the three artifacts and remaining blockers, then return. Do not remove the ready label while still writing results. Host launcher and after_run disable dispatch. One formal run, 20 minutes inherited ceiling, no automatic retry or model fallback. Approval/usage failure means blocked, not permission to bypass.
