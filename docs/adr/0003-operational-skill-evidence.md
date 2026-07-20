# ADR 0003: Skill presence is not runtime evidence

Status: Accepted

## Context

Codex and Factory discover skills through different roots and runtime adapters. The prior structural validator compared files and could report green while Factory emitted scanner errors from broken links. Codex could also shorten catalog descriptions without omitting skills. Treating these signals as one boolean hid both false positives and useful partial evidence.

## Decision

The Development System reports six monotonic observations independently: existence, discovery, catalog exposure, loadability, full load/activation, and behavioral influence.

- Canonical hashes and valid frontmatter prove loadability, not load.
- Runtime selection/read evidence proves load.
- A skill-specific behavior signature, absent from the prompt and present in the final response, proves influence for the probe contract.
- Catalog description shortening is a warning; only actual omission is overflow.
- Scanner errors and broken links fail catalog health even if another root still permits activation.
- Identical physical copies are declared mirrors of one logical skill.
- Divergent variants require the same named adapter behavior contract.

Operational evidence pins the catalog version, target HOME, installed folder hashes, executable path, runtime version, timestamp, command, exit status, and final response because installations and CLI behavior may drift. Catalog exposure is probed separately from activation.

## Consequences

Validation can explain how far a skill reached without claiming more than the evidence shows. Isolated tests prove structural behavior and explicitly remain invalid without live evidence; live probes launch the installed read-only harnesses. Cleanup mutates only manifest-declared paths and remains reversible through integrity-checked snapshots.
