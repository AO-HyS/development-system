#!/usr/bin/env node
// @ts-check
import { homedir } from "node:os";
import { isAbsolute } from "node:path";

/** This file intentionally has no static runtime imports: even a broken install
 * must return the host's supported denial shape before the 15-second deadline. */
let eventName = "PreToolUse";
let complete = false;
/** @param {unknown} result */
function finish(result) {
  if (complete) return;
  complete = true;
  process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(0));
}
function failed() {
  if (eventName === "PreToolUse") finish({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Governance hook failed or exceeded its internal deadline; the action is denied." } });
  else if (eventName === "Stop") finish({ decision: "block", reason: "Governance hook failed; this run requires recovery." });
  else finish({}); // Interrupt cannot be prevented or restarted by a hook.
}
const deadline = setTimeout(failed, 7500);
process.on("uncaughtException", failed);
process.on("unhandledRejection", failed);
try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--home" || !isAbsolute(args[1]))) throw new Error("invalid arguments");
  const home = args[1] ?? homedir();
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (Buffer.byteLength(input) > 2 * 1024 * 1024) throw new Error("event too large");
  }
  const event = JSON.parse(input);
  if (event && typeof event.hook_event_name === "string") eventName = event.hook_event_name;
  if (eventName === "Interrupt") { clearTimeout(deadline); setTimeout(failed, 2200); }
  const { handleHook } = await import("./hook.mjs");
  finish(await handleHook(event, { home }));
} catch { failed(); }
