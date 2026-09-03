# Development System Contract 1.5.16

Version 1.5.16 preserves the immutable 1.5.15 contract and keeps the
fast-model-first policy while adding an explicit,
evidence-bound cross-harness model route. Codex and T3 Code remain the
canonical lifecycle surfaces. The ordinary implementation route and all
mechanical, non-deliberative work follow one shared ordered runtime attempt
chain: Devin SWE-1.7, Factory GLM 5.3 Flash, Devin Gemini 3.8 Flash only with
verified runtime availability, then Codex GPT-5.6 Luna with reasoning `max` on
the priority/fast service path. This includes trivial edits, code/file search,
file creation, code generation, evidence collection, and focused tests.
Everyday implementation is never direct on Codex Luna High; Fable 5.1 is
reserved for adversarial review and the Sol parent retains deliberation,
integration, and semantic judgment.

The `adversarial-review` route is Factory Droid Claude Fable 5.1, then Devin
Claude Fable 5.1, then Codex GPT-5.6 Sol. Fable and Sol use `xhigh` by default;
`max` requires an explicit escalation signal. Each unavailable candidate and
provider/quota boundary is recorded. The pure `model-route` operation never
dispatches a provider and blocks when declared candidates are exhausted.

Factory and Devin are model/harness routes only. They are not lifecycle
authorities and do not install skills. The global orchestrator owns skills;
product repositories receive only their minimal generated adapters. Existing
Computer Use remains Codex Luna Max execution with separate Sol judgment, and
NutriPlan/The Barber visible acceptance keeps its authorized Computer Use
boundary.

The 0.23.0 skill catalog ships a new immutable 1.5.16 `coding-orchestration`
skill copy and a new immutable 1.5.16 `fast_implementer` agent artifact (Luna,
`max`); catalog 0.22.0 and the 1.5.15 bytes remain untouched immutable
rollback targets. Published 1.5.15 bytes remain immutable;
1.5.15 is the rollback target. See `docs/model-routing.md` and ADR 0018 for
operator evidence and escalation policy.
