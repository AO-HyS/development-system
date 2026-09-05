import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { resolveModelRoute } from "../src/model-routing.mjs";

const root = resolve(import.meta.dirname, "..");
const roster = JSON.parse(await readFile(resolve(root, "config/1.5.16/capability-roster.json"), "utf8"));
const agentRoster = JSON.parse(await readFile(resolve(root, "config/agent-roster.json"), "utf8"));

test("adversarial review uses Fable xhigh by default and reports explicit evidence", () => {
  const result = resolveModelRoute({ roster, capability: "review", routeSlot: "adversarial-review" });
  assert.equal(result.valid, true);
  assert.equal(result.selected.harness, "factory");
  assert.equal(result.selected.requestedModel, "claude-fable-5.1");
  assert.equal(result.selected.resolvedModel, null);
  assert.equal(result.selected.resolvedModelStatus, "receipt-required");
  assert.equal(result.selected.reasoning, "xhigh");
  assert.equal(result.selected.evidenceStatus, "provisional");
  assert.equal(result.selected.mappingStatus, "mapped");
  assert.deepEqual(result.selected.invocation, {
    command: "droid",
    args: ["exec", "--model", "claude-fable-5.1", "--reasoning-effort", "xhigh"],
  });
  assert.equal(result.authority.dispatchAuthorized, false);
});

test("a matching observed-model receipt resolves the actual model exactly", () => {
  const result = resolveModelRoute({
    roster,
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: [{ candidateId: "factory-fable-5.1", observedModel: "claude-fable-5.1" }],
  });
  assert.equal(result.valid, true);
  assert.equal(result.selected.harness, "factory");
  assert.equal(result.selected.resolvedModel, "claude-fable-5.1");
  assert.equal(result.selected.resolvedModelStatus, "receipt-matched");
});

test("quota exhaustion crosses Factory to Devin to Codex and preserves trace", () => {
  const result = resolveModelRoute({
    roster,
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: [
      { candidateId: "factory-fable-5.1", reason: "quota-exhausted" },
      { candidateId: "devin-fable-5.1", reason: "quota-exhausted" },
    ],
  });
  assert.equal(result.valid, true);
  assert.equal(result.selected.harness, "codex");
  assert.equal(result.selected.resolvedModel, null);
  assert.equal(result.selected.resolvedModelStatus, "receipt-required");
  assert.equal(result.selected.reasoning, "xhigh");
  assert.deepEqual(result.fallbackTrace.map((entry) => entry.action), [
    "advance-to-declared-fallback",
    "advance-to-declared-fallback",
    "select-declared-route",
  ]);
  assert.equal(result.fallbackTrace[0].boundary, "provider:factory");
  assert.equal(result.fallbackTrace[1].boundary, "provider:devin");
});

test("Devin descriptors use exact current non-interactive model UIDs", () => {
  const fable = resolveModelRoute({
    roster,
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: [{ candidateId: "factory-fable-5.1", reason: "quota-exhausted" }],
  });
  assert.deepEqual(fable.selected.invocation, {
    command: "devin",
    args: ["--model", "claude-fable-5-1-xhigh", "--print"],
  });
  const gemini = resolveModelRoute({
    roster,
    capability: "mechanical-execution",
    routeSlot: "fast-execution",
    unavailable: [
      { candidateId: "devin-swe-1-7", reason: "latency-budget-exceeded" },
      { candidateId: "factory-glm-5.3-flash", reason: "quota-exhausted" },
      { candidateId: "devin-gemini-3.8-flash", observedModel: "gemini-3.8-flash" },
    ],
  });
  assert.equal(gemini.selected.requiresVerifiedRuntimeAvailability, true);
  assert.deepEqual(gemini.selected.invocation, {
    command: "devin",
    args: ["--model", "gemini-3-8-flash-high", "--print"],
  });
});

