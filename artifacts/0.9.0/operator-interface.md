# Operator interface 0.9.0

Ordinary software requests remain direct and proportional. A tiny change uses
the fast path and aims to show the requested behavior within five minutes. The
operator may explicitly request a full suite, but no generic implementation,
review, preview, or release instruction implies it.

The operator explicitly triggers Wayfinder, grilling, specs, tickets,
prototypes, multiple work, broad suites, and promotion. The system does not
choose those flows from task size.

Multiple-ticket worktrees are opt-in through `$work-multiple` or equally clear
natural language:

- "Trabaja múltiples tickets."
- "Usa modo múltiple para estos tickets."
- "Ejecuta estos tickets en paralelo."

The request authorizes planning and execution only as far as the surrounding
delivery request already allows. It does not authorize publication or
promotion.

Provide tickets to the skill with this information:

```json
{
  "request": "Trabaja múltiples tickets",
  "harness": "codex",
  "changeClass": "tiny",
  "manualQa": {
    "decision": "required",
    "reason": "The appointment interaction changed."
  },
  "tickets": [
    {
      "id": "AOH-1",
      "surfaces": ["appointments"],
      "acceptanceCriterion": "The saved appointment appears in the calendar"
    },
    {
      "id": "AOH-2",
      "surfaces": ["appointments", "calendar"],
      "blockedBy": ["AOH-1"],
      "acceptanceCriterion": "The calendar shows the updated appointment"
    },
    {
      "id": "AOH-3",
      "surfaces": ["admin-catalog"],
      "acceptanceCriterion": "The admin can save the catalog item"
    }
  ]
}
```

The skill identifies sequential and parallel lanes, worktree ownership, the
acceptance verification policy, and selected model routes. Execution must
replace each selected route with a runtime receipt proving the actual model
used. A missing explicit request, acceptance criterion, unknown blocker,
dependency cycle, unbounded full-suite request, empty acceptance evidence, or
unresolved runtime model fails closed.

Execution stays inside the active Codex or Factory orchestration adapter.
Before starting writers, the harness must return one distinct registered Git
worktree receipt per lane. Each delegated result must bind its worker and model
to harness runtime metadata (session and event), not echo plan intent.
Acceptance must return one evidence entry per ticket containing the exact
criterion, what it proves, and what was observed. Integration and review remain
inside the authorized implementation; PR, merge, release, and production are
not implied.
