import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { planParallelWork } from "../src/parallel-work.mjs";

const agent = {
  role: "fast_implementer",
  harness: "codex",
  resolvedModel: "gpt-5.6-luna",
  reasoning: "high",
};

function ticket(id, surfaces, dependencies = [], status = "pending") {
  return {
    id,
    surfaces,
    dependencies,
    status,
    acceptance: `${id} observable`,
    checks: [`test:${id}`],
    stopCondition: `${id} verified`,
    branch: `codex/${id.toLowerCase()}`,
    worktree: `/tmp/${id.toLowerCase()}`,
    agent,
  };
}

test("dependencies gate readiness without permanently unioning lanes", () => {
  const plan = planParallelWork({
    explicitlyInvoked: true,
    repository: { identity: "AO-HyS/development-system", revision: "a".repeat(40) },
    tickets: [
      ticket("T1", ["src/auth"]),
      ticket("T2", ["src/auth/session"], ["T1"]),
      ticket("T3", ["src/reader"]),
      ticket("T4", ["src/release"], ["T3"]),
    ],
    integration: { baseRevision: "a".repeat(40), currentRevision: "a".repeat(40), conflicts: [] },
  });

  assert.equal(plan.valid, true);
  assert.deepEqual(plan.frontier, ["T1", "T3"]);
  assert.deepEqual(plan.executableFrontier, ["T1", "T3"]);
  assert.deepEqual(plan.activeLanes.map((lane) => lane.currentTicket), ["T1", "T3"]);
  assert.deepEqual(plan.lanes.map((lane) => lane.tickets), [["T1"], ["T2"], ["T3"], ["T4"]]);
  assert.deepEqual(plan.waitingTickets, [
    { id: "T2", reason: "dependencies-incomplete:T1" },
    { id: "T4", reason: "dependencies-incomplete:T3" },
  ]);
  assert.equal(plan.lanes.every((lane) => lane.writerCount === 1), true);
  assert.deepEqual(plan.delivery, { strategy: "single-integrated-candidate", branchCount: 1, pullRequestCount: 1, separationReason: null });
  assert.equal(plan.candidate.status, "in-progress");
  assert.deepEqual(plan.externalSideEffects, []);
});

test("capacity and overlapping ready work produce a deterministic executable frontier", () => {
  const plan = planParallelWork({
    initiativeAuthorized: true,
    maxConcurrentWriters: 2,
    repository: { identity: "repo", revision: "a".repeat(40) },
    tickets: [
      ticket("T1", ["src/shared"]),
      ticket("T2", ["src/shared/child"]),
      ticket("T3", ["src/independent"]),
      ticket("T4", ["src/another"]),
    ],
    integrationChecks: ["pnpm test"],
    integration: { baseRevision: "a".repeat(40), currentRevision: "a".repeat(40), conflicts: [] },
  });

  assert.equal(plan.valid, true);
  assert.deepEqual(plan.frontier, ["T1", "T2", "T3", "T4"]);
  assert.deepEqual(plan.executableFrontier, ["T1", "T3"]);
  assert.deepEqual(plan.waitingTickets, [
    { id: "T2", reason: "surface-conflict:T1" },
    { id: "T4", reason: "capacity:2" },
  ]);
  assert.deepEqual(plan.integrationChecks, ["pnpm test"]);
});

test("transitive surface bridges never hide an executable disjoint lane", () => {
  const plan = planParallelWork({
    initiativeAuthorized: true,
    maxConcurrentWriters: 2,
    repository: { identity: "repo", revision: "a".repeat(40) },
    tickets: [
      ticket("T1", ["src/a"]),
      ticket("T2", ["src/a/child", "src/b/child"]),
      ticket("T3", ["src/b"]),
    ],
    integrationChecks: ["pnpm test"],
    integration: { baseRevision: "a".repeat(40), currentRevision: "a".repeat(40), conflicts: [] },
  });
  assert.deepEqual(plan.executableFrontier, ["T1", "T3"]);
  assert.deepEqual(plan.activeLanes.map((lane) => lane.currentTicket), ["T1", "T3"]);
});

test("running work reserves capacity before pending tickets", () => {
  const plan = planParallelWork({
    initiativeAuthorized: true,
    maxConcurrentWriters: 1,
    repository: { identity: "repo", revision: "a".repeat(40) },
    tickets: [ticket("T1", ["src/a"]), ticket("T2", ["src/b"], [], "running")],
    integrationChecks: ["pnpm test"],
    integration: { baseRevision: "a".repeat(40), currentRevision: "a".repeat(40), conflicts: [] },
  });
  assert.deepEqual(plan.executableFrontier, ["T2"]);
  assert.deepEqual(plan.waitingTickets, [{ id: "T1", reason: "capacity:1" }]);
});

