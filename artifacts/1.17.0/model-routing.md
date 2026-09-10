# Model routing operator contract (1.17.0)

**The model selected when the conversation starts remains the orchestrator.**
The parent chooses agents and effort from available native capabilities. The
roster and Codex role TOMLs contain recommendations/requested defaults; they do
not prove a served model or force a provider chain. No extra coordinator is added.

Edit `config/agent-roster.json` for suggestions, then publish a new snapshot.
The preliminary [local worker screen](https://github.com/AO-HyS/development-system/blob/v1.17.0/docs/model-screen-2026-09-10.md) favors trying
Terra Low or Sol Low priority for bounded Codex implementation, and GLM High
for OpenCode. These are single-sample suggestions, not universal specialist
rankings. Existing named profiles remain usable; a parent can explicitly select
an available model through generic native delegation when a fixed profile does
not match its task. A profile's old default never replaces the starting parent.

Codex and OpenCode remain ordinary supported routes. Devin is explicitly enabled
for the user's SWE-2 experiment, not restored as an automatic fallback. Factory
and Droid remain retired. Every descendant of that SWE lane stays SWE, including
critics/browser roles when capable. Missing capability is reported, not silently
filled by Codex or Go. T3 uses the model and tools of its selected underlying
provider; file installation alone does not certify provider capabilities.

`model-route` and `orchestration-plan` are optional pure proposals. They neither
dispatch agents nor change the current conversation. When asking `model-route`
for suggestions, pass a roster compatible with the chosen session/family. The
resolver reads an input roster, then an explicit version snapshot, otherwise
the executing package's config. It does not automatically reload a HOME copy.
Do not mistake a computed default or a copied skill for observed host behavior.

Native TOML profiles are installed artifacts; already-running agents do not
change when files change. Verify actual runtime identity/capabilities when the
host exposes them, otherwise report requested settings and unknown observations.
Fast means priority service tier; Max is reasoning effort. A request for priority
is not a billing receipt or evidence it was honored.

Use direct tools for deterministic work. Send compact packets with root, owned
files, behavior and focused checks to useful workers. They execute the packet
without reopening lifecycle discovery. Keep one writer per surface and native
attached cancellation. Preserve useful work and typed failure evidence. Record
interrupted setup attempts separately from implementation results.

Design, visual critique and Computer Use require actual vision/browser capability
within the selected family. Independent visual critique follows Impeccable and
precedes final walkthrough recording. Existing product architecture, state/data
invariants and relevant quality gates remain. Selection grants no new authority.
