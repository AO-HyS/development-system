# ADR 0033: Verification roles follow capabilities, not model names

Status: accepted for release 1.18.1, September 12, 2026.

The repository rollout exposed three remaining global guides that required
Astra, Luna or Sol even though the selected orchestrator policy is portable.
This patch updates the creation and maintenance of product verification and the
UI craft integration. Published 1.18.0 remains immutable.

The selected parent assigns a capable Computer Use runner and a capable judge
within the user's provider constraints. Neutral execution, private acceptance
rubrics, origin/action boundaries, observed model identity and independently
judged evidence remain explicit. An unavailable capability is reported rather
than silently replaced. Contract-only maintenance needs focused validation and
does not establish live product coverage or require a new recording.

Repository schemas and validators should encode these roles and preserve
provenance and permissions; a model brand is not evidence of browser capability.
This patch does not certify another provider, drive a UI, or claim token savings.
