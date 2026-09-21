import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGovernanceArguments, runGovernance } from "../runtime/jev-governance/cli.mjs";
import { GovernanceError, safeGovernanceError } from "../runtime/jev-governance/errors.mjs";
import { validateTransition, validateOutcome } from "../runtime/jev-governance/schemas.mjs";
import { isGovernanceControlCommand } from "../runtime/jev-governance/hook.mjs";

test("recovery help exposes usable complete transition and blocked-close inputs without session activation", async () => {
  for (const command of ["advance", "close"]) {
    const receipt = await runGovernance(["schema", command, "--json"]);
    assert.equal(receipt.code, 0);
    const example = receipt.result.commands[command].input;
    assert.ok(example.reason);
    assert.ok(example.boundaryId);
    assert.doesNotThrow(() => command === "advance" ? validateTransition(example) : validateOutcome(example));
  }
  assert.equal(parseGovernanceArguments(["--help"]).command, "help");
  assert.equal((await runGovernance(["help", "begin", "--json"])).result.commands.begin.input.requiredCapabilities.includes("shell"), true);
  const recovery = await runGovernance(["schema", "recover-host-attempt", "--json"]);
  assert.equal(recovery.code, 0);
  assert.deepEqual(Object.keys(recovery.result.commands['recover-host-attempt'].input).sort(), ['attemptId', 'reason']);
});

test("read-only recovery commands retain the exact control grammar without exempting execution", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "governance-help-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL("../runtime/jev-governance/cli.mjs", import.meta.url));
  for (const reference of ["help", "schema advance", "examples close"]) {
    const command = `node '${cli}' ${reference} --home '${home}' --json`;
    assert.equal(await isGovernanceControlCommand(command, { home }), true);
    assert.equal(await isGovernanceControlCommand(`${command}; true`, { home }), false);
  }
  assert.equal(await isGovernanceControlCommand(`node '${cli}' execute --home '${home}' --input-json '{}'`, { home }), false);
  assert.throws(() => parseGovernanceArguments(["recover", "--input-json", '{"reason":"obsolete intake"}']));
  assert.throws(() => parseGovernanceArguments(["recover-host-attempt", "--input-json", '{"attemptId":"capture","reason":"completed failed capture"}']));
  const recovery = `node '${cli}' recover-host-attempt --home '${home}' --run failed-run --input-json '{"attemptId":"capture","reason":"completed failed capture"}' --json`;
  assert.equal(await isGovernanceControlCommand(recovery, { home }), true);
  assert.equal(await isGovernanceControlCommand(`${recovery}; true`, { home }), false);
  assert.throws(() => parseGovernanceArguments(['recover-host-attempt', '--run', 'failed-run', '--input-json', '{}', '--force']));
});

test("safe errors retain actionable known causes but never echo provider text or unknown fields", () => {
  const secret = "fixture-provider-private-data";
  const receipt = safeGovernanceError(new GovernanceError(secret, "stale", { field: secret }), { operation: "advance" });
  assert.equal(receipt.error.code, "stale");
  assert.match(receipt.error.nextAction, /Reclassify/);
  assert.equal(JSON.stringify(receipt).includes(secret), false);
  assert.equal(safeGovernanceError(new Error(secret), { operation: "classify" }).error.code, "internal_error");
  const capability = safeGovernanceError(new GovernanceError(secret, "capability_missing", { field: "contract.requiredCapabilities", missingCapabilities: ["computer-use", secret] }), { operation: "begin" });
  assert.deepEqual(capability.error.missingCapabilities, ["computer-use"]);
  assert.equal(capability.error.field, "contract.requiredCapabilities");
});

test("invalid CLI arguments return a structured failure and leave diagnostics reachable", async () => {
  const failed = await runGovernance(["advance", "--input-json", "{}", "--input", "private-name.json", "--json"]);
  assert.equal(failed.code, 1);
  assert.equal(failed.result.ok, false);
  assert.equal(failed.result.error.code, "invalid_argument");
  assert.equal(failed.output.includes("private-name"), false);
  assert.equal((await runGovernance(["examples", "close", "--json"])).code, 0);
});

test("real incomplete transition and close schemas identify the missing reason", () => {
  for (const [validate, input, field] of [
    [validateTransition, { to: "research", boundaryId: "current" }, "transition.reason"],
    [validateOutcome, { status: "blocked", boundaryId: "current" }, "outcome.reason"],
  ]) {
    let receipt;
    try { validate(input); assert.fail("Missing reason must be rejected"); }
    catch (error) { receipt = safeGovernanceError(error, { operation: "advance" }); }
    assert.equal(receipt.error.code, "invalid");
    assert.equal(receipt.error.field, field);
    assert.match(receipt.error.nextAction, /schema/);
  }
});

test("the hook launcher accepts bounded image-sized PostToolUse envelopes", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "governance-image-envelope-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const launcher = fileURLToPath(new URL("../runtime/jev-governance/hook-launcher.mjs", import.meta.url));
  const input = JSON.stringify({ hook_event_name: "PostToolUse", session_id: "unbound-image-fixture", tool_name: "mcp__cua_repl__js", tool_response: { content: [{ type: "image", mimeType: "image/png", data: "A".repeat(3 * 1024 * 1024) }] } });
  const result = spawnSync(process.execPath, [launcher, "--home", home], { input, encoding: "utf8", timeout: 9000 });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {}, "The transport must not mislabel a bounded PostToolUse as an oversized PreToolUse denial");
  // Unbound fixture only: this proves envelope transport, not image validity,
  // a current host identity, stored evidence, or product acceptance.
});
