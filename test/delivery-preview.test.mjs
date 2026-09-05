import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { createCommandDeliveryRuntime, runImplementPreview } from "../src/delivery.mjs";
import { readLifecycleState, runLifecycleRequest } from "../src/lifecycle.mjs";

async function authorizedWorkflow(home, workflowId) {
  for (const request of [
    "Inicia grill-with-docs",
    "Apruebo los requisitos",
    "Genera el spec y Local Visual Plan con to-spec",
    "Apruebo el spec y plan",
    "Genera tickets con to-tickets",
    "Apruebo los tickets",
  ]) {
    assert.equal(
      (await runLifecycleRequest({ home, workflowId, mode: "transition", request })).ok,
      true,
    );
  }
  await runLifecycleRequest({
    home,
    workflowId,
    mode: "transition",
    request: "Implementa y entrega el preview",
    terminalSlice: "Deliver AOH-145 without merge",
  });
}

function deliveryPlan(targetRepository) {
  return {
    schemaVersion: 2,
    targetRepository,
    terminalSlice: "Deliver AOH-145 without merge",
    writer: { surface: "codex", role: "implementer" },
    reviewers: [
      { lane: "intent", surface: "factory", role: "adversarial-reviewer" },
      { lane: "standards", surface: "codex", role: "reviewer" },
    ],
    tdd: { selection: "required", reason: "contract and regression logic", evidence: "public scenario seam" },
    qa: { level: "omitted", reason: "internal CLI only", alternativeEvidence: "CLI acceptance scenario" },
    providerReadiness: {
      required: true,
      reason: "preview environment contract changed",
      surfaces: ["environment"],
    },
    visualPlan: {
      title: "AOH-145 Implement Preview",
      sections: ["Scope", "Review lanes", "Preview decision"],
    },
    manualChecklist: ["Inspect the PR", "Open the preview", "Authorize merge separately"],
  };
}

