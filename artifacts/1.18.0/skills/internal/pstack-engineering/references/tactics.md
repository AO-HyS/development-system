# Selected PStack 0.15.0 tactics

- Trace the concrete failure before editing. Inspect the smallest source that
  distinguishes competing explanations; stop research once it supports action.
- Keep decisions and exclusions in the handoff. Preserve them verbatim when
  resuming; update the record after a real decision changes.
- Keep shared mutable state under one owner. Separate independent targets when
  useful; a browser tab and its recording have one driver.
- Complete independently verifiable units. Preserve evidence from a stable
  unit rather than recertifying the entire program after each change.
- Exchange compact completion facts. Scripts track waiting and aggregation;
  the model handles decisions and exceptions.
- Subtract before extending: remove duplicate checks, wrappers and reports when
  they protect no distinct behavior. Preserve product guarantees.
- For visual parity, keep a trustworthy baseline. Pixel equality is meaningful
  only for an explicit parity request under controlled rendering; ordinary UI
  improvements do not loop until every pixel matches.

Not adopted: mandatory architecture tournaments, competing implementations for
ordinary edits, coordinator trees, fixed upstream model routing, autonomous
external authority or zero-diff loops. They would reintroduce observed overhead.

## Part 2: research and prototypes when they shorten delivery

Source: Lauren Tan, The Complete Guide to pstack Pt. 2 (2026-09-09),
https://x.com/poteto/status/2097732320606507506.

- Explain the concrete problem in plain language when misunderstanding would
  cause rework. Use code and relevant history to distinguish how from why.
- Describe the caller or user's intended experience before selecting internals.
- Load only the playbook needed for the current uncertainty. A small prototype
  should answer a named question, then be discarded or integrated deliberately.
- Explore multiple options when choosing between them could avoid expensive
  rework. Ordinary edits proceed directly; candidate tournaments are optional.
- Preserve decisions and useful evidence, retiring obsolete execution plans
  when they would mislead the next worker. Historical records remain traceable.

These are adaptations to our delivery goal, not a wholesale installation of
poteto-mode, a new coordinator or a claim that upstream model choices are fastest.