test("Gemini requires a current matching runtime receipt and otherwise advances to Luna", () => {
  const withoutReceipt = resolveModelRoute({
    roster,
    capability: "mechanical-execution",
    routeSlot: "fast-execution",
    unavailable: [
      { candidateId: "devin-swe-1-7", reason: "latency-budget-exceeded" },
      { candidateId: "factory-glm-5.3-flash", reason: "quota-exhausted" },
    ],
  });
  assert.equal(withoutReceipt.selected.model, "gpt-5.6-luna");
  assert.equal(withoutReceipt.attempts[2].reason, "runtime-availability-unverified");

  const withReceipt = resolveModelRoute({
    roster,
    capability: "mechanical-execution",
    routeSlot: "fast-execution",
    unavailable: [
      { candidateId: "devin-swe-1-7", reason: "latency-budget-exceeded" },
      { candidateId: "factory-glm-5.3-flash", reason: "quota-exhausted" },
      { candidateId: "devin-gemini-3.8-flash", observedModel: "gemini-3.8-flash" },
    ],
  });
  assert.equal(withReceipt.selected.model, "gemini-3.8-flash");
  assert.equal(withReceipt.selected.resolvedModel, "gemini-3.8-flash");
});

test("Codex Luna fallback uses exec, max reasoning, and the priority tier", () => {
  const result = resolveModelRoute({
    roster,
    capability: "mechanical-execution",
    routeSlot: "fast-execution",
    unavailable: [
      { candidateId: "devin-swe-1-7", reason: "latency-budget-exceeded" },
      { candidateId: "factory-glm-5.3-flash", reason: "quota-exhausted" },
      { candidateId: "devin-gemini-3.8-flash", reason: "unavailable" },
    ],
  });
  assert.deepEqual(result.selected.invocation, {
    command: "codex",
    args: [
      "exec",
      "--strict-config",
      "--model",
      "gpt-5.6-luna",
      "--config",
      'model_reasoning_effort="max"',
      "--config",
      'service_tier="priority"',
    ],
  });
  assert.deepEqual(result.selected.serviceTier, { tier: "priority", label: "fast", status: "runtime-required" });
  assert.equal(result.selected.fallbackOnly, true);
  assert.equal(result.attempts[2].reason, "unavailable");
});

test("escalation elevates only the Astra route to max", () => {
  const base = {
    roster: agentRoster,
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: [
      { candidateId: "factory-fable-5.1", reason: "quota-exhausted" },
      { candidateId: "devin-fable-5.1", reason: "quota-exhausted" },
    ],
  };
  const plain = resolveModelRoute(base);
  assert.equal(plain.valid, true);
  assert.equal(plain.selected.harness, "codex");
  assert.equal(plain.selected.model, "gpt-6-astra");
  assert.equal(plain.selected.reasoning, "high");
  assert.equal(plain.selected.escalationApplied, false);
  const escalated = resolveModelRoute({ ...base, escalation: true });
  assert.equal(escalated.valid, true);
  assert.equal(escalated.selected.reasoning, "max");
  assert.equal(escalated.selected.escalationApplied, true);
});

test("OpenCode candidates invoke opencode run with pure, model, variant and json format", () => {
  const base = { roster: agentRoster, capability: "mechanical-execution", routeSlot: "fast-execution" };
  const first = resolveModelRoute(base);
  assert.equal(first.valid, true);
  assert.equal(first.selected.id, "opencode-muse-spark-1.3-contributor");
  assert.equal(first.selected.model, "opencode-go/muse-spark-1.3-contributor");
  assert.equal(first.selected.reasoning, "high");
  assert.equal(first.selected.mappingStatus, "provisional");
  assert.equal(first.selected.evidenceStatus, "runtime-required");
  assert.equal(first.selected.resolvedModel, null);
  assert.equal(first.selected.resolvedModelStatus, "receipt-required");
  assert.equal(first.selected.requiresVerifiedRuntimeAvailability, false);
  assert.deepEqual(first.selected.invocation, {
    command: "opencode",
    args: ["run", "--pure", "--model", "opencode-go/muse-spark-1.3-contributor", "--variant", "high", "--format", "json"],
  });
  assert.equal(first.selected.invocation.args.includes("--auto"), false);
  const qwen = resolveModelRoute({
    ...base,
    unavailable: [
      { candidateId: "opencode-muse-spark-1.3-contributor", reason: "quota-exhausted" },
      { candidateId: "opencode-glm-5.3-flash", reason: "quota-exhausted" },
      { candidateId: "opencode-qwen3.8-flash", observedModel: "opencode-go/qwen3.8-flash" },
    ],
  });
  assert.deepEqual(qwen.selected.invocation, {
    command: "opencode",
    args: ["run", "--pure", "--model", "opencode-go/qwen3.8-flash", "--variant", "high", "--format", "json"],
  });
});

