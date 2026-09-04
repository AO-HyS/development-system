import { agentRoster, agentRosterPath, validateAgentRoster } from "../src/agent-roster.mjs";

const validation = validateAgentRoster(agentRoster);
if (!validation.valid) {
  process.stderr.write(`${validation.errors.join("\n")}\n`);
  process.exitCode = 1;
} else {
  const routes = /** @type {Array<{candidates: unknown[]}>} */ (agentRoster.routes);
  const candidates = routes.reduce((total, route) => total + route.candidates.length, 0);
  process.stdout.write(`Agent roster OK: ${routes.length} routes, ${candidates} candidates (${agentRosterPath.pathname})\n`);
}
