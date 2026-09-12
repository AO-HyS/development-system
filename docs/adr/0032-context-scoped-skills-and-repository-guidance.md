# ADR 0032: Load skill context by the affected task

Status: accepted for release 1.18.0, September 12, 2026.

The global skill refresh alone did not fix repository guidance: normalization
still emitted a fixed Astra/Go chain, while local frontend wrappers required
several full guides on every edit. Reinstallation could also erase global edits
that were absent from the versioned source.

Publish the adapted skills in immutable artifact paths and catalog 0.39.0. Keep
short, precise discovery descriptions; move conditional details into references.
The selected conversation model owns orchestration and chooses capable agents
within the user's provider boundaries. Preserve an already selected execution
method rather than nesting coordinators. Continue until observable behavior,
checks and the authorized delivery endpoint are satisfied.

Repository adapters state the same policy. Their architecture, authorization,
provider readiness and release contracts remain explicit. The historical
executable anti-slop phase definitions apply to an explicitly requested internal
plan; ordinary work uses proportional responsibilities, not six compulsory
agent lanes. No planner engine or protected gate is bypassed by this change.

Product wrappers load only the relevant design, backend, email or deployment
references. Approved visual direction and source images remain accessible.
Impeccable 4.3.1 stays complete; independent visual critique and corrections
precede final evidence. Product domain rules and existing release trains remain
product-owned. Updating development guidance does not authorize promoting
unrelated product work queued on a release branch.

Sources: [OpenAI's skill guidance](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)
and [Impeccable 4.3.1](https://github.com/pbakaus/impeccable/releases/tag/skill-v4.3.1).
The source post and upstream snapshot metadata are retained in
`artifacts/1.18.0/refresh-provenance.json`. Local discovery measurements do not
establish production task speed, token savings or cross-host behavioral parity.

Verification covers normalization, preservation of unrelated files, immutable
catalog hashes, package provenance, isolated installation and rollback. Existing
product checks apply to the tooling-only diff; application UI acceptance is not
claimed for this guidance update.
