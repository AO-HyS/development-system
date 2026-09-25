# ADR 0058: Claude Code as a native harness

Status: Accepted for implementation; discovery and behavioral influence in
Claude Code remain separate operational evidence.

## Context

The operator now uses Claude Code (Opus 5.5) alongside Codex, including through
T3 Code's Claude provider. The same personal rules, skills, destructive-command
guard and optional Headroom transport must apply in both hosts without copying
files by hand or weakening existing Codex behavior.

## Decision

Claude Code is a native harness named `claude`, and it adds links, not copies.
Catalog 0.50.0 adds a `.claude/skills` root with one Claude variant per
catalogued skill. Each variant is a declared mirror installed as a relative
symbolic link to the skill's installed canonical copy, so both hosts read the
same files. Existing entries at those paths are snapshotted and restored on
rollback by the normal skill synchronization.

There is one personal instruction file. The shared `~/.codex/AGENTS.md` gains a
short Claude Code host section that maps roles to native subagents, keeps
requested and observed identity separate, and applies Anthropic's Opus 5.5
guidance: effort controls thinking, no "think carefully" instructions, and the
whole task is handed over with its finish line. `~/.claude/CLAUDE.md` is an
operator link to that file; the manifest installer keeps its no-symlink rule for
managed files. Project `AGENTS.md` files are read natively by Claude Code, with
`claude-md-and-agents-md` so a repository CLAUDE.md does not hide them.

The guard skill accepts `--harness claude`. Guardrail activation merges a
`PreToolUse` Bash|Monitor hook into `~/.claude/settings.json` next to the Codex
hook once the Claude guard skill is installed. The snapshot is schema 3; schema
2 Codex-only snapshots remain valid. Because Claude Code rewrites its settings,
rollback removes only the managed hook when the bytes changed.

`runtime/headroom/claude.mjs` is installed next to the Codex launcher and
reuses its proxy profile and lifecycle. It sets only `ANTHROPIC_BASE_URL` and
`ENABLE_TOOL_SEARCH`, keeps the caller's directory, login, model and effort,
and refuses to replace another Claude transport. The Codex launcher is
unchanged.

Plugins, MCP servers and other Claude settings stay operator configuration
outside the manifest, like the Codex `config.toml`. A Claude subagent roster and
cross-host delegation, such as Codex computer use from Claude, are deferred to a
later decision.

## Consequences

Codex artifacts other than the contract, personal instructions, catalog and
Headroom README/provenance are byte-identical to 1.30.1. Installed files do not prove that Claude Code
discovers or follows them; that needs an observed Claude session.
