import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkflowStore, workflowPolicy } from "../src/orchestration-store.mjs";

const baseSha = "a".repeat(40);
const candidateHash = "b".repeat(64);
const executor = { adapter: "opencode", model: "opencode-go/deepseek-v4.1-flash", effort: "high" };
const reviewer = { adapter: "codex", model: "gpt-6-astra", effort: "xhigh" };
const atom = (id, writeSet = [], dependsOn = [], readSet = []) => ({ id, objective: `Implement ${id}`, readSet, writeSet, dependsOn,
  acceptanceIds: [`accept-${id}`], execution: executor, review: reviewer, promptPath: `${id}.md` });
const plan = (atoms) => ({ schemaVersion: 1, policyVersion: workflowPolicy.version, runId: "durable-fixture", root: "/tmp/fixture-repository", baseSha,
  coordinator: { model: "gpt-5.6-sol", effort: "high" }, atoms });
const completion = (attempt, paths = []) => ({ ...attempt, ok: true, terminationObserved: true, changedPaths: paths, candidateHash });
const acceptance = (attempt, patches = {}) => ({ ...attempt, type: "acceptance-receipt", verifier: "independent-reviewer", ok: true, terminationObserved: true, ...patches });

async function fixture(t, atoms) {
  const directory = await mkdtemp(join(tmpdir(), "workflow-store-"));
  const store = await WorkflowStore.create({ directory, plan: plan(atoms) });
  t.after(() => store.close());
  return { directory, store };
}

test("durable queue serializes read/write owners and wakes dependencies only after candidate review", async (t) => {
  const { store, directory } = await fixture(t, [atom("writer", ["src"]), atom("reader", [], [], ["src/shared.mjs"]), atom("dependent", ["lib"], ["writer"])]);
  const events = [];
  store.on("change", (event) => events.push(event.type));
  await assert.rejects(store.start("dependent"), /not ready/);
  const [writer, reader] = await Promise.allSettled([store.start("writer"), store.start("reader")]);
  assert.equal(writer.status, "fulfilled");
  assert.equal(reader.status, "rejected");
  assert.match(reader.reason.message, /lease conflict/);
  assert.deepEqual(store.ready(), []);
  await store.complete("writer", completion(writer.value, ["src/shared.mjs"]));
  assert.deepEqual(store.ready(), []);
  assert.deepEqual(store.awaitingVerification().map((entry) => entry.id), ["writer"]);
  const review = await store.startReview("writer");
  await assert.rejects(store.startReview("writer"), /not awaiting/);
  await store.verify("writer", acceptance(review));
  assert.deepEqual(store.ready().map((entry) => entry.id), ["reader", "dependent"]);
  assert.deepEqual(events, ["atom-started", "atom-completed", "review-started", "atom-verified"]);
  const persisted = JSON.parse(await readFile(join(directory, "workflow.json"), "utf8"));
  assert.equal(persisted.revision, 4);
  assert.equal(persisted.scheduler.atoms.find((entry) => entry.id === "writer").state, "verified");
  assert.equal(persisted.plan.atoms[0].promptPath, "writer.md");
});