test("Muse selection stays unresolved without a matching receipt and resolves exactly with one", () => {
  const base = { roster: agentRoster, capability: "mechanical-execution", routeSlot: "fast-execution" };
  const unresolved = resolveModelRoute(base);
  assert.equal(unresolved.selected.id, "opencode-muse-spark-1.3-contributor");
  assert.equal(unresolved.selected.independenceBoundary, "provider:opencode-go");
  assert.equal(unresolved.selected.resolvedModel, null);
  assert.equal(unresolved.selected.resolvedModelStatus, "receipt-required");
  const resolved = resolveModelRoute({
    ...base,
    unavailable: [{ candidateId: "opencode-muse-spark-1.3-contributor", observedModel: "opencode-go/muse-spark-1.3-contributor" }],
  });
  assert.equal(resolved.valid, true);
  assert.equal(resolved.selected.id, "opencode-muse-spark-1.3-contributor");
  assert.equal(resolved.selected.resolvedModel, "opencode-go/muse-spark-1.3-contributor");
  assert.equal(resolved.selected.resolvedModelStatus, "receipt-matched");
});

test("Muse policy-blocked and quota fallback advances to GLM", () => {
  const base = { roster: agentRoster, capability: "mechanical-execution", routeSlot: "fast-execution" };
  const policy = resolveModelRoute({
    ...base,
    unavailable: [{ candidateId: "opencode-muse-spark-1.3-contributor", reason: "policy-blocked" }],
  });
  assert.equal(policy.valid, true);
  assert.equal(policy.selected.model, "opencode-go/glm-5.3-flash");
  assert.equal(policy.attempts[0].reason, "policy-blocked");
  assert.equal(policy.fallbackTrace[0].action, "advance-to-declared-fallback");
  const quota = resolveModelRoute({
    ...base,
    unavailable: [{ candidateId: "opencode-muse-spark-1.3-contributor", reason: "quota-exhausted" }],
  });
  assert.equal(quota.valid, true);
  assert.equal(quota.selected.model, "opencode-go/glm-5.3-flash");
  assert.equal(quota.selected.resolvedModel, null);
});

