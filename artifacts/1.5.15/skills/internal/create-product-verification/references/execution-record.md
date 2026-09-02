# Neutral execution record

The executor may return:

```json
{
  "executionStatus": "complete",
  "lastCompletedStep": "submit-form",
  "actions": [],
  "observations": [],
  "screenshots": [],
  "video": "host-created-private-path-or-null",
  "runtimeErrors": [],
  "unexpectedStates": []
}
```

`executionStatus` is limited to `complete` or `incomplete`. The record must
not contain `verdict`, `pass`, `fail`, `blocked`, `inconclusive`, or a claim
about side-effect correctness. The runner does not write the repository or
workspace; it may return only host-created paths under
`$HOME/.development-system/private/verification/<run-id>`. The orchestrator
adds the acceptance judgment after deterministic before/after probes and
rubric comparison.