test("attempt receipts reject stale, duplicate, unowned, wrong-model and wrong-candidate events", async (t) => {
  const { store } = await fixture(t, [atom("writer", ["src/file.mjs"])]);
  const attempt = await store.start("writer");
  for (const patch of [{ attemptId: "stale" }, { contractHash: "old" }, { baseSha: "c".repeat(40) }, { runId: "other" }, { atomId: "other" }]) {
    await assert.rejects(store.complete("writer", { ...completion(attempt), ...patch }), /does not match/);
  }
  await assert.rejects(store.complete("writer", completion(attempt, ["outside.mjs"])), /unowned/);
  await assert.rejects(store.complete("writer", { ...completion(attempt), execution: { ...executor, model: "gpt-5.6-luna" } }), /pinned profile/);
  await assert.rejects(store.complete("writer", { ...completion(attempt), terminationObserved: false }), /termination/);
  await assert.rejects(store.complete("writer", { ...completion(attempt), candidateHash: null }), /snapshot hash/);
  await store.complete("writer", completion(attempt, ["src/file.mjs"]));
  await assert.rejects(store.complete("writer", completion(attempt)), /not running/);
  const review = await store.startReview("writer");
  for (const patch of [{ candidateHash: "c".repeat(64) }, { reviewAttemptId: "stale" }, { execution: { ...reviewer, effort: "high" } }, { changedPaths: [] }, { acceptanceIds: [] }]) {
    await assert.rejects(store.verify("writer", acceptance(review, patch)));
  }
  assert.equal(store.snapshot().atoms[0].state, "reviewing");
  await store.verify("writer", acceptance(review));
  await assert.rejects(store.verify("writer", acceptance(review)), /not awaiting/);
});

test("cancellation retains ownership until stopped and late completion cannot finish a new attempt", async (t) => {
  const { store } = await fixture(t, [atom("writer", ["src"]), atom("other", ["src/file.mjs"])]);
  const attempt = await store.start("writer");
  await store.cancel("writer", "observed provider mismatch");
  await assert.rejects(store.retry("writer"), /stopped prior owner/);
  await assert.rejects(store.start("other"), /lease conflict/);
  await assert.rejects(store.complete("writer", completion(attempt)), /not running/);
  await assert.rejects(store.stopped("writer", { ...attempt, terminationObserved: false }), /termination/);
  // Stopping a wrong or unobserved model records failure; it never pretends model acceptance.
  await store.stopped("writer", { ...attempt, execution: { ...executor, model: "wrong-model" }, terminationObserved: true });
  await store.retry("writer", "Correct the failed bounded attempt");
  const next = await store.start("writer");
  assert.notEqual(next.attemptId, attempt.attemptId);
  assert.notEqual(next.contractHash, attempt.contractHash);
  await assert.rejects(store.complete("writer", completion(attempt)), /does not match/);
  await store.complete("writer", { ...completion(next), ok: false });
  assert.equal(store.snapshot().atoms[0].state, "failed");
});

test("failed review preserves its candidate and permits correction only after review termination", async (t) => {
  const { store } = await fixture(t, [atom("writer", ["src"])]);
  const attempt = await store.start("writer");
  await store.complete("writer", completion(attempt, ["src/file.mjs"]));
  const review = await store.startReview("writer");
  await assert.rejects(store.retry("writer"), /stopped prior owner/);
  await store.verify("writer", acceptance(review, { ok: false, findings: ["Required behavior is missing"] }));
  assert.equal(store.snapshot().atoms[0].candidateHash, candidateHash);
  assert.deepEqual(store.snapshot().activeAttempts, {});
  await store.retry("writer", "Address the missing behavior");
  const next = await store.start("writer");
  await store.complete("writer", completion(next, ["src/file.mjs"]));
  const nextReview = await store.startReview("writer");
  await assert.rejects(store.verify("writer", acceptance(review)), /does not match/);
  await store.verify("writer", acceptance(nextReview));
});

test("plan and start pins reject Luna, weak Astra effort, wrong coordinator, dependencies and cycles", async (t) => {
  const { store } = await fixture(t, [atom("writer", ["src"])]);
  await assert.rejects(store.start("writer", { ...executor, model: "gpt-5.6-luna" }), /pinned profile/);
  assert.equal(store.snapshot().revision, 0);
  for (const invalid of [
    { ...plan([atom("writer")]), coordinator: { model: "gpt-6-astra", effort: "high" } },
    plan([{ ...atom("writer"), execution: { ...executor, model: "gpt-5.6-luna" } }]),
    plan([{ ...atom("writer"), review: { ...reviewer, effort: "high" } }]),
    plan([atom("writer", [], ["missing"])]),
    plan([atom("a", [], ["b"]), atom("b", [], ["a"])]),
  ]) {
    const directory = await mkdtemp(join(tmpdir(), "invalid-workflow-"));
    await assert.rejects(WorkflowStore.create({ directory, plan: invalid }), /Invalid workflow plan/);
  }
});

