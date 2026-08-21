# ETERIA architecture convergence prompt

Work in the existing checkout for `AO-HyS/eteria`.

I want ETERIA's web, landing, current native clients, Convex domain, media pipeline, and release tooling to have one understandable product architecture without pretending every platform has the same needs. Preserve current behavior, privacy, and visual identity.

Start with the installed Working Backwards flow. Run a short Product Grill by Topic, generate a compact non-technical Future Customer Story, and stop for my review. After approval, run a platform-aware Technical Grill, complete research only where evidence is missing, and produce the Product Contract, Technical Contract, and Implementation Map through their normal gates. Create one Linear initiative with dependency-aware tickets only after the map is approved and I explicitly authorize tracker writes. Do not refactor before Implement Preview.

For this convergence initiative only, the Technical Grill must load the installed architecture reference pack at `~/.codex/development-system/architecture-reference-pack.md` (canonical 1.5.9 fallback: `https://github.com/AO-HyS/development-system/blob/main/artifacts/1.5.9/architecture-reference-pack.md`) before asking architecture questions. For each observed boundary, record `current state -> reference evidence -> fit or mismatch -> inferred decision`. Present inferred architecture decisions for correction or approval instead of asking me to design module placement, locality, package sharing, or repository guidance when repository and reference evidence already answer them. Continue to ask me about complex product behavior, risk, data, providers, destructive cleanup, and trade-offs that evidence cannot settle. This opt-in instruction does not change normal Working Backwards behavior outside these product-convergence prompts.

Mark the Technical Grill with `working_backwards_program: architecture-convergence` and complete every product-architecture dimension in the reference pack's coverage matrix before asking me to approve it. Apply every dimension per platform instead of forcing symmetry, and cover code, tests, documentation, media and data boundaries, dependency direction, and product-level fitness functions that prevent drift.

Keep three named product workstreams visible from the Technical Grill through the final Reader: **Product architecture**, **Convex backend**, and **Observability**. Give each workstream its own current evidence, decisions, tickets or explicit no-change conclusion, acceptance checks, timing, and rollout status. Agent guardrails, global anti-slop policy, and Release Train design remain Development System-owned and are not product migration workstreams; only verify that the current repository adapter is compatible.

The Technical Grill and repository audit must establish:

- the intended boundaries among `apps/web`, `apps/landing`, `apps/ios`, `apps/mobile`, `packages/convex`, `packages/media-pipeline`, and shared UI/environment/release packages;
- which domain rules and contracts can be shared, and which Swift/iOS, web, or mobile implementations should remain native adapters;
- whether inactive or legacy mobile surfaces are authoritative, experimental, or removable candidates, without deleting them by assumption;
- whether React composition, native architecture, Convex queries/mutations/actions, media storage, Cloudflare, PostHog, strict typing, and privacy follow current primary guidance;
- whether subscriptions, queries, image/media delivery, rendering, and native networking are measurably bounded and performant;
- which stack-specific fitness functions compose lint, typecheck, focused tests, `ios:verify`, React Doctor, Impeccable, Convex/security review, and provider smoke without making every change pay every platform;

Use strong iOS, React, Convex, and cross-platform open-source products as comparative evidence where they match a real ETERIA decision. Prefer explicit Interfaces and adapters over forced code sharing.

The approved implementation should complete the agreed convergence without changing production data or provider state outside authorized slices. Finish with a named offline Reader report showing platform ownership, before/after architecture, performance evidence, removed antipatterns, checks and timing, preview/production evidence, rollback, and a concise device-specific QA list.
