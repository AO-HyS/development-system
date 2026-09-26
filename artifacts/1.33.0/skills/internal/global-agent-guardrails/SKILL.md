---
name: global-agent-guardrails
description: Install, audit, test, or update the Development System's global destructive-command guard for Codex, Claude Code and T3 Code. Use when configuring agent safety hooks or investigating whether dangerous shell operations are blocked.
---

# Global Agent Guardrails

This skill is the operator guide for the executable destructive-command policy. The hook is the enforcement layer; instructions alone are not protection.

## Contract

- Codex and T3 Code share the Codex `PreToolUse` adapter, matched on `Bash|exec|apply_patch`.
- Claude Code uses a `PreToolUse` hook in its user settings, matched on `Bash|Monitor|Edit|Write|MultiEdit|NotebookEdit`.
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

The policy hard-blocks recursive forced deletion, catastrophic disk operations, destructive Git history/worktree operations, forced pushes, repository deletion, high-impact infrastructure destruction, and downloaded-code-to-shell pipelines. It intentionally does not block normal reads, ordinary file edits, dependency installation, or non-recursive deletion of a named file. For tracked paths, use `git rm -r` instead of `rm -rf`.

## Policy 2.0.0: quote-aware evaluation

`references/policy.json` is evaluated against a parsed command, not raw text:

