---
name: decisions
description: Surface only consequential decisions from the current work that remain genuinely uncertain. Manual-only; use when the user explicitly invokes $decisions or asks which choices are still questionable.
---

# Decisions

Review the current work and report only decisions that are both consequential and genuinely uncertain.

Do not include:

- settled choices with strong evidence;
- routine implementation details;
- alternatives already disproved by real verification or repository constraints;
- generic risks that are not decisions;
- hidden reasoning or chain-of-thought.

For each remaining item, state concisely:

1. the decision made;
2. why the available evidence is insufficient;
3. the strongest credible alternative;
4. the smallest real check, observation, or human choice that would resolve it;
5. whether the decision is easy or costly to reverse.

Order items by impact and reversibility. Return `No consequential uncertain decisions remain.` when that is the honest result. Keep the response short and in plain language. Do not create or edit an ADR, spec, ticket, or decision log unless the user separately authorizes that write.

## High bar for ADRs

Do not write an ADR for routine or easily reversible choices: AI makes updating code cheap, so routine ADRs rot within days. Write an ADR only when the decision is:

- **hard to reverse**, **surprising without context**, and involves a **real trade-off**; or
- **security or compliance** related.

Otherwise, the code plus its lint or type rule is the ADR.
