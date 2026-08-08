---
name: working-backwards
description: Define a software feature from its future customer experience through evidence, product and technical contracts, vertical tickets, and a private T3 implementation handoff. Use when a feature idea needs Working Backwards definition, hard product questions, profile selection, or a portable implementation map before coding.
---

# Working Backwards

Explain the finished customer experience first. Treat claims about users, metrics, prices, dates, and external capabilities as hypotheses until evidence supports them.

## Select depth

- Use **Quick** only for settled, narrow, reversible behavior on one surface with no hard risk trigger.
- Use **Standard** by default: brief, research questions and report, product contract, domain and technical design, structure outline, ticket map, and handoff.
- Use **Complex** for invariants, authorization, sensitive data, destructive behavior, migration or backfill, paid activation, uncertain providers, multiple repositories, or difficult rollback. Add only the ADR, prototype, migration, security, or rollout evidence the risks require.

Recommend depth read-only. Preserve a human-selected deeper profile. Record attempts to downshift and retain the minimum risk profile.

## Work backwards

1. Draft the plain-language Working Backwards Brief: actor, current problem, desired outcome, finished experience, first value, external and internal FAQ, boundaries, and unsupported claims.
2. Ask the hard questions. Use grilling for unsettled product choices and research current code/runtime or primary sources for factual gaps. Keep current-state evidence separate from future-state design.
3. Define observable behavior before entities and modules. Record states, permissions, errors, recovery, compatibility, invariants, alternatives, and rejected decisions.
4. Cut narrow vertical slices with observable outcomes, acceptance criteria, focused checks, native dependencies, and a truthful executable frontier. Each slice must fit a fresh implementation context.
5. Generate a compact private T3 handoff from approved artifact hashes, repository/base revision, tracker state, frontier, first slice, checks, risks, and remaining authorizations. T3 revalidates freshness before implementation.

Stop on contradictory artifacts, missing required evidence, unsafe visibility, or stale governing inputs. Resume from the smallest affected stage.

## Hold exactly three definition gates

1. **Product Contract Approved** — approve the brief, relevant questions, evidence, and desired experience.
2. **Technical Contract Approved** — approve product behavior, domain and technical design, and required risk evidence.
3. **Implementation Map Approved** — approve vertical slices, dependencies, acceptance criteria, and initial frontier.

HumanLayer is an optional local definition and comment surface. Record its configuration, observations, and receipts; its comments, task state, or auto-advance never grant a gate. Keep private operational artifacts outside synchronized destinations.

After the third gate, prepare publication intent read-only. Publish tracker issues only with separate explicit external-write authorization and an injected tracker adapter. Generate the private handoff separately. Keep `implementationAuthorized: false`; only the existing Implement Preview can authorize one terminal slice. Commit, push, PR, merge, release, production, paid activation, and destructive operations retain their own exact authorization boundaries.
