# AO HyS architecture convergence prompt

Work in the existing checkout for `AO-HyS/aohys.com`.

I want to make AO HyS the public, understandable example of how we build software: fast to change, straightforward to navigate, and free of agent-generated architectural drift. Preserve its current product behavior and visual identity.

Start with the installed Working Backwards flow. Run a short Product Grill by Topic and use what I already said as settled context. The first artifact must be a compact, non-technical Future Customer Story. After I approve it, run the Technical Grill against the repository, complete research only where evidence is missing, and produce the Product Contract, Technical Contract, and Implementation Map through their normal gates. Create one Linear initiative with dependency-aware tickets only after the map is approved and I explicitly authorize tracker writes. Do not refactor before Implement Preview.

For this convergence initiative only, the Technical Grill must load the installed architecture reference pack at `~/.codex/development-system/architecture-reference-pack.md` (canonical fallback: `https://github.com/AO-HyS/development-system/blob/main/docs/architecture-reference-pack.md`) before asking architecture questions. For each observed boundary, record `current state -> reference evidence -> fit or mismatch -> inferred decision`. Present inferred architecture decisions for correction or approval instead of asking me to design module placement, locality, package sharing, or repository guidance when repository and reference evidence already answer them. Continue to ask me about complex product behavior, risk, data, providers, destructive cleanup, and trade-offs that evidence cannot settle. This opt-in instruction does not change normal Working Backwards behavior outside these product-convergence prompts.

Keep four named workstreams visible from the Technical Grill through the final Reader: **Product and agent architecture**, **Convex backend**, **Observability**, and **Release Train**. Give each workstream its own current evidence, decisions, tickets or explicit no-change conclusion, acceptance checks, timing, and rollout status. Codex-facing repository guidance is part of Product and agent architecture; PostHog is part of Observability, not a generic quality footnote.

The Technical Grill and repository audit must establish:

- how `apps/site`, `apps/dashboard`, `apps/backend`, and the shared packages divide product responsibilities today;
- whether business logic, content graph behavior, UI composition, and provider adapters live at the correct locality;
- where duplicated forms, page structures, route conventions, utilities, or compatibility layers make agents guess;
- whether React composition, TanStack usage, Convex boundaries, Cloudflare delivery, PostHog observability, type safety, and Impeccable checks follow current primary guidance;
- which existing modules are genuinely deep and reusable, and which abstractions merely move code around;
- which fast architecture, lint, type, behavior, React Doctor, security, and visual fitness functions can prevent drift on changed surfaces;
- how its Release Train can skip metadata-only work, avoid duplicated checks, and still preserve exact-SHA preview, production smoke, and rollback evidence.

Use current source and runtime evidence. Compare only where useful with primary documentation and recognized open-source React/TanStack/Convex monorepos. Every proposed pattern must state why it fits AO HyS rather than being copied because it is popular.

The approved implementation should converge the whole agreed initiative, not leave a permanent “later” debt list. Keep migrations, destructive cleanup, provider changes, merge, and production behind their explicit gates. Finish with a named offline Reader report that shows before/after architecture, changed Modules and Interfaces, removed antipatterns, checks, timing, preview, production evidence, rollback, and the few things I should test.
