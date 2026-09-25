import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

const DEFAULT_PATHS = Object.freeze({
  node: '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node',
  repl: '/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/cua-repl/bin/cua-repl.mjs',
  nodeRepl: '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl',
});

/** Per-invocation Codex config overrides. This does not establish browser readiness. */
/** @param {{ node: string, repl: string, nodeRepl: string }} [paths] */
export async function nativeBrowserOverrides(paths = DEFAULT_PATHS) {
  for (const name of /** @type {const} */ (['node', 'repl', 'nodeRepl'])) {
    if (typeof paths[name] !== 'string' || !paths[name].startsWith('/')) {
      throw new Error(`nativeBrowser.${name} must be an absolute path`);
    }
    await access(paths[name], name === 'repl' ? constants.R_OK : constants.X_OK);
  }
  return [
    '-c', `mcp_servers.node_repl.command=${JSON.stringify(paths.node)}`,
    '-c', `mcp_servers.node_repl.args=${JSON.stringify([paths.repl])}`,
    '-c', 'mcp_servers.node_repl.env.CUA_REPL_ENABLED_SURFACES="browser,computer"',
    '-c', `mcp_servers.node_repl.env.CUA_REPL_NODE_REPL_PATH=${JSON.stringify(paths.nodeRepl)}`,
  ];
}
