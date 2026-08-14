# AO HyS architecture convergence prompt

Work in the existing checkout for `AO-HyS/aohys.com`.

I want to make AO HyS the public, understandable example of how we build software: fast to change, straightforward to navigate, and free of agent-generated architectural drift. Preserve its current product behavior and visual identity.

Start with the installed Working Backwards flow. Run a short Product Grill by Topic and use what I already said as settled context. The first artifact must be a compact, non-technical Future Customer Story. After I approve it, run the Technical Grill against the repository, complete research only where evidence is missing, and produce the Product Contract, Technical Contract, and Implementation Map through their normal gates. Create one Linear initiative with dependency-aware tickets only after the map is approved and I explicitly authorize tracker writes. Do not refactor before Implement Preview.

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
