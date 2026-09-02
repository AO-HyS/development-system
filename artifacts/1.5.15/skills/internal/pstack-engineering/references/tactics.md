# Selected engineering tactics

This is an AO adaptation of selected ideas from Lauren Tan's PStack. It is
pinned for provenance to `cursor-plugins` commit
`82f1d4f49ba8f21e3315a89c97e82f7c02a48fba` and does not install the upstream
router.

| Tactic | Apply when | Evidence |
| --- | --- | --- |
| `architect` | boundaries or ownership are unclear | named modules and dependency direction |
| `how-and-why` | changing unfamiliar behavior | current mechanism and reason |
| `interrogate-assumptions` | requirements or invariants may be wrong | explicit confirmed or rejected assumptions |
| `fix-root-causes` | diagnosing a defect | reproduced cause and regression check |
| `subtract-before-add` | adding code or abstractions | reuse/deletion considered first |
| `type-discipline` | changing typed interfaces | no escape hatches; boundary types validated |
| `idempotence` | retries or operations can repeat | repeated execution is safe or guarded |
| `sequence-verifiable-units` | work has dependencies | each unit has focused acceptance |
| `build-the-lever` | repeated tool work dominates | small script with bounded interface |
| `prove-it-works` | completing a lane | observable evidence from the declared check |
| `guard-context` | repository or task is large | compact inputs and referenced artifacts |

Adaptation notice: upstream PStack is MIT licensed, copyright 2026 Lauren Tan.
See `NOTICE.md` in this skill directory. No upstream prose or router behavior
is incorporated by reference.

