# Maintenance record

```yaml
outcome: clean | changed | blocked
feature: mapped feature identifier
sourceRevision: commit or working-tree fingerprint
run:
  route: exact origin and path
  identity: role or fixture
  steps: neutral execution-plan reference
  evidence: private screenshots/video/log paths
probes:
  before: deterministic capture
  after: deterministic capture
productFindings: []
changedFiles: []
blockers: []
```

`productFindings` are not verification-maintenance failures. Preserve them
for the product work queue without changing product code in this pass. The
`evidence` paths must be host-created files under
`$HOME/.development-system/private/verification/<run-id>`.
