# Model routing operator contract (1.6.0)

The editable source is `config/agent-roster.json`; released snapshots under
`config/<version>` are immutable. Astra runs in Codex and owns orchestration,
decisions, design, ordinary review and Computer Use. Deterministic commands use
tools directly. Six evidence phases do not require six model conversations.

Bounded implementation follows this order:

1. OpenCode Go `opencode-go/muse-spark-1.3-contributor`, High.
2. OpenCode Go `opencode-go/glm-5.3-flash`, High.
3. Go `opencode-go/qwen3.8-flash`, High, after matching runtime availability.
4. Devin `swe-1-7-lightning-medium`, Medium.
5. Factory `glm-5.3-flash`, High.
6. Codex `gpt-5.6-luna`, High, priority-tier fallback only.

Complex independent review follows Factory Fable 5.1 Medium, Devin Fable 5.1
Medium, then Astra High. Ordinary review stays with Astra. Escalation may
increase Astra effort to Max when observed risk justifies it. Effort is a
task setting; a provider/model name alone does not establish speed or quality.

`model-route --input route.json --json` is pure apart from reading local
availability observations: it never calls providers or grants dispatch.
It accepts `capability`, `routeSlot`, optional `roster`, `unavailable` and
`escalation`. Without a supplied roster or version it uses the active roster.
The host supplies exact worktree, ownership, prompt and authorized permissions
separately. Never add automatic permissions to the pure invocation descriptor.

Requested and resolved models are distinct. Only a matching runtime receipt
may populate `resolvedModel`; an installed configuration or model listing is
not proof of execution. Record quota, unavailable, unsupported, policy,
timeout, latency or model-mismatch evidence before advancing. Exhaustion and
unknown harnesses fail closed. Reuse useful worker context across corrections.

OpenCode invokes `opencode run --pure --model <provider/model> --variant <effort>
--format json`. Devin effort-specific UIDs are resolved from its live model
catalog. Factory invokes `droid exec --model ... --reasoning-effort ...`.
Astra and Luna use Codex. Do not confuse the Astra model with a provider.

Muse Spark 1.3 Contributor is the first bounded implementation candidate
under explicit Contributor opt-in; the operator authorized its use and
understands the provider data policy. One synthetic run on 2026-09-04
observed Muse 18.737s vs GLM 35.734s across 18/18 independent cases each.
n=1; self-checks were flawed on both sides; no general quality superiority
is claimed. Production routing stays provisional with parent reviews:
ordinary review stays with Astra, complex review stays Factory/Devin Fable
then Astra, and Astra owns UI/computer-use judgment unchanged. Selection
still reports `resolvedModel: null` until a matching runtime receipt
resolves the exact observed model.

Record a real failure with `record-provider-failure --input observation.json`.
The observation has exactly `candidateId`, typed `reason`, ISO `observedAt`,
ISO `expiresAt` (maximum seven days later), and a private `evidenceRef`.
Use a short backoff when the provider gives no exact reset time. The host stores
only negative observations under `.development-system/private/runtime/`;
expired failures stop affecting selection. An explicit `unavailable` packet
overrides the cache for reproducible decisions. Cache entries never establish
successful execution or model resolution.
