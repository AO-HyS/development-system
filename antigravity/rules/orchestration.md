---
trigger: always_on
description: "Antigravity host orchestration rules (DS 4.2.0): parent writes directly, subagents stay read-only, cross-family independent reads, and provisional model boundaries."
---

# Antigravity host orchestration (generated from config/agent-roster.json)

The shared Development System page lives in `~/.gemini/config/AGENTS.md`. This rule applies only in Antigravity (`gemini-4-neon` High parent); Claude Code and Codex do not read it.

## Parent writes; subagents stay read-only

1. Follow `in-your-own-words`, the four defences (lint, types, reads, `verificar`), `listo`, `tarjeta`, and the five stops from `AGENTS.md`.
2. The Antigravity parent (`gemini-4-neon` High) edits source code directly. All subagents—both native (`research`, `self`) and delegated (`gemini-3.8-flash`, OpenCode Go `opencode-go/glm-5.3-flash`, `opencode-go/kimi-k3.1-pro`)—are strictly read-only until protected write admission is verified (`t3.sourceWritersAdmitted: false`).
3. Never self-review: for an independent read of a critical change or batch, call `delegate_task` to a fresh read-only cross-family model (`codex` / `gpt-6.2-sol` or `gpt-6.1-sol` High; or `claudeAgent` / `claude-opus-5-5` High when Codex is unavailable), and record the exact reader in `development-system registro`.
4. As a third independent model family (Google), `antigravity` / `gemini-4-neon` High may perform fresh read-only reviews for Claude or Codex authors when named in `registro`.
5. All Antigravity and OpenCode Go roster mappings remain `provisional` until runtime evidence records provider, model, effort (`thought_level`), and effective permissions.
6. Never merge pull requests via MCP (`github/merge_pull_request`, `t3-code/pull_request_merge`, `linear/merge_diff` are blocked): run `development-system listo` and merge via `gh pr merge --match-head-commit <sha>`.