test("exclusive controller, exact resume plan and persisted completion survive reopening", async (t) => {
  const { store, directory } = await fixture(t, [atom("writer", ["src"])]);
  await assert.rejects(WorkflowStore.open({ directory }), /owning controller/);
  await assert.rejects(WorkflowStore.open({ directory, recoverController: { ...store.snapshot().controller, terminationObserved: true } }), /process termination/);
  const attempt = await store.start("writer");
  await store.complete("writer", completion(attempt, ["src/file.mjs"]));
  await store.close();
  await assert.rejects(WorkflowStore.open({ directory, plan: { ...plan([atom("writer", ["src"])]), coordinator: reviewer } }), /resume plan or model pins/);
  const resumed = await WorkflowStore.open({ directory, plan: plan([atom("writer", ["src"])]) });
  t.after(() => resumed.close());
  assert.equal(resumed.snapshot().atoms[0].state, "awaiting-verification");
  assert.equal(resumed.snapshot().atoms[0].candidateHash, candidateHash);
  await resumed.verify("writer", acceptance(await resumed.startReview("writer")));
  assert.equal(resumed.snapshot().atoms[0].state, "verified");
});

test("interrupted reviewer must stop explicitly after restart before cancellation can release its lease", async (t) => {
  const { store, directory } = await fixture(t, [atom("writer", ["src"]), atom("other", ["src/file.mjs"])]);
  await store.complete("writer", completion(await store.start("writer"), ["src/file.mjs"]));
  const review = await store.startReview("writer");
  await store.close();
  const resumed = await WorkflowStore.open({ directory });
  t.after(() => resumed.close());
  assert.equal(resumed.snapshot().atoms[0].state, "recovery-required");
  await assert.rejects(resumed.verify("writer", acceptance(review)), /not awaiting/);
  await resumed.cancel("writer", "Stop interrupted reviewer");
  await assert.rejects(resumed.start("other"), /lease conflict/);
  await assert.rejects(resumed.stopped("writer", { ...review, reviewAttemptId: "old", terminationObserved: true }), /active review attempt/);
  await resumed.stopped("writer", { ...review, terminationObserved: true });
  assert.equal(resumed.snapshot().atoms[0].state, "cancelled");
  assert.deepEqual(resumed.ready().map((entry) => entry.id), ["other"]);
});

test("dead-controller recovery never assumes its writer also terminated or accepts its late receipt", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "crashed-workflow-"));
  const input = { directory, plan: plan([atom("writer", ["src"]), atom("other", ["src/file.mjs"])]) };
  const source = `import { WorkflowStore } from ${JSON.stringify(new URL("../src/orchestration-store.mjs", import.meta.url).href)};
    const store = await WorkflowStore.create(${JSON.stringify(input)});
    const attempt = await store.start('writer');
    process.stdout.write(JSON.stringify({controller:store.snapshot().controller,attempt}));`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  const prior = JSON.parse(child.stdout);
  await assert.rejects(WorkflowStore.open({ directory }), /owning controller/);
  const resumed = await WorkflowStore.open({ directory, recoverController: { ...prior.controller, terminationObserved: true } });
  t.after(() => resumed.close());
  assert.equal(resumed.snapshot().atoms[0].state, "recovery-required");
  await assert.rejects(resumed.complete("writer", completion(prior.attempt)), /not running/);
  await assert.rejects(resumed.start("other"), /lease conflict/);
  await assert.rejects(resumed.retry("writer"), /stopped prior owner/);
  await resumed.stopped("writer", { ...prior.attempt, terminationObserved: true });
  await resumed.retry("writer");
  const next = await resumed.start("writer");
  assert.notEqual(next.attemptId, prior.attempt.attemptId);
});
