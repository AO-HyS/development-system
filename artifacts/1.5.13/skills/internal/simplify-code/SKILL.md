---
name: simplify-code
description: Review an existing diff for safe deletion, reuse, native, standard-library, or installed-dependency alternatives. Explicit invocation or deterministic-plan selection only; read-only by default.
---

# Simplify Code

Review the existing diff after implementation and before the independent
correctness review. This is a narrow, read-only lens for reducing unnecessary
code and abstractions.

## Order of inspection

1. Does the requested behavior need the new code to exist?
2. Can existing repository code be reused without weakening a boundary?
3. Can the standard library or the platform provide the behavior?
4. Can an already-installed dependency provide it?
5. What is the smallest clear implementation that preserves the contract?

Recommend deletion or simplification only when the evidence shows that the
behavior, architecture, security, accessibility, observability, performance,
and test contract remain intact. Prefer clear deep modules and local
ownership over an artificially small file count or compressed one-liners.

Never remove trust-boundary validation, authorization, error handling that
prevents data loss, required tests, telemetry, product behavior, or explicit
repository rules. Do not add dependencies, edit files, or turn raw line count
into a quality gate.

## Output

Return only evidence-backed findings:

- `keep`: code that is justified by the requested behavior or a protected boundary;
- `simplify`: a concrete safe deletion or reuse opportunity with affected paths;
- `uncertain`: a possible simplification that requires owner judgment.

State clearly when no safe simplification is found. This review does not
replace correctness, security, performance, visual, or accessibility review.
