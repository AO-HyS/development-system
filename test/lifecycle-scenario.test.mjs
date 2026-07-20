import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  executeLifecycleOperation,
  readLifecycleState,
  runLifecycleRequest,
} from "../src/lifecycle.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(repositoryRoot, "bin", "development-system.mjs");

function runCli(...args) {
  const result = spawnSync(process.execPath, [cliPath, ...args, "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return {
    ...result,
    json: result.stdout.trim() ? JSON.parse(result.stdout) : null,
  };
}

test("Wayfinder can be recommended but only an explicit invocation persists it outside the normal lifecycle", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-lifecycle-wayfinder-"));
  const workflowId = "AOH-142";

  const recommendation = await runLifecycleRequest({
    home,
    workflowId,
    mode: "recommend",
    request: "Esta iniciativa es enorme y todavía no tiene una ruta clara",
  });

  assert.equal(recommendation.selectedStage, "wayfinder");
  assert.equal(recommendation.transition.status, "recommended");
  assert.equal(recommendation.externalSideEffects.length, 0);
  await assert.rejects(access(resolve(home, ".development-system", "lifecycles", "AOH-142.json")));

  const explicitInvocation = await runLifecycleRequest({
    home,
    workflowId,
    mode: "transition",
    request: "Invoca Wayfinder explícitamente para AOH-142",
  });

  assert.equal(explicitInvocation.transition.operation, "invoke_wayfinder");
  assert.equal(explicitInvocation.state.stage, "idle");
  assert.equal(explicitInvocation.state.optionalStage, "wayfinder");
  assert.equal(explicitInvocation.evidence.at(-1).authorization, "explicit-human-request");
  assert.equal((await readLifecycleState({ home, workflowId })).optionalStage, "wayfinder");
});

test("the normal lifecycle persists every human gate and manual stage as a distinct transition", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-lifecycle-gates-"));
  const workflowId = "AOH-200";
  const requests = [
    ["Inicia grill-with-docs para AOH-200", "start_requirements", "requirements_in_progress"],
    ["Apruebo los requisitos de AOH-200", "approve_requirements", "requirements_approved"],
    ["Genera el spec y Local Visual Plan con to-spec", "create_spec_plan", "spec_plan_ready"],
    ["Apruebo el spec y el Local Visual Plan", "approve_spec_plan", "spec_plan_approved"],
    ["Convierte el spec aprobado a tickets con to-tickets", "create_tickets", "tickets_ready"],
    ["Apruebo los tickets de AOH-200", "approve_tickets", "tickets_approved"],
  ];

  for (const [request, operation, stage] of requests) {
    const result = await runLifecycleRequest({
      home,
      workflowId,
      mode: "transition",
      request,
    });
    assert.equal(result.ok, true, request);
    assert.equal(result.transition.operation, operation);
    assert.equal(result.state.stage, stage);
  }

  const implementPreview = await runLifecycleRequest({
    home,
    workflowId,
    mode: "transition",
    request: "Implementa y entrega el preview de AOH-200",
    terminalSlice: "Persist lifecycle gates and acceptance evidence",
  });

  assert.equal(implementPreview.transition.operation, "authorize_implement_preview");
  assert.equal(implementPreview.state.stage, "delivery_authorized");
  assert.equal(implementPreview.state.terminalSlice, "Persist lifecycle gates and acceptance evidence");
  assert.deepEqual(
    implementPreview.evidence.map((entry) => entry.operation),
    [
      "start_requirements",
      "approve_requirements",
      "create_spec_plan",
      "approve_spec_plan",
      "create_tickets",
      "approve_tickets",
      "authorize_implement_preview",
    ],
  );
  assert.equal((await readLifecycleState({ home, workflowId })).stage, "delivery_authorized");
});

