import assert from "node:assert/strict";
import test from "node:test";

import {
  createHumanLayerAdapter,
  createHumanLayerReceipt,
  DEFAULT_HUMANLAYER_CONFIG,
  humanLayerFeedbackReceipt,
  linkHumanLayerTask,
  probeHumanLayerReadOnly,
  routeHumanLayerArtifacts,
} from "../src/humanlayer-adapter.mjs";

test("initial HumanLayer configuration is local, never-worktree, and integration-free", () => {
  assert.equal(DEFAULT_HUMANLAYER_CONFIG.daemon.location, "local");
  assert.equal(DEFAULT_HUMANLAYER_CONFIG.worktreeTiming, "Never");
  assert.equal(DEFAULT_HUMANLAYER_CONFIG.worktree.timing, "Never");
  assert.equal(DEFAULT_HUMANLAYER_CONFIG.autoAdvance, false);
  assert.deepEqual(DEFAULT_HUMANLAYER_CONFIG.integrations, { slack: false, linear: false, external: false });
});

test("task links are canonical-workflow references and cannot be rebound", () => {
  const links = new Map();
  assert.deepEqual(linkHumanLayerTask({ taskId: "hl-task-1", workflowId: "WB-1", existingLinks: links }), {
    adapter: "humanlayer",
    taskId: "hl-task-1",
    workflowId: "WB-1",
    sourceOfTruth: "development-system",
    lifecycleAuthority: "development-system",
  });
  assert.throws(() => linkHumanLayerTask({ taskId: "hl-task-1", workflowId: "WB-2", existingLinks: links }), /already linked/);
});

test("routing selects matching visibility and fails closed before any write", () => {
  const result = routeHumanLayerArtifacts({
    artifacts: [
      { id: "brief", visibility: "portable" },
      { id: "handoff", visibility: "private" },
    ],
    destinations: [
      { id: "synced-tasks", visibility: "portable", syncsExternally: true },
      { id: "synced-private", visibility: "private", syncsExternally: true },
    ],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.routes, []);
  assert.deepEqual(result.denied, [{
    artifactId: "handoff",
    visibility: "private",
    reason: "private-artifact-only-external-destination",
  }]);
});

test("materialization uses an injected writer only after the complete plan is safe", async () => {
  const writes = [];
  const adapter = createHumanLayerAdapter({
    runtime: { writeArtifact: async (request) => writes.push(request) },
  });
  const result = await adapter.materializeArtifacts({
    artifacts: [{ id: "brief", visibility: "portable" }],
    destinations: [{ id: "repo", visibility: "portable" }],
  });
  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].destinationId, "repo");
});

test("receipt keeps app and CLI versions independent and records runtime evidence", () => {
  const receipt = createHumanLayerReceipt({
    appVersion: "0.153.0",
    cliVersion: "0.31.0",
    agent: "codex",
    model: "gpt-5",
    effort: "high",
    loadedSkills: ["drive-development-flow"],
    promptAdditions: ["Use the canonical gates"],
    taskId: "hl-task-1",
    sessionId: "hl-session-1",
    sideEffects: [],
  });
  assert.equal(receipt.appVersion, "0.153.0");
  assert.equal(receipt.cliVersion, "0.31.0");
  assert.notEqual(receipt.appVersion, receipt.cliVersion);
  assert.equal(receipt.daemonLocation, "local");
  assert.deepEqual(receipt.loadedSkills, ["drive-development-flow"]);
  assert.equal(receipt.sessionId, "hl-session-1");
});

test("read-only probe reports existence, discovery, loading, and influence independently", async () => {
  let request;
  const result = await probeHumanLayerReadOnly({
    skill: "working-backwards",
    probe: (value) => {
      request = value;
      return { existence: true, discovery: true, loading: false, influence: null, sideEffects: [] };
    },
  });
  assert.deepEqual(request, { skill: "working-backwards", readOnly: true });
  assert.equal(result.exists, true);
  assert.equal(result.discovered, true);
  assert.equal(result.loaded, false);
  assert.equal(result.influenced, null);
  assert.equal(result.ok, true);
  assert.deepEqual(result.sideEffects, []);
});

test("HumanLayer comments, status, and auto-advance are feedback only", () => {
  const receipt = humanLayerFeedbackReceipt({ comments: ["Approve"], taskStatus: "done", autoAdvance: true });
  assert.equal(receipt.accepted, false);
  assert.equal(receipt.gateGranted, false);
  assert.equal(receipt.lifecycleMutation, false);
  assert.equal(receipt.reason, "feedback-only");
  assert.deepEqual(receipt.sideEffects, []);
});

