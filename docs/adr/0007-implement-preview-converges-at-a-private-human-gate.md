# ADR 0007: Implement Preview converges at a private human gate

Status: Accepted

## Context

Delivery can appear complete while high-risk review findings remain, while the same defect loops indefinitely, or while PR and preview evidence are scattered across logs. A delivery trigger must not inherit merge, release, or production authority.

## Decision

Run one authorized terminal slice with one writer by default, independent intent and standards review processes, proportional TDD/QA evidence, and structured commit/PR/preview operations. Completion requires no blocker/high findings and explicit disposition of medium findings. Repeated blocking fingerprints pause the loop as non-convergent.

Write Local Visual Plan and Recap under the selected HOME with private permissions, outside the target repository and pull request. The recap exposes failures/corrections, risk, PR, preview, and a manual checklist. End at `ready-for-human` without promotion authority.

## Consequences

Review is confrontational without being unbounded ceremony. Private decision surfaces support fast human judgment. Merge, release, and production remain exact, separate, one-shot authorizations.
