# ADR 0034: Reuse the approved HTML grill as an answer surface

Status: accepted for release 1.19.0, September 12, 2026.

The operator prefers the HTML questionnaires already used for Barber dashboard
design and learning discovery. Recreating their markup in each thread wastes
time and produces inconsistent saving behavior.

Catalog 0.40.0 bundles that layout and client in `grill-with-docs`, with a small
Python standard-library renderer and server. Each round supplies a JSON with
questions. Submit saves literal answers in a private local JSON. The user tells
the agent in chat to read it and continue. Additional questions use another
input JSON and ID, reusing the same assets.

The existing browser drafts, partial answers, comments, deferred decisions,
one-at-a-time view and export/import controls are retained. Revision checks and
atomic writes protect submissions. One server owns a questionnaire; a tunnel
shares only its page and answer endpoint. Saved answers survive a restart, while
the temporary public URL changes. Synthetic validation uses an isolated HOME.

This adds no automatic brief rewriting, cross-thread session manager, polling
agent, or new definition gate. Design grills retain the existing design-direction
handoff, including accessible reference images in specs and tickets. Ordinary
implementation stays direct. The installed skill is provider-neutral; file
installation and discovery do not prove every model will follow it correctly.

Source paths and hashes for the reused Barber artifacts are recorded in
`artifacts/1.19.0/refresh-provenance.json`. No operator answers are distributed.
This release changes Development System only; it does not promote product code.
