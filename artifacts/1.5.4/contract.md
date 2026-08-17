# Development System Contract 1.5.4

Version 1.5.4 retains every guarantee and authorization boundary of 1.5.3. Published 1.5.0 through 1.5.3 bytes remain unchanged.

## Sequential Codex live evidence patch

- Execute the Codex version, catalog-discovery, and skill-influence observations sequentially.
- Never infer live influence from an exit-zero process that omitted its final agent message.
- Retry an exit-zero observation that omits its final message or required behavior signature at most once, and record whether that bounded recovery occurred.
- Preserve the independent timeout, bounded-output, sanitization, and failure classification of every observation.
- Require the Codex version observation itself to succeed; a failed or timed-out version check can never certify catalog or skill evidence.
- Keep the exact installed contract, catalog, source-commit, privacy, read-only, and state-invariant guarantees introduced by 1.5.3.
