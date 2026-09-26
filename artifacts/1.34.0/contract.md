# Development contract 1.34.0

This profile supersedes mandatory governance as the default. Historical contracts remain immutable.

## Advisory development profile

New sessions request Sol 6 High at normal speed; keep the already selected parent.
For nontrivial work, Luna 6 High with requested priority collects bounded source
facts before Astra 6 XHigh authors the implementation plan. A distinct fresh
Astra 6 XHigh reviews requirements, evidence and the plan before writers start.
Sol 6 Medium handles general writing; Luna 6 High priority handles exact and
mechanical packets. Independent Astra 6 XHigh reviews the integrated result.
Tiny deterministic edits proceed directly with relevant repository checks.

Follow coding-orchestration/references/jev-advisory.md. Jev advises at useful
routing, decision and correction boundaries. The parent decides, dispatches with
native host tools, integrates and verifies. No Jev per-tool or Stop gate is active.
An unavailable or malformed classification records failure; the parent can
continue authorized work with an explicit rationale. Advice never grants
permission, proves execution, or substitutes for independent review and evidence.

Keep one writer per surface; parallelize only disjoint eligible work. Preserve
historical runs and unresolved ownership without treating them as new-run gates.
Do not resume or silently revalidate an older governed run under this profile.
The obsolete automatic controller remains disabled. OpenCode is not a default.

A roster requests model, effort and speed; actual host/provider metadata establishes
observed identity and tier. Report missing metadata as unknown. No silent fallback.
Astra planning and review stay XHigh. Optional coordinator effort changes use the
native host and retain actual observations; they require no Jev permission token
and do not establish cache reuse without provider evidence.

For nontrivial delivery, provide a readable HTML report using the installed
working-backwards report helper, including behavior passed/failed/not reached,
elapsed time, evidence and material gaps. Preserve the field-notebook presentation,
margin questions, browser drafts and revisioned batch submission. Markdown is
supplementary. Serve sanitized report assets through the authorized temporary
tunnel; state its actual URL and availability/expiry. Keep secrets and private
transcripts outside its served directory. A report is not acceptance evidence.

## Installation and recovery

The manifest explicitly selects advisory-parent-execution. Setup removes only managed Jev handlers, preserves unrelated guards and records a reversible transition. Reinstall retains its original rollback boundary. Rollback preflights backup bytes and hook drift before writes. Old runs remain historical without granting new execution or acceptance.

## HTML report continuity

The field-notebook reader and margin questions from source fb6b5dd968281cd1a5c5563b940047102982a2fa are retained, with integration corrections documented separately. Browser drafts, revisioned batch submissions, file-open copy/download, maps, charts, media, themes and offline assets remain. Opening a report grants no implementation or release authority.

## Repository preparation correction

Initialize and normalize generate the advisory repository adapter. Product-specific lifecycle extensions survive normalization; shared lifecycle policy comes from this version. The paired skill catalog is 0.51.0.


## Automated tests and evidence

No automated tests anywhere: do not create, run or restore them; delete them
when found (`check-no-tests` and the guard enforce this). Every task includes
real verification without being asked: computer use, browser, and the
repository's verification CLI and feature map. Report passed / failed / not
reached with evidence.

## Headroom transport evidence

Headroom is an explicit same-account per-invocation option. Keep the existing
Codex binary and CODEX_HOME, preserve caller arguments, and request lossless,
cache-conservative operation. Provider cache reuse can still change request
bytes; do not promise byte identity. Keep native usage from the parent and every
actual descendant separate from proxy counters, and separate requested model or
tier from observed identity. Use launch/completion events instead of polling.
Proxy counters and token deltas are descriptive; without complete controlled
evidence, do not claim Headroom caused savings.


## T3 app-server launch correction

Place the Headroom provider overrides after the app-server subcommand. Codex applies command-line configuration in this position when T3 supplies its own -c settings. Ordinary exec argument ordering remains unchanged. This corrects launch configuration; transport coverage and provider usage still require observed evidence.

