# Current work — Claude Code parity (Development System 1.31.0)

## Objective — 2026-09-24

Give Claude Code (Opus 5.5, including T3's Claude provider) parity with the
Codex setup: same personal rules and skills, the destructive-command guard,
optional Headroom transport, and one-to-one plugins/MCP servers. Research the
current Opus 5.5 and Claude Code practices, and audit agent instructions across
the product repositories. Deferred by the user: a Claude subagent roster and
cross-CLI delegation (e.g. Codex/OpenAI computer use invoked from Claude).

## Root and branch

Canonical root /Users/corrortiz/Documents/AO/development-system, branch
feat/claude-code-parity-1.31.0. It is stacked on
feat/headroom-observed-delivery-1.30.0 (tag v1.30.1, installed, pushed, not
merged into develop or main); starting from develop would have dropped the
installed 1.30.x artifacts. No worktree or clone was created. The previous
task's narrative is in that branch's docs/current-work.md.

## Completed

- Release 1.31.0 / catalog 0.50.0 (ADR 0058): `claude` harness, 104 skill
  mirrors in .claude/skills, generated .claude/CLAUDE.md (shared rules
  verbatim, Claude host profile, Opus 5.5 practices), guard `--harness claude`,
  guardrails for ~/.claude/settings.json (schema 3, schema 2 compatible),
  runtime/headroom/claude.mjs. Scan budget raised 512 → 768.
- Builder check and typecheck pass. Isolated HOME: upgrade 1.30.1 → 1.31.0,
  audit healthy, skill audit only lacks operational evidence (same class as
  the 1.30.1 baseline), mirrors identical, foreign symlinks preserved,
  guardrail enable/probe/rollback byte-identical, v2 → v3 migration.
- Operator HOME: installed 1.31.0 from the local checkout, guardrails enabled
  (Codex entry unchanged, Claude entry added). Codex config.toml, 18 role
  TOMLs, hooks.json and AGENTS.md match the pre-change fingerprints. The guard
  blocked real Claude Code Bash calls in this session (loaded and enforcing).
- Operator configuration outside the manifest: 11 official plugins (github,
  vercel, sentry, cloudflare, stripe, expo, convex, linear, posthog, exa,
  mercadopago); user MCPs auggie, mobbin, expect (broken npx cache moved to
  private); instructionFiles = claude-md-and-agents-md; impeccable hook
  command repaired; 14 non-catalog skills linked; 5 dangling skill links moved
  to private backup. Backups of prior Claude settings are private.
- Headroom: real `claude -p` runs through claude.mjs and the private T3 shim
  (stream-json) completed with 2 proxied requests each. Counters descriptive.

## Pending

- Independent review of the 1.31.0 diff and the repository instruction audit
  (read-only) are running; apply material corrections, re-check, commit, push.
- User actions: OAuth for vercel, sentry, cloudflare, stripe, expo, linear,
  posthog, exa, mercadopago, mobbin, Notion (via /mcp or claude.ai); GitHub
  plugin needs GITHUB_PERSONAL_ACCESS_TOKEN or stays on the gh CLI; optional
  T3 provider instance pointing binaryPath at the private Headroom shim.
- Decisions: posthog plugin adds ~170 skills of context; whether to publish a
  1.31.0 prerelease/PR; Claude subagent roster; cross-CLI computer use.

## Evidence and processes

Private: ~/.development-system/private/releases/1.31.0-claude/ (config,
shim, operator-before.sha256, broken links) and
~/.development-system/private/runs/headroom-claude/. No owned background
processes remain after each Headroom run.
