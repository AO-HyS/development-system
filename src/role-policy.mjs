// @ts-check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { agentRoster } from './agent-roster.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const profiles = agentRoster.hostProfiles;

/** @param {'codex'|'claude'} host */
export function renderHostInstructions(host) {
  const instructions = profiles.instructions[host];
  if (!instructions) throw new Error(`Unknown host: ${host}`);
  return instructions;
}

/** @param {string} agentName */
export function codexRoleProfile(agentName) {
  const normalized = agentName.replaceAll('_', '-');
  const role = profiles.codex.roles[normalized];
  if (!role) throw new Error(`Unknown Codex role: ${agentName}`);
  return Object.freeze({ ...role });
}

/** @returns {Record<string, string>} */
export function renderRolePolicyOutputs() {
  /** @type {Record<string, string>} */
  const outputs = {
    'claude/orchestration/policy.json': `${JSON.stringify(profiles.claude.policy, null, 2)}\n`,
    'claude/rules/orchestration.md': `# Claude Code orchestration (generated from config/agent-roster.json)\n\n${renderHostInstructions('claude')}`,
  };
  for (const [name, template] of Object.entries(profiles.claude.agents)) {
    if (!/^[A-Za-z][A-Za-z-]*$/.test(name)) throw new Error(`Invalid Claude role name: ${name}`);
    outputs[`claude/agents/${name}.md`] = template;
  }
  return outputs;
}

/** @param {string} [directory] */
export function checkRolePolicyOutputs(directory = root) {
  const errors = [];
  for (const [relative, expected] of Object.entries(renderRolePolicyOutputs())) {
    try {
      if (readFileSync(path.join(directory, relative), 'utf8') !== expected) errors.push(`Generated role policy drift: ${relative}`);
    } catch {
      errors.push(`Generated role policy missing: ${relative}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
