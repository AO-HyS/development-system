---
name: pstack-engineering
description: Apply selected PStack-derived engineering tactics inside the Development System router for implementation, review, debugging, and verification. This is not poteto-mode and grants no authority.
---

# PStack Engineering Tactics

Use this as a tactics library beneath `coding-orchestration`, never as a second
router. The Development System remains authoritative for lifecycle,
authorization, model routing, lane ownership, checks, release, and production.

Read [references/tactics.md](references/tactics.md), select only tactics that
fit the declared lane, and record their names in the lane bundle. Prefer:

- understand how and why before editing;
- interrogate assumptions and fix root causes;
- subtract before adding;
- preserve type-system discipline and idempotence;
- sequence independently verifiable units;
- build a small reusable script only when it reduces repeated tool work;
- prove behavior with focused evidence;
- keep context small and report uncertainty explicitly.

Do not invoke or emulate `poteto-mode`, `swarm`, autonomous external actions,
Cursor-specific agents, or upstream model routing. Do not claim this skill was
discovered, loaded, or influential without host runtime evidence. Missing
runtime evidence falls back to the repository contract and declared checks.

