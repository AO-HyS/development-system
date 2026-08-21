# Casa Roca architecture convergence prompt

Work in the existing checkout for `corrortiz/casa-roca`.

I want Casa Roca's dashboard, public surface, and Convex backend to have a clear architecture that agents can extend without scattering domain logic or breaking production behavior. Casa Roca may keep its Vercel-specific delivery choices; those choices are local to this product.

Start with the installed Working Backwards flow. Run a short Product Grill by Topic, generate a compact non-technical Future Customer Story, and stop for my review. After approval, run the Technical Grill from repository evidence, complete research only where evidence is missing, and produce the Product Contract, Technical Contract, and Implementation Map through their normal gates. Create one Linear initiative with dependency-aware tickets only after the map is approved and I explicitly authorize tracker writes. Do not refactor before Implement Preview.

For this convergence initiative only, the Technical Grill must load the installed architecture reference pack at `~/.codex/development-system/architecture-reference-pack.md` (canonical 1.5.9 fallback: `https://github.com/AO-HyS/development-system/blob/main/artifacts/1.5.9/architecture-reference-pack.md`) before asking architecture questions. For each observed boundary, record `current state -> reference evidence -> fit or mismatch -> inferred decision`. Present inferred architecture decisions for correction or approval instead of asking me to design module placement, locality, package sharing, or repository guidance when repository and reference evidence already answer them. Continue to ask me about complex product behavior, risk, data, providers, destructive cleanup, and trade-offs that evidence cannot settle. This opt-in instruction does not change normal Working Backwards behavior outside these product-convergence prompts.

Mark the Technical Grill with `working_backwards_program: architecture-convergence` and complete every product-architecture dimension in the reference pack's coverage matrix before asking me to approve it. Do not reduce the program to visible UI files or naming cleanup: cover code, tests, documentation, data access, dependency direction, and product-level fitness functions that keep the repository converged.

Keep three named product workstreams visible from the Technical Grill through the final Reader: **Product architecture**, **Convex backend**, and **Observability**. Give each workstream its own current evidence, decisions, tickets or explicit no-change conclusion, acceptance checks, timing, and rollout status. Agent guardrails, global anti-slop policy, and Release Train design remain Development System-owned and are not product migration workstreams; only verify that the current repository adapter is compatible.

The Technical Grill and repository audit must establish:

- the intended boundaries among `apps/dashboard`, `apps/public`, and `packages/backend`;
- where membership, reservations, attendance, content, and administration domain rules belong;
- whether UI composition, shared components, routes, hooks, utilities, and Convex functions are discoverable by domain rather than accidental file history;
- whether authorization, validators, indexes, pagination, bounded reads, write contention, storage, and migrations follow current Convex guidance;
- where types are erased through `any`, unsafe assertions, generated-type workarounds, or duplicated client/server contracts;
- whether current shadcn components and icon choices can be updated safely while preserving Casa Roca's design;
- which changed-surface checks should compose lint, typecheck, focused tests, React Doctor, Impeccable, Convex review, security, and Vercel/provider evidence without repeating work;

Preserve production data and current user-visible behavior. Treat schema changes, backfills, R2/storage moves, and provider configuration as separate risk-bearing slices with rollback evidence. Use primary sources and strong open-source examples only to test a proposed boundary, not to impose a universal folder template.

The approved implementation should complete the agreed convergence rather than normalize names and leave the old coupling in place. Finish with a named offline Reader report showing before/after architecture, domain ownership, changed Modules and Interfaces, removed antipatterns, verification time, preview, production evidence, rollback, and a short human test list.
