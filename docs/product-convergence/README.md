# Product convergence prompts

Each convergence prompt opts into the [Architecture reference pack](../architecture-reference-pack.md). That opt-in applies only to the convergence initiative: the Technical Grill infers architecture choices that repository and reference evidence can settle, presents them for correction or approval, and keeps asking the operator about complex product trade-offs that evidence cannot decide. Ordinary Working Backwards tasks retain their normal questioning behavior.

These prompts start a separate Working Backwards initiative in each primary product after Development System Next is installed. They do not claim that adapter rollout changed product architecture.

Use one prompt from the target repository. The first output is a compact Product Grill and Future Customer Story. The Technical Grill, audit, initiative, tickets, implementation, and release follow only through their normal gates.

| Product | Prompt |
| --- | --- |
| AO HyS | [`aohys.md`](aohys.md) |
| Casa Roca | [`casa-roca.md`](casa-roca.md) |
| The Barber Central | [`the-barber-central.md`](the-barber-central.md) |
| ETERIA | [`eteria.md`](eteria.md) |
| NutriPlan | [`nutriplan.md`](nutriplan.md) |

Shared outcome: make the existing product easier for humans and agents to change, preserve real behavior and production data, remove proven architectural drift rather than renaming it, and leave fast fitness functions that detect recurrence.

Every prompt makes four implementation workstreams explicit instead of hiding them inside a generic audit:

1. **Product and agent architecture** — module ownership, React/TanStack composition, strict types, repository instructions, Codex-facing discoverability, and fast fitness functions.
2. **Convex backend** — domain ownership, authorization, validators, indexes, subscriptions, storage, components, security, performance, and cost-sensitive paths.
3. **Observability** — PostHog production instrumentation, actionable errors, conversion/product signals, privacy boundaries, alerts, and evidence for safe automatic follow-up.
4. **Release Train** — affected-surface selection, evidence reuse, preview, exact-SHA promotion, smoke, rollback, and measured provider wait.

The Product Contract, Technical Contract, Implementation Map, Linear initiative, tickets, final Reader, and Check-in evidence must preserve those workstream names. A prompt may prove that one workstream needs no change, but it may not silently omit it.

Until Linear has product-specific teams and native issue keys, tracker writes must use the canonical product project and a visible title prefix: `[AO HyS]`, `[Casa Roca]`, `[The Barber Central]`, `[NutriPlan]`, or `[ETERIA]`. Human-facing reports render `AO/AOH-n`, `CR/AOH-n`, `TBC/AOH-n`, `NP/AOH-n`, or `ET/AOH-n`; they must not present a bare `AOH-n` as if it identified the product.

The prompts deliberately ask for repository evidence before prescribing one universal structure. A monorepo, a native client, a public site, and a multi-surface operational product should share principles without becoming the same architecture.
