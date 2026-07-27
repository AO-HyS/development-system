#!/usr/bin/env node

import { readFile } from "node:fs/promises";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const inputPath = option("--input");
if (!inputPath) throw new Error("Usage: evaluate-goal.mjs --input <run.json>");
const run = JSON.parse(await readFile(inputPath, "utf8"));

if (run.schemaVersion !== 1 || !["tiny", "multiple"].includes(run.mode)) {
  throw new Error("Run record requires schemaVersion 1 and mode tiny|multiple");
}

const criteria = Array.isArray(run.acceptanceCriteria) ? run.acceptanceCriteria : [];
const checks = Array.isArray(run.checks) ? run.checks : [];
const reviews = Array.isArray(run.reviews) ? run.reviews : [];
const failures = [];
const unavailable = [];
const finiteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const correctness = {
  status: criteria.length > 0 && criteria.every((item) =>
    item.verified === true &&
    typeof item.proves === "string" &&
    item.proves.trim().length > 0 &&
    typeof item.observed === "string" &&
    item.observed.trim().length > 0
  )
    ? "met"
    : "missed",
  evidence: criteria.map((item) => ({
    id: item.id,
    verified: item.verified === true,
    proves: item.proves ?? null,
  })),
};
if (correctness.status === "missed") {
  failures.push("Every acceptance criterion needs functional evidence.");
}

const applicableChecks = checks.filter((check) => check.applicable !== false);
const relevantChecksPass =
  applicableChecks.length > 0 &&
  applicableChecks.every((check) =>
    check.passed === true &&
    typeof check.proves === "string" &&
    check.proves.trim().length > 0 &&
    typeof check.observed === "string" &&
    check.observed.trim().length > 0
  );
const reviewsPass =
  reviews.length === 2 &&
  reviews.every((review) =>
    review.contextIsolated === true &&
    typeof review.sessionId === "string" &&
    review.sessionId.trim().length > 0 &&
    typeof review.eventId === "string" &&
    review.eventId.trim().length > 0 &&
    ["standards", "intent"].includes(review.brief) &&
    Number(review.blocker ?? 0) === 0 &&
    Number(review.high ?? 0) === 0 &&
    (
      Number(review.medium ?? 0) === 0 ||
      (
        typeof review.mediumDisposition === "string" &&
        review.mediumDisposition.trim().length > 0
      )
    )
  ) &&
  new Set(reviews.map((review) => review.sessionId)).size === 2 &&
  new Set(reviews.map((review) => review.eventId)).size === 2 &&
  new Set(reviews.map((review) => review.brief)).size === 2;
const qa = run.manualQa ?? {};
const manualQaPass =
  ["not-applicable", "skipped"].includes(qa.decision)
    ? typeof qa.reason === "string" && qa.reason.trim().length > 0
    : qa.decision === "required" &&
      typeof qa.evidence === "string" &&
      qa.evidence.trim().length > 0;
const quality = {
  status: relevantChecksPass && reviewsPass && manualQaPass ? "met" : "missed",
  relevantChecksPass,
  independentReviewsPass: reviewsPass,
  manualQaPass,
};
if (!relevantChecksPass) failures.push("A relevant fast check failed or lacks meaning.");
if (!reviewsPass) failures.push("Two isolated reviews without blocker/high findings are required.");
if (!manualQaPass) failures.push("Manual QA decision or evidence is incomplete.");

const elapsed = run.functionalEvidenceMs;
let speed;
if (!finiteNumber(elapsed) || elapsed < 0) {
  speed = { status: "missed", reason: "functionalEvidenceMs is invalid" };
  failures.push("Functional-evidence timing is invalid.");
} else if (run.mode === "tiny") {
  speed = elapsed <= 300_000
    ? { status: "met", functionalEvidenceMs: elapsed, targetMs: 300_000 }
    : elapsed <= 600_000
      ? {
          status: "missed",
          functionalEvidenceMs: elapsed,
          ceilingMs: 600_000,
          reason: "within exceptional ceiling but above the goal",
        }
      : {
          status: "missed",
          functionalEvidenceMs: elapsed,
          ceilingMs: 600_000,
          reason: "process-audit required",
        };
  if (speed.status === "missed") failures.push("Tiny work missed the five-minute goal.");
} else {
  const baseline = run.sequentialBaselineMs;
  if (!finiteNumber(baseline) || baseline <= 0) {
    speed = {
      status: "unproven",
      functionalEvidenceMs: elapsed,
      reason: "A comparable sequential baseline is unavailable.",
    };
    unavailable.push("Multiple-work speedup lacks a comparable sequential baseline.");
  } else {
    speed = {
      status: elapsed < baseline ? "met" : "missed",
      functionalEvidenceMs: elapsed,
      sequentialBaselineMs: baseline,
      speedup: baseline / elapsed,
    };
    if (speed.status === "missed") failures.push("Parallel work did not beat the sequential baseline.");
  }
}

const resource = run.resourceUsage ?? {};
let cost;
if (
  resource.authoritativeCost?.status === "reported" &&
  finiteNumber(resource.authoritativeCost.amount) &&
  finiteNumber(resource.authoritativeCost.baselineAmount) &&
  typeof resource.authoritativeCost.currency === "string" &&
  resource.authoritativeCost.currency.trim().length > 0 &&
  typeof resource.authoritativeCost.source === "string" &&
  resource.authoritativeCost.source.trim().length > 0 &&
  typeof resource.authoritativeCost.baselineSource === "string" &&
  resource.authoritativeCost.baselineSource.trim().length > 0
) {
  const costStatus = resource.authoritativeCost.amount <=
      resource.authoritativeCost.baselineAmount
    ? "met"
    : "missed";
  cost = {
    ...resource.authoritativeCost,
    status: costStatus,
  };
  if (cost.status === "missed") failures.push("Authoritative cost exceeded the baseline.");
} else {
  cost = {
    status: "unproven",
    reason: "Comparable authoritative cost is unavailable; token counts alone are not price.",
    tokens: finiteNumber(resource.tokens) ? resource.tokens : null,
    baselineTokens: finiteNumber(resource.baselineTokens)
      ? resource.baselineTokens
      : null,
  };
  unavailable.push("Cost goal is unproven.");
}

const lanes = Number(run.laneCount);
const tickets = Number(run.ticketCount);
const explicitModeValid = run.mode === "multiple"
  ? run.explicitlyInvoked === true
  : lanes === 1 && tickets === 1;
const simplicity = {
  status:
    Number.isInteger(lanes) &&
    Number.isInteger(tickets) &&
    lanes > 0 &&
    tickets >= lanes &&
    explicitModeValid
      ? "met"
      : "missed",
  laneCount: lanes,
  ticketCount: tickets,
  explicitlyInvoked: run.explicitlyInvoked === true,
};
if (simplicity.status === "missed") {
  failures.push("Lane count or multiple-mode invocation violates the simplicity contract.");
}

const axes = { correctness, quality, speed, cost, simplicity };
const axisStatuses = Object.values(axes).map((axis) => axis.status);
const status = axisStatuses.includes("missed")
  ? "missed"
  : axisStatuses.includes("unproven")
    ? "unproven"
    : "met";

process.stdout.write(`${JSON.stringify({
  goal: "Deliver correct functionality to the authorized state as fast as possible, with useful quality, the lowest measured cost, and the least complexity.",
  status,
  axes,
  failures,
  unavailable,
}, null, 2)}\n`);
