# Current work — Claude Code parity (Development System 1.31.0)

## Objective — 2026-09-24

Give Claude Code (Opus 5.5, including T3's Claude provider) parity with the
Codex setup using links, not second copies: same personal rules and skills,
destructive-command guard, optional Headroom transport, one-to-one plugins/MCP
servers, minimal added context. User direction: do not author, update or run
tests; deferred: Claude subagent roster and cross-CLI computer use via Codex.

## Root and branch

Canonical root /Users/corrortiz/Documents/AO/development-system, branch
feat/claude-code-parity-1.31.0, stacked on feat/headroom-observed-delivery-1.30.0
(v1.30.1 is installed and pushed but not in develop or main). No worktree/clone.

## Completed

- Release 1.31.0 / catalog 0.50.0 (ADR 0058), unpublished: Claude skill variants
  install as relative links to the canonical copies; the shared
  ~/.codex/AGENTS.md gains a short "Claude Code host" section; guard accepts
  `--harness claude` and guards Bash|Monitor from the canonical engine;
  runtime/headroom/claude.mjs sits next to cli.mjs. Independent review findings
  were corrected. Builder check and typecheck pass.
- Operator HOME: 1.31.0 installed and healthy (an earlier 1.31.0 layout was
  rolled back to 1.30.1 with its installing commit's code, then reinstalled).
  ~/.claude/CLAUDE.md -> ../.codex/AGENTS.md (Claude confirmed it loads).
  Guardrails healthy for Codex and Claude; the guard blocks real Claude calls.
  Codex config.toml, 18 role TOMLs and hooks.json unchanged; AGENTS.md changed
  only by the appended Claude section.
- Operator configuration: plugins github, vercel, sentry, cloudflare, stripe,
  expo, convex, linear, exa; MCPs auggie, mobbin, expect, posthog, mercadopago
  (Codex had those two as MCP only); instructionFiles =
  claude-md-and-agents-md; impeccable hook repaired; 14 non-catalog skills
  linked; dangling links and superseded files kept under private backup.
  Context: 281 skills, 21 MCP servers (was 449 skills with posthog plugin).
- Headroom: private T3 shim runs Claude through the installed launcher
  (stream-json, 2 proxied requests per call); management subcommands skip the
  proxy; another base URL is refused.
- Read-only audit of all product repositories' agent instructions (results
  reported to the user; no repository changed).

## Publication and rollout — 2026-09-24

- Published development prerelease v1.31.0 (tag on e694986, asset
  aohys-development-system-1.31.0.tgz, sha256 c8ae8448…7e9b). Operator HOME
  reinstalled from the downloaded package; audit/guardrails/skills healthy.
- Primary repos (development-steward list): eteria PR #279 and casa-roca
  PR #138 target develop (package pin, adapter version pin, host-neutral
  guidance; casa-roca drops its stale CLAUDE.md). normalize-repository was not
  used: its template would regress the 2026-09-23 manual guidance alignment.
- the-barber-central: branch chore/development-system-1.31.0 committed locally
  (e9b7a636); push blocked by its pre-push typecheck, whose wrangler types
  include private apps/*/.env.local names under turbo strict env mode.
- aohys (develop, 443 pending files incl. .codex/development-system) and
  nutri-plan (active T3 coordinator branch, 714 pending files) untouched.
- casa-roca's VS Code auto-migration diff is preserved privately
  (preserved/casa-roca-vscode-settings.patch); lint-staged cannot stage the
  ignored .vscode path.

## Pending (user)

- OAuth in /mcp: vercel, sentry, cloudflare, stripe, expo, linear, posthog,
  exa, mercadopago, mobbin, Notion. GitHub plugin needs
  GITHUB_PERSONAL_ACCESS_TOKEN (gh CLI works meanwhile).
- Optional T3 provider instance whose binaryPath is the private Headroom shim.
- Decide: remove repository tests; publish 1.31.0; repository instruction
  cleanups; Claude subagent roster; cross-CLI computer use.

## Evidence and processes

Private: ~/.development-system/private/releases/1.31.0-claude/ and
~/.development-system/private/runs/headroom-claude/. No owned processes remain.
