# ADR 0060: Real verification, no automated tests, report launch

## Status

Accepted. Whether Claude Code and Codex run the new hooks, and whether they
changed a session, remain separate operational evidence.

## Context

The operator decided on 2026-09-25 that repositories carry no automated tests.
Agents kept generating test files, and passing suites were read as acceptance
while real behavior went unobserved. Real verification (computer use, the
browser or a product verification CLI) is what establishes behavior.

The destructive-command guard blocked harmless commands (quoted `$`, `$?`,
`2>/dev/null` reads): 34 blocks in one product session and several in this
repository. Since ADR 0055 only `implement preview` produced the completion
report, so ordinary tasks ended without one. The Claude roster used Haiku for
mapping and mechanical work, and `run-report.py` undercounted session cost.

## Decision

Contract 1.33.0 with catalog 0.51.0:

- **D1 No automated tests.** Repositories keep no test files, runner
  configuration, test scripts, test dependencies or CI test steps.
- **D2 Real verification.** Computer use, the browser or a verification CLI is
  part of every task without being requested.
- **D3 `check-no-tests`.** `development-system check-no-tests --root <repo> --json`
  reports findings of kind test-file, test-config, test-script,
  test-dependency and ci-test-step among git's tracked and untracked,
  non-ignored files. Product repositories call it as
  `aohys-development-system check-no-tests`; `pnpm run check:no-tests` runs it here.
- **D4 Reviewed exceptions.** `config/no-tests-allow.json` (`{"allow": ["prefix/"]}`)
  lists reviewed path prefixes that the check skips.
- **D5 One pattern list.** `src/test-change-policy.mjs` exports
  `TEST_FILE_PATTERN_SOURCES`; the guard policy's `testFilePatterns` must equal
  it, and the release builder fails when they differ.
- **D6 Guard `test-file-write`.** Creating or modifying test files or runner
  configuration through edit tools, `apply_patch` or Bash is blocked; deleting
  them is allowed.
- **D7 Guard `guard-config-write`.** Writing the guard's own hook configuration
  or installed guard skill is blocked; the guardrails commands manage them.
- **D8 Fewer false positives.** The guard parses quoting and allows harmless
  redirections and `$?`; destructive commands stay blocked.
- **D9 This repository's tests are removed.** `verify` is `roster:check`,
  `typecheck`, `validate:repository` and `release:prepare`. The isolated
  installation `scenario` stays: it demonstrates installation, drift, rollback
  and preservation rather than testing code.
- **D10 `tdd` leaves the catalog.** Catalog 0.51.0 drops it and lists its
  `.agents/skills/tdd` and `.claude/skills/tdd` destinations as cleanup, as
  catalog 0.18.0 did for `qa`.
- **D11 Report closing step.** `orchestrate-work` and `coding-orchestration`
  end nontrivial work by generating the completion report with
  `development-system document`, serving it through the reader tunnel and
  giving its URL.
- **D12 Stop report gate.** `runtime/report-gate/stop-gate.mjs` blocks the
  first stop of a session that changed files without producing a report, allows
  every later stop and fails open. Claude Code gets its Stop entry through
  `claude-orchestration-enable`; Codex through `report-gate-enable`, with
  `report-gate-audit` and `report-gate-rollback`.
- **D13 Short report.** Verdict, what changed, real verification (passed,
  failed or not reached, with evidence), pending items, margin questions and a
  gardener line.
- **D14 No Haiku.** Explore, code-mapper, docs-researcher and
  mechanical-worker run on Sonnet at low effort (policy `2026-09-25.9`, tiers
  sonnet, opus_low, opus_medium, opus_high, fable) and do mechanical work only.
- **D15 Accurate cost.** `run-report.py` takes usage from each message's last
  chunk and selects the session by project directory; it keeps a Haiku price
  row for sessions recorded before 1.33.0.
- **D16 Execution contract.** `Done when:` is an executable command with its
  expected result, retried up to three times; `Outcome:` is optional;
  reversible decisions are taken and recorded, while data, production, money
  and customers stop for the operator; a repeated mistake is proposed as a rule
  at the highest possible level (code, then lint, CI or guard, then a rule or
  skill).

The grill questionnaire carries byte copies of the working-backwards reader
assets under `assets/reader/`; the builder checks they are identical.

## Consequences

Installed files do not prove that either harness discovers the skills, runs the
guard rules or the Stop gate, or that they influenced a session; that needs
observed-session evidence. Codex `apply_patch` visibility to the guard hook is
unconfirmed.

A contract `rollback` refuses while the report-gate or Claude orchestration
activation snapshot exists, naming the command to run first
(`report-gate-rollback` / `claude-orchestration-rollback`), so the managed hooks
never point at deleted files. The snapshot paths come from the feature modules
themselves. When Codex `hooks.json` changed after guard activation,
`guardrails-rollback` removes only the managed entry and rewrites the file as
2-space JSON, so its formatting can differ from the prior bytes.

Product repositories adopt the policy one pull request at a time: delete their
tests, add `check-no-tests` to pre-commit and CI, and pin 1.33.0.

Historical release builders and catalogs still name `tdd` and the removed
scripts; they are immutable records. Verification of this repository no longer
has a regression suite, so each change needs real observation of its behavior.
