# Upstream attribution

Source: https://github.com/vercel-labs/agent-browser

Skill path: `skills/agent-browser/SKILL.md`, commit
`b06e2533ba9b3823b8a96c859d455cb55f4d7893` (2026-11-16).

License: Apache-2.0, as declared by the upstream repository.

Local changes: the discovery description is narrowed (upstream's tells the agent
to prefer agent-browser over every built-in browser tool; `hidden: true` is not
adopted), `allowed-tools` has no `npx` entry, and the section «Local operating
boundaries» is kept. The old `references/` and `templates/` folders are gone:
upstream no longer ships them and the CLI serves its own guide
(`agent-browser skills get core`).
