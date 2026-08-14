# Development System Contract 1.5.1

Version 1.5.1 retains every contract, authorization boundary, workflow, Reader, quality, observability, release, Check-in, Linear hygiene, and Development Steward guarantee of 1.5.0. Published 1.5.0 bytes remain unchanged.

## Development Steward launchd runtime patch

- Launch the Codex JavaScript entrypoint through the exact absolute Node executable recorded by the managed scheduler instead of depending on the minimal `launchd` PATH.
- Persist and hash-bind the Node executable path alongside Codex, the deterministic Steward core, and the Check-in core.
- Keep the scheduled process shell-free, ephemeral, read-only, fail-closed, and unable to replace the last complete report when collection or validation fails.
