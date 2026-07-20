---
name: flow-code-review
description: Review a branch or diff through independent Standards and Spec lanes, then validate, deduplicate, and rank actionable findings by risk. Use when drive-development-flow selects review or after flow-implement completes.
---

# Flow Code Review

Review the diff along two independent axes:

- **Standards**: repository instructions, documented conventions, security, correctness, maintainability, and relevant smell heuristics.
- **Spec**: requested behavior, missing or partial requirements, unrequested scope, and behavior that looks implemented incorrectly.

Keep the inspections blind to each other. The parent owns the final integrated judgment.

## 1. Pin the fixed point

Use the fixed point supplied by the user. Otherwise infer it from repository evidence:

1. current pull request base;
2. configured upstream;
3. remote default branch;
4. `origin/develop`, then `origin/main`, then `origin/master`, when exactly one is sensible.

Ask only when the evidence leaves materially different comparisons. Confirm the ref resolves and the three-dot diff is non-empty before starting review lanes.

## 2. Identify sources

Find the spec from issue references, a user-supplied path, or matching files under `docs/`, `specs/`, or `.scratch/`. Follow `docs/agents/issue-tracker.md` when external tracker data is required. If there is no spec, skip that lane and say so.

Find applicable `AGENTS.md`, `CONTRIBUTING.md`, coding standards, domain docs, and validation rules. Repo rules override generic heuristics.

The Standards lane may flag these only as judgment calls when repo policy does not endorse them:

- mysterious names;
- duplicated code;
- feature envy;
- data clumps;
- primitive obsession;
- repeated switches;
- shotgun surgery;
- divergent change;
- speculative generality;
- message chains;
- middle men;
- refused bequests.

Skip anything deterministic tooling already enforces unless the tool is absent or its result is failing.

## 3. Run two blind lanes

Inside a Git repository, load `coding-orchestration`. Use its installed `reviewer` role through the active harness when independent delegation materially improves the review. Do not hardcode a generic agent type or harness tool name.

Give each lane only the fixed diff packet, commit list, and its own sources. Do not give either lane the other report.

Standards brief:

> Cite actionable correctness, regression, security, maintainability, or documented-standard problems by tight file and line. Distinguish hard violations from smell judgments. Omit style-only findings already enforced by tooling. Return under 400 words.

Spec brief:

> Cite missing or partial requirements, scope creep, and incorrectly implemented requested behavior by tight file and line plus the supporting spec text. Return under 400 words.

If delegation is not useful or unavailable, run the passes sequentially with separate evidence notes.

## 4. Integrate and verify

The parent must:

1. Validate each candidate against the actual diff and source.
2. Merge duplicates and resolve contradictions while retaining the producing axis.
3. Rank findings by user impact and regression risk.
4. Put actionable findings first with tight file and line references.
5. Inspect the real command, log, route, or runtime behavior behind any material green-check claim.
6. End with a short Standards/Spec status and residual verification gaps.

Do not edit product code unless the user asked to address findings. If nothing actionable remains, say so plainly.