test("fast-execution follows the declared OpenCode-first route order", () => {
  const base = { roster: agentRoster, capability: "mechanical-execution", routeSlot: "fast-execution" };
  const first = resolveModelRoute(base);
  assert.equal(first.selected.model, "opencode-go/muse-spark-1.3-contributor");
  const second = resolveModelRoute({
    ...base,
    unavailable: [{ candidateId: "opencode-muse-spark-1.3-contributor", reason: "quota-exhausted" }],
  });
  assert.equal(second.selected.model, "opencode-go/glm-5.3-flash");
  const qwenWithReceipt = resolveModelRoute({
    ...base,
    unavailable: [
      { candidateId: "opencode-muse-spark-1.3-contributor", reason: "quota-exhausted" },
      { candidateId: "opencode-glm-5.3-flash", reason: "quota-exhausted" },
      { candidateId: "opencode-qwen3.8-flash", observedModel: "opencode-go/qwen3.8-flash" },
    ],
  });
  assert.equal(qwenWithReceipt.selected.model, "opencode-go/qwen3.8-flash");
  const third = resolveModelRoute({
    ...base,
    unavailable: [
      { candidateId: "opencode-muse-spark-1.3-contributor", reason: "quota-exhausted" },
      { candidateId: "opencode-glm-5.3-flash", reason: "quota-exhausted" },
    ],
  });
  assert.equal(third.selected.model, "swe-1-7-lightning");
  assert.equal(third.selected.reasoning, "medium");
  assert.deepEqual(third.selected.invocation, { command: "devin", args: ["--model", "swe-1-7-lightning-medium", "--print"] });
  const fourth = resolveModelRoute({
    ...base,
    unavailable: [
      { candidateId: "opencode-muse-spark-1.3-contributor", reason: "quota-exhausted" },
      { candidateId: "opencode-glm-5.3-flash", reason: "quota-exhausted" },
      { candidateId: "devin-swe-1-7-lightning", reason: "unavailable" },
    ],
  });
  assert.equal(fourth.selected.model, "glm-5.3-flash");
  assert.equal(fourth.selected.harness, "factory");
  const fifth = resolveModelRoute({
    ...base,
    unavailable: [
      { candidateId: "opencode-muse-spark-1.3-contributor", reason: "quota-exhausted" },
      { candidateId: "opencode-glm-5.3-flash", reason: "quota-exhausted" },
      { candidateId: "devin-swe-1-7-lightning", reason: "unavailable" },
      { candidateId: "factory-glm-5.3-flash", reason: "quota-exhausted" },
    ],
  });
  assert.equal(fifth.selected.model, "gpt-5.6-luna");
  assert.equal(fifth.selected.reasoning, "high");
  assert.equal(fifth.selected.fallbackOnly, true);
  assert.deepEqual(fifth.selected.invocation, {
    command: "codex",
    args: [
      "exec",
      "--strict-config",
      "--model",
      "gpt-5.6-luna",
      "--config",
      'model_reasoning_effort="high"',
      "--config",
      'service_tier="priority"',
    ],
  });
});

test("new mappings stay provisional and resolution stays receipt-required without evidence", () => {
  const result = resolveModelRoute({ roster: agentRoster, capability: "mechanical-execution", routeSlot: "fast-execution" });
  assert.equal(result.selected.evidenceStatus, "runtime-required");
  assert.equal(result.selected.mappingStatus, "provisional");
  assert.equal(result.selected.resolvedModel, null);
  assert.equal(result.selected.resolvedModelStatus, "receipt-required");
  assert.equal(result.authority.dispatchAuthorized, false);
});

test("resolveModelRoute accepts installed aliases for the matching capability slot", () => {
  const direct = resolveModelRoute({ roster: agentRoster, capability: "mechanical-execution", routeSlot: "fast-execution" });
  const viaAlias = resolveModelRoute({ roster: agentRoster, capability: "mechanical-execution", routeSlot: "implementation-default" });
  assert.equal(viaAlias.valid, true);
  assert.deepEqual(viaAlias.selected, direct.selected);
  const wrongCapability = resolveModelRoute({ roster: agentRoster, capability: "review", routeSlot: "implementation-default" });
  assert.equal(wrongCapability.valid, false);
  assert.match(wrongCapability.errors.join("\n"), /no declared route matches capability and routeSlot/);
});

test("unsupported harnesses fail closed instead of routing to Codex", () => {
  const malformed = structuredClone(agentRoster);
  malformed.routes[1].candidates[0].harness = "magiccli";
  const result = resolveModelRoute({ roster: malformed, capability: "mechanical-execution", routeSlot: "fast-execution" });
  assert.equal(result.valid, false);
  assert.equal(result.blocked, true);
  assert.equal(result.selected, null);
  assert.equal(result.attempts.length, 0);
  assert.match(result.errors.join("\n"), /harness is unsupported: magiccli/);
});

