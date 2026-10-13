# Upstream and local adaptation

Source: https://github.com/cursor/plugins/tree/9d76bcab133aefcccb16121d7be874e6aa823729/pstack/skills/architect
Author: Lauren Tan (Poteto). License: MIT; retained in LICENSE.
The exact fetched tree and file hashes are in upstream.json.

This is an AO adaptation, not an unchanged upstream copy. Keep the author's
workflow while honoring explicit user decisions: first confirmed incident,
existing orchestrator and proportional scope, no automated tests or evals,
retained authorization and real behavior verification. Cursor-specific runner
and invocation settings are replaced with supported host discovery and workflow.
No additional permission checkpoint is introduced for already authorized work.

For the approved weekly skill refresh, compare upstream against this pinned
snapshot, review the local adaptations, and ship changes through a new shared
package/catalog transaction. Never overwrite this published artifact or install
unreviewed upstream instructions directly over the adaptation. Catalog provenance
makes the skill discoverable to that refresh; this file does not create a schedule.
