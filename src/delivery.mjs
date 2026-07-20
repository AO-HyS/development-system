// @ts-check

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { executeLifecycleOperation, readLifecycleState } from "./lifecycle.mjs";

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** @param {any} plan */
function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || plan.schemaVersion !== 1) {
    throw new Error("Delivery plan schema is invalid");
  }
  const writerCount = Array.isArray(plan.writers) ? plan.writers.length : plan.writer ? 1 : 0;
  if (writerCount !== 1 || (Array.isArray(plan.writers) && plan.writer)) {
    throw new Error("Implement Preview requires exactly one writer by default");
  }
  if (!plan.tdd || typeof plan.tdd.reason !== "string" || typeof plan.tdd.evidence !== "string") {
    throw new Error("TDD selection requires a reason and evidence");
  }
  if (!plan.qa || typeof plan.qa.reason !== "string") {
    throw new Error("QA selection requires a reason");
  }
  if (plan.qa.level === "omitted" && typeof plan.qa.alternativeEvidence !== "string") {
    throw new Error("QA omission requires alternative evidence");
  }
  if (!Array.isArray(plan.reviewers) || !["intent", "standards"].every(
    (lane) => plan.reviewers.some((/** @type {any} */ reviewer) => reviewer.lane === lane),
  )) {
    throw new Error("Intent and standards review lanes are required");
  }
  if (
    !plan.visualPlan ||
    typeof plan.visualPlan.title !== "string" ||
    !Array.isArray(plan.visualPlan.sections) ||
    plan.visualPlan.sections.length === 0 ||
    !plan.visualPlan.sections.every((/** @type {unknown} */ section) => typeof section === "string" && section.length > 0)
  ) {
    throw new Error("Local Visual Plan requires a title and non-empty sections");
  }
  if (
    !Array.isArray(plan.manualChecklist) ||
    plan.manualChecklist.length === 0 ||
    !plan.manualChecklist.every((/** @type {unknown} */ item) => typeof item === "string" && item.length > 0)
  ) {
    throw new Error("Implement Preview requires a non-empty manual checklist");
  }
  for (const forbidden of ["merge", "release", "production"]) {
    if (plan.steps?.[forbidden] || plan.execution?.[forbidden]) {
      throw new Error(`${forbidden} is outside Implement Preview authorization`);
    }
  }
}

/** @param {string} root @param {string} name @param {string} contents */
async function writePrivateSurface(root, name, contents) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const path = resolve(root, name);
  await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

