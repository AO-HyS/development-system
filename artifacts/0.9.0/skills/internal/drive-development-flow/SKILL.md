---
name: drive-development-flow
description: Apply the fixed implementation flow to authorized software work while leaving special planning, discovery, and multiple-ticket modes under explicit user control. Use automatically for software development conversations; never infer a special workflow from size or ambiguity.
---

# Drive Development Flow

Hold one constant:

> Deliver correct functionality to the authorized state as fast as possible,
> with useful quality, the lowest measured cost, and the least complexity.

The user controls the lifecycle. This skill does not guess which ceremony the
user wants.

## Route only what was requested

- For an authorized code change or ready ticket, load `flow-implement`.
- For a review, bug diagnosis, QA intake, or research request, load only the
  directly requested matching flow.
- Load Wayfinder, grilling, spec creation, ticket creation, prototypes, or
  `work-multiple` only when the user explicitly asks for that activity.
- Never activate a special flow because work is large, vague, urgent, or has
  several tickets.
- Never advance from discussion to tickets or implementation without the
  corresponding authorization.

## Keep implementation fixed

Implementation always:

1. freezes the smallest complete outcome and authorization boundary;
2. changes only what that outcome needs;
3. runs affected fast static checks and focused local tests;
4. uses React Doctor or an applicable Impeccable check only when the relevant
   React, interaction, or visual implementation changed;
5. selects manual UI QA by observable risk, not merely because a file is
   user-visible;
6. obtains independent review evidence proportionate to the change;
7. continues only to the publication or production state the user authorized.

A full repository suite is never implicit.

## Preserve explicit special modes

The following are user-triggered tools, not inferred stages:

- Wayfinder and grilling;
- spec and ticket generation;
- prototypes;
- `work-multiple`;
- broad suites, release, merge, and production promotion.

When one is invoked, follow its own contract and return control to the user at
its authorization boundary.

## Compose with coding orchestration

Inside a Git repository, load `coding-orchestration` for non-trivial coding.
This skill preserves the requested lifecycle action; orchestration chooses the
smallest adequate execution route. Neither skill may add unrequested stages.
