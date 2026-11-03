// @ts-check
// Argument parsing for `development-system evidence record` (moved out of cli.mjs in 2.10.0 to keep it within its size budget).
import { homedir } from "node:os";

export const EVIDENCE_USAGE = "--pr <ref> --verified-sha <sha> (--deployed-sha <sha> --environment <url> --tool quicke2e --run <run.json>|computer-use --reason <why>|simulator --allowed pass|fail --denied pass|fail --effects pass|fail | --exception nonvisual --reason <text> --checks <text> | --owner-waiver <owner's exact words>) [--platforms ios,android,web] [--account <a>] [--role <r>] [--capture <path>]... [--home <dir>] [--json]";

/** @param {string[]} argv */
export function parseEvidenceArguments(argv) {
  const [, subcommand, ...tokens] = argv;
  if (subcommand !== "record") throw new Error(`Usage: development-system evidence record ${EVIDENCE_USAGE}`);
  /** @type {{home: string, json: boolean, captures: string[], [key: string]: unknown}} */
  const options = { home: homedir(), json: false, captures: [] };
  /** @type {Record<string, string>} */
  const valueFlags = { "--home": "home", "--pr": "pr", "--verified-sha": "verifiedSha", "--deployed-sha": "deployedSha", "--environment": "environment", "--account": "account", "--role": "role", "--allowed": "allowed", "--denied": "denied", "--effects": "effects", "--exception": "exception", "--reason": "reason", "--checks": "checks", "--owner-waiver": "ownerWaiver", "--platforms": "platforms", "--tool": "tool", "--run": "run" };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") { options.json = true; continue; }
    const value = tokens[index + 1];
    if (token === "--capture") {
      if (value === undefined || value.startsWith("--")) throw new Error("Missing value for --capture");
      options.captures.push(value); index += 1; continue;
    }
    const key = valueFlags[token];
    if (!key) throw new Error(`Unknown option for evidence record: ${token}`);
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    options[key] = value;
    index += 1;
  }
  return /** @type {{home: string, json: boolean, captures: string[], pr?: string, verifiedSha?: string, deployedSha?: string, environment?: string, account?: string, role?: string, allowed?: string, denied?: string, effects?: string, exception?: string, reason?: string, checks?: string, ownerWaiver?: string, platforms?: string, tool?: string, run?: string}} */ (options);
}
