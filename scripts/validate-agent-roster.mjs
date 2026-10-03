import { agentRoster, agentRosterPath, validateAgentRoster } from "../src/agent-roster.mjs";
import { readFileSync } from "node:fs";
import { checkRolePolicyOutputs, codexRoleProfile } from "../src/role-policy.mjs";

const validation = validateAgentRoster(agentRoster);
if (agentRoster.hostProfiles) {
  const generated = checkRolePolicyOutputs();
  validation.errors.push(...generated.errors);
  validation.valid = validation.valid && generated.valid;
  // The published predecessor is immutable: every shipped native role must
  // still resolve even if a new preferred mixed-provider profile is added.
  const predecessor = JSON.parse(readFileSync(new URL('../manifests/1.40.0.json', import.meta.url), 'utf8'));
  for (const artifact of predecessor.artifacts) {
    if (!artifact.logicalName.startsWith('codex-agent-')) continue;
    try {
      codexRoleProfile(artifact.logicalName.slice('codex-agent-'.length));
    } catch (error) {
      validation.errors.push(error instanceof Error ? error.message : String(error));
      validation.valid = false;
    }
  }
}
if (!validation.valid) {
  process.stderr.write(`${validation.errors.join("\n")}\n`);
  process.exitCode = 1;
} else {
  const routes = /** @type {Array<{candidates: unknown[]}>} */ (agentRoster.routes);
  const candidates = routes.reduce((total, route) => total + route.candidates.length, 0);
  process.stdout.write(`Agent roster OK: ${routes.length} routes, ${candidates} candidates (${agentRosterPath.pathname})\n`);
}
