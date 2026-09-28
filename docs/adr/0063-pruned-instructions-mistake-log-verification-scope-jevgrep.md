# ADR 0063: Pruned instructions, mistake log, verification scope and jevgrep

## Status

Accepted. Whether Codex and Claude Code follow the shorter instructions, whether
retro and development-steward actually record and read mistakes, and whether
agents use `jg` for behavior-location questions remain separate operational
evidence.

## Context

The operator reviewed five published posts on how agents use always-loaded
instructions, record their own mistakes and search unfamiliar code. The
operator and a second Codex thread (Astra) agreed on five points for 1.36.0:

- **Prune the always-loaded instructions.** The global instructions (installed
  as `~/.codex/AGENTS.md`, which `~/.claude/CLAUDE.md` links to per ADR 0058)
  and `claude/rules/orchestration.md` repeated the no-tests, Gardener,
  two-way/one-way, `Done when:` and develop-merge rules. Each rule needs one
  home, and Codex-only guidance belongs in a Codex host section.
- **Count mistakes.** "A mistake seen twice becomes a hard rule" could not be
  applied: there was no record of mistakes, only build-time gardener checks and
  prose.
- **State the verification scope.** Completion reports said what passed, but
  not what the verification did not cover or which real effects (charges,
  emails, writes) happened.
- **Adopt jevgrep.** `@dzhng/jevgrep` 0.4.0 (MIT, bin `jg`) answers "where does
  this behavior live" questions in natural language through the TypeSafe
  provider the operator already pays for. rg stays the tool for exact names.
- **Remove Augment.** The auggie MCP server returned REPO_NOT_FOUND for AO-HyS
  and was unused. MCP servers are operator configuration outside the manifest,
  so its removal is an operator edit and not part of this contract.

The same release carries the recorded next-version fixes: check-no-tests did
not read instruction documents and scanned vendored Python environments, the
residue audit flagged byte-identical catalog mirrors in product repositories,
and a background writer hold without an agent id expired like a foreground hold
(the ADR 0062 known gap).

## Decision

Contract 1.36.0 with catalog 0.54.0:

- **Shorter shared instructions.** `artifacts/1.36.0/global-codex-instructions.md`
  replaces the 1.34.1 copy at `.codex/AGENTS.md`. It keeps one shared core, a
  Codex host section and a Claude Code host section, stays under 8,640 bytes
  and keeps every authorization, permission, verification and data-boundary
  rule. The Claude orchestration rule drops the bullets that the global file
  already holds and keeps the Claude-only rules.
- **Mistake log in code.** `development-system mistake add --id --incident
  --evidence [--summary] [--fix] [--control] [--repository]` appends one line
  per occurrence to `~/.development-system/private/mistakes.jsonl` (mode 0600).
  A repeated (id, incident) pair is a no-op. `mistake list --repeated` lists
  ids seen in two or more distinct incidents with the Gardener hint (code >
  lint/CI/guard > rule/skill). Evidence is a path, URL or commit, never a
  secret. retro (still manual, `disable-model-invocation: true`) reads the
  repeated list first and records each root cause; development-steward adds
  the repeated ids and a proposed control to its weekly report.
- **Verification scope in code.** `development-system document` requires a
  line in `## Detalle` that begins with `Alcance de la verificación:` (or
  `Verification scope:` in `## Detail`) and states what the verification
  covers, what it does not cover and the real effects. The error quotes the
  line to add. orchestrate-work and flow-implement move to 1.36.0 copies that
  prescribe it, and the delivery recap writes it from what it actually ran.
- **jevgrep skill.** Catalog 0.54.0 adds `jevgrep` for Codex and Claude Code
  (the Claude variant links to the Codex one). The operator alone installs
  `@dzhng/jevgrep@0.4.0` (never `@latest`) and authenticates it through stdin;
  agents never install, upgrade or authenticate it, and a missing or failing
  `jg` is reported as a gap while work continues with rg. The roster guard lets
  code-mapper run only `jg "<question>" [relative root]` with
  `--max-source-bytes`, `--concurrency` and `--no-cache`, and `jg --version`;
  every subcommand, the `--hidden`, `--no-ignore`, `--include-*` flags and
  absolute or `..` roots are refused.
- **Cleanup fixes.** check-no-tests reports live instruction documents
  (README, AGENTS.md, CLAUDE.md, CONTRIBUTING.md and docs, excluding
  current-work, ADRs, published artifacts and blockquotes) that direct an agent
  to write or run tests, and skips `site-packages`, `.venv` and `venv`. The
  directive patterns live in `src/test-change-policy.mjs`, shared with the
  release gardener. The residue audit skips catalog skill copies that are
  byte-identical to their catalog original. A writer dispatched with
  `run_in_background` is recorded as a background hold and, without an agent
  id, is kept until the maximum hold age or an explicit release.
- **Thread health, not throughput.** `development-system thread-health
  (--thread <t3-id> | --session <claude-id>)` reads a Claude Code transcript
  read-only and answers the operator's three questions about a long run: is it
  stuck (idle time, identical failures repeated, review rounds past three),
  which instructions the guard stopped, and what it costs (tokens by model,
  cache share, Codex review tokens). Merge rate and tickets per hour are not
  alarms: a long task that keeps moving cheaply is healthy. Loops print a
  suggested `mistake add` command; nothing is recorded automatically. Codex
  threads are reported as not supported yet.

## Consequences

- Completion documents without the verification-scope line fail until the
  line is added; there is no compatibility window.
- Repositories whose README or docs tell agents to run tests now fail
  check-no-tests until the text changes or an allow prefix covers it.
- The mistake log is private to the operator's HOME and is never installed or
  published.
- code-mapper gains one network-capable command; searches send eligible source
  to the operator's provider, so roots stay inside the repository being worked.
- 1.35.x artifacts stay published and unchanged.

## Adoption without a benchmark

The operator adopts these changes without a benchmark or pilot gate: build,
then prune what does not help. The published jevgrep saving is the vendor's
claim, not a measurement of this system. jevgrep is removable in a later
version by dropping the catalog entry and the `jgRefusal` branch of the roster
guard's mapper check; the other changes are reversible in the same way,
through a new contract version.
