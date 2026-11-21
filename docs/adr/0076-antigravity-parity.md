# ADR 0076 — Antigravity full parity and secondary roster roles (DS 4.2.0)

- **Status:** Accepted
- **Date:** 2026-11-20
- **Contract version:** `4.2.0` (skill catalog `0.87.0`)
- **Cross-review plan:** `~/.development-system/private/cross-review/ds-420-antigravity-parity/plan-v4.md` (3 rounds with `codex/gpt-6.2-sol` High)

## Context

Development System `4.1.0` shipped full skill, rule, guardrail, and audit parity for Codex, T3 Code (Codex/Claude), and Claude Code, while Antigravity (`~/.gemini/config/` for standalone CLI/App/IDE and `~/.t3/userdata/providers/antigravity/<profile>/config/` for T3 Code ACP) remained unintegrated:

- Only 1 live skill (`better-auth-best-practices`) and 18 dangling legacy symlinks existed under `~/.gemini/config/skills/`.
- No global rules (`AGENTS.md`, `rules/orchestration.md`), no fail-closed `PreToolUse` guardrails (`hooks.json`), and no MCP servers were wired into Antigravity.
- Antigravity (`gemini-4-neon`, `gemini-3.8-flash`) and OpenCode Go (`glm-5.3-flash`, `kimi-k3.1-pro`) were not represented in `config/agent-roster.json`.

## Decision

1. **Antigravity as a native harness in `4.2.0` / `0.87.0`:**
   - Mirror the immutable 4.0.0/4.1.0 one-page global instruction file to `~/.gemini/config/AGENTS.md` (`expectedMirrorOf: personal-codex-instructions.codex`).
   - Ship an Antigravity-only orchestration rule (`antigravity/rules/orchestration.md`, `trigger: always_on`, `<= 2,500` B) stating that the parent edits directly, all subagents remain read-only until protected writer admission is demonstrated, and independent reads remain cross-family.
   - Add `.gemini/config/skills/<name>` symlink variants to all 86 catalog skills, clean the 18 legacy paths in `brokenSymlinkCleanup` strictly when they are broken symlinks, and register `<home>/.agents/skills` in `.gemini/config/skills.json` so external user skills load alongside catalog skills.

2. **Fail-closed Antigravity guardrails (`policy 3.1.0`, `mcp-policy 2.0.0`):**
   - Extend `artifacts/4.2.0/skills/internal/global-agent-guardrails/scripts/command-guard.mjs` with `--harness antigravity` (camelCase `toolCall` normalization, JSON `{"decision":"allow"|"deny","reason":"..."}` stdout with exit code 0, fail-closed on malformed stdin/errors).
   - Protect Antigravity config files and T3 ACP OAuth stores dynamically (`~/.t3/userdata/providers/antigravity/<hash>/...`), evaluate `test-file-write` against every root in `workspacePaths`, and unconditionally stop `github/merge_pull_request`, `t3-code/pull_request_merge`, and `linear/merge_diff`.
   - Install under top-level `"development-system-guardrails"` in `~/.gemini/config/hooks.json` with a fail-closed shell wrapper while preserving sibling user hooks.

3. **Single-authority T3 ACP profile linking (`antigravity-link` / `antigravity-unlink`):**
   - `src/antigravity-link.mjs` owns `.development-system/antigravity-link/{state.json,pending.json,snapshots/}` (outside `shared-installation.mjs#managedPaths`) under the shared SQLite lock.
   - Links `AGENTS.md`, `rules`, `hooks.json`, `skills.json`, and (by default) `mcp_config.json` into `~/.t3/userdata/providers/antigravity/<profile>/config/`.
   - `doctor` degrades (`ok: false`) if `pending.json` exists or any ACP profile is out-of-sync for the 4 DS artifacts. DS rollback automatically reverts the 4 DS artifacts while preserving user `mcp_config.json`.

4. **Resumable surgical rollback and launcher cutover safety:**
   - Add `.gemini/config/hooks.json` and `.gemini/config/skills.json` to `ownerEditableSettings` with path-specific `protectedView` and `weakenedHooks`.
   - Precompute and persist `entry.surgicalTarget` in the pending journal before mutating owner-edited settings during rollback, so interrupted surgical rollbacks resume deterministically.
   - Pin a temporary `.local/bin/development-system-recover` launcher to the newer runtime during launcher cutover and remove it only after deleting the pending journal.

5. **Secondary provisional roster roles and CLI-repo production gate:**
   - Register `antigravity-*` and `opencode-go-research-*` candidates in `config/agent-roster.json` as `provisional` / `runtime-required` behind existing Codex/Claude defaults while keeping `profiles.t3.sourceWritersAdmitted: false`.
   - Support `smoke: { aplica: false, motivo }` in `config/niveles.json` and add `config/niveles.json` for `AO-HyS/development-system`.

## Consequences

- `4.1.0`, `3.0.0`, `manifests/4.1.0.json`, and `catalog/0.86.0.json` remain byte-for-byte immutable.
- `managedPaths()` stays version-aware so historical `4.1.0` receipts verify without drift.
- Claude Code and Codex configurations and runtime behaviors are unchanged.
