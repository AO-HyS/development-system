import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { run } from "../src/cli.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "jev-advisory-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const atom = { id: "candidate", objective: "Review shared appointment ownership", readSet: ["src/appointments"], writeSet: ["src/appointments/editor.ts"], dependsOn: [], acceptanceIds: ["preserve-owner"] };
  const context = { runId: "synthetic-run", baseSha: "a".repeat(40), rootModel: "gpt-6-sol", phase: "implementation", verifiedAtomIds: [] };
  const atomFile = join(root, "atom.json"), contextFile = join(root, "run.json"), activeFile = join(root, "active.json");
  await writeFile(atomFile, JSON.stringify(atom));
  await writeFile(contextFile, JSON.stringify(context));
  return { root, atom, context, atomFile, contextFile, activeFile, args: ["classify-atom", "--atom", atomFile, "--run-context", contextFile, "--home", root, "--json"] };
}

function fakeCredential(t) {
  const previous = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "synthetic-advisory-test-credential";
  t.after(() => {
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previous;
  });
}

function responseFor(request) {
  const routes = Object.keys(request.questions.route.criteria);
  const answers = Object.fromEntries(Object.keys(request.questions).filter((key) => key !== "route").map((key) => [key, { type: "noul", noul: key === "semantic_overlap" ? 0.9 : 0.1 }]));
  answers.route = { type: "choice", choice: "exact_implementation", confidence: 1, probabilities: Object.fromEntries(routes.map((route) => [route, route === "exact_implementation" ? 1 : 0])) };
  return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 10, output_tokens: 5 } }));
}

test("classification forwards active write ownership and binds its receipt to that exact request", async (t) => {
  const f = await fixture(t);
  fakeCredential(t);
  const activeAtoms = [{ id: "editor-owner", writeSet: ["src/appointments/editor.ts", "src/shared"] }, { id: "reader", writeSet: [] }];
  await writeFile(f.activeFile, JSON.stringify(activeAtoms));
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    return responseFor(request);
  });
  const receiptFile = join(f.root, "classification.json");
  const { result } = await run([...f.args, "--active-atoms", f.activeFile, "--receipt", receiptFile]);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].state.activeAtoms, activeAtoms);
  assert.equal(result.semanticOverlap, 0.9);
  assert.equal(result.stateHash, createHash("sha256").update(JSON.stringify(requests[0].state)).digest("hex"));
  assert.equal(result.actionable, false);
  assert.equal(result.classificationStatus, "succeeded");
  assert.equal(result.policyVersion, "1.3.0");
  assert.equal(result.proposedRoute, "exact_implementation");
  assert.deepEqual(Object.keys(requests[0].questions.route.criteria).sort(), ["astra_xhigh_decision", "blocked_dependency", "browser_executor", "exact_implementation", "general_implementation", "read_only_mapper", "root_direct", "specialist_review"].sort());
  assert.equal(result.appliedRoute, null);
  assert.equal(JSON.parse(await readFile(receiptFile, "utf8")).stateHash, result.stateHash);

  await run(f.args);
  assert.deepEqual(requests[1].state.activeAtoms, []);
});

test("active advisory status reports requested GPT-6 profiles and unknown actual identity", async (t) => {
  const f = await fixture(t);
  const { result } = await run(["advisory-status", "--home", f.root, "--json"]);
  assert.equal(result.version, "1.29.0");
  assert.equal(result.policyVersion, "1.3.0");
  assert.deepEqual(result.modelProfile.newSessionDefault, { model: "gpt-6-sol", effort: "high", tier: "default", identity: "requested" });
  assert.equal(result.modelProfile.exactImplementation.model, "gpt-6-luna");
  assert.equal(result.modelProfile.generalImplementation.model, "gpt-6-sol");
  assert.equal(result.modelProfile.actualModel, null);
  assert.equal(result.automaticExecution, false);
});

test("stale policy receipt is rejected and a current failed classification permits explicit parent continuation", async (t) => {
  const f = await fixture(t);
  fakeCredential(t);
  t.mock.method(globalThis, "fetch", async (_url, options) => responseFor(JSON.parse(options.body)));
  const receiptFile = join(f.root, "success.json");
  const { result: success } = await run([...f.args, "--receipt", receiptFile]);
  const staleFile = join(f.root, "stale.json");
  await writeFile(staleFile, JSON.stringify({ ...success, policyVersion: "1.2.0-candidate.3" }));
  const decisionArgs = ["record-route-decision", "--atom", f.atomFile, "--run-context", f.contextFile, "--home", f.root, "--chosen-route", "general_implementation", "--rationale", "Parent selects general implementation after inspecting context", "--json"];
  await assert.rejects(run([...decisionArgs, "--route-receipt", staleFile]), /current advisory receipt/);

  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => { throw new Error("private provider detail"); });
  const failedFile = join(f.root, "failed.json");
  await assert.rejects(run([...f.args, "--receipt", failedFile]), /classification failed/i);
  const failed = JSON.parse(await readFile(failedFile, "utf8"));
  assert.equal(failed.classificationStatus, "failed");
  assert.equal(failed.failureCode, "provider_failure");
  assert.equal(failed.proposedRoute, null);
  assert.equal(failed.judgments, null);
  assert.equal(JSON.stringify(failed).includes("private provider detail"), false);
  const { result: decision } = await run([...decisionArgs, "--route-receipt", failedFile]);
  assert.equal(decision.classificationStatus, "failed");
  assert.equal(decision.classificationFailureCode, "provider_failure");
  assert.equal(decision.proposedRoute, null);
  assert.equal(decision.chosenRoute, "general_implementation");
  assert.equal(decision.authorizationGranted, false);
  assert.equal(decision.executionObserved, false);
});