const surfaceStyles = `<style>
:root { color-scheme: light; --bg: oklch(1 0 0); --surface: oklch(0.97 0.006 91); --ink: oklch(0.19 0.025 78); --muted: oklch(0.42 0.025 78); --line: oklch(0.88 0.012 91); --primary: oklch(0.84 0.165 91.3); --primary-soft: oklch(0.94 0.075 91.3); --accent: oklch(0.32 0.10 320); --success: oklch(0.39 0.105 145); --danger: oklch(0.46 0.17 28); font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font-size: 16px; line-height: 1.6; }
a { color: var(--accent); text-underline-offset: 0.18em; }
a:focus-visible { outline: 3px solid var(--primary); outline-offset: 3px; border-radius: 4px; }
.shell { width: min(100% - 40px, 1040px); margin: 0 auto; padding: 32px 0 72px; }
.masthead { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding-bottom: 22px; border-bottom: 1px solid var(--line); }
.product { margin: 0; font-weight: 720; letter-spacing: -0.02em; }
.privacy { display: inline-flex; align-items: center; gap: 8px; margin: 0; color: var(--muted); font-size: 0.8125rem; font-weight: 650; }
.privacy::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--success); }
.hero { padding: 56px 0 36px; max-width: 760px; }
.hero h1 { margin: 0 0 14px; font-size: 2.65rem; line-height: 1.08; letter-spacing: -0.035em; overflow-wrap: anywhere; text-wrap: balance; }
.hero p { margin: 0; max-width: 68ch; color: var(--muted); font-size: 1.08rem; text-wrap: pretty; }
.label { margin: 0 0 9px; color: var(--muted); font-size: 0.82rem; font-weight: 680; }
.slice { margin: 0; font-size: 1.15rem; font-weight: 650; line-height: 1.45; text-wrap: pretty; }
.plan-layout, .evidence-layout { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(250px, 0.7fr); gap: 56px; align-items: start; }
.plan-flow { margin: 0; padding: 0; list-style: none; counter-reset: plan; }
.plan-flow li { counter-increment: plan; display: grid; grid-template-columns: 42px 1fr; gap: 14px; align-items: start; padding: 18px 0; border-top: 1px solid var(--line); }
.plan-flow li:last-child { border-bottom: 1px solid var(--line); }
.plan-flow li::before { content: counter(plan); display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--primary-soft); color: var(--ink); font-weight: 750; font-variant-numeric: tabular-nums; }
.boundary { padding: 22px; background: var(--surface); border-radius: 12px; }
.boundary p { margin: 0; color: var(--muted); }
.decision-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: center; padding: 26px; color: oklch(0.97 0 0); background: oklch(0.16 0.018 78); border-radius: 14px; }
.decision-bar h2 { margin: 3px 0 6px; font-size: 1.35rem; letter-spacing: -0.02em; }
.decision-bar p { margin: 0; color: oklch(0.78 0.018 78); }
.state { color: var(--primary); font-size: 0.78rem; font-weight: 760; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; }
.action { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px; border-radius: 9px; font-weight: 720; text-decoration: none; }
.action.primary { background: var(--primary); color: oklch(0.18 0.025 78); }
.action.secondary { color: oklch(0.97 0 0); border: 1px solid oklch(0.45 0.02 78); }
.section { padding-top: 38px; }
.section h2 { margin: 0 0 16px; font-size: 1.25rem; letter-spacing: -0.02em; text-wrap: balance; }
.findings, .checklist { margin: 0; padding: 0; list-style: none; }
.findings li, .checklist li { padding: 13px 0; border-top: 1px solid var(--line); }
.findings li:last-child, .checklist li:last-child { border-bottom: 1px solid var(--line); }
.finding-key { color: var(--danger); font-weight: 720; }
.evidence-row { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 12px; padding: 13px 0; border-top: 1px solid var(--line); }
.evidence-row:last-child { border-bottom: 1px solid var(--line); }
.evidence-row strong { color: var(--muted); font-size: 0.82rem; }
.evidence-row span { min-width: 0; overflow-wrap: anywhere; }
.footer-note { margin-top: 42px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.9rem; }
@media (max-width: 760px) { .shell { width: min(100% - 28px, 1040px); padding-top: 20px; } .masthead { align-items: flex-start; flex-direction: column; gap: 8px; } .hero { padding-top: 38px; } .hero h1 { font-size: 2.1rem; } .plan-layout, .evidence-layout, .decision-bar { grid-template-columns: minmax(0, 1fr); gap: 26px; } .decision-bar { padding: 24px; } .actions { flex-direction: column; width: 100%; } .action { flex: 0 0 auto; width: 100%; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
</style>`;

