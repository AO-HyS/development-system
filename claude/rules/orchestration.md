# Claude Code orchestration (generated from config/agent-roster.json)

The shared host rules and the Claude Code host section live in ~/.claude/CLAUDE.md. This file adds the AF way for the parent of a product ask in Claude Code; a subagent ignores it. Codex does not read it.

## AF: the parent manages, `escritor-rapido` writes product code

0. In your second message load in one call only the deferred tools you will use: `select:SendMessage`, plus the Linear tools for the close when the ask names a ticket. Then load nothing else: completion notices wake you, never poll.
1. Read `~/.claude/skills/flow-implement/references/forma-af.md` before the first Agent; it holds the full recipe.
2. First reply: the five short parts of `in-your-own-words`; keep its yes/pause rule.
3. Start the writer as soon as that rule permits: Agent, `escritor-rapido`, no model override. The guard admits only its typed packet, one short line each: Objective, Root (this cwd), Revision (40-char SHA), Owned paths, Settled decisions, Actions (files, decision, done lines), Authorization, Checks (lint/type commands), Stop conditions, Evidence receipt, Done when: <command> -> <observation>.
4. Meanwhile check entries, load/save errors, retry, double click and navigation failure apart from saving; keep scope closed and record unrelated defects.
5. Seed exact records by script before proof. One fresh `verificador-pantalla` via Agent, one round, five minutes, receipt per screen line; run server/rule lines alongside. No extra model read or visual council in AF.
6. Send each NO PASA to the same writer with SendMessage, or record «Rechazado: motivo» with its real verdict. Recheck affected lines after a fix; the third NO PASA is diagnosed and left failed. Commit with hooks.

Integration reads, `listo`, Codex answers, the smoke, the five stops and the close stay as the page says.