test("Implement Preview reaches a private decision surface without promotion authority", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-delivery-home-"));
  const repository = await mkdtemp(resolve(tmpdir(), "aohys-delivery-repo-"));
  const workflowId = "AOH-145";
  await authorizedWorkflow(home, workflowId);
  const privateRoot = resolve(home, ".development-system", "private", workflowId);
  await mkdir(privateRoot, { recursive: true, mode: 0o755 });
  await writeFile(resolve(privateRoot, "plan.html"), "stale", { mode: 0o644 });
  const calls = [];
  let reviewRound = 0;
  const runtime = {
    async run(step, context) {
      calls.push({ step, context });
      if (step === "review") {
        if (context.lane === "intent") reviewRound += 1;
        if (reviewRound === 1 && context.lane === "intent") {
          return {
            ok: true,
            findings: [
              { severity: "High", fingerprint: "missing-preview-gate", message: "Preview gate is absent" },
              { severity: "medium", disposition: "", fingerprint: "unclear-copy", message: "Decision copy is ambiguous" },
            ],
          };
        }
        return { ok: true, findings: [] };
      }
      if (step === "full_certification") return { ok: true, certified: true };
      if (step === "provider_readiness") return { ok: true, ready: true };
      if (step === "open_pr") return { ok: true, url: "https://example.test/pr/145" };
      if (step === "publish_preview") return { ok: true, url: "https://preview.example.test/aoh-145" };
      return { ok: true, evidence: `${step} verified` };
    },
  };

  const result = await runImplementPreview({
    home,
    workflowId,
    plan: deliveryPlan(repository),
    runtime,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready-for-human");
  assert.equal(result.pullRequestUrl, "https://example.test/pr/145");
  assert.equal(result.previewUrl, "https://preview.example.test/aoh-145");
  assert.equal((await readLifecycleState({ home, workflowId })).stage, "pre_release_ready");
  assert.ok(calls.some((call) => call.step === "correct"));
  assert.ok(result.failuresAndCorrections.some((finding) => finding.fingerprint === "unclear-copy"));
  assert.ok(calls.filter((call) => call.step === "review").every((call) => call.context.cleanContextId));
  assert.ok(!calls.some((call) => ["merge", "release", "production"].includes(call.step)));
  assert.equal(calls.filter((call) => call.step === "full_certification").length, 1);
  assert.equal(calls.filter((call) => call.step === "provider_readiness").length, 1);
  assert.equal(calls.filter((call) => call.step === "publish_preview").length, 1);
  assert.ok(calls.findIndex((call) => call.step === "commit") < calls.findIndex((call) => call.step === "full_certification"));
  assert.ok(calls.findIndex((call) => call.step === "full_certification") < calls.findIndex((call) => call.step === "push"));
  assert.ok(calls.findIndex((call) => call.step === "provider_readiness") < calls.findIndex((call) => call.step === "publish_preview"));
  assert.ok(!calls.some((call) => call.step === "validate"));
  assert.ok(calls.some((call) => call.step === "changed_validation"));

  const recap = await readFile(result.recapPath, "utf8");
  assert.match(recap, /Failures and corrections/i);
  assert.match(recap, /missing-preview-gate/i);
  assert.match(recap, /https:\/\/preview\.example\.test\/aoh-145/);
  assert.match(recap, /Authorize merge separately/i);
  assert.match(recap, /name="viewport"/i);
  assert.match(recap, /development-system-technical-reader/i);
  assert.match(recap, /reader-report/i);
  const recapBody = recap.slice(recap.indexOf("<body"), recap.indexOf("<script>"));
  assert.doesNotMatch(recapBody, /authority-state/);
  assert.doesNotMatch(recapBody, /Implementation authorized/);
  assert.ok(result.recapPath.startsWith(resolve(home, ".development-system", "private", "documents")));
  const recapMarkdown = await readFile(result.recapMarkdownPath, "utf8");
  assert.match(recapMarkdown, /Deliver AOH-145 without merge/);
  assert.match(recapMarkdown, /missing-preview-gate/);
  assert.match(recapMarkdown, /https:\/\/preview\.example\.test\/aoh-145/);
  assert.match(recapMarkdown, /Authorize merge separately/i);
  assert.ok(result.visualPlanPath.startsWith(resolve(home, ".development-system", "private")));
  assert.ok(result.recapPath.startsWith(resolve(home, ".development-system", "private")));
  assert.equal((await stat(privateRoot)).mode & 0o777, 0o700);
  assert.equal((await stat(result.visualPlanPath)).mode & 0o777, 0o600);
  assert.equal((await stat(result.recapPath)).mode & 0o777, 0o600);
});
test("a false success receipt cannot advance the lifecycle", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-delivery-document-failure-"));
  const repository = await mkdtemp(resolve(tmpdir(), "aohys-delivery-document-failure-repo-"));
  const workflowId = "AOH-145-DOCUMENT-FAILURE";
  await authorizedWorkflow(home, workflowId);

  const result = await runImplementPreview({
    home,
    workflowId,
    plan: deliveryPlan(repository),
    runtime: {
      async run(step) {
        if (step === "review") return { ok: true, findings: [] };
        if (step === "full_certification") return { ok: true, certified: true };
        if (step === "provider_readiness") return { ok: true, ready: true };
        if (step === "open_pr") return { ok: true, url: "https://example.test/pr/145" };
        if (step === "publish_preview") return { ok: true, url: "https://preview.example.test/aoh-145" };
        return { ok: true };
      },
    },
    documentWriter: async () => ({ generated: true, markdownPath: resolve(home, "missing.md"), htmlPath: resolve(home, "missing.html"), sourceSha256: "0".repeat(64), htmlSha256: "0".repeat(64) }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(result.step, "document");
  assert.match(result.reason, /Technical recap generation failed/);
  assert.equal(result.recapPath, undefined);
  assert.ok(Array.isArray(result.evidence) && result.evidence.length > 0);
  assert.deepEqual(result.externalSideEffects, ["commit", "push", "open_pr", "publish_preview"]);
  assert.equal((await readLifecycleState({ home, workflowId })).stage, "delivery_authorized");
});

test("structured command runtime passes correction findings without a shell and rejects promotion commands", async () => {
  const repository = await mkdtemp(resolve(tmpdir(), "aohys-command-runtime-"));
  const base = deliveryPlan(repository);
  const plan = {
    ...base,
    execution: {
      correct: {
        command: process.execPath,
        args: ["-e", "process.stdout.write(JSON.stringify({ok:true, findings:JSON.parse(process.env.AOHYS_REVIEW_FINDINGS_JSON)}))"],
      },
      full_certification: {
        command: process.execPath,
        args: ["-e", "process.stdout.write(JSON.stringify({ok:true, certified:true}))"],
      },
    },
  };
  const runtime = createCommandDeliveryRuntime(plan);
  const findings = [{ severity: "high", fingerprint: "authorization-gap", message: "Missing gate" }];
  const corrected = await runtime.run("correct", {
    workflowId: "AOH-145-COMMAND",
    terminalSlice: base.terminalSlice,
    findings,
  });

  assert.equal(corrected.ok, true);
  assert.deepEqual(corrected.findings, findings);
  assert.deepEqual(
    await runtime.run("full_certification", {
      workflowId: "AOH-145-COMMAND",
      terminalSlice: base.terminalSlice,
    }),
    {
      ok: true,
      certified: true,
      command: `${process.execPath} -e process.stdout.write(JSON.stringify({ok:true, certified:true}))`,
      exitCode: 0,
      stderr: "",
    },
  );
  assert.throws(
    () => createCommandDeliveryRuntime({
      ...plan,
      execution: { ...plan.execution, merge: { command: "git", args: ["merge"] } },
    }),
    /merge.*outside/i,
  );
});

test("repeated blocker or high findings pause the loop as non-convergent", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-delivery-loop-"));
  const repository = await mkdtemp(resolve(tmpdir(), "aohys-delivery-loop-repo-"));
  const workflowId = "AOH-145-NONCONVERGENT";
  await authorizedWorkflow(home, workflowId);

  const result = await runImplementPreview({
    home,
    workflowId,
    plan: deliveryPlan(repository),
    runtime: {
      async run(step) {
        if (step === "review") {
          return {
            ok: true,
            findings: [{ severity: "blocker", fingerprint: "same-defect", message: "Still broken" }],
          };
        }
        return { ok: true, evidence: `${step} complete` };
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "paused-non-convergent");
  assert.equal((await readLifecycleState({ home, workflowId })).stage, "delivery_authorized");
  await assert.rejects(access(resolve(home, ".development-system", "private", workflowId, "recap.html")));
  await assert.rejects(access(resolve(home, ".development-system", "private", "documents")));
});

test("delivery planning enforces one writer and evidence for proportional TDD and QA", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-delivery-plan-"));
  const repository = await mkdtemp(resolve(tmpdir(), "aohys-delivery-plan-repo-"));
  const workflowId = "AOH-145-PLAN";
  await authorizedWorkflow(home, workflowId);
  const base = deliveryPlan(repository);
  const runtime = { async run() { return { ok: true }; } };

  await assert.rejects(
    runImplementPreview({ home, workflowId, plan: { ...base, writers: [base.writer, base.writer] }, runtime }),
    /one writer/i,
  );
  await assert.rejects(
    runImplementPreview({ home, workflowId, plan: { ...base, tdd: { selection: "omitted" } }, runtime }),
    /TDD.*reason.*evidence/i,
  );
  await assert.rejects(
    runImplementPreview({ home, workflowId, plan: { ...base, qa: { level: "omitted", reason: "internal" } }, runtime }),
    /QA.*alternative/i,
  );
  await assert.rejects(
    runImplementPreview({
      home,
      workflowId,
      plan: { ...base, providerReadiness: { required: true, reason: "provider changed", surfaces: [] } },
      runtime,
    }),
    /provider readiness.*surfaces/i,
  );
});

test("publication uses Git continuity without requiring SHA bookkeeping", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-delivery-git-"));
  const repository = await mkdtemp(resolve(tmpdir(), "aohys-delivery-git-repo-"));
  const workflowId = "AOH-145-GIT";
  await authorizedWorkflow(home, workflowId);

  const result = await runImplementPreview({
    home,
    workflowId,
    plan: deliveryPlan(repository),
    runtime: {
      async run(step) {
        if (step === "review") return { ok: true, findings: [] };
        if (step === "full_certification") return { ok: true, certified: true };
        if (step === "provider_readiness") return { ok: true, ready: true };
        if (step === "open_pr") return { ok: true, url: "https://example.test/pr/145" };
        if (step === "publish_preview") {
          return { ok: true, url: "https://preview.example.test/aoh-145" };
        }
        return { ok: true };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready-for-human");
});

test("full certification still fails closed when its native result is missing", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-delivery-certification-"));
  const repository = await mkdtemp(resolve(tmpdir(), "aohys-delivery-certification-repo-"));
  const workflowId = "AOH-145-CERTIFICATION";
  await authorizedWorkflow(home, workflowId);

  const result = await runImplementPreview({
    home,
    workflowId,
    plan: deliveryPlan(repository),
    runtime: {
      async run(step) {
        if (step === "review") return { ok: true, findings: [] };
        if (step === "full_certification") return { ok: true };
        return { ok: true };
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "full_certification");
  assert.match(result.reason, /certified=true/i);
});

test("the final recap is a real generated technical document with hash receipts", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-delivery-document-"));
  const repository = await mkdtemp(resolve(tmpdir(), "aohys-delivery-document-repo-"));
  const workflowId = "AOH-145-DOCUMENT";
  await authorizedWorkflow(home, workflowId);

  const result = await runImplementPreview({
    home,
    workflowId,
    plan: deliveryPlan(repository),
    runtime: {
      async run(step) {
        if (step === "review") return { ok: true, findings: [] };
        if (step === "full_certification") return { ok: true, certified: true };
        if (step === "provider_readiness") return { ok: true, ready: true };
        if (step === "open_pr") return { ok: true, url: "https://example.test/pr/145" };
        if (step === "publish_preview") return { ok: true, url: "https://preview.example.test/aoh-145" };
        return { ok: true };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready-for-human");
  assert.equal(result.promotionAuthorization, "not-granted");
  assert.ok(result.recapPath.endsWith(".html"));
  assert.ok(result.recapMarkdownPath.endsWith(".md"));
  const markdown = await readFile(result.recapMarkdownPath, "utf8");
  const html = await readFile(result.recapPath, "utf8");
  assert.equal(result.recapDocument.sourceSha256, createHash("sha256").update(markdown, "utf8").digest("hex"));
  assert.ok(html.includes('href="https://example.test/pr/145"'));
  assert.ok(html.includes('href="https://preview.example.test/aoh-145"'));
  assert.match(markdown, /Deliver AOH-145 without merge/);
  assert.match(markdown, /No blocking findings remained after review/);
  assert.match(markdown, /contract and regression logic/);
  assert.match(html, /Deliver AOH-145 without merge/);
  assert.match(html, /development-system-technical-reader/);
  const documentBody = html.slice(html.indexOf("<body"), html.indexOf("<script>"));
  assert.doesNotMatch(documentBody, /authority-state/);
  assert.doesNotMatch(documentBody, /Implementation authorized/);
  assert.equal((await readLifecycleState({ home, workflowId })).stage, "pre_release_ready");
});

test("a document generation failure blocks generate_recap without claiming success", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-delivery-document-failure-"));
  const repository = await mkdtemp(resolve(tmpdir(), "aohys-delivery-document-failure-repo-"));
  const workflowId = "AOH-145-DOCUMENT-FAILURE";
  await authorizedWorkflow(home, workflowId);

  const result = await runImplementPreview({
    home,
    workflowId,
    plan: deliveryPlan(repository),
    runtime: {
      async run(step) {
        if (step === "review") return { ok: true, findings: [] };
        if (step === "full_certification") return { ok: true, certified: true };
        if (step === "provider_readiness") return { ok: true, ready: true };
        if (step === "open_pr") return { ok: true, url: "https://example.test/pr/145" };
        if (step === "publish_preview") return { ok: true, url: "https://preview.example.test/aoh-145" };
        return { ok: true };
      },
    },
    documentWriter: async () => { throw new Error("simulated document store failure"); },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(result.step, "document");
  assert.match(result.reason, /Technical recap generation failed: simulated document store failure/);
  assert.equal(result.recapPath, undefined);
  assert.ok(Array.isArray(result.evidence) && result.evidence.length > 0);
  assert.deepEqual(result.externalSideEffects, ["commit", "push", "open_pr", "publish_preview"]);
  assert.equal((await readLifecycleState({ home, workflowId })).stage, "delivery_authorized");
});