test("classification failures create bound sanitized receipts for missing credential and malformed provider response", async (t) => {
  const f = await fixture(t);
  const previous = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  t.after(() => { if (previous === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = previous; });
  const missingFile = join(f.root, "missing-key.json");
  await assert.rejects(run([...f.args, "--receipt", missingFile]), /TYPESAFE_API_KEY/);
  const missing = JSON.parse(await readFile(missingFile, "utf8"));
  assert.equal(missing.failureCode, "credential_missing");
  assert.equal(missing.runId, f.context.runId);
  assert.equal(missing.atomId, f.atom.id);
  assert.equal(missing.policyVersion, "1.3.0");
  process.env.TYPESAFE_API_KEY = "synthetic-advisory-test-credential";
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ invalid: "secret provider payload" })));
  const malformedFile = join(f.root, "malformed.json");
  await assert.rejects(run([...f.args, "--receipt", malformedFile]), /invalid route answer/);
  const malformed = JSON.parse(await readFile(malformedFile, "utf8"));
  assert.equal(malformed.failureCode, "malformed_response");
  assert.equal(JSON.stringify(malformed).includes("secret provider payload"), false);
  assert.equal(malformed.packetHash, missing.packetHash);
  assert.equal(malformed.runContextHash, missing.runContextHash);
});

test("provider timeout creates a failed receipt and does not dispatch or retry", async (t) => {
  const f = await fixture(t);
  fakeCredential(t);
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests += 1;
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  const receiptFile = join(f.root, "timeout.json");
  await assert.rejects(run([...f.args, "--receipt", receiptFile]), /Jev request timed out/);
  const receipt = JSON.parse(await readFile(receiptFile, "utf8"));
  assert.equal(receipt.failureCode, "timeout");
  assert.equal(receipt.actionable, false);
  assert.equal(requests, 1);
});

test("invalid active ownership fails before provider access or receipt creation", async (t) => {
  const f = await fixture(t);
  fakeCredential(t);
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests += 1; throw new Error("Provider access is forbidden"); });
  const receiptFile = join(f.root, "must-not-exist.json");
  const invalidValues = [
    {},
    [{ id: "owner", writeSet: ["../outside"] }],
    [{ id: "owner", writeSet: ["/absolute"] }],
    [{ id: "owner", writeSet: "src" }],
    [{ id: "owner", writeSet: [], instruction: "unexpected context" }],
    [{ id: "owner", writeSet: [] }, { id: "owner", writeSet: ["src"] }],
  ];
  for (const value of invalidValues) {
    await writeFile(f.activeFile, JSON.stringify(value));
    await assert.rejects(run([...f.args, "--active-atoms", f.activeFile, "--receipt", receiptFile]), /[Aa]ctive atom/);
  }
  assert.equal(requests, 0);
  assert.equal((await readdir(f.root)).includes("must-not-exist.json"), false);
});

test("direct historical controller refuses before manifest reads, mutations or provider processes", async (t) => {
  const f = await fixture(t);
  const script = fileURLToPath(new URL("../scripts/run-jev-workflow.mjs", import.meta.url));
  const guard = `
    import cp from 'node:child_process';
    import fs from 'node:fs';
    import fsp from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const forbidden = () => { throw new Error('FORBIDDEN_CONTROLLER_SIDE_EFFECT'); };
    for (const key of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) cp[key] = forbidden;
    for (const key of ['writeFile', 'appendFile', 'mkdir', 'symlink', 'rm', 'rename', 'unlink']) {
      fsp[key] = forbidden;
      fs[key] = forbidden;
      fs[key + 'Sync'] = forbidden;
    }
    globalThis.fetch = forbidden;
    syncBuiltinESMExports();
  `;
  const env = { ...process.env, HOME: f.root };
  delete env.TYPESAFE_API_KEY;
  delete env.TYPESAFE_ENV_FILE;
  const before = await readdir(f.root);
  for (const args of [[], ["--manifest", join(f.root, "missing-private-manifest.json")]]) {
    const result = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(guard)}`, script, ...args], { cwd: f.root, env, encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Historical controller disabled/);
    assert.doesNotMatch(result.stderr, /FORBIDDEN_CONTROLLER_SIDE_EFFECT|ENOENT|missing-private-manifest/);
  }
  assert.deepEqual(await readdir(f.root), before);
});