test("Implement Preview grants only the delivery loop while sensitive operations need exact one-shot authorization", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-lifecycle-authorization-"));
  const workflowId = "AOH-201";
  const setup = [
    "Inicia grill-with-docs",
    "Apruebo los requisitos",
    "Genera el spec y Local Visual Plan con to-spec",
    "Apruebo el spec y plan",
    "Genera tickets con to-tickets",
    "Apruebo los tickets",
  ];
  for (const request of setup) {
    assert.equal(
      (await runLifecycleRequest({ home, workflowId, mode: "transition", request })).ok,
      true,
      request,
    );
  }
  await runLifecycleRequest({
    home,
    workflowId,
    mode: "transition",
    request: "Implementa y entrega el preview",
    terminalSlice: "AOH-201 terminal slice",
  });

  const commit = await executeLifecycleOperation({ home, workflowId, operation: "commit" });
  assert.equal(commit.ok, true);
  assert.deepEqual(commit.externalSideEffects, [{ operation: "commit", scope: "AOH-201 terminal slice" }]);

  for (const operation of [
    "merge",
    "release",
    "production",
    "paid_activation",
    "destructive_operation",
  ]) {
    const denied = await executeLifecycleOperation({ home, workflowId, operation });
    assert.equal(denied.ok, false, operation);
    assert.equal(denied.execution.status, "denied");
    assert.equal(denied.externalSideEffects.length, 0);
  }

  const recap = await executeLifecycleOperation({
    home,
    workflowId,
    operation: "generate_recap",
  });
  assert.equal(recap.ok, true);
  assert.equal(recap.state.stage, "pre_release_ready");

  const mergeAuthorization = await runLifecycleRequest({
    home,
    workflowId,
    mode: "transition",
    request: "Autorizo únicamente el merge de AOH-201",
  });
  assert.equal(mergeAuthorization.transition.operation, "authorize_merge");
  assert.equal(mergeAuthorization.state.authorizations.at(-1).operation, "merge");

  assert.equal((await executeLifecycleOperation({ home, workflowId, operation: "merge" })).ok, true);
  assert.equal((await executeLifecycleOperation({ home, workflowId, operation: "merge" })).ok, false);
  assert.equal((await executeLifecycleOperation({ home, workflowId, operation: "release" })).ok, false);

  for (const [operation, request] of [
    ["release", "Autorizo el release"],
    ["production", "Autorizo producción"],
    ["paid_activation", "Autorizo la activación pagada"],
    ["destructive_operation", "Autorizo la operación destructiva"],
  ]) {
    const authorization = await runLifecycleRequest({
      home,
      workflowId,
      mode: "transition",
      request,
    });
    assert.equal(authorization.transition.operation, `authorize_${operation}`);
    assert.equal((await executeLifecycleOperation({ home, workflowId, operation })).ok, true);
    assert.equal((await executeLifecycleOperation({ home, workflowId, operation })).ok, false);
  }
});

test("manual-only stages and delivery operations stay inert before their exact trigger", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-lifecycle-inert-"));
  const workflowId = "AOH-202";
  const statePath = resolve(home, ".development-system", "lifecycles", `${workflowId}.json`);

  const prematureSpec = await runLifecycleRequest({
    home,
    workflowId,
    mode: "transition",
    request: "Genera el spec con to-spec",
  });
  assert.equal(prematureSpec.ok, false);
  assert.equal(prematureSpec.transition.status, "denied");
  assert.equal(prematureSpec.state.stage, "idle");
  assert.equal(prematureSpec.externalSideEffects.length, 0);

  const prematureCommit = await executeLifecycleOperation({ home, workflowId, operation: "commit" });
  assert.equal(prematureCommit.ok, false);
  assert.equal(prematureCommit.execution.status, "denied");
  assert.equal(prematureCommit.externalSideEffects.length, 0);
  await assert.rejects(access(statePath));
});

test("the CLI exposes natural-language lifecycle requests and read-only status", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-lifecycle-cli-"));
  const recommendation = runCli(
    "lifecycle-request",
    "--home",
    home,
    "--workflow",
    "AOH-203",
    "--mode",
    "recommend",
    "--request",
    "Esta iniciativa es enorme y no tiene una ruta clara",
  );
  assert.equal(recommendation.status, 0, recommendation.stderr);
  assert.equal(recommendation.json.selectedStage, "wayfinder");

  const status = runCli("lifecycle-status", "--home", home, "--workflow", "AOH-203");
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.json.state.stage, "idle");
  await assert.rejects(
    access(resolve(home, ".development-system", "lifecycles", "AOH-203.json")),
  );
});

test("lifecycle persistence refuses symlink escapes and invalid state schemas", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-lifecycle-safe-home-"));
  const outside = await mkdtemp(resolve(tmpdir(), "aohys-lifecycle-outside-"));
  await symlink(outside, resolve(home, ".development-system"), "dir");

  await assert.rejects(
    runLifecycleRequest({
      home,
      workflowId: "AOH-204",
      mode: "transition",
      request: "Inicia grill-with-docs",
    }),
    /symbolic link.*HOME/i,
  );
  await assert.rejects(access(resolve(outside, "lifecycles", "AOH-204.json")));

  const schemaHome = await mkdtemp(resolve(tmpdir(), "aohys-lifecycle-schema-"));
  const statePath = resolve(schemaHome, ".development-system", "lifecycles", "AOH-205.json");
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    `${JSON.stringify({ schemaVersion: 99, workflowId: "AOH-205", stage: "idle" })}\n`,
    "utf8",
  );
  await assert.rejects(readLifecycleState({ home: schemaHome, workflowId: "AOH-205" }), /schema/i);
});
