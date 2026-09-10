# ADR 0031: Keep session-selected orchestration and lane family boundaries

Status: accepted for release 1.17.0 preparation, September 10, 2026. The
full host orchestration experiment remains unrun; this release makes no claim
of certified SWE, OpenCode or Devin adapters.

The rápido → bien → barato objective remains the governing priority: deliver the
complete usable result quickly, correct it with focused evidence, then reduce
cost. The model selected when the conversation starts remains the orchestrator.
The parent chooses agents and roles; the editable roster and native Codex TOMLs
provide requested defaults, not runtime evidence, without replacing the parent
or enforcing a provider chain. Actual model and tool identity is verified at
dispatch.

The SWE-2 experiment is a strict family lane. Every descendant, including an
independent critic or browser role when the family provides that capability,
stays in the SWE family. Codex and Go are not fallback providers for that lane.
DeepSeek/OpenCode may use available models, and a Codex parent may choose
available GPT/Go tools. Each role keeps its actual host capabilities and
permission boundaries.

Design, visual review and Computer Use are assigned only to roles with the real
vision or browser capability required by the task. If the selected family lacks
that capability, the system reports the gap rather than silently substituting a
different family. General defaults may recommend Astra for visual work, but an
explicit lane family takes precedence. Independent visual critique remains
resolved before final walkthrough evidence, with selected real references kept
retrievable through the existing design handoff.

Release 1.17.0 publishes the eight portable internal skills and global Codex
instructions under new immutable artifact paths. `drive-development-flow` and
`coding-orchestration` retain their `.codex` variants and add explicit `.agents`
mirrors with `expectedMirrorOf` relationships. Copying files establishes source
presence and hashes only; it does not establish harness discovery, loading,
behavioral influence or runtime certification.

No new coordinator, tracker, approval gate or browser bridge is introduced.
Bounded packets retain state invariants, resume state, ownership, selected visual
references and focused checks. Broad checks are repeated only for a relevant
change, failure or unresolved risk. Published earlier artifacts remain
immutable rollback targets.