## Claude Code harness

Claude Code is a native harness. Catalog 0.50.0 links every catalogued skill into .claude/skills from its installed copy. ~/.claude/CLAUDE.md is an operator link to the shared ~/.codex/AGENTS.md, which carries a short Claude Code host section. The destructive-command guard covers Codex hooks and Claude Code user settings. Headroom per-invocation launch is available for Claude Code. Plugins, MCP servers and other Claude settings remain operator configuration outside this manifest. File installation does not prove discovery, loading or behavioral influence.

## Claude Code orchestration roster

Contract 1.32.0 installs seventeen Claude Code subagent roles into .claude/agents, the orchestration rule into .claude/rules and the roster guard with its policy under .codex/development-system/runtime/claude-orchestration. Roles form tier ladders for implement, plan and review work (Haiku, Opus low, medium and high, Fable 5.1), and the guard asks Jev which tier each packet needs, refusing a mismatched packet once and naming the role at Jev's tier. Fable roles run only when Jev picks that tier or gives it a probability of at least 0.4, or the packet carries a Fable scope: line; otherwise they are refused every time. Allowed tiered dispatches are logged to tier-memory.jsonl; a dispatch repeated at a higher tier counts as escalated, and Jev sees those outcomes for similar packets from the same repository. Jev's route and tier refusals happen at most once per packet and at most three times per session, and a Jev failure proceeds. claude-orchestration-enable merges the guard hooks and two subagent limits into ~/.claude/settings.json; claude-orchestration-rollback restores prior bytes or removes only the managed entries, and must run before a contract rollback or downgrade. Installed files do not prove that Claude Code loads the roster or that the guard influenced a session; that needs observed-session evidence.

## Real verification, no automated tests and report launch

Contract 1.33.0 replaces automated tests with real verification: computer use, the browser or a product verification CLI is part of every task. `development-system check-no-tests --root <repository> --json` reports automated test files, test runner configuration, test scripts, test dependencies and CI test steps among git's tracked and untracked files; a repository may list reviewed path prefixes in config/no-tests-allow.json. Catalog 0.51.0 gives the command guard two more rules: test-file-write blocks creating or modifying test files or runner configuration while deleting them stays allowed, and guard-config-write blocks writing the guard's own hook configuration or installed skill outside the Development System guardrails commands. A Stop report gate asks once per session that changed files for the completion report, generated with development-system document and served through the reader tunnel, and fails open; Claude Code receives it through claude-orchestration-enable and Codex through report-gate-enable. The Claude roster no longer uses Haiku: Explore, code-mapper, docs-researcher and mechanical-worker run on Sonnet at low effort for mechanical work only. Installed files do not prove that a harness runs these hooks or that they influenced a session; that needs observed-session evidence.

## Astra reviews through codex-review

Contract 1.34.0 moves plan, diff, security and visual reviews to Astra XHigh through `codex-review.mjs`, installed with the Claude orchestration runtime. It runs `codex exec` in a read-only sandbox on the review packet (images through `--image`), writes findings.md, the event stream and a receipt, and prints one JSON receipt line with the requested model and effort and the observed ones read from the Codex session log, or unknown. The coordinator launches it in the background and is woken when it exits, so it never polls or sleeps. From the fourth round of the same objective a `Round rationale:` line naming an open critical or high finding is required; otherwise remaining findings become documented gaps or next-version work. At most five reviews run at once, and the Stop report gate waits while one is running. The Fable reviewers plan-reviewer and security-reviewer are retired, and the Claude reviewers run only with a declared `Codex fallback:` line that the report states. A halted or failed subagent's packet is split into smaller packets and dispatched again rather than absorbed by the coordinator. Installed files do not prove that a harness runs these hooks or that they influenced a session; that needs observed-session evidence.
