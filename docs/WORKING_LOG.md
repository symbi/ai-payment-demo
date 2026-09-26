# Coordinator working log

## 2026-09-26 — execution authorized

- User approved plan/diagram fixes and sequential execution, basic functionality first.
- Reconciled existing 38 Taskboard cards; consistent M/A/B/C/D roles and input/output/evidence; dependency graph acyclic. ETH-18 moved after payment; ETH-22 no longer waits on final data; live payment waits for live risk adapter.
- Host observed Node v26.6.0, npm 11.18.0, Git 2.50.1. Ports 5178/4031/4032 had no listener in the local check. Existing services untouched.
- Official npm metadata checked for fixed package versions; new project scaffold, shared contract v1 and A/B handoff created. Install succeeded (161 packages); locked offline `npm ci --ignore-scripts` also succeeded. Doctor and initial shared-contract typecheck passed. Do not reinstall while A/B are reading packages again.
- Real Intercepta key, private application LLM configuration, recipient address and live scan not verified. No secrets copied, no real payment, no push/publication.

## Basic implementation dispatch

- User confirmed Key still absent; continue the basic slice without it. ETH-31 is blocked, not silently skipped.
- A actual Codex task: `01a0d923-7df1-7232-87b5-7bd2212a62bb`; B: `01a0d923-90e3-7801-a43e-c4b00c829de6`. Both observed active. Execution prompts use scoped single writers, no recursive agents. Model override omitted, retaining user defaults; actual model identity not independently verified.
- Generated a new empty local test merchant using `npm run setup:local`; only public address enters local `.env`. Secret is ignored under `.runtime/`, mode 0600. No buyer private key or API key configured; payments disabled. No network or payment involved in wallet generation.
- First concurrent intermediate test run: 14 policy assertions passed; seller HTTP tests could not listen on loopback (`EPERM`) in sandbox. This is not a business test success. A notified; final validation must allow local listening. Limit root Vitest to 2 workers.
- Revised target diagrams independently delivered, 9/9 checks, four viewport browser checks, main coordinator inspected large light screenshots. Architecture vs implementation status remains explicit; optional model is not yet connected.

## Manual-start and checkpoint update

- User requested linked Taskboard cards and existing tasks, explicit per-card starts, independent review before uploads, and incremental reproduction on a personal computer. A/B implementation paused at safe handoffs; A subsequently received a separate direct user instruction for independent read-only review.
- A reports 11 seller tests plus typecheck passed; B reports 44 buyer tests plus typecheck passed. These are implementer reports, not coordinator independent acceptance. B has not created `apps/web`, run a build, or verified real local A/B HTTP integration. No complete browser demo is claimed.
- Verified GitHub CLI login is `ShengHuang21`. User reaffirmed target `SYMBI`; repository still has no remote and no commits. Do not upload to the wrong account. Commit/push authority now applies only to reviewed, locally verified modules and the verified personal target.
- Taskboard product owner confirmed current formal service remains HEAD `4725dc0974d556f19c38a43dedbab6ec204e336d`; CAP49 visual lane changes are not live. Existing-task full binding is supported, but managed Start does not resume A/B; ETH project workspace mapping is missing and CLI project map only affects cloud configuration. Manual existing-task coordination remains the truthful route; no automatic launch has been proven.
- Added four explicit module delivery checkpoints: ETH-39 preparation, ETH-40 seller, ETH-41 buyer/page, ETH-42 integrated flow; each names inputs, independent review, visible output, commit/push and personal-computer evidence. Existing final acceptance remains required. No checkpoint is marked executed or done.
- Fully bound ETH-1 to M and ETH-5/25 to the verified existing B task (local sboai project, actual cwd). Readback confirms identity rootRoute ready, but managed execution still has missing worktree/log/state gates. A's implementation bindings are delegated to its current writer to avoid conflicting updates. Review checkpoint cards deliberately remain unbound until reviewer/coordination identity is resolved.
- A broad binding attempt was rejected before execution because default routing could misassign review/delivery cards. Removed fallback mapping, validated each card's explicit role, and limited subsequent successful updates to ETH-5 and ETH-25 individually. No safety check was bypassed.
