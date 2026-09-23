import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readProviderFailures, recordProviderFailure } from "../src/provider-availability.mjs";
import { resolveModelRoute } from "../src/model-routing.mjs";
import { agentRoster } from "../src/agent-roster.mjs";

test("a host quota failure blocks the sole Luna candidate without fallback until its expiry", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "ds-provider-"));
  const now = Date.parse("2026-09-04T22:00:00Z");
  const observation = { candidateId: "advisory-fast-execution", reason: "quota-exhausted", observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString(), evidenceRef: "private/provider-response.json" };
  try {
    assert.deepEqual(await readProviderFailures(home, now), []);
    await recordProviderFailure({ home, observation, now });
    const route = (unavailable) => resolveModelRoute({ roster: agentRoster, capability: "mechanical-execution", routeSlot: "fast-execution", unavailable });
    const blocked = route(await readProviderFailures(home, now));
    assert.equal(blocked.valid, false);
    assert.equal(blocked.selected, null);
    assert.match(blocked.errors.join("\n"), /all declared candidates are unavailable/);
    assert.deepEqual(blocked.attempts.map(({ candidateId, status, reason }) => ({ candidateId, status, reason })), [
      { candidateId: "advisory-fast-execution", status: "skipped", reason: "quota-exhausted" },
    ]);
    const restored = route(await readProviderFailures(home, now + 60000));
    assert.equal(restored.valid, true);
    assert.equal(restored.selected.model, "gpt-6-luna");
    assert.equal(restored.selected.harness, "codex");
    assert.equal(restored.selected.reasoning, "high");
    assert.deepEqual(restored.selected.serviceTier, { tier: "priority", label: "fast", status: "runtime-required" });
    assert.equal(restored.selected.resolvedModel, null);
    const before = await readFile(resolve(home, ".development-system/private/runtime/provider-availability.json"), "utf8");
    await assert.rejects(recordProviderFailure({ home, observation: { ...observation, reason: "maybe unavailable" }, now }), /Unsupported/);
    await assert.rejects(recordProviderFailure({ home, observation: { ...observation, expiresAt: new Date(now + 8 * 86400000).toISOString() }, now }), /bounded expiry/);
    assert.equal(await readFile(resolve(home, ".development-system/private/runtime/provider-availability.json"), "utf8"), before);
  } finally { await rm(home, { recursive: true, force: true }); }
});
