# ADR 0058: Claude Code as a native harness

Status: Accepted for implementation; discovery and behavioral influence in
Claude Code remain separate operational evidence.

## Context

The operator now uses Claude Code (Opus 5.5) alongside Codex, including through
T3 Code's Claude provider. The same personal rules, skills, destructive-command
guard and optional Headroom transport must apply in both hosts without copying
files by hand or weakening existing Codex behavior.

## Decision

Claude Code is a native harness named `claude`. Catalog 0.50.0 adds a
`.claude/skills` root and one Claude variant per catalogued skill. Each variant
is a declared mirror of the skill's canonical source, so both hosts install
identical bytes. Existing entries at those paths are snapshotted and restored
on rollback by the normal skill synchronization.

`.claude/CLAUDE.md` is generated from the Codex personal instructions. Shared
sections stay verbatim. Only the Codex-specific roster and Jev paragraphs are
replaced by a Claude host profile, which maps roles to native subagents and
keeps requested and observed identity separate. Opus 5.5 working practices
follow Anthropic's published prompting guidance: effort controls thinking,
there are no "think carefully" instructions, and the whole task is handed over
with its finish line. Project `AGENTS.md` files are read natively by Claude Code.

The guard skill accepts `--harness claude`. Guardrail activation merges a
`PreToolUse` Bash hook into `~/.claude/settings.json` next to the Codex hook.
The snapshot is schema 3; schema 2 Codex-only snapshots remain valid for
rollback.

`runtime/headroom/claude.mjs` reuses the Codex launcher's proxy profile and
lifecycle. It sets only `ANTHROPIC_BASE_URL` and `ENABLE_TOOL_SEARCH`. It keeps
the caller's directory, login, model and effort. The Codex launcher is
unchanged.

Plugins, MCP servers and other Claude settings stay operator configuration
outside the manifest, like the Codex `config.toml`. A Claude subagent roster and
cross-host delegation, such as Codex computer use from Claude, are deferred to a
later decision.

## Consequences

Codex artifacts other than the contract, catalog and Headroom README/provenance
are byte-identical to 1.30.1. Installed files do not prove that Claude Code
discovers or follows them; that needs an observed Claude session.
