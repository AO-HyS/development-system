# Upstream and local adaptation

Source: https://github.com/cursor/plugins/tree/c86f349b102feb91f1966f8a6a60882a4e601b50/pstack/skills/in-your-own-words
Author: Lauren Tan (Poteto). License: MIT; retained in LICENSE.
The exact fetched upstream tree and its original file hashes remain in
upstream.json; they describe provenance, not the adapted installed bytes.

Local adaptation in 2.4.2: SKILL.md explains the goal, problem, concrete approach
and verification, then ends the turn awaiting explicit user approval. Corrections
revise the proposal and retain that pause. Output follows the user's language.
The picker display name matches the canonical in-your-own-words identifier;
there is one logical skill with a declared Claude symlink mirror.

The routine brief restatement before autonomous work lives in the shared
instructions. It does not invoke this explicit review-and-wait skill.

Local adaptation in 2.10.0 (owner request of 2026-11-02): the explicit
invocation answers in three ordered parts: what was understood (the request
restated unchanged), how to improve it (the four questions of pstack `sharpen`,
cursor/plugins pstack/skills/sharpen, same author and license, with improvements
marked as suggestions), and the plan built on both. The review-and-wait pause is
unchanged.

Local adaptation in 2.11.0 (owner request of 2026-11-07): the proposal adds two
parts after the plan: when it is done (a short numbered list, each item an
action or command and the observation it must produce at the authorized
endpoint) and how it will be proven (real verification per item, what cannot be
proven, real effects). After approval that list is the goal: the agent checks
every item before saying it finished, keeps working while an item is open and
the work is authorized, stops early only for a named concrete blocker, never
loosens the list on its own, and reports each item as passed, failed or not
reached. The "define done, then drive to it without stopping" idea comes from
the pstack poteto-mode autonomous-run playbook (cursor/plugins
pstack/skills/poteto-mode/playbooks/autonomous-run.md, same author and license).
