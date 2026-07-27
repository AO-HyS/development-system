import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const skillRoot = resolve("artifacts/0.9.0/skills/internal/work-multiple");

async function runJsonScript(script, input) {
  const directory = await mkdtemp(resolve(tmpdir(), "development-goal-"));
  const inputPath = resolve(directory, "input.json");
  await writeFile(inputPath, `${JSON.stringify(input)}\n`);
  const result = spawnSync(
    process.execPath,
    [resolve(skillRoot, "scripts", script), "--input", inputPath],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function completeRun(overrides = {}) {
  return {
    schemaVersion: 1,
    mode: "tiny",
    functionalEvidenceMs: 240_000,
    acceptanceCriteria: [
      {
        id: "AOH-1",
        verified: true,
        proves: "The requested behavior works.",
        observed: "The bounded acceptance behavior completed successfully.",
      },
    ],
    checks: [
      {
        applicable: true,
        passed: true,
        proves: "The changed contract passes.",
        observed: "The focused contract check exited successfully.",
      },
    ],
    reviews: [
      {
        contextIsolated: true,
        sessionId: "review-session-standards",
        eventId: "review-event-standards",
        brief: "standards",
        blocker: 0,
        high: 0,
        medium: 0,
      },
      {
        contextIsolated: true,
        sessionId: "review-session-intent",
        eventId: "review-event-intent",
        brief: "intent",
        blocker: 0,
        high: 0,
        medium: 0,
      },
    ],
    manualQa: {
      decision: "skipped",
      reason: "A label changed without behavioral risk.",
    },
    resourceUsage: {
      tokens: 800,
      baselineTokens: 1_000,
      authoritativeCost: {
        status: "reported",
        currency: "USD",
        amount: 0.08,
        baselineAmount: 0.1,
        source: "provider-run-current",
        baselineSource: "provider-run-baseline",
      },
    },
    laneCount: 1,
    ticketCount: 1,
    explicitlyInvoked: false,
    ...overrides,
  };
}

test("the skill is explicit and preserves the constant goal", async () => {
  const skill = await readFile(resolve(skillRoot, "SKILL.md"), "utf8");
  const metadata = await readFile(resolve(skillRoot, "agents/openai.yaml"), "utf8");
  assert.match(skill, /never infer activation/i);
  assert.match(skill, /Deliver correct functionality to the authorized state/i);
  assert.match(metadata, /allow_implicit_invocation:\s*false/);
});

test("UI QA is not applicable, skipped, or required by observable risk", async () => {
  assert.deepEqual(
    await runJsonScript("select-qa.mjs", { uiChanged: false }),
    {
      decision: "not-applicable",
      reason: "No user-interface surface changed.",
    },
  );
  assert.equal(
    (await runJsonScript("select-qa.mjs", {
      uiChanged: true,
      labelOnly: true,
    })).decision,
    "skipped",
  );
  assert.equal(
    (await runJsonScript("select-qa.mjs", {
      uiChanged: true,
      interactive: true,
    })).decision,
    "required",
  );

  const directory = await mkdtemp(resolve(tmpdir(), "development-qa-invalid-"));
  const inputPath = resolve(directory, "input.json");
  await writeFile(inputPath, `${JSON.stringify({
    uiChanged: false,
    interactive: true,
  })}\n`);
  const contradiction = spawnSync(
    process.execPath,
    [resolve(skillRoot, "scripts/select-qa.mjs"), "--input", inputPath],
    { encoding: "utf8" },
  );
  assert.notEqual(contradiction.status, 0);
  assert.match(contradiction.stderr, /cannot be declared/i);

  await writeFile(inputPath, `${JSON.stringify({
    uiChanged: true,
    interactive: "true",
  })}\n`);
  const invalidType = spawnSync(
    process.execPath,
    [resolve(skillRoot, "scripts/select-qa.mjs"), "--input", inputPath],
    { encoding: "utf8" },
  );
  assert.notEqual(invalidType.status, 0);
  assert.match(invalidType.stderr, /must be boolean/i);
});

test("five minutes is success while the exceptional ceiling is still a miss", async () => {
  assert.equal((await runJsonScript("evaluate-goal.mjs", completeRun())).status, "met");
  const exception = await runJsonScript(
    "evaluate-goal.mjs",
    completeRun({ functionalEvidenceMs: 420_000 }),
  );
  assert.equal(exception.status, "missed");
  assert.equal(exception.axes.speed.status, "missed");
  assert.match(exception.axes.speed.reason, /exceptional ceiling/i);
});

test("multiple work never invents speed or cost evidence", async () => {
  const result = await runJsonScript(
    "evaluate-goal.mjs",
    completeRun({
      mode: "multiple",
      functionalEvidenceMs: 300_000,
      sequentialBaselineMs: undefined,
      resourceUsage: {},
      laneCount: 2,
      ticketCount: 4,
      explicitlyInvoked: true,
    }),
  );
  assert.equal(result.status, "unproven");
  assert.equal(result.axes.speed.status, "unproven");
  assert.equal(result.axes.cost.status, "unproven");
});

test("empty proof and token-only price cannot produce a green goal", async () => {
  const emptyProof = await runJsonScript(
    "evaluate-goal.mjs",
    completeRun({
      acceptanceCriteria: [{ id: "AOH-1", verified: true }],
      checks: [],
    }),
  );
  assert.equal(emptyProof.axes.correctness.status, "missed");
  assert.equal(emptyProof.axes.quality.status, "missed");

  const tokenOnly = await runJsonScript(
    "evaluate-goal.mjs",
    completeRun({
      resourceUsage: { tokens: 500, baselineTokens: 1_000 },
    }),
  );
  assert.equal(tokenOnly.status, "unproven");
  assert.equal(tokenOnly.axes.cost.status, "unproven");
});

test("multiple work meets the goal only with comparable evidence on every axis", async () => {
  const result = await runJsonScript(
    "evaluate-goal.mjs",
    completeRun({
      mode: "multiple",
      functionalEvidenceMs: 300_000,
      sequentialBaselineMs: 600_000,
      laneCount: 2,
      ticketCount: 4,
      explicitlyInvoked: true,
    }),
  );
  assert.equal(result.status, "met");
  assert.equal(result.axes.speed.speedup, 2);

  const failedReview = await runJsonScript(
    "evaluate-goal.mjs",
    completeRun({
      reviews: [
        {
          contextIsolated: true,
          sessionId: "same-session",
          eventId: "same-event",
          brief: "standards",
          blocker: 0,
          high: 0,
        },
        {
          contextIsolated: true,
          sessionId: "same-session",
          eventId: "same-event",
          brief: "intent",
          blocker: 0,
          high: 1,
        },
      ],
    }),
  );
  assert.equal(failedReview.status, "missed");
  assert.equal(failedReview.axes.quality.status, "missed");
});

test("invalid timing, invalid cost, and duplicated review receipts fail closed", async () => {
  const invalid = await runJsonScript(
    "evaluate-goal.mjs",
    completeRun({
      functionalEvidenceMs: null,
      resourceUsage: {
        authoritativeCost: {
          status: "reported",
          currency: "USD",
          amount: null,
          baselineAmount: null,
          source: "provider-run-current",
          baselineSource: "provider-run-baseline",
        },
      },
      reviews: [
        {
          contextIsolated: true,
          sessionId: "same-session",
          eventId: "same-event",
          brief: "standards",
          blocker: 0,
          high: 0,
        },
        {
          contextIsolated: true,
          sessionId: "same-session",
          eventId: "same-event",
          brief: "intent",
          blocker: 0,
          high: 0,
        },
      ],
    }),
  );
  assert.equal(invalid.status, "missed");
  assert.equal(invalid.axes.speed.status, "missed");
  assert.equal(invalid.axes.cost.status, "unproven");
  assert.equal(invalid.axes.quality.status, "missed");

  const expensive = await runJsonScript(
    "evaluate-goal.mjs",
    completeRun({
      resourceUsage: {
        authoritativeCost: {
          status: "reported",
          currency: "USD",
          amount: 0.2,
          baselineAmount: 0.1,
          source: "provider-run-current",
          baselineSource: "provider-run-baseline",
        },
      },
    }),
  );
  assert.equal(expensive.status, "missed");
  assert.equal(expensive.axes.cost.status, "missed");
});