- Quoted text, heredoc bodies with a quoted delimiter, and redirections such as `2>/dev/null` are data. `grep "git reset --hard" docs` and `git commit -m "..."` pass.
- `$(…)`, backticks, `<(…)` and `>(…)` are evaluated recursively up to `maxSubstitutionDepth` (4); `$((…))` is arithmetic. `$(cat <<'EOF' … EOF)` (the usual commit-message form) is read as its literal heredoc text unless the command redefines `cat`. Unquoted heredoc bodies are scanned for substitutions. A heredoc or here-string fed to a shell (or `source /dev/stdin`) is evaluated as shell. For other interpreters (`python -c`, `node -e/--eval/-p`, `deno eval`, `perl -e`, `ruby -e`, `osascript -e`, `php -r/-R/-B/-E`, `Rscript -e`, `lua -e`, an `awk` program or `awk -f`, or a heredoc fed to one of them), each string literal in the code that contains whitespace, including literals joined with `+`, `,` or adjacency, and each code fragment between quotes, brackets and `;` is evaluated as a shell command with interpolations (`${…}`, `$name`, `{name}`, `%s`) replaced by a placeholder. Code that calls a process API (`system`, `exec*`, `spawn*`, `popen`, `run`, backticks, …) with a lone shell name (`os.system("sh")`) is blocked. Native file APIs in that code (`shutil.rmtree`, `fs.rmSync`, `open(…, 'w')`) are not inspected.
- Destructive rules apply to each simple command after wrappers (`sudo`, `env`, `xargs`, `timeout`, `nohup`, `find -exec`, …) are stripped, and to any argument position that names a destructive-capable command or shell (`ssh host rm -rf …`, `watch 'git reset --hard'`, `tmux new -d 'true; git reset --hard'`, `parallel ::: '…'`), including command positions inside one argument after `;`, `&`, `|`, `(`, `{` or `then`/`do`. They are skipped for pure-read commands (`readOnlyCommands`, `sed` without `-i`/`e`/`w`, `awk` without `system(`/pipes/redirection).
- Rule `match` values: `command` (default; canonical `name args…`, for git starting at the subcommand), `pipeline` (command names joined by `|`), `raw` (full source text).
- Always blocked (`structuralRules`): `eval`, `$'…'` outside single quotes, `${!x}`, a variable or substitution as the command name, `sh|bash|zsh -c` with a non-literal script, a shell or interpreter reading its program from a pipe, inherited or non-literal stdin, a process substitution or a device (`echo … | sh`, `node -`, `python3 <<< "$x"`, `awk -f -`, `bash <(…)`), Git configuration that makes an ordinary command destructive (`help.autocorrect`, `clean.requireForce=false`, deleting or forced push refspecs, `remote.*.mirror`), unparseable input, and variable arguments to `sensitiveCommands` (`rm`, `dd`, `mkfs`, `diskutil`, `gh`, `terraform`, `pulumi`, `kubectl`, `wrangler`, `vercel`, and git outside `readOnlyGitSubcommands`). Executed inline Git configuration (`-c alias.x=…`, `core.pager`) and program-naming variables (`GIT_PAGER=…`) are evaluated as commands.
- `git-discard` allows `git checkout --ours/--theirs` and `git restore --staged`.
- `test-file-write` blocks creating or modifying paths matching `testFilePatterns` inside the payload `cwd`: redirections, `tee`, `cp`/`mv`/`install` destinations, `sed -i` targets, `git diff --output`, Edit/Write/MultiEdit `file_path`, NotebookEdit `notebook_path`, and apply_patch `*** Add File:`/`*** Update File:`/`*** Move to:`. Deleting test files is allowed.
- `guard-config-write` blocks writes to `protectedWriteTargets`: `~/.codex/hooks.json`, `~/.codex/config.toml`, `~/.claude/settings.json`, `~/.claude/settings.local.json` and the installed `global-agent-guardrails` skills (`~`, `$HOME` and absolute spellings), plus `protectedProjectWriteTargets` inside the payload `cwd` (`.claude/settings.json`, `.claude/settings.local.json`, `.codex/hooks.json`, `.codex/config.toml`, and `.git/config`, whose aliases run commands; use `git config` instead). Writers include redirections, `tee`, `sponge`, `cp`/`mv`/`install`/`ln`, recursive `cp`/`rsync`/`ditto` and `tar`/`unzip`/`patch` rooted above a protected path, `perl`/`ruby -i`, `curl -o/-O`, `wget -O/-P`, `dd of=`, `ex`/`vi`/`vim`/`nvim`/`ed` file operands, and `chmod`/`chown`/`chflags` on a protected path or any ancestor. A glob target (`*`, `?`, `[…]`, `**`, brace expansion, extglob and zsh groups, qualifiers and `^ # ~` operators) is blocked when it can match a protected path; `*` skips a leading dot unless the command mentions dotglob, GLOBIGNORE or GLOB_DOTS. `cd`, `pushd`, `env -C` and `sudo -D` move the directory used for later relative targets; after a conditional, backgrounded, piped or branch `cd`, `cd -`, `popd`, `cd $(…)`, a missing directory or a CDPATH lookup, the directory is unknown. A path under an unknown directory (a variable prefix, `~-`, or an unknown working directory) is blocked when its literal tail can name a protected path or a file below a protected directory.
- `shell-arithmetic-injection` blocks text shaped like `name[$(…)]` in assignments, `[[ … ]]`, `for` lists and name-taking builtins (`let`, `printf -v`, `read`, `declare`, `export`, `test -v`, …): bash runs that subscript when the text is later evaluated.
- Known false positives, by design: interpreter code naming a shell next to a process API (`shutil.which('bash')` with `subprocess` in the same program), an interpreter with only preload options and no program (`node -r ts-node/register`), backtick prose with a destructive command inside a runner argument, and glob or brace targets that could match a protected path. Known gaps: editor settings such as `.vscode/settings.json` are not protected, and the evaluation budget is 3 s (the hook denies on timeout).

Check a decision without installing:

```bash
node scripts/command-guard.mjs check --command 'git status --short' --cwd <repo>
node scripts/command-guard.mjs check --tool-json '{"tool_name":"Write","cwd":"<repo>","tool_input":{"file_path":"src/a.test.ts"}}'
```

Exit 0 means allowed, 2 means blocked; the JSON output names the rule.

## Verify

Audit must prove all of the following:

- the exact managed Codex and Claude Code hook entries exist alongside pre-existing entries;
- the installed policy engine matches the current catalogued skill bytes;
- a harmless command with a redirection (`grep -n "x" f 2>/dev/null | head`) is allowed;
- `git reset --hard` is blocked, and a `--tool-json` Write to `src/a.test.ts` is blocked;
- rollback restores exact prior Codex bytes and prior Claude Code settings bytes, or removes only the managed Claude Code hook when Claude Code rewrote its settings, without touching Factory.

Do not claim T3 Code has an independent hook runtime: each T3 thread inherits the adapter of its Codex or Claude Code provider.
