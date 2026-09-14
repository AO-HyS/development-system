# Execution contract

Pin one compact packet before dispatch:

1. Objective or ticket, including whether it is synthetic; exact root, branch
   or revision; and current unrelated changes to preserve.
2. Owned files or module surface and the writer; disjoint parallel surfaces
   only when their dependency order is explicit.
3. Mode: exact instructions with an ordered recipe, or outcome delegation with
   the observable result and constraints.
4. Expected behavior and observable values to record at the public interface.
5. Authorization source, permitted side effects and terminal endpoint.
6. Enumerated focused checks, required existing gates and evidence shape.
7. Stop conditions, known failures, retry condition and completion receipt.

Exact and outcome modes use this same contract. Exact mode reports the first
recipe mismatch. Outcome mode chooses an implementation but still runs every
listed mandatory check and returns its observable receipt. A packet never
authorizes publication,
promotion, provider substitution or a new workflow stage by implication.

For UI work, resolve the fixture identity, role, organization and entities once.
The neutral executor receives exact action inputs and values to record; the
parent retains private acceptance criteria and judges the receipt.
