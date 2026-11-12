// @ts-check

// Audit probe for the never-blocking orchestration coach of the Claude roster guard (2.14.0).
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

/**
 * Feeds the installed guard a parent stream under a fresh session: five Reads, then Bash reads such as
 * `cd src && rg -n foo . | head` (one read each) mixed with `ls src; cat package.json` (a list: neutral), so the
 * coach hint must arrive exactly with the tenth counted read and never before. Then ten Reads carrying an agent_id
 * under another fresh session must print nothing. The guard never executes the commands.
 * Returns findings; empty when the coach behaves.
 * @param {string} home
 * @param {string} guard the installed guard path
 */
export function probeCoach(home, guard) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, HOME: home };
  delete env.TYPESAFE_API_KEY;
  delete env.CLAUDE_ROSTER_GUARD;
  /** @param {string} session @param {string | undefined} agentId @param {string} [command] a Bash command instead of a Read */
  const read = (session, agentId, command) => {
    const input = JSON.stringify({ session_id: session, hook_event_name: "PreToolUse", tool_name: command ? "Bash" : "Read", cwd: home,
      ...(agentId ? { agent_id: agentId, agent_type: "code-mapper" } : {}),
      tool_input: command ? { command } : { file_path: `${home}/audit-coach-probe.txt` } });
    const result = spawnSync(process.execPath, [guard], { input, env, encoding: "utf8", timeout: 30000 });
    return { status: result.status, stdout: (result.stdout ?? "").trim() };
  };
  /** @param {string} stdout */
  const coachContext = (stdout) => {
    try { return String(JSON.parse(stdout)?.hookSpecificOutput?.additionalContext ?? "").startsWith("Orchestration coach:"); }
    catch { return false; }
  };
  /** @type {string[]} */
  const findings = [];
  const parentSession = `audit-coach-${randomUUID()}`;
  const search = "cd src && rg -n foo . | head";
  const list = "ls src; cat package.json";
  // [command or undefined for a Read, counted read number or 0 for neutral]
  /** @type {Array<[string | undefined, number]>} */
  const stream = [[undefined, 1], [undefined, 2], [undefined, 3], [undefined, 4], [undefined, 5], [list, 0],
    [search, 6], [search, 7], [search, 8], [search, 9], [list, 0], [search, 10]];
  for (const [index, [command, counted]] of stream.entries()) {
    const label = `parent ${command ? `Bash ${JSON.stringify(command)}` : "Read"} (call ${index + 1})`;
    const { status, stdout } = read(parentSession, undefined, command);
    if (status !== 0) { findings.push(`Coach probe: ${label} exited ${status}`); break; }
    if (counted === 10) {
      if (!coachContext(stdout)) findings.push("Coach probe: the tenth counted parent read did not print an Orchestration coach hint (installed guard predates the coach)");
    } else if (stdout !== "") { findings.push(`Coach probe: ${label} printed output before the tenth counted read`); break; }
  }
  const childSession = `audit-coach-${randomUUID()}`;
  for (let i = 1; i <= 10; i += 1) {
    const { status, stdout } = read(childSession, "audit-coach-agent");
    if (status !== 0 || stdout !== "") { findings.push(`Coach probe: subagent Read ${i} was not passed silently`); break; }
  }
  return findings;
}
