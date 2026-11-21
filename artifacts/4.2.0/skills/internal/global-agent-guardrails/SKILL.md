---
name: global-agent-guardrails
description: Install, audit, or update the Development System's small command lock (policy 3.0.0) for Codex, Claude Code and T3 Code. Use when configuring agent safety hooks or investigating why a command was blocked.
---

# Global Agent Guardrails: the small lock

One `PreToolUse` hook per host runs `scripts/command-guard.mjs` (Codex and T3 Code on `Bash|exec|apply_patch|mcp__.*`, Claude Code on `Bash|Monitor|Edit|Write|MultiEdit|NotebookEdit|mcp__.*`). Existing hook settings are merged, never replaced. The lock stops accidents, not a deliberate bypass; it is no sandbox and no substitute for review or authorization.

## What it blocks

- **Production** (`production`): `git push` that updates `main` or `master`, by a refspec or, when none names the destination, by the configuration git reads, stored or given with `-c` (`remote.<name>.push`, `push.default` `matching` or `upstream`); `gh pr merge` (or `gh api -X PUT …/pulls/<n>/merge`) of a PR whose base is `main` or `master`, read with `gh pr view <pr> --json baseRefName` (blocked, with the reason, when it cannot be read); `vercel … --prod`, `vercel promote`, `convex deploy` without a preview flag, `wrangler deploy` to production or without `--env`, `npm|pnpm publish`, `gh release create`, and package scripts `deploy:prod*` and `release:prod*`. It passes only with `DS_PRODUCCION="<the owner's words>"` as a prefix, once the owner answered.
- **Destruction the owner did not order**: `git reset --hard`, `git clean` (not `-n`/`-i`), discarding through `git checkout --`/`restore`/`switch --force`, `rm -rf` (except folders the agent can make again: ignored build or cache folders, the scratch folder, temporary folders), a forced or mirror push to `develop`, `main` or `master` (to any other branch it passes), `gh repo delete`, infrastructure destruction, disk formatting. Each passes with `DS_ORDENADO="<the owner's words>"` as a prefix.
- **Spend**: `vercel domains buy|transfer-in`, `stripe --live`, and the MCP tools the MCP policy names as spend, destruction, messages to people or account security.
- **Secrets** (`secret-export`): a command given a path in `~/.development-system/private/secrets` or reading input from one. No exception.
- **No tests** (`test-file-write`, `test-grant-self-authorization`): writing test files or runner configuration, and granting oneself a test grant. Only the operator grants, with `development-system allow-tests <dir>` in their own terminal.

## What it no longer blocks

What it cannot read passes: a command it cannot parse, a program named by a variable, `eval`, dynamic shell text, unknown hook payloads and unknown MCP tools. `references/policy.json` lists those rule ids in `disabledRules`; a match of a disabled rule allows the command, and the commands around it are still judged. The rules that stay on read each program's words before any disabled check, so a disabled check cannot hide them, and the secrets folder is read again from the directory `env -C`, `sudo -D` or `git -C` moves to. Guard configuration, Git configuration and merges to `develop` are not locked either.

## Owner's words

`DS_ORDENADO` and `DS_PRODUCCION` count only as a literal, non-empty prefix assignment on the command itself (`DS_ORDENADO="borra eso" git reset --hard HEAD~1`). Every pass appends one JSON line (time, rule, prefix, words, command, cwd) to `~/.development-system/private/guard/ordenado.log` (folder 0700, file 0600); if the line cannot be written, the command is denied.

## Operate

```bash
./bin/development-system guardrails-enable | guardrails-audit | guardrails-rollback   # use --home <isolated-home> to verify
node scripts/command-guard.mjs check --command 'git push origin HEAD:main' --cwd <repo>
node scripts/command-guard.mjs check --tool-json '{"tool_name":"Write","cwd":"<repo>","tool_input":{"file_path":"src/a.test.ts"}}'
```

Exit 0 means allowed, 2 blocked; the JSON names the rule. `check` never writes the owner-pass log; only the hook does.
