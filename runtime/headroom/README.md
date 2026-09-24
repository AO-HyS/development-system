# Per-invocation Headroom transport

Use an explicit private JSON configuration. Example (replace all paths with the
current local paths):

```json
{
  "codexBinary": "/absolute/path/to/current/codex",
  "headroomBinary": "/Users/NAME/.development-system/private/tools/headroom-0.38.0/bin/headroom",
  "root": "/absolute/path/to/project",
  "codexHome": "/absolute/path/to/existing/CODEX_HOME",
  "runRoot": "/Users/NAME/.development-system/private/runs/headroom",
  "nativeBrowser": true
}
```

Invoke `node runtime/headroom/cli.mjs --config /private/config.json -- exec
...` for Codex CLI. For T3, set its documented `customBinaryPath` to an
executable shim that invokes `node runtime/headroom/cli.mjs --config
/private/config.json -- "$@"`. T3 supplies `app-server` in its arguments; the
shim forwards those arguments unchanged and does not append a second command.
The wrapper does not choose a model, effort, service tier,
role, sandbox mode, or approval mode. Caller-selected models must be from the
current Sol, Astra, or Luna GPT-6 family. App-server model changes after launch
remain the host's responsibility and need separate observation.

`--version` and `--help` go directly to the configured Codex binary. Other
invocations start a private loopback Headroom proxy, wait up to 180 seconds for
its health endpoint, and add only per-process Codex provider overrides. Proxy
logs and numeric before/after statistics stay in a fresh `runRoot` directory;
native Codex token usage and actual model identity require independent session
evidence. A healthy proxy and valid CUA launcher files do not prove transport
coverage or browser access. No browser policy or host guard is changed here.

When `nativeBrowser` is true, the helper checks the bundled ChatGPT CUA
launcher files and sets only the `node_repl` MCP command, args, and env for this
Codex process. An object with absolute `node`, `repl`, and `nodeRepl` paths may
be used when the bundled paths differ. Other MCP servers retain their config.

## Claude Code

`claude.mjs` applies the same proxy profile to Claude Code. Its private JSON
configuration needs absolute `claudeBinary`, `headroomBinary` and `runRoot`
paths. Invoke `node claude.mjs --config /private/config.json -- <claude
arguments>`, or point T3's Claude provider `binaryPath` at a shim whose last line
is `exec node .../claude.mjs --config ... -- "$@"`. The launcher keeps the
caller's working directory, account login, model and effort. It sets only
`ANTHROPIC_BASE_URL` (without `/v1`) and keeps MCP tool search enabled with
`ENABLE_TOOL_SEARCH`. It refuses to start when another base URL or a Bedrock,
Vertex or Foundry transport is configured. Version, help and management
subcommands (auth, mcp, plugin, doctor, update) skip the proxy. In a terminal,
Claude stays in the foreground process group so Ctrl-C interrupts the turn. Receipts follow the Codex launcher's format and
make no claim about observed model identity or savings.
