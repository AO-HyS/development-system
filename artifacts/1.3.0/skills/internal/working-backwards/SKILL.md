---
name: working-backwards
description: Define a software feature progressively from its future customer experience through research, product and technical contracts, vertical tickets, and a private T3 handoff. Use when the user asks to start with the customer story, Amazon-style Working Backwards, PRFAQ, product definition before coding, or a HumanLayer planning task that should create and review one document at a time.
---

# Working Backwards

Begin with the finished customer experience. Accept a short natural-language idea; never ask the user to manufacture a structured mega-prompt.

## Run progressively

Create or revise exactly one artifact at a time. Ask one high-leverage question per message, write every settled answer into the active artifact, and keep the user on that document until they clearly approve it. A request such as `quiero hacer X; empecemos con la historia del usuario` starts the first phase without another setup interview.

Use this order:

1. `customer-story`: future press release/customer story, actor, current pain, promised outcome, first-value journey, external FAQ, internal FAQ, boundaries, and unsupported claims.
2. `research-questions`: only questions about current code, behavior, users, or external facts that could change the product decision.
3. `research-report`: answers from live code/runtime and primary sources; separate facts, inferences, and unknowns.
4. `product-contract`: observable behavior, scope, success, states, permissions, errors, recovery, compatibility, and rejected product options.
5. `technical-contract`: entities, invariants, interfaces, reads, writes, events, migrations, security, rollback, test seams, and rejected technical options.
6. `implementation-map`: narrow vertical tickets with outcomes, acceptance criteria, checks, dependencies, and one truthful executable frontier.
7. `t3-handoff`: compact private handoff bound to the approved artifacts and exact first slice; set `implementationAuthorized: false`.

Default to Standard. Use Quick only for settled, narrow, reversible behavior on one surface. Use Complex for invariants, authorization, sensitive data, destructive behavior, migration/backfill, paid activation, uncertain providers, multiple repositories, or difficult rollback.

## Use HumanLayer as the surface

In a HumanLayer task, use **Freeform** as the carrier because HumanLayer exposes no custom-workflow registry. Resolve the task artifact directory supplied by HumanLayer; otherwise use `.humanlayer/tasks/<task-slug>/` in the repository. Create numbered Markdown files using the next free `NN-` prefix and these stems:

`customer-story`, `research-questions`, `research`, `product-contract`, `technical-contract`, `implementation-map`, `t3-handoff`.

The first six artifacts live in `.humanlayer/tasks/<task-slug>/`. The T3 handoff never does: write it only to the `privateHandoffPath` returned by the helper. Every HumanLayer artifact starts with:

```yaml
---
working_backwards_role: <role>
working_backwards_status: draft
---
```

The `implementation-map` frontmatter also includes `working_backwards_first_slice: <ticket-id>`. It must name an actual ticket in that document whose dependencies are satisfied and whose acceptance path is executable. The helper refuses the implementation gate without it.

Before acting, resolve the normalized Git remote and exact `git rev-parse HEAD`, then run `scripts/humanlayer-workflow.mjs status` relative to this skill. Pass that repository evidence on every status and turn so revision drift returns to the affected gate:

```text
node <skill-dir>/scripts/humanlayer-workflow.mjs status --task-dir <absolute-task-dir> --repository-identity <remote> --repository-revision <revision>
```

Its `currentPhase` and `action` are authoritative. On a live user reply at `review-artifact`, run `turn` with the entire reply:

```text
node <skill-dir>/scripts/humanlayer-workflow.mjs turn --task-dir <absolute-task-dir> --message <entire-user-message> --repository-identity <remote> --repository-revision <revision>
```

Only `approval.accepted: true` advances. Natural confirmations such as `Apruebo, sigue`, `Se ve bien, continúa`, `Todo correcto, avanza`, and `Looks good, go ahead` are clear approvals at an active checkpoint. Feedback revises the same file. After advancing, create only the next artifact and continue the interview.

At `create-private-handoff`, write the final handoff to `privateHandoffPath`, report the private path in HumanLayer, and never copy its contents into the task. The handoff must start with this exact binding frontmatter, populated from the current helper result and the three returned gate receipts:

```yaml
---
working_backwards_role: t3-handoff
working_backwards_status: draft
workflow_id: <workflowId>
gate_receipt_path: <gateReceiptPath>
repository_identity: <normalized repository identity>
repository_revision: <exact revision>
product_receipt_hash: <product receiptHash>
technical_receipt_hash: <technical receiptHash>
implementation_map_receipt_hash: <implementationMap receiptHash>
implementation_map_hash: <implementationMap ticketMapHash>
first_slice: <exact first vertical ticket id>
implementationAuthorized: false
requiresImplementPreview: true
---
```

Then include the objective, exact first slice, acceptance checks, dependencies, risks, and remaining gates. Run `status` again: only `action: handoff-ready` proves that the private handoff is bound to the approved repository revision, map, and receipts. `privateHandoffInvalid: true` means revise the same private file. HumanLayer comments and task status are feedback; only a clear live reply at the active checkpoint can approve.

## Preserve gates and authority

Document approvals advance the first three artifacts. Hold exactly three formal definition gates:

- `product-contract` → `approve-product-contract`
- `technical-contract` → `approve-technical-contract`
- `implementation-map` → `approve-implementation-map`

The helper executes the exact canonical gate operation and persists canonical hash-bound receipts at `gateReceiptPath` under `~/.development-system/private/working-backwards/<task-and-repository-id>/`. Drift returns to the earliest changed artifact and invalidates its descendants. Negated, combined, quoted, historical, or ambiguous approval language never advances.

Stop on contradictory artifacts, missing evidence, unsafe visibility, or stale inputs. Keep the T3 handoff private. Do not implement, publish tickets, commit, push, open a PR, merge, release, deploy, spend money, or perform destructive operations from this definition workflow; each retains its normal exact authorization boundary.