test("malformed candidate blocks the whole route before fallback", () => {
  const malformed = structuredClone(roster);
  malformed.routes[0].candidates[0].model = "";
  const result = resolveModelRoute({ roster: malformed, capability: "review", routeSlot: "adversarial-review" });
  assert.equal(result.valid, false);
  assert.equal(result.attempts.length, 0);
  assert.match(result.errors.join("\n"), /candidates\[0\]\.model is required/);
});

test("a bare model fact matching multiple provider candidates fails closed", () => {
  const result = resolveModelRoute({
    roster,
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: { "claude-fable-5.1": "quota-exhausted" },
  });
  assert.equal(result.valid, false);
  assert.equal(result.blocked, true);
  assert.equal(result.selected, null);
  assert.match(result.errors.join("\n"), /matches multiple declared candidates and fails closed/);
  assert.equal(result.attempts.length, 0);
});

test("an unambiguous bound model fact is consumed once, not across providers", () => {
  const result = resolveModelRoute({
    roster,
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: { "factory:claude-fable-5.1": "quota-exhausted" },
  });
  assert.equal(result.valid, true);
  assert.equal(result.selected.harness, "devin");
  assert.equal(result.attempts[0].boundary, "provider:factory");
  const bare = resolveModelRoute({
    roster,
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: { "claude-fable-5.1": "quota-exhausted" },
  });
  assert.equal(bare.valid, false);
  assert.equal(bare.selected, null);
  assert.match(bare.errors.join("\n"), /matches multiple declared candidates and fails closed/);
});

test("exhausted candidates fail closed with every attempt", () => {
  const result = resolveModelRoute({
    roster,
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: {
      "factory-fable-5.1": "quota-exhausted",
      "devin-fable-5.1": "unavailable",
      "codex-sol-review": "policy-blocked",
    },
  });
  assert.equal(result.valid, false);
  assert.equal(result.blocked, true);
  assert.equal(result.selected, null);
  assert.match(result.errors.join("\n"), /fails closed/);
  assert.equal(result.attempts.length, 3);
  assert.deepEqual(result.attempts.map((entry) => entry.reason), ["quota-exhausted", "unavailable", "policy-blocked"]);
});

test("observed model mismatch is an explicit failed attempt in array and object forms", () => {
  const arrayResult = resolveModelRoute({
    roster,
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: [{ candidateId: "factory-fable-5.1", observedModel: "parent-inherited-model" }],
  });
  assert.equal(arrayResult.selected.harness, "devin");
  assert.equal(arrayResult.attempts[0].reason, "unavailable");
  assert.equal(arrayResult.attempts[0].observedModel, "parent-inherited-model");
  const objectResult = resolveModelRoute({
    roster,
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: { "factory-fable-5.1": { observedModel: "parent-inherited-model" } },
  });
  assert.deepEqual(
    { harness: objectResult.selected.harness, reason: objectResult.attempts[0].reason, observedModel: objectResult.attempts[0].observedModel },
    { harness: arrayResult.selected.harness, reason: arrayResult.attempts[0].reason, observedModel: arrayResult.attempts[0].observedModel },
  );
});

test("an observed-model-only receipt resolves the matching candidate in both forms", () => {
  const arrayResult = resolveModelRoute({
    roster,
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: [{ candidateId: "factory-fable-5.1", observedModel: "claude-fable-5.1" }],
  });
  assert.equal(arrayResult.selected.resolvedModel, "claude-fable-5.1");
  assert.equal(arrayResult.selected.resolvedModelStatus, "receipt-matched");
  const objectResult = resolveModelRoute({
    roster,
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: { "factory-fable-5.1": { observedModel: "claude-fable-5.1" } },
  });
  assert.deepEqual(
    { resolvedModel: objectResult.selected.resolvedModel, status: objectResult.selected.resolvedModelStatus },
    { resolvedModel: arrayResult.selected.resolvedModel, status: arrayResult.selected.resolvedModelStatus },
  );
});

