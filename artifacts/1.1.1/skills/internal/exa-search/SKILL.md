---
name: exa-search
description: Search the public web through Exa with cost telemetry and bounded content. Use when a repository opts into Exa, the user explicitly invokes $exa-search, or current external research needs Exa's neural retrieval or grounded structured output.
---

# Exa Search

Use Exa as a paid retrieval option, not as an automatic replacement for repository search, known-URL fetching, or primary-source browsing.

## Route the request

- Search the repository and connected first-party systems locally before searching the public web.
- Use `/contents` or the browser when the URL is already known. Use this skill when URLs must be discovered.
- Default to `type: "auto"`, 5 results, and `contents.highlights: true`.
- Use `fast` or `instant` only for latency-sensitive lookups.
- Use `deep-lite`, `deep`, or `deep-reasoning` only for multi-source comparison or synthesis. State why the deeper paid mode is justified.
- Add `outputSchema` only when downstream code needs structured grounded output. Never invent citation or confidence fields; Exa returns grounding separately.
- Prefer official documentation, standards, repositories, and original research for technical work. Domain filters are a precision tool, not a default.

## Protect data and cost

- Never send secrets, credentials, private source, customer data, personal health information, or other non-public repository context in a query or prompt.
- Convert the research need into a public, context-minimized query before calling Exa.
- The wrapper rejects common credential, contact, government-ID, and clinical-record patterns before network use. Treat this as defense in depth, not proof that arbitrary text is anonymous.
- `compliance: "hipaa"` constrains Exa transport but never authorizes sending PHI. Use it only where a separately approved data policy permits the data; NutriPlan remains public/synthetic-only.
- Start with highlights. Request full text only when excerpts are insufficient and always cap `maxCharacters`.
- Omit `maxAgeHours` unless freshness matters. `0` forces live crawling and adds latency.
- Keep the default result count unless evidence is insufficient. Escalate depth before multiplying repeated searches.
- The wrapper stores request timing, search type, result count, request ID, and the API-reported estimated `costDollars.total`; it never stores the query, result URLs, excerpts, or response body. Billing remains authoritative.

## Run

The wrapper uses `EXA_API_KEY`, then `~/.config/exa/key`. Do not print or persist the key. Resolve the installed skill path before invoking it so the command works from any repository:

```bash
node ~/.agents/skills/exa-search/scripts/exa-search.mjs search --query "current public question"
node ~/.agents/skills/exa-search/scripts/exa-search.mjs search --query "comparison" --type deep --num-results 8
node ~/.agents/skills/exa-search/scripts/exa-search.mjs request --input /absolute/path/request.json
node ~/.agents/skills/exa-search/scripts/exa-search.mjs search --query "preview" --dry-run
```

Use `request --input` for advanced payloads such as `outputSchema`, `systemPrompt`, dates, or multiple filters. The wrapper validates current raw-JSON camelCase, deprecated parameters, category conflicts, content bounds, and schema limits before any paid request.

## Verify and report

- For version-sensitive integration details, check the [canonical coding-agent reference](https://exa.ai/docs/reference/search-api-guide-for-coding-agents) before changing the wrapper. Report any drift.
- Inspect `requestId`, `searchType`, source URLs, grounding, and the API-reported estimated request cost in `costDollars.total`.
- Cite the original sources in the user-facing answer, not Exa itself.
- If Exa is unavailable or returns weak evidence, say so and continue with the normal browser/search tools when that remains in scope.
