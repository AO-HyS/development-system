# ADR 0042: Permit code reviewers to execute required checks

Status: Accepted bounded runtime repair; product acceptance remains separate.

## Context

A real workflow arm reached code review, where the read-only sandbox prevented
Vitest from writing transient configuration files. The reviewer rejected the
candidate with empty findings, and strict validation correctly stopped the run.
The failure is retained as evidence rather than converted to a successful review.

## Decision

Packet and integrated code reviewers use `danger-full-access` to run the existing
checks. Review prompts prohibit product edits and require a concrete defect or
command/evidence-backed validation blocker when rejecting a candidate. Keep the
strict structured-review schema and rejection of empty findings.

Execution capability does not grant mutation authority. Preserve immutable
candidate/source tree guards and explicitly check the pinned integration HEAD
and branch before acceptance or application. Reject reviewed source or revision
changes even if the reviewer approves. Discovery, planning, plan review and visual
review remain read-only. Model pins, direct/single options, defaults, correction,
integration, neutral QA and acceptance gates are unchanged.

## Release boundary

Extend exact commit ac3ab4d397291d850d09bca1e7c2fa4b12392761 in an isolated 1.23.2
worktree. New immutable snapshots and manifest retain all 41 managed destinations
and catalog 0.43.1 with 104 skills / 140 variants. Compatible 1.23.0 scheduler
policy and pricing remain explicit pinned inputs. Local verification and tarball
preparation do not activate HOME, publish remotely or establish product acceptance.
