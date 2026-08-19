# Architecture reference pack

This pack is comparative evidence for the product-convergence prompts. It is not a universal folder template and it does not make silent architectural inference the default for ordinary Working Backwards tasks. A convergence prompt opts into this pack explicitly.

For an opted-in convergence initiative, inspect the product repository first. Use only the references relevant to an observed boundary, and record the result as:

`current state -> reference evidence -> product fit or mismatch -> inferred decision`

Present inferred decisions to the operator for correction or approval. Continue asking about genuinely unresolved product behavior, risk, destructive changes, provider choices, data boundaries, and other complex trade-offs that source evidence cannot decide.

## Durable principles

| Source | Use it for | Do not turn it into |
| --- | --- | --- |
| [A Philosophy of Software Design](https://web.stanford.edu/~ouster/cgi-bin/aposd.php) | Deep modules, narrow Interfaces, hidden complexity and information ownership. | Arbitrary file-size budgets or abstraction for its own sake. |
| [Domain Modeling Made Functional](https://pragprog.com/titles/swdddf/domain-modeling-made-functional/) | Business vocabulary, explicit states and making invalid states difficult to represent. | A requirement to adopt one language or functional framework. |
| [Building Evolutionary Architectures](https://www.thoughtworks.com/en-gb/insights/books/building-evolutionaryarchitectures-second-edition) | Fast deterministic fitness functions plus periodic semantic review. | A slow universal suite on every change. |
| [The Pragmatic Programmer](https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/) | Tracer bullets, automation, feedback and reversible progress. | Permission to skip production evidence or explicit risk gates. |

## Web, React, TanStack and monorepos

| Reference | What to extract | What not to copy |
| --- | --- | --- |
| [TanStack Query](https://github.com/TanStack/query) and [TanStack Router](https://github.com/TanStack/router) | Primary behavior for server-state ownership, loaders, route typing, cache boundaries and Router/Query composition. | Library-repository layout as an application architecture. |
| [`t3-oss/create-t3-turbo`](https://github.com/t3-oss/create-t3-turbo) | A predictable Turborepo skeleton: applications as composition roots, explicit package exports, shared tooling, affected checks, TanStack Start and Expo seams. | Its tRPC, Drizzle, Supabase, Next.js or Vercel choices when the product uses Convex, Cloudflare or another runtime. It is a starter, not proof of a complex domain model. |
| [Formbricks](https://github.com/formbricks/formbricks) | A real-product stress test for domain-named modules, feature locality, public package surfaces, jobs, storage, UI engines and package-owned checks. | Its framework, database, licensing or deployment choices. Its scale does not justify copying every package. |
| [Turborepo documentation](https://turborepo.com/docs/crafting-your-repository) | Task graph, declared inputs/outputs, caching and changed-surface execution. | Treating Turborepo itself as architecture or enabling experimental boundaries as the only guard. |

For new multi-app TypeScript products, Turborepo is the preferred implementation unless the product prompt says otherwise. The architectural requirement is still a truthful dependency graph, explicit public Interfaces and affected checks; a tool name alone does not prove those properties.

## Convex and Cloudflare

| Reference | What to extract | What not to copy |
| --- | --- | --- |
| [Convex documentation](https://docs.convex.dev/) and official components | Authorization, validators, indexes, pagination, bounded reads, subscriptions, write contention, actions, scheduling, storage and maintained components. | Generic repository layers over Convex or custom infrastructure that an official component already owns. |
| [Cloudflare templates](https://github.com/cloudflare/templates) and product documentation | Runtime boundaries, Workers/Pages/R2 capabilities, caching and provider-native deployment evidence. | Cloudflare structure in products that do not use Cloudflare, or moving domain records out of Convex merely to reduce file-storage cost. |

Keep domain records and relationships in Convex. Prefer Cloudflare for suitable binary or static storage when the product already owns that boundary and migration risk is explicitly approved.

## Mobile and desktop

| Surface | Reference set | Apply when | Avoid |
| --- | --- | --- | --- |
| React Native / Expo | [Expo](https://github.com/expo/expo), [Callstack React Native practices](https://github.com/callstackincubator/agent-skills), and [Software Mansion](https://github.com/software-mansion-labs) | New shared mobile product work by default; measure renders, lists, memory, bundle, startup and native-boundary work. | Forcing web abstractions into native UI or hiding a capability that requires Swift/Kotlin. |
| Android | [Now in Android](https://github.com/android/nowinandroid) plus [Pocket Casts Android](https://github.com/Automattic/pocket-casts-android) | Compose features, unidirectional data flow, dependency direction, builds and production-product reality checks. | Copying Google's sample modules without a matching product boundary. |
| iOS | Apple guidance, [isowords](https://github.com/pointfreeco/isowords) and [Pocket Casts iOS](https://github.com/Automattic/pocket-casts-ios) | Explicit feature state/effects, testable seams, previews and multiple targets. | Requiring one state-management library or sharing code merely for symmetry. |
| Electron | [T3 Code](https://github.com/pingdotgg/t3code) and [Actual Budget](https://github.com/actualbudget/actual) | Desktop/web/server contracts, process boundaries, local-first behavior, incremental builds and agent-oriented sessions. | Treating T3 Code as a Convex product example or copying a desktop process model into a normal web app. |

Expo/React Native is the default for new mobile work. Native Swift/Kotlin remains the correct choice when a product has an explicit platform capability, an existing native contract, or measured performance evidence.

## Product-specific selection

- **AO HyS:** TanStack Query/Router, `create-t3-turbo`, Formbricks, Convex and Cloudflare; use T3 Code only to evaluate agent discoverability and session ergonomics.
- **Casa Roca:** the shared React/domain principles plus its actual Next.js/Vercel contract; Vercel guidance remains local to this product.
- **The Barber Central:** TanStack/React locality, Formbricks-style feature modules, Convex and Cloudflare/R2 boundaries; preserve the operational multi-app split unless evidence disproves it.
- **ETERIA:** shared principles plus Expo/React Native, iOS, Convex, media and Cloudflare references selected per surface; never force identical architecture across platforms.
- **NutriPlan:** shared web/TanStack/Convex references; treat the unused mobile application as an explicit product decision rather than an automatic migration target.

## Evidence rule

A reference can justify a decision only when the report records:

1. the current product evidence and affected paths;
2. the exact source or implementation pattern inspected;
3. why the pattern fits this product's domain, stack and operating constraints;
4. what is deliberately not adopted;
5. a fast fitness function or review seam that can detect future drift.

Popularity is a discovery signal, not sufficient evidence. Local products are comparison fixtures and rollout evidence, never automatic architectural authorities.
