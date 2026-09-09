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
