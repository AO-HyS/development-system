# ADR 0059: Claude Code orchestration roster

## Status

Accepted. Discovery of the roster by Claude Code and the guard's influence on a
session remain separate operational evidence.

## Context

ADR 0058 made Claude Code a native harness and deferred a Claude subagent roster
to a later decision. Without one, a redesign session spent a very large amount of
cached Opus tokens: general-purpose agents did broad work at the parent's tier,
and images were read repeatedly, each one paid again on every later turn.

Codex and Astra are not available from Claude Code right now, so the most
capable model left is Fable 5.1, which is also the most expensive and must be
used minimally. The operator wants Jev, not hardcoded rules, to pick the model
tier and effort for each packet, and Jev must never stall work.

## Decision

Contract 1.32.0 installs seventeen Claude Code subagent roles, an orchestration
rule and a roster guard hook with its policy (version `2026-09-25.8`).

| Role | Family | Tier |
| --- | --- | --- |
| Explore, code-mapper, docs-researcher | read | haiku |
| mechanical-worker | implement | haiku |
| exact-implementer, implementer | implement | opus_low |
| implementer-medium | implement | opus_medium |
| senior-implementer | implement | opus_high |
| ui-implementer | ui | opus_high |
| planner-medium | plan | opus_medium |
| planner | plan | opus_high |
| reviewer-medium | review | opus_medium |
| reviewer | review | opus_high |
| plan-reviewer, security-reviewer | review | fable |
| visual-reviewer | visual | opus_high |
| browser-qa | browser | opus_low |

Opus tiers are Opus 5.5 at low, medium or high effort. The read, ui, visual and
browser families have fixed tiers. Implement, plan and review form tier ladders.

**Jev tier selection.** For a tiered role, the guard POSTs a direct "tier" choice
question to the policy's Jev endpoint, in parallel with Jev's route
classification through the installed advisory CLI (the runtime's own questions
are fixed). The credential comes from `TYPESAFE_API_KEY` or the policy's
credential file and is never logged. When Jev's tier differs from the role's tier
with confidence of at least 0.5, the guard refuses once and names the role at
Jev's tier. A `Route rationale:` line keeps the chosen role. Route
classifications are recorded against the Jev receipt.

**Fable rule.** plan-reviewer and security-reviewer run when Jev picks `fable`
or gives p(fable) >= 0.4, or when the packet carries a `Fable scope:` line
naming the surfaces and why Opus high is not enough. With no Jev answer, the
line is required.

**Memory.** Each allowed tiered dispatch appends one line to
`tier-memory.jsonl` next to the ledger: session, repository directory basename,
family, role, tier, Jev's tier and objective. A dispatch repeated later in the
same session at a higher tier for a similar objective counts as escalated. Jev
receives per-tier dispatch and escalation stats for the family across
repositories, and up to 6 similar objectives from repositories with the same
directory basename. The guard reads the whole file and uses the last 2000 rows.

**Anti-stall.** Jev's route and tier refusals happen at most once per packet
(keyed by its Objective line); Fable roles without Jev's pick or a `Fable scope:`
line are refused every time, as are other structural denials. Route refusals
apply only to writer packets. After 3 Jev refusals in a session Jev only
advises. A Jev failure or timeout lets the dispatch proceed.

**Other guard rules.** Only roster roles and a few Claude built-ins are allowed,
with the roster's model; plugin agents need model `opus` or `haiku`. Subagents
cannot start agents. Writer packets need `Owned paths:` and `Done when:` lines,
and a writer is refused while another active writer holds one of its paths. A
hold expires after 5 minutes for a foreground writer without an agent id, after
30 minutes of transcript idleness, or after 2 hours. Image reads have per-role
budgets (coordinator 2, ui-implementer and senior-implementer 5, visual-reviewer
12, browser-qa 2, others 1). `CLAUDE_ROSTER_GUARD=off` in the settings env
disables the guard entirely.

**Activation and rollback.** `claude-orchestration-enable` merges three managed
hook entries into `~/.claude/settings.json` (PreToolUse for Agent, Read and
screenshot tools; PostToolUse for Agent; SubagentStop), each identified by the
exact shell-quoted `node '<HOME>/.codex/development-system/runtime/claude-orchestration/roster-guard.mjs'`
command, and sets `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=4` and
`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`. Only exact-command entries are
managed; other entries, including private ones naming a roster guard, are
untouched. State lives in `.development-system/claude-orchestration/state.json`
with the prior and installed settings bytes and env values. On re-activation
after the settings changed, the recorded prior state becomes the structural
rollback of the current settings, not the earliest bytes.
`claude-orchestration-audit` checks guard and policy hashes, the three entries,
env values and two local probes. `claude-orchestration-rollback` restores the
prior bytes when settings still equal the installed bytes; otherwise it removes
only managed hook objects, drops an entry only when its hooks array becomes
empty, and restores env keys whose value still equals the installed one.

**Source layout.** Sources live in top-level `claude/` (`claude/orchestration/`,
`claude/agents/`, `claude/rules/`), outside `runtime/`, so the guard stays
outside the strict runtime type check. Artifacts and installed files are 0644;
hooks run the guard through `node`.

## Consequences

Installed files do not prove that Claude Code loads the roster or that the guard
influenced a session; that needs observed-session evidence.

Run `claude-orchestration-rollback` before a contract rollback or downgrade.
Otherwise the managed hook points at a deleted guard.
`claude-orchestration-audit` reports "managed hook targets a missing guard"
whenever a managed hook remains and the guard file is absent, including after a
contract rollback or downgrade.

Tiered dispatches send data to the Jev endpoint: packet text (up to 12000
characters), objective, risk signals, base commit, read and write set paths,
active writers' ids and write sets, per-tier stats across repositories, and up
to 6 similar objectives from repositories with the same directory basename.

`tier-memory.jsonl`, `ledger.jsonl` and the per-session Jev files are not
rotated and grow over time.

Worst-case hook time is about git 2 s, plus the parallel Jev calls (max of 8 s
and 7 s), plus a 4 s record, plus node startups: under the 20 s hook timeout.
Jev timeouts and guard errors do not block a dispatch.

Env keys that already held the managed values before enable stay after rollback.
