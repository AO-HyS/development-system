# Host execution

Code Mode means composing tool operations as code and summarizing results. It
can reduce model round trips; it is not inherently a different model, browser,
or grant of permissions. OpenCode V2 groups MCP tools through Code Mode:
https://opencode.ai/v2/docs/mcp-servers
Its interpreter executes a supported JavaScript subset through host tools;
it does not supply ambient filesystem/network authority. The primary source is
https://github.com/anomalyco/opencode/tree/dev/packages/codemode
Do not add an interpreter or persistent daemon where the host already composes
tools. The exact Dax social post remains unverified; this guidance comes from
the official implementation. No new runtime dependency is required.

Use the existing host code surface (Codex functions.exec or an authorized REPL)
when it actually exposes the needed tools. Tools visible to Codex do not become
available to a terminal script or OpenCode automatically. Use the repository's
approved Computer Use mechanism. Stop a batch at an unexpected state or origin.
Do not introduce a separate browser harness just to claim batching.

Keep the repository's existing execution-plan format and authority checks.
Code composition is an execution technique, not a second approval protocol.
A host must enforce redirect and click navigation boundaries before effects:
observing an escaped URL afterward cannot undo it. Opaque input references
stay in the authorized host; never put secrets into scripts or model output.

Use a read-only fixture to confirm the host tools compose correctly before
product writes. A real recording demonstrates that host only; it does not
establish another adapter, product acceptance or token savings. In T3, a
`functions.exec` batch can await the available `preview_recording_start`,
`preview_scroll` and `preview_recording_stop` tools, with stop in `finally`.
Keep the tab ID explicit and check each result for errors. If tooling is
unavailable, report the gap rather than adding another browser runtime.

A batch is one stable segment with observable preconditions. Selectors or
accessibility IDs come from a current observation. Read-heavy metadata work may
run concurrently; actions on the same tab and recording lifecycle serialize.
Abort closes recording and reports incomplete. Interrupted or uncertain writes
require observing state before any further action.

For Luna handoff: provide only root/revision, owned script/media paths, callable
host methods, authorized actions, expected evidence shape and stop conditions.
Astra retains private acceptance criteria. Request script creation or correction
once, then execute it without polling Luna for progress. Preserve original media;
derivatives and manifests remain private and name their source hashes.

For existing-media checks, use installed `ffprobe` for duration/codec/size and
`ffmpeg` for decoding or sampled contact sheets. Preserve the original, record
its SHA-256 and label derivatives. The critic judges the screenshots; media
inspection alone never certifies product behavior or design quality.
