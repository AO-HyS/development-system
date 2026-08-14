# NutriPlan architecture convergence prompt

Work in the existing checkout for `AO-HyS/nutri-plan`.

I want NutriPlan's production web surfaces and Convex domain to become easier and faster for agents to change, with real type safety and no risk to existing patient, nutrition, workout, identity, or operational data. The unused React Native app is a decision candidate, not an implicit migration target: determine whether it should be removed now and recreated later, retained with a clear boundary, or activated by a separate initiative.

Start with the installed Working Backwards flow. Run a short Product Grill by Topic, generate a compact non-technical Future Customer Story, and stop for my review. After approval, run the Technical Grill against repository and production-safe evidence, complete research only where evidence is missing, and produce the Product Contract, Technical Contract, and Implementation Map through their normal gates. Create one Linear initiative with dependency-aware tickets only after the map is approved and I explicitly authorize tracker writes. Do not refactor before Implement Preview.

The Technical Grill and repository audit must establish:

- the intended ownership of `apps/dashboard`, `apps/admin-dashboard`, `apps/landing`, `apps/mobile`, `packages/convex`, `packages/observability`, `packages/router-compat`, and shared configuration;
- where patient, nutrition, workout, directory, identity, authorization, forms, page composition, and tutorial/publishing rules live today;
- whether generators, shared form structures, routing compatibility, and utilities reduce duplication or instead create indirection and stale variants;
- every owned use of `any`, double assertions, generated-type bypasses, or duplicated contracts that prevents honest end-to-end typing;
- Convex authorization, validators, indexes, pagination, bounded results, subscription fan-out, write contention, actions, scheduled work, components, storage, and cost-sensitive hot paths;
- whether official Convex components now replace custom infrastructure we maintain unnecessarily;
- how Cloudflare should own suitable files/images while Convex retains domain records and relationships;
- whether TanStack, React composition, shadcn components, icons, PostHog observability, React Doctor, Impeccable, and security checks follow current primary guidance;
- how the Release Train can add a metadata-only fast path, avoid repeat `performance-contracts`, avoid unrelated backfills/deploys, preflight squash-history recovery, and prevent recovery branches from triggering unnecessary external Workers builds.

Production data safety is a first-class constraint. Inventory schemas, migrations, backfills, backups, provider bindings, and rollback before modifying them. Measure current query/read/subscription behavior before claiming an optimization. Use recognized React/TanStack/Convex monorepos as evidence for specific decisions, not as a universal template.

The approved implementation should converge the entire agreed initiative without leaving known architectural drift as permanent debt. Finish with a named offline Reader report showing before/after Modules and Interfaces, the mobile-app decision, removed antipatterns, Convex performance/cost evidence, validation timing, preview/production proof, rollback, and a short human QA list.
