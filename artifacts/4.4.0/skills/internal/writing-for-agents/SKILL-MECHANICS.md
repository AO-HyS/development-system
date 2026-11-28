# Skill mechanics

Read this branch of [writing-for-agents](SKILL.md) when authoring or editing a
skill. Keep the workflow's useful decisions; remove accumulated prompting that
no longer changes the result.

## Discovery and invocation

Keep the description short and specific about the requested operation. Put the
trigger first; capability lists and broad topic matches can attract unrelated
tasks and become truncated in large catalogs. A database migration skill applies
to creating or reviewing migrations, not every query.

Preserve automatic discovery unless the user requests an explicit-only skill.
Use the host's actual mechanism: Codex uses `policy.allow_implicit_invocation`
in `agents/openai.yaml`; other hosts can differ. Do not transplant another
host's frontmatter flags or assume a successful copy proves discovery. Preserve
existing UI, policy, tool and dependency metadata during edits. Consult the
installed `skill-creator` and current host documentation when changing invocation
settings; leave them unchanged for a content-only edit.

## Load guidance when needed

Keep a short self-contained skill inline. For substantial distinct workflows,
put their detail in references and identify exactly when to read each. A router
loads one relevant branch, not every linked skill. Shared instructions have one
authoritative owner. Support data and example prompts do not belong in every
worker's context. Reuse settled decisions and source pointers on continuation.

For AGENTS.md, keep the rules needed across repository tasks there. Route service
boundaries to architecture docs, schema work to data docs and deployment to release
docs. Do not require a full repository map before an unrelated small edit.

## Guide the result

Write executable steps with observable completion criteria. For development
execution, use the shared
[exact-default protocol](../coding-orchestration/references/execution-contract.md)
for ordered packets, capability adaptation, exception handling and receipts.
Keep that protocol in its authoritative owner; other skills provide their
operation-specific actions and concise pointers. Make fewer assumptions about
model inference by resolving decisions and adding examples where needed.
Preserve model/provider choice and require evidence of actual capabilities.

Define completion so implementation, relevant verification and corrections
continue through the authorized endpoint. A first draft does not require a new
approval unless the user actually requested that checkpoint. Reference material
and open research questions can remain references; an ordered workflow need not
invent an implementation before its prerequisites are known.

Validate changed frontmatter and references, then use a few representative
positive and negative requests for a substantial routing change. Check both
successful activation and unrelated tasks staying out of the workflow. Separate
static validation, observed skill discovery and behavior; report only what was
observed. An entire development benchmark is not required for a wording change.

Provenance, when revisiting these decisions: OpenAI's
[Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)
and [Build skills](https://developers.openai.com/codex/skills/).
Ordinary authoring uses this distilled guidance without fetching the article.