test("malformed observations fail closed in both forms", () => {
  const nonRecord = resolveModelRoute({
    roster,
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: ["quota-exhausted", 42],
  });
  assert.equal(nonRecord.valid, false);
  assert.equal(nonRecord.blocked, true);
  assert.match(nonRecord.errors.join("\n"), /availability entries must be objects/);
  const unsupportedReason = resolveModelRoute({
    roster,
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: { "factory-fable-5.1": { reason: "weather" } },
  });
  assert.equal(unsupportedReason.valid, false);
  assert.match(unsupportedReason.errors.join("\n"), /unsupported unavailable reason: weather/);
  const noKey = resolveModelRoute({
    roster,
    capability: "review",
    routeSlot: "adversarial-review",
    unavailable: [{ observedModel: "claude-fable-5.1" }],
  });
  assert.equal(noKey.valid, false);
  assert.match(noKey.errors.join("\n"), /observed-model entries require candidateId/);
});

test("typed latency fallback advances and fails fast representably", () => {
  const latency = resolveModelRoute({
    roster,
    capability: "mechanical-execution",
    routeSlot: "fast-execution",
    unavailable: [{ candidateId: "devin-swe-1-7", reason: "latency-budget-exceeded" }],
  });
  assert.equal(latency.valid, true);
  assert.equal(latency.selected.model, "glm-5.3-flash");
  assert.equal(latency.fallbackTrace[0].reason, "latency-budget-exceeded");
  const timeout = resolveModelRoute({
    roster,
    capability: "mechanical-execution",
    routeSlot: "fast-execution",
    unavailable: [{ candidateId: "devin-swe-1-7", reason: "timeout" }],
  });
  assert.equal(timeout.valid, true);
  assert.equal(timeout.selected.model, "glm-5.3-flash");
  assert.equal(timeout.fallbackTrace[0].reason, "timeout");
});

test("implementation and mechanical lanes follow the shared fast chain", () => {
  const roster1_5_16 = roster;
  const implementation = resolveModelRoute({ roster: roster1_5_16, capability: "implementation", routeSlot: "implementation-default" });
  assert.equal(implementation.valid, true);
  assert.equal(implementation.selected.requestedModel, "swe-1-7");
  assert.equal(implementation.selected.harness, "devin");
  assert.equal(implementation.selected.model, "swe-1-7");
  assert.equal(implementation.selected.reasoning, "max");
  assert.equal(implementation.selected.resolvedModel, null);
  assert.equal(implementation.selected.resolvedModelStatus, "receipt-required");
  const mechanical = resolveModelRoute({ roster: roster1_5_16, capability: "mechanical-execution", routeSlot: "fast-execution" });
  assert.deepEqual(implementation.selected, { ...mechanical.selected, id: implementation.selected.id });
  const implementationRoute = roster1_5_16.routes.find((route) => route.routeSlot === "implementation-default");
  const fastRoute = roster1_5_16.routes.find((route) => route.routeSlot === "fast-execution");
  assert.equal(implementationRoute.chain, "fast");
  assert.equal(fastRoute.chain, "fast");
  const sharedChain = roster1_5_16.chains.fast;
  assert.deepEqual(implementationRoute.candidates ?? sharedChain, sharedChain);
  assert.deepEqual(fastRoute.candidates ?? sharedChain, sharedChain);
  assert.equal(sharedChain.length, 4);
  assert.deepEqual(sharedChain.map((candidate) => candidate.model), ["swe-1-7", "glm-5.3-flash", "gemini-3.8-flash", "gpt-5.6-luna"]);
  assert.equal(sharedChain[2].evidenceStatus, "runtime-required");
  assert.equal(sharedChain[2].requiresVerifiedRuntimeAvailability, true);
  assert.equal(sharedChain[3].reasoning, "max");
  assert.equal(sharedChain[3].fallbackOnly, true);
  assert.deepEqual(sharedChain[3].serviceTier, { tier: "priority", label: "fast", status: "runtime-required" });
  assert.equal(implementationRoute.candidates, undefined);
  assert.equal(fastRoute.candidates, undefined);
});
