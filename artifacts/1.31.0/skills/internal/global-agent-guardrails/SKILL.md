---
name: global-agent-guardrails
description: Install, audit, test, or update the Development System's global destructive-command guard for Codex, Claude Code and T3 Code. Use when configuring agent safety hooks or investigating whether dangerous shell operations are blocked.
---

# Global Agent Guardrails

This skill is the operator guide for the executable destructive-command policy. The hook is the enforcement layer; instructions alone are not protection.

## Contract

- Codex and T3 Code share the Codex `PreToolUse` adapter.
- Claude Code uses a `PreToolUse` Bash|Monitor hook in its user settings.
- Existing Codex hooks and Claude Code settings are merged, never replaced.
- Factory settings, skills, logs, and executables are outside the current runtime and are never read or changed.
- The guard fails closed when a matched shell tool has malformed or missing command input.
- Hard blocks do not imply sandboxing and do not replace repository permissions, review, backups, or explicit authorization.
- The agent cannot bypass a block. A human may run the command outside the harness or deliberately remove the guard after reviewing the exact target and recovery plan.

## Operate

Use the Development System CLI from its canonical checkout:

```bash
./bin/development-system guardrails-enable
./bin/development-system guardrails-audit
./bin/development-system guardrails-rollback
```

Use `--home <isolated-home>` in tests. Enabling requires the catalogued Codex and Claude `global-agent-guardrails` skills to be installed first.

The policy hard-blocks recursive forced deletion, catastrophic disk operations, destructive Git history/worktree operations, forced pushes, repository deletion, high-impact infrastructure destruction, and downloaded-code-to-shell pipelines. It intentionally does not block normal reads, ordinary file edits, dependency installation, or non-recursive deletion of a named file.

## Verify

Audit must prove all of the following:

- the exact managed Codex and Claude Code hook entries exist alongside pre-existing entries;
- the installed policy engine matches the current catalogued skill bytes;
- a harmless command is allowed;
- representative dangerous commands are blocked;
- rollback restores exact prior Codex bytes and prior Claude Code settings bytes, or removes only the managed Claude Code hook when Claude Code rewrote its settings, without touching Factory.

Do not claim T3 Code has an independent hook runtime: each T3 thread inherits the adapter of its Codex or Claude Code provider.
