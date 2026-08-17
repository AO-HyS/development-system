# The Barber Central architecture convergence prompt

Work in the existing checkout for `AO-HyS/the-barber-central`.

I want The Barber Central's dashboard, admin dashboard, landing, and Convex domain to become faster and safer for agents to change. Preserve the operational behavior that already works while removing architectural patterns that generate duplicate forms, page factories, compatibility layers, or hard-to-find business rules.

Start with the installed Working Backwards flow. Run a short Product Grill by Topic and generate a compact, non-technical Future Customer Story. After I approve it, run the Technical Grill against the repository, complete research only where evidence is missing, and produce the Product Contract, Technical Contract, and Implementation Map through their normal gates. Create one Linear initiative with dependency-aware tickets only after the map is approved and I explicitly authorize tracker writes. Do not refactor before Implement Preview.

Keep four named workstreams visible from the Technical Grill through the final Reader: **Product and agent architecture**, **Convex backend**, **Observability**, and **Release Train**. Give each workstream its own current evidence, decisions, tickets or explicit no-change conclusion, acceptance checks, timing, and rollout status. Codex-facing repository guidance is part of Product and agent architecture; PostHog is part of Observability, not a generic quality footnote.

The Technical Grill and repository audit must establish:

- the intended ownership of `apps/dashboard`, `apps/admin-dashboard`, `apps/landing`, `packages/convex`, `packages/router-compat`, and shared configuration;
- whether appointments, staff, services, customers, organizations, permissions, forms, and page composition follow explicit domain boundaries;
- which generators and abstractions eliminate repetition and which instead create indirection, stale variants, or agent confusion;
- whether TanStack routing/data patterns, React composition, Convex authorization and performance, Cloudflare/R2 boundaries, PostHog observability, and strict TypeScript match current primary guidance;
- where `any`, assertions, copied contracts, oversized utilities, effects used for derivable state, or cross-app imports hide real coupling;
- whether shadcn components and icon usage can be updated without making every surface visually identical;
- which fast fitness functions should prevent recurrence through lint architecture, typecheck, focused tests, React Doctor, Impeccable, Convex review, and security;
- why the Release Train sometimes performs broad checks or preview work, and how affected-surface selection can preserve exact-SHA evidence while making metadata-only and isolated UI changes fast.

Use observable behavior and production contracts as the baseline. Protect tenant data, authorization, appointments, media, Stripe, migrations, and provider configuration with explicit slices and rollback. Use recognized repositories and books as evidence for principles, never as a folder tree to copy blindly.

The approved implementation should finish the agreed convergence and remove proven antipatterns rather than documenting them as permanent debt. Finish with a named offline Reader report covering before/after architecture, removed drift, verification timings, preview/production evidence, rollback, and the smallest useful human QA list.