test("running work with incomplete dependencies fails closed", () => {
  const plan = planParallelWork({
    initiativeAuthorized: true,
    repository: { identity: "repo", revision: "a".repeat(40) },
    tickets: [ticket("T1", ["src/a"]), ticket("T2", ["src/b"], ["T1"], "running")],
    integrationChecks: ["pnpm test"],
    integration: { baseRevision: "a".repeat(40), currentRevision: "a".repeat(40), conflicts: [] },
  });
  assert.equal(plan.valid, false);
  assert.match(plan.errors.join("\n"), /running ticket T2 has incomplete dependencies:T1/);
});

test("a local failure blocks descendants but independent lanes continue", () => {
  const plan = planParallelWork({
    explicitlyInvoked: true,
    sharedBaseHealthy: true,
    repository: { identity: "repo", revision: "b".repeat(40) },
    tickets: [
      ticket("T1", ["src/auth"], [], "failed"),
      ticket("T2", ["src/api"], ["T1"]),
      ticket("T3", ["src/reader"]),
    ],
    integration: { baseRevision: "b".repeat(40), currentRevision: "b".repeat(40), conflicts: [] },
  });

  assert.deepEqual(plan.frontier, ["T3"]);
  assert.deepEqual(plan.blockedTickets, [
    { id: "T1", reason: "local-failure" },
    { id: "T2", reason: "failed-dependency:T1" },
  ]);
  assert.deepEqual(plan.activeLanes.map((lane) => lane.currentTicket), ["T3"]);
});

test("integration drift, conflicts, unresolved models, and unexplained split PRs fail closed", () => {
  const plan = planParallelWork({
    explicitlyInvoked: true,
    repository: { identity: "repo", revision: "d".repeat(40) },
    tickets: [ticket("T1", ["src/a"], [], "completed"), { ...ticket("T2", ["src/b"], [], "completed"), agent: { ...agent, resolvedModel: "inherit" } }],
    delivery: { strategy: "separate-pull-requests" },
    integration: { baseRevision: "c".repeat(40), currentRevision: "d".repeat(40), ancestry: "diverged", diffVerified: true, conflicts: ["src/shared.mjs"] },
  });

  assert.equal(plan.valid, false);
  assert.match(plan.errors.join("\n"), /resolved model|separation reason/i);
  assert.equal(plan.candidate.status, "blocked-conflicts-and-divergence");
  assert.equal(plan.candidate.coherent, false);
});

test("a verified conflict-free descendant is normal Git progress and can be coherent", () => {
  const plan = planParallelWork({
    explicitlyInvoked: true,
    repository: { identity: "repo", revision: "f".repeat(40) },
    tickets: [ticket("T1", ["src/a"], [], "completed"), ticket("T2", ["src/b"], [], "completed")],
    integration: {
      baseRevision: "e".repeat(40),
      currentRevision: "f".repeat(40),
      ancestry: "descendant",
      diffVerified: true,
      conflicts: [],
    },
  });

  assert.equal(plan.valid, true);
  assert.equal(plan.candidate.status, "coherent");
  assert.equal(plan.candidate.coherent, true);
  assert.equal(plan.candidate.ancestry, "descendant");
});

test("work-multiple remains only a deprecated CLI alias", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "parallel-work-cli-"));
  const inputPath = resolve(directory, "input.json");
  await writeFile(inputPath, JSON.stringify({
    explicitlyInvoked: true,
    repository: { identity: "repo", revision: "e".repeat(40) },
    tickets: [ticket("T1", ["src/a"]), ticket("T2", ["src/b"])],
    integration: { baseRevision: "e".repeat(40), currentRevision: "e".repeat(40), conflicts: [] },
  }), "utf8");
  const cli = resolve(import.meta.dirname, "..", "bin", "development-system.mjs");
  const current = spawnSync(process.execPath, [cli, "parallel-work", "--input", inputPath, "--json"], { encoding: "utf8" });
  const alias = spawnSync(process.execPath, [cli, "work-multiple", "--input", inputPath, "--json"], { encoding: "utf8" });
  assert.equal(current.status, 0, current.stderr);
  assert.equal(alias.status, 0, alias.stderr);
  assert.equal(JSON.parse(current.stdout).operation, "parallel-work");
  assert.equal(JSON.parse(alias.stdout).migrationAlias, "work-multiple");
  assert.equal(JSON.parse(alias.stdout).deprecatedAlias, true);
});