/** @param {{title: string, body: string}} details */
function surfaceDocument(details) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(details.title)}</title>${surfaceStyles}</head><body><main class="shell"><header class="masthead"><p class="product">Development System</p><p class="privacy">Private local surface</p></header>${details.body}</main></body></html>`;
}

/** @param {any} plan */
function visualPlanHtml(plan) {
  const sections = plan.visualPlan.sections.map((/** @type {string} */ section) => `<li>${escapeHtml(section)}</li>`).join("");
  return surfaceDocument({
    title: plan.visualPlan.title,
    body: `<section class="hero"><p class="label">Local Visual Plan</p><h1>${escapeHtml(plan.visualPlan.title)}</h1><p>Execution map for one approved terminal slice.</p></section><div class="plan-layout"><section><p class="label">Authorized slice</p><p class="slice">${escapeHtml(plan.terminalSlice)}</p><div class="section"><h2>Delivery sequence</h2><ol class="plan-flow">${sections}</ol></div></section><aside class="boundary"><p class="label">Authorization boundary</p><p>Implementation may reach code, checks, review, pull request, and preview. Merge, release, and production remain separate human decisions.</p></aside></div><p class="footer-note">This plan stays outside the target repository and pull request.</p>`,
  });
}

/** @param {any} details */
function recapHtml(details) {
  const corrections = details.failuresAndCorrections.length === 0
    ? "<li>No blocking findings remained after review.</li>"
    : details.failuresAndCorrections.map((/** @type {any} */ item) =>
        `<li><span class="finding-key">${escapeHtml(item.fingerprint)}</span><br>${escapeHtml(item.message)}</li>`
      ).join("");
  const checklist = details.plan.manualChecklist.map((/** @type {string} */ item) => `<li>${escapeHtml(item)}</li>`).join("");
  return surfaceDocument({
    title: "Local Visual Recap",
    body: `<section class="hero"><p class="label">Local Visual Recap</p><h1>Inspect the delivery, then decide.</h1><p class="slice">${escapeHtml(details.plan.terminalSlice)}</p></section><section class="decision-bar"><div><span class="state">READY FOR HUMAN REVIEW</span><h2>Preview and pull request are available</h2><p>No promotion authority has been granted.</p></div><div class="actions"><a class="action primary" href="${escapeHtml(details.previewUrl)}" rel="noopener noreferrer">Open preview</a><a class="action secondary" href="${escapeHtml(details.pullRequestUrl)}" rel="noopener noreferrer">Inspect pull request</a></div></section><div class="evidence-layout"><section class="section"><h2>Failures and corrections</h2><ul class="findings">${corrections}</ul><h2 class="section">Risk and evidence</h2><div class="evidence-row"><strong>TDD</strong><span>${escapeHtml(details.plan.tdd.reason)} — ${escapeHtml(details.plan.tdd.evidence)}</span></div><div class="evidence-row"><strong>QA</strong><span>${escapeHtml(details.plan.qa.reason)} — ${escapeHtml(details.plan.qa.alternativeEvidence ?? details.plan.qa.level)}</span></div></section><section class="section"><h2>Manual checklist</h2><ul class="checklist">${checklist}</ul></section></div><p class="footer-note">Merge, release, and production require separate human authorization.</p>`,
  });
}

/** @param {unknown} value */
function isReviewUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** @param {any[]} findings */
function normalizeFindings(findings) {
  if (!Array.isArray(findings)) return [];
  return findings.map((finding, index) => {
    const severity = String(finding?.severity ?? "").trim().toLowerCase();
    const validSeverity = ["blocker", "high", "medium", "low"].includes(severity);
    return {
      ...finding,
      severity: validSeverity ? severity : "high",
      fingerprint: typeof finding?.fingerprint === "string" && finding.fingerprint.length > 0
        ? finding.fingerprint
        : `invalid-review-finding-${index + 1}`,
      message: typeof finding?.message === "string" && finding.message.length > 0
        ? finding.message
        : "Reviewer returned an invalid finding; fail closed until corrected.",
    };
  });
}

/** @param {any[]} findings */
function blockingFindings(findings) {
  return findings.filter((finding) =>
    ["blocker", "high"].includes(finding.severity) ||
    (finding.severity === "medium" && (
      typeof finding.disposition !== "string" || finding.disposition.trim().length === 0
    ))
  );
}

/** @param {any[]} findings */
function findingSignature(findings) {
  return [...new Set(blockingFindings(findings).map((finding) => finding.fingerprint))].sort().join("|");
}

/**
 * @param {{home: string, workflowId: string, plan: any, runtime: {run: (step: string, context: any) => Promise<any>}}} options
 */
export async function runImplementPreview(options) {
  validatePlan(options.plan);
  const lifecycle = await readLifecycleState({ home: options.home, workflowId: options.workflowId });
  if (lifecycle.stage !== "delivery_authorized" || !lifecycle.terminalSlice) {
    throw new Error("Implement Preview has not authorized this workflow");
  }
  if (lifecycle.terminalSlice !== options.plan.terminalSlice) {
    throw new Error("Delivery plan exceeds the authorized terminal slice");
  }
  const privateRoot = resolve(options.home, ".development-system", "private", options.workflowId);
  const visualPlanPath = await writePrivateSurface(
    privateRoot,
    "plan.html",
    visualPlanHtml(options.plan),
  );
  const writer = options.plan.writer ?? options.plan.writers[0];
  /** @type {any[]} */
  const failuresAndCorrections = [];
  /** @type {any[]} */
  const evidence = [];

  for (const step of ["implement", "test", "validate"]) {
    const result = await options.runtime.run(step, {
      workflowId: options.workflowId,
      targetRepository: options.plan.targetRepository,
      terminalSlice: options.plan.terminalSlice,
      writer,
      tdd: options.plan.tdd,
    });
    if (result.ok !== true) return { ok: false, status: "failed", step, result, visualPlanPath };
    evidence.push({ step, result });
    await executeLifecycleOperation({ home: options.home, workflowId: options.workflowId, operation: step });
  }

  let previousBlockingSignature = null;
  for (;;) {
    /** @type {any[]} */
    const roundFindings = [];
    for (const reviewer of options.plan.reviewers) {
      const result = await options.runtime.run("review", {
        workflowId: options.workflowId,
        targetRepository: options.plan.targetRepository,
        terminalSlice: options.plan.terminalSlice,
        lane: reviewer.lane,
        reviewer,
        cleanContextId: randomUUID(),
      });
      if (result.ok !== true) return { ok: false, status: "failed", step: "review", result, visualPlanPath };
      roundFindings.push(...normalizeFindings(result.findings));
      evidence.push({ step: "review", lane: reviewer.lane, result });
    }
    await executeLifecycleOperation({ home: options.home, workflowId: options.workflowId, operation: "review" });
    const open = blockingFindings(roundFindings);
    if (open.length === 0) break;
    const signature = findingSignature(roundFindings);
    if (signature.length > 0 && signature === previousBlockingSignature) {
      return {
        ok: false,
        status: "paused-non-convergent",
        repeatedFindings: open,
        visualPlanPath,
        evidence,
      };
    }
    previousBlockingSignature = signature;
    failuresAndCorrections.push(...open);
    const correction = await options.runtime.run("correct", {
      workflowId: options.workflowId,
      targetRepository: options.plan.targetRepository,
      terminalSlice: options.plan.terminalSlice,
      writer,
      findings: open,
    });
    if (correction.ok !== true) return { ok: false, status: "failed", step: "correct", correction, visualPlanPath };
    evidence.push({ step: "correct", result: correction });
    await executeLifecycleOperation({ home: options.home, workflowId: options.workflowId, operation: "correct" });
    for (const step of ["test", "validate"]) {
      const rerun = await options.runtime.run(step, {
        workflowId: options.workflowId,
        targetRepository: options.plan.targetRepository,
        terminalSlice: options.plan.terminalSlice,
        writer,
        afterCorrection: true,
      });
      if (rerun.ok !== true) return { ok: false, status: "failed", step, result: rerun, visualPlanPath };
      evidence.push({ step, result: rerun });
      await executeLifecycleOperation({ home: options.home, workflowId: options.workflowId, operation: step });
    }
  }

  if (options.plan.qa.level !== "omitted") {
    const qa = await options.runtime.run("qa", {
      workflowId: options.workflowId,
      targetRepository: options.plan.targetRepository,
      selection: options.plan.qa,
    });
    if (qa.ok !== true) return { ok: false, status: "failed", step: "qa", result: qa, visualPlanPath };
    evidence.push({ step: "qa", result: qa });
  } else {
    evidence.push({ step: "qa", omitted: true, alternativeEvidence: options.plan.qa.alternativeEvidence });
  }
  await executeLifecycleOperation({ home: options.home, workflowId: options.workflowId, operation: "qa" });

  let pullRequestUrl = "";
  let previewUrl = "";
  for (const step of ["commit", "push", "open_pr", "publish_preview"]) {
    const result = await options.runtime.run(step, {
      workflowId: options.workflowId,
      targetRepository: options.plan.targetRepository,
      terminalSlice: options.plan.terminalSlice,
      writer,
    });
    if (result.ok !== true) return { ok: false, status: "failed", step, result, visualPlanPath };
    if (step === "open_pr") pullRequestUrl = result.url ?? "";
    if (step === "publish_preview") previewUrl = result.url ?? "";
    evidence.push({ step, result });
    await executeLifecycleOperation({ home: options.home, workflowId: options.workflowId, operation: step });
  }
  if (!isReviewUrl(pullRequestUrl) || !isReviewUrl(previewUrl)) {
    return { ok: false, status: "failed", step: "decision-surface", reason: "Valid HTTP(S) PR and preview URLs are required", visualPlanPath };
  }
  const recapPath = await writePrivateSurface(
    privateRoot,
    "recap.html",
    recapHtml({ plan: options.plan, failuresAndCorrections, pullRequestUrl, previewUrl }),
  );
  const preRelease = await executeLifecycleOperation({
    home: options.home,
    workflowId: options.workflowId,
    operation: "generate_recap",
  });
  if (!preRelease.ok) {
    return { ok: false, status: "failed", step: "generate_recap", result: preRelease, visualPlanPath, recapPath };
  }
  return {
    ok: true,
    status: "ready-for-human",
    pullRequestUrl,
    previewUrl,
    visualPlanPath,
    recapPath,
    failuresAndCorrections,
    evidence,
    externalSideEffects: evidence
      .filter((entry) => ["commit", "push", "open_pr", "publish_preview"].includes(entry.step))
      .map((entry) => entry.step),
    promotionAuthorization: "not-granted",
  };
}

/** @param {string} text */
function parseCommandOutput(text) {
  const candidates = [text.trim(), ...text.trim().split("\n").reverse()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue to the next candidate; plain text is valid evidence.
    }
  }
  return { evidence: text.trim() };
}

/**
 * Execute a delivery plan without a shell. Every step is a separate process so review
 * lanes receive clean runtime context. The plan cannot name promotion operations.
 * @param {any} plan
 */
export function createCommandDeliveryRuntime(plan) {
  validatePlan(plan);
  return {
    async run(/** @type {string} */ step, /** @type {any} */ context) {
      const specification = step === "review"
        ? plan.execution?.review?.[context.lane]
        : plan.execution?.[step];
      if (!specification || typeof specification.command !== "string" || !Array.isArray(specification.args)) {
        return { ok: false, error: `No structured command is configured for ${step}` };
      }
      if (["merge", "release", "production"].includes(step)) {
        return { ok: false, error: `${step} is outside Implement Preview authorization` };
      }
      const cwd = resolve(specification.cwd ?? plan.targetRepository);
      const result = spawnSync(specification.command, specification.args, {
        cwd,
        encoding: "utf8",
        shell: false,
        maxBuffer: 20 * 1024 * 1024,
        env: {
          ...process.env,
          AOHYS_WORKFLOW_ID: context.workflowId,
          AOHYS_TERMINAL_SLICE: context.terminalSlice ?? plan.terminalSlice,
          AOHYS_REVIEW_LANE: context.lane ?? "",
          AOHYS_CLEAN_CONTEXT_ID: context.cleanContextId ?? "",
          AOHYS_REVIEW_FINDINGS_JSON: JSON.stringify(context.findings ?? []),
        },
      });
      const parsed = parseCommandOutput(result.stdout ?? "");
      return {
        ...parsed,
        ok: result.status === 0 && parsed.ok !== false,
        command: [specification.command, ...specification.args].join(" "),
        exitCode: result.status,
        stderr: result.stderr ?? "",
      };
    },
  };
}
