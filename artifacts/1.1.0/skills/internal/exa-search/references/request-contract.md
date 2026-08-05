# Exa raw request contract

Canonical reference: https://exa.ai/docs/reference/search-api-guide-for-coding-agents

The wrapper sends raw JSON to `POST https://api.exa.ai/search` with `Authorization: Bearer`, following the current coding-agent guide. Earlier setup notes that used `x-api-key` as the canonical header are stale. Raw JSON and the JavaScript SDK use camelCase; Python uses snake_case.

Defaults:

- `type: "auto"`
- `numResults: 5`
- `contents: { "highlights": true }`
- no forced live crawl
- no synthesis

Supported search types are `auto`, `fast`, `instant`, `deep-lite`, `deep`, and `deep-reasoning`. `additionalQueries` is restricted to deep variants. Current categories are `company`, `people`, `publication`, `news`, `personal site`, and `financial report`; older notes that named `research paper` are stale because scholarly work now uses `publication`. `company` and `people` cannot be combined with `excludeDomains` or publication-date filters.

On `/search`, `text`, `highlights`, and `summary` belong inside `contents`. The deprecated or nonexistent parameters `useAutoprompt`, `includeUrls`, `excludeUrls`, `numSentences`, `highlightsPerUrl`, `tokensNum`, and `livecrawl` are rejected.

When `contents.text` is an object, `maxCharacters` is required by this Development System wrapper even though the API itself permits uncapped text. Supported verbosity values are `compact`, `standard`, and `full`.

Enterprise `compliance: "hipaa"` is accepted only with `type: "fast"` or `"instant"`, no `contents.summary`, and explicit cache-only retrieval through `contents.maxAgeHours: -1`. This validates the API's documented HIPAA restrictions locally; it does not claim that Exa is authorized for a product's regulated data.

`outputSchema` may have at most two nested object levels and ten total properties. Do not add citation or confidence fields. Grounding is returned in `output.grounding`.

The API response can contain `requestId`, `searchType`, `results`, `output`, and `costDollars.total`. Only request metadata and the API-reported estimated request cost are written to local telemetry; billing remains the authoritative charge record.
