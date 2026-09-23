# Execution contract

Pin one compact packet before dispatch. For direct work, keep the same fields
in the existing task record at the scale needed; no extra document is required.

1. Objective or ticket, whether synthetic, exact root and branch/revision,
   current dirty paths and unrelated work to preserve.
2. Owned paths, one writer, dependencies and settled decisions with only the
   references needed for this packet. Parallel surfaces must be disjoint.
3. Mode: **exact instructions by default**. List ordered actions or commands,
   their inputs and expected observations. For an outcome-delegation exception,
   record the specific open decision and why prescribing a recipe is premature;
   constrain that decision and keep all other fields and mandatory checks.
4. Expected public behavior and acceptance criteria. Distinguish the observable
   values a neutral executor records from the parent's private acceptance rubric.
5. Authorization source, permitted side effects, restrictions and endpoint.
6. Enumerated focused checks and required existing gates, each with expected
   result and evidence location. Record candidate revision plus relevant dirty
   content/inputs so a receipt can be matched to the candidate actually checked.
7. Stop conditions, first mismatch to report, bounded retry condition and next
   checkpoint. A mismatch stops dependent actions; independent authorized work
   can continue. Retry only after a named prerequisite changes.
8. Completion receipt: changed paths, actual commands/actions and exit status,
   observed values, passed/failed/pending checks, evidence pointers, actual
   runtime model/tool identity when observable, unresolved gaps and next action.
   Mark unavailable identity evidence as unknown; a requested profile is not
   proof of the resolved model. Editing completion does not establish acceptance.

## Size the packet to capability

Keep the same behavior, checks and authorization for every model. Where a worker
cannot reliably carry the whole sequence, split at an observable checkpoint,
resolve choices before dispatch, provide a concrete example, and issue the next
small packet after assessing its receipt. Use the same approach when the parent
model has limited capability. Examples illustrate inputs and receipt shape;
they do not replace a repository's canonical implementation or test oracle.

For example: inspect the named handler and report the current transition; then
change the owned handler following the settled decision; then run the named
behavior check and record the observed transition. If the first observation
contradicts the packet, return that mismatch before editing dependent behavior.

Keep correction packets limited to the finding, affected paths, expected
behavior and affected checks. Reuse still-applicable evidence rather than
repeating discovery or every passing check. Model-agnostic means the same
acceptance standard, not a guarantee that every available model can satisfy it.

A packet never implies publication, promotion, provider substitution or a new
workflow stage. A missing capability or failed check remains an explicit gap.
For model changes, quota interruption or ownership transfer, use
[execution continuity](execution-continuity.md).

For UI work, resolve fixture identity, role, organization and entities once.
The neutral executor receives exact action inputs and values to record; the
parent retains private acceptance criteria and judges the receipt.
