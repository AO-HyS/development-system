import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "bin/development-system.mjs");

test("CLI model-route loads a versioned roster and returns a pure selection", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "development-system-model-route-cli-"));
  const input = resolve(directory, "route.json");
  await writeFile(input, JSON.stringify({
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: [{ candidateId: "factory-fable-5.1", reason: "quota-exhausted" }],
  }), "utf8");
  const result = spawnSync(process.execPath, [cli, "model-route", "--version", "1.5.16", "--input", input, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.selected.harness, "devin");
  assert.equal(payload.selected.resolvedModel, null);
  assert.equal(payload.selected.resolvedModelStatus, "receipt-required");
  assert.equal(payload.authority.dispatchAuthorized, false);
  assert.equal(payload.attempts[0].reason, "quota-exhausted");
});

test("CLI reports the actual resolved model only from a matching receipt", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "development-system-model-route-cli-"));
  const input = resolve(directory, "route.json");
  await writeFile(input, JSON.stringify({
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: [{ candidateId: "factory-fable-5.1", observedModel: "claude-fable-5.1" }],
  }), "utf8");
  const result = spawnSync(process.execPath, [cli, "model-route", "--version", "1.5.16", "--input", input, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.selected.harness, "factory");
  assert.equal(payload.selected.resolvedModel, "claude-fable-5.1");
  assert.equal(payload.selected.resolvedModelStatus, "receipt-matched");
});

test("CLI rejects malformed --version before reading input", () => {
  const result = spawnSync(process.execPath, [cli, "model-route", "--version", "1.5", "--input", "missing.json", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /semantic versioning/);
});
