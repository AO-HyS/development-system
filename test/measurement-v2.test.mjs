import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  buildMeasurementScorecard,
  ingestRunRecords,
  validateRunRecord,
  writeMeasurementScorecard,
} from "../src/measurements.mjs";

const ROSTER_HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FIXTURE_HASH = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TERMINAL_SLICE_HASH = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const ROLLBACK_REF = "roster:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

function record(overrides = {}) {
  const value = {
    schemaVersion: 2,
    runId: "run-baseline-1",
    cohort: "baseline",
    repository: {
      id: "development-system",
      commit: "0123456789abcdef0123456789abcdef01234567",
      ticket: "AOH-214",
    },
    benchmark: {
      packetId: "measurement-v2-packet",
      acceptanceId: "measurement-v2-acceptance",
      fixtureHash: FIXTURE_HASH,
      rosterHash: ROSTER_HASH,
    },
    capability: "implementation",
    stage: "flow-implement",
    ciPolicy: "required",
    terminalSliceHash: TERMINAL_SLICE_HASH,
    startedAt: "2026-07-20T10:00:00.000Z",
    endedAt: "2026-07-20T10:10:00.000Z",
    verifiedAt: "2026-07-20T10:09:00.000Z",
    waitMs: 30_000,
    result: "success",
    evidenceStatus: "validated",
    gates: {
      requirements: "passed",
      spec: "passed",
      tickets: "passed",
      ci: "passed",
      preview: "not-required",
      humanFinal: "pending",
    },
    agents: [{
      role: "implementer",
      routeSlot: "implementation",
      harness: "codex",
      requestedModel: "gpt-5.6-sol",
      resolvedModel: "gpt-5.6-sol",
      reasoning: "medium",
      durationMs: 570_000,
      tokens: 12_000,
      costUsd: null,
      selectionReason: "bounded-contract-risk",
      result: "success",
      evidenceStatus: "validated",
    }],
    quality: {
      firstAttempt: { passed: false, findings: 1 },
      final: { passed: true, findings: 0 },
      reviews: 1,
      corrections: 1,
      regressions: 0,
      reopens: 0,
      ci: "passed",
      qa: "passed",
      preview: "not-run",
      escapedDefects: 0,
    },
    rollbackRef: null,
    ...overrides,
  };
  if (!Object.hasOwn(overrides, "verifiedAt")) value.verifiedAt = value.endedAt;
  return value;
}

test("strict run-record validation captures the full privacy-safe measurement contract", () => {
  assert.deepEqual(validateRunRecord(record()), []);

  const invalid = record({
    endedAt: "2026-07-20T09:00:00.000Z",
    result: "timeout",
    evidenceStatus: "provisional",
    agents: [{ ...record().agents[0], costUsd: undefined, unexpected: true }],
  });
  const errors = validateRunRecord(invalid);
  assert.ok(errors.some((error) => /endedAt.*startedAt/i.test(error)));
  assert.ok(errors.some((error) => /costUsd.*number or null/i.test(error)));
  assert.ok(errors.some((error) => /unexpected.*not allowed/i.test(error)));
  assert.ok(errors.some((error) => /timeout.*result/i.test(error)));
  assert.ok(errors.some((error) => /final.*passed.*result/i.test(error)));
});

test("operational strings are identifiers or hashes and rollback references are immutable", () => {
  const invalid = record({
    terminalSlice: "free-form slice prose",
    terminalSliceHash: "not-a-hash",
    rollbackRef: "restore-this-later",
    benchmark: { ...record().benchmark, fixtureHash: "fixture" },
    agents: [{
      ...record().agents[0],
      selectionReason: "This is unrestricted explanatory prose",
    }],
  });
  const errors = validateRunRecord(invalid);
  assert.ok(errors.some((error) => /terminalSlice.*not allowed/i.test(error)));
  assert.ok(errors.some((error) => /terminalSliceHash.*SHA-256/i.test(error)));
  assert.ok(errors.some((error) => /fixtureHash.*SHA-256/i.test(error)));
  assert.ok(errors.some((error) => /selectionReason.*identifier/i.test(error)));
  assert.ok(errors.some((error) => /rollbackRef.*git:|roster:/i.test(error)));
});

test("prompt, secret, clinical, and private-content fields are rejected recursively", () => {
  for (const [path, mutate] of [
    ["prompt", (value) => { value.prompt = "do not retain"; }],
    ["agents[0].apiSecret", (value) => { value.agents[0].apiSecret = "redacted"; }],
    ["quality.clinicalNotes", (value) => { value.quality.clinicalNotes = "redacted"; }],
    ["quality.firstAttempt.privateContent", (value) => {
      value.quality.firstAttempt.privateContent = "redacted";
    }],
  ]) {
    const value = record();
    mutate(value);
    assert.ok(
      validateRunRecord(value).some((error) => error.includes(path) && /privacy/i.test(error)),
      `expected recursive privacy rejection for ${path}`,
    );
  }
});

test("ingestion accepts multiple JSON and JSONL sources while rejecting the invalid batch", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "aohys-measure-v2-ingest-"));
  const jsonPath = resolve(directory, "runs.json");
  const jsonlPath = resolve(directory, "more.jsonl");
  await writeFile(jsonPath, `${JSON.stringify([record(), record({
    runId: "run-treatment-1",
    cohort: "treatment",
    startedAt: "2026-07-21T10:00:00.000Z",
    endedAt: "2026-07-21T10:08:00.000Z",
  })])}\n`);
  await writeFile(jsonlPath, `${JSON.stringify(record({
    runId: "run-treatment-2",
    cohort: "treatment",
    startedAt: "2026-07-22T10:00:00.000Z",
    endedAt: "2026-07-22T10:07:00.000Z",
  }))}\n`);

  const records = await ingestRunRecords([jsonPath, jsonlPath]);
  assert.equal(records.length, 3);

  const nestedOutput = resolve(directory, "generated", "scorecard");
  await writeMeasurementScorecard(buildMeasurementScorecard(records), nestedOutput);
  assert.equal((await ingestRunRecords([directory])).length, 3);

  const arbitrary = resolve(directory, "arbitrary.json");
  await writeFile(arbitrary, `${JSON.stringify({ operation: "not-a-scorecard" })}\n`);
  await assert.rejects(ingestRunRecords([directory]), /schemaVersion|runId/i);
  await writeFile(arbitrary, "[]\n");

  await writeFile(jsonlPath, `${JSON.stringify({ ...record(), secret: "no" })}\n`);
  await assert.rejects(ingestRunRecords([jsonPath, jsonlPath]), /privacy/i);
});

test("scorecard aggregates daily and rolling seven-day routes, preserves unknown cost, and flags weak evidence", () => {
  const records = [
    record(),
    record({
      runId: "run-baseline-2",
      startedAt: "2026-07-21T10:00:00.000Z",
      endedAt: "2026-07-21T10:09:00.000Z",
      result: "timeout",
      evidenceStatus: "timeout",
      verifiedAt: null,
      waitMs: null,
      agents: [{
        ...record().agents[0],
        durationMs: 510_000,
        tokens: null,
        costUsd: 0.25,
        result: "timeout",
        evidenceStatus: "timeout",
      }],
      quality: {
        ...record().quality,
        firstAttempt: { passed: false, findings: 1 },
        final: { passed: false, findings: 1 },
        ci: "not-run",
        qa: "not-run",
      },
    }),
    record({
      runId: "run-treatment-1",
      cohort: "treatment",
      startedAt: "2026-07-22T10:00:00.000Z",
      endedAt: "2026-07-22T10:06:00.000Z",
      waitMs: 10_000,
      agents: [{
        ...record().agents[0],
        requestedModel: "inherit",
        resolvedModel: "gpt-5.6-terra",
        harness: "factory",
        durationMs: 350_000,
        tokens: 7_000,
        costUsd: null,
      }],
      quality: {
        ...record().quality,
        firstAttempt: { passed: true, findings: 0 },
        corrections: 0,
      },
      rollbackRef: ROLLBACK_REF,
    }),
  ];

  const scorecard = buildMeasurementScorecard(records, {
    baseline: "baseline",
    treatment: "treatment",
    sampleThreshold: 2,
    rollbackRef: ROLLBACK_REF,
    currentRosterHash: ROSTER_HASH,
  });

  assert.equal(scorecard.schemaVersion, 2);
  assert.equal(scorecard.summary.records, 3);
  assert.deepEqual(scorecard.summary.evidence, {
    validated: 2,
    provisional: 0,
    incomplete: 0,
    timeout: 1,
    "permission-blocked": 0,
  });
  assert.ok(scorecard.daily.some((row) =>
    row.repository === "development-system" &&
    row.capability === "implementation" &&
    row.routeSlot === "implementation" &&
    row.role === "implementer" &&
    row.model === "gpt-5.6-terra" &&
    row.harness === "factory"
  ));
  assert.equal(scorecard.daily.find((row) => row.date === "2026-07-20").costUsd, null);
  assert.equal(
    scorecard.daily.find((row) => row.date === "2026-07-20" && row.groupBy === "overall")
      .averageTimeToVerifiedMs,
    600_000,
  );
  const latestOverall = scorecard.rolling7.findLast((row) => row.groupBy === "overall");
  assert.equal(latestOverall.sampleSize, 3);
  assert.equal(latestOverall.costUsd, null);
  assert.equal(latestOverall.tokens, null);
  assert.equal(latestOverall.averageWaitMs, null);
  assert.equal(latestOverall.averageTimeToVerifiedMs, null);
  assert.equal(latestOverall.evidence.timeout, 1);
  assert.equal(scorecard.comparisons[0].recommendation.status, "insufficient-evidence");
  assert.equal(scorecard.comparisons[0].recommendation.sampleThreshold, 2);
  assert.equal(scorecard.rosterMutation, "none");
});

test("eligible treatment recommendations are advisory and always include rollback", () => {
  const records = [];
  for (let index = 0; index < 3; index += 1) {
    records.push(record({
      runId: `baseline-${index}`,
      startedAt: `2026-07-2${index}T10:00:00.000Z`,
      endedAt: `2026-07-2${index}T10:10:00.000Z`,
    }));
    records.push(record({
      runId: `treatment-${index}`,
      cohort: "treatment",
      startedAt: `2026-07-2${index}T12:00:00.000Z`,
      endedAt: `2026-07-2${index}T12:05:00.000Z`,
      waitMs: 5_000,
      agents: [{
        ...record().agents[0],
        durationMs: 295_000,
        tokens: 7_000,
        costUsd: 0.1,
      }],
      quality: {
        ...record().quality,
        firstAttempt: { passed: true, findings: 0 },
        corrections: 0,
      },
      rollbackRef: ROLLBACK_REF,
    }));
  }

  const scorecard = buildMeasurementScorecard(records, {
    baseline: "baseline",
    treatment: "treatment",
    sampleThreshold: 3,
    rollbackRef: ROLLBACK_REF,
    currentRosterHash: ROSTER_HASH,
  });
  const recommendation = scorecard.comparisons[0].recommendation;
  assert.equal(recommendation.status, "eligible");
  assert.equal(recommendation.action, "consider-treatment");
  assert.equal(recommendation.rollbackRef, ROLLBACK_REF);
  assert.equal(scorecard.rosterMutation, "none");
  assert.equal(scorecard.comparisons[0].treatment.ciPassRate, 1);
  assert.equal(scorecard.comparisons[0].treatment.qaPassRate, 1);
  assert.equal(scorecard.comparisons[0].treatment.previewReadyRate, 1);
});

test("different roles and models compare when they execute the same logical route slot", () => {
  const records = [];
  for (let index = 0; index < 3; index += 1) {
    records.push(record({ runId: `baseline-slot-${index}` }));
    records.push(record({
      runId: `treatment-slot-${index}`,
      cohort: "treatment",
      rollbackRef: ROLLBACK_REF,
      agents: [{
        ...record().agents[0],
        role: "fast_implementer",
        routeSlot: "implementation",
        requestedModel: "gpt-5.3-codex-spark",
        resolvedModel: "gpt-5.3-codex-spark",
        durationMs: 300_000,
      }],
      quality: {
        ...record().quality,
        firstAttempt: { passed: true, findings: 0 },
        corrections: 0,
      },
    }));
  }
  const scorecard = buildMeasurementScorecard(records, {
    currentRosterHash: ROSTER_HASH,
    rollbackRef: ROLLBACK_REF,
  });
  assert.equal(scorecard.comparisons.length, 1);
  assert.equal(scorecard.comparisons[0].routeSlot, "implementation");
  assert.deepEqual(scorecard.comparisons[0].baselineRoutes, [{
    role: "implementer",
    model: "gpt-5.6-sol",
    harness: "codex",
  }]);
  assert.deepEqual(scorecard.comparisons[0].treatmentRoutes, [{
    role: "fast_implementer",
    model: "gpt-5.3-codex-spark",
    harness: "codex",
  }]);
  assert.equal(scorecard.comparisons[0].recommendation.status, "eligible");
});

test("different logical route slots never mix into one comparison", () => {
  const scorecard = buildMeasurementScorecard([
    record({ runId: "baseline-implementation-slot" }),
    record({
      runId: "treatment-architecture-slot",
      cohort: "treatment",
      agents: [{
        ...record().agents[0],
        routeSlot: "architecture-analysis",
      }],
    }),
  ], {
    sampleThreshold: 1,
    currentRosterHash: ROSTER_HASH,
    rollbackRef: ROLLBACK_REF,
  });
  assert.deepEqual(
    scorecard.comparisons.map((comparison) => comparison.routeSlot).sort(),
    ["architecture-analysis", "implementation"],
  );
  assert.ok(scorecard.comparisons.every(
    (comparison) => comparison.recommendation.status === "insufficient-evidence"
  ));
});

test("enough samples remain ineligible when fixture, packet, acceptance, or repository commit differs", () => {
  const records = [];
  for (let index = 0; index < 3; index += 1) {
    records.push(record({ runId: `baseline-comparable-${index}` }));
    records.push(record({
      runId: `treatment-not-comparable-${index}`,
      cohort: "treatment",
      benchmark: {
        ...record().benchmark,
        fixtureHash: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      },
    }));
  }
  const scorecard = buildMeasurementScorecard(records, {
    sampleThreshold: 3,
    currentRosterHash: ROSTER_HASH,
    rollbackRef: ROLLBACK_REF,
  });
  assert.equal(scorecard.comparisons[0].comparable, false);
  assert.equal(scorecard.comparisons[0].recommendation.status, "not-comparable");
  assert.equal(scorecard.comparisons[0].recommendation.action, "rerun-identical-packet");
});

test("eligibility excludes provisional agent outcomes even when the enclosing runs are validated", () => {
  const records = [];
  for (let index = 0; index < 3; index += 1) {
    records.push(record({ runId: `baseline-agent-validated-${index}` }));
    records.push(record({
      runId: `treatment-agent-provisional-${index}`,
      cohort: "treatment",
      agents: [{
        ...record().agents[0],
        evidenceStatus: "provisional",
      }],
    }));
  }
  const scorecard = buildMeasurementScorecard(records, {
    sampleThreshold: 3,
    currentRosterHash: ROSTER_HASH,
    rollbackRef: ROLLBACK_REF,
  });
  assert.equal(scorecard.comparisons[0].treatment.validatedRunCount, 0);
  assert.equal(scorecard.comparisons[0].recommendation.status, "insufficient-evidence");
});

test("validated but failed agent outcomes cannot recommend a route", () => {
  const records = [];
  for (let index = 0; index < 3; index += 1) {
    records.push(record({ runId: `baseline-agent-success-${index}` }));
    records.push(record({
      runId: `treatment-agent-failure-${index}`,
      cohort: "treatment",
      agents: [{
        ...record().agents[0],
        result: index === 0 ? "failure" : "success",
        durationMs: 300_000,
      }],
      quality: {
        ...record().quality,
        firstAttempt: { passed: true, findings: 0 },
        corrections: 0,
      },
    }));
  }
  const scorecard = buildMeasurementScorecard(records, {
    currentRosterHash: ROSTER_HASH,
    rollbackRef: ROLLBACK_REF,
  });
  assert.equal(scorecard.comparisons[0].treatment.successRate, 0.666667);
  assert.equal(scorecard.comparisons[0].recommendation.status, "quality-gate-failed");
});

test("quality gates and average rates block routing without sample-size bias", () => {
  const records = [];
  for (let index = 0; index < 3; index += 1) {
    records.push(record({
      runId: `baseline-quality-${index}`,
      quality: { ...record().quality, corrections: 1 },
    }));
    records.push(record({
      runId: `treatment-quality-${index}`,
      cohort: "treatment",
      agents: [{ ...record().agents[0], durationMs: 300_000 }],
      quality: {
        ...record().quality,
        firstAttempt: { passed: true, findings: 0 },
        corrections: 1,
        qa: index === 0 ? "failed" : "passed",
      },
    }));
  }
  records.push(record({
    runId: "treatment-quality-extra",
    cohort: "treatment",
    agents: [{ ...record().agents[0], durationMs: 300_000 }],
    quality: {
      ...record().quality,
      firstAttempt: { passed: true, findings: 0 },
      corrections: 1,
    },
  }));
  const scorecard = buildMeasurementScorecard(records, {
    sampleThreshold: 3,
    currentRosterHash: ROSTER_HASH,
    rollbackRef: ROLLBACK_REF,
  });
  const comparison = scorecard.comparisons[0];
  assert.equal(comparison.deltas.averageCorrections, 0);
  assert.equal("tokens" in comparison.baseline, false);
  assert.equal("costUsd" in comparison.treatment, false);
  assert.equal(comparison.treatment.qaPassRate, 0.75);
  assert.equal(comparison.recommendation.status, "quality-gate-failed");
  assert.equal(comparison.recommendation.action, "do-not-change-routing");
});

test("a required preview must pass while an explicitly unnecessary preview may be not-run", () => {
  const records = [];
  for (let index = 0; index < 3; index += 1) {
    records.push(record({ runId: `baseline-preview-${index}` }));
    records.push(record({
      runId: `treatment-preview-${index}`,
      cohort: "treatment",
      agents: [{ ...record().agents[0], durationMs: 300_000 }],
      gates: { ...record().gates, preview: "passed" },
      quality: {
        ...record().quality,
        firstAttempt: { passed: true, findings: 0 },
        corrections: 0,
        preview: "not-run",
      },
    }));
  }
  const scorecard = buildMeasurementScorecard(records, {
    currentRosterHash: ROSTER_HASH,
    rollbackRef: ROLLBACK_REF,
  });
  assert.equal(scorecard.comparisons[0].treatment.previewReadyRate, 0);
  assert.equal(scorecard.comparisons[0].recommendation.status, "quality-gate-failed");
});

test("TTV may not regress and unknown treatment TTV blocks a recommendation when baseline is known", () => {
  const records = [];
  for (let index = 0; index < 3; index += 1) {
    records.push(record({
      runId: `baseline-ttv-${index}`,
      verifiedAt: "2026-07-20T10:05:00.000Z",
    }));
    records.push(record({
      runId: `treatment-ttv-${index}`,
      cohort: "treatment",
      verifiedAt: "2026-07-20T10:09:00.000Z",
      rollbackRef: ROLLBACK_REF,
      agents: [{ ...record().agents[0], durationMs: 300_000 }],
      quality: {
        ...record().quality,
        firstAttempt: { passed: true, findings: 0 },
        corrections: 0,
      },
    }));
  }
  const regressed = buildMeasurementScorecard(records, {
    currentRosterHash: ROSTER_HASH,
    rollbackRef: ROLLBACK_REF,
  });
  assert.equal(regressed.comparisons[0].deltas.averageTimeToVerifiedMs, 240_000);
  assert.equal(regressed.comparisons[0].recommendation.status, "quality-gate-failed");

  const unknownTreatment = records.map((current) =>
    current.cohort === "treatment" ? { ...current, verifiedAt: null } : current
  );
  const unknown = buildMeasurementScorecard(unknownTreatment, {
    currentRosterHash: ROSTER_HASH,
    rollbackRef: ROLLBACK_REF,
  });
  assert.equal(unknown.comparisons[0].treatment.averageTimeToVerifiedMs, null);
  assert.equal(unknown.comparisons[0].recommendation.status, "quality-gate-failed");
});

test("CI readiness permits an explicit not-required gate while QA still must pass", () => {
  const records = [];
  for (let index = 0; index < 3; index += 1) {
    const shared = {
      capability: "architecture",
      ciPolicy: "not-required-read-only",
      agents: [{
        ...record().agents[0],
        role: "architecture_planner",
        routeSlot: "architecture-analysis",
        durationMs: 500_000,
      }],
      gates: { ...record().gates, ci: "not-required" },
      quality: { ...record().quality, ci: "not-run" },
    };
    records.push(record({
      ...shared,
      runId: `baseline-ci-not-required-${index}`,
    }));
    records.push(record({
      ...shared,
      runId: `treatment-ci-not-required-${index}`,
      cohort: "treatment",
      rollbackRef: ROLLBACK_REF,
      agents: [{ ...shared.agents[0], durationMs: 300_000 }],
      quality: {
        ...shared.quality,
        firstAttempt: { passed: true, findings: 0 },
        corrections: 0,
      },
    }));
  }
  const scorecard = buildMeasurementScorecard(records, {
    currentRosterHash: ROSTER_HASH,
    rollbackRef: ROLLBACK_REF,
  });
  assert.equal(scorecard.comparisons[0].treatment.ciPassRate, 0);
  assert.equal(scorecard.comparisons[0].treatment.ciReadyRate, 1);
  assert.equal(scorecard.comparisons[0].treatment.qaPassRate, 1);
  assert.equal(scorecard.comparisons[0].recommendation.status, "eligible");
});

test("implementation cannot self-declare the read-only CI exemption", () => {
  const exempt = record({
    ciPolicy: "not-required-read-only",
    gates: { ...record().gates, ci: "not-required" },
    quality: { ...record().quality, ci: "not-run" },
  });
  assert.ok(validateRunRecord(exempt).some((error) =>
    /ciPolicy.*architecture.*research/i.test(error)
  ));

  const bypass = record({
    gates: { ...record().gates, ci: "not-required" },
    quality: { ...record().quality, ci: "not-run" },
  });
  assert.ok(validateRunRecord(bypass).some((error) =>
    /required.*gates\.ci/i.test(error)
  ));
});

test("regressions, reopens, and escaped defects independently block eligibility", () => {
  for (const field of ["regressions", "reopens", "escapedDefects"]) {
    const records = [];
    for (let index = 0; index < 3; index += 1) {
      records.push(record({ runId: `baseline-${field}-${index}` }));
      records.push(record({
        runId: `treatment-${field}-${index}`,
        cohort: "treatment",
        agents: [{ ...record().agents[0], durationMs: 300_000 }],
        quality: {
          ...record().quality,
          firstAttempt: { passed: true, findings: 0 },
          corrections: 0,
          [field]: index === 0 ? 1 : 0,
        },
      }));
    }
    const scorecard = buildMeasurementScorecard(records, {
      currentRosterHash: ROSTER_HASH,
      rollbackRef: ROLLBACK_REF,
    });
    assert.equal(
      scorecard.comparisons[0].recommendation.status,
      "quality-gate-failed",
      field,
    );
  }
});

test("a stale current-roster hash cannot produce an eligible recommendation", () => {
  const records = [];
  for (let index = 0; index < 3; index += 1) {
    records.push(record({ runId: `baseline-roster-${index}` }));
    records.push(record({
      runId: `treatment-roster-${index}`,
      cohort: "treatment",
      rollbackRef: ROLLBACK_REF,
      quality: {
        ...record().quality,
        firstAttempt: { passed: true, findings: 0 },
        corrections: 0,
      },
      agents: [{ ...record().agents[0], durationMs: 300_000 }],
    }));
  }
  const scorecard = buildMeasurementScorecard(records, {
    sampleThreshold: 3,
    currentRosterHash: FIXTURE_HASH,
    rollbackRef: ROLLBACK_REF,
  });
  assert.equal(scorecard.comparisons[0].rosterAnchored, false);
  assert.equal(scorecard.comparisons[0].recommendation.status, "roster-drift");
});

test("terminal-slice identity participates in comparability", () => {
  const records = [];
  for (let index = 0; index < 3; index += 1) {
    records.push(record({ runId: `baseline-terminal-${index}` }));
    records.push(record({
      runId: `treatment-terminal-${index}`,
      cohort: "treatment",
      terminalSliceHash: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      rollbackRef: ROLLBACK_REF,
    }));
  }
  const scorecard = buildMeasurementScorecard(records, {
    currentRosterHash: ROSTER_HASH,
    rollbackRef: ROLLBACK_REF,
  });
  assert.equal(scorecard.comparisons[0].comparable, false);
  assert.equal(scorecard.comparisons[0].recommendation.status, "not-comparable");
});

test("rollback evidence from a provisional treatment run cannot authorize a validated route", () => {
  const records = [];
  for (let index = 0; index < 3; index += 1) {
    records.push(record({ runId: `baseline-rollback-${index}` }));
    records.push(record({
      runId: `treatment-rollback-${index}`,
      cohort: "treatment",
      agents: [{ ...record().agents[0], durationMs: 300_000 }],
      quality: {
        ...record().quality,
        firstAttempt: { passed: true, findings: 0 },
        corrections: 0,
      },
    }));
  }
  records.push(record({
    runId: "treatment-provisional-rollback",
    cohort: "treatment",
    evidenceStatus: "provisional",
    verifiedAt: null,
    rollbackRef: ROLLBACK_REF,
    agents: [{
      ...record().agents[0],
      evidenceStatus: "provisional",
      durationMs: 300_000,
    }],
  }));
  const scorecard = buildMeasurementScorecard(records, {
    currentRosterHash: ROSTER_HASH,
  });
  assert.equal(scorecard.comparisons[0].recommendation.status, "missing-recovery-reference");
  assert.equal(scorecard.comparisons[0].recommendation.rollbackRef, null);
});

test("multiple agents in one run do not inflate the validated-run eligibility threshold", () => {
  const baseline = record({
    agents: [
      record().agents[0],
      { ...record().agents[0], resolvedModel: "gpt-5.6-terra" },
      { ...record().agents[0], resolvedModel: "gpt-5.3-codex-spark" },
    ],
  });
  const treatment = record({
    runId: "treatment-multi-agent",
    cohort: "treatment",
    agents: baseline.agents,
  });
  const scorecard = buildMeasurementScorecard([baseline, treatment], {
    sampleThreshold: 3,
    currentRosterHash: ROSTER_HASH,
    rollbackRef: ROLLBACK_REF,
  });
  assert.equal(scorecard.comparisons[0].baseline.sampleSize, 3);
  assert.equal(scorecard.comparisons[0].baseline.validatedRunCount, 1);
  assert.equal(scorecard.comparisons[0].recommendation.status, "insufficient-evidence");
});

test("agent outcomes drive route metrics instead of copying the enclosing run outcome", () => {
  const mixed = record({
    agents: [
      record().agents[0],
      {
        ...record().agents[0],
        role: "reviewer",
        result: "permission-blocked",
        evidenceStatus: "permission-blocked",
        tokens: null,
      },
    ],
  });
  const scorecard = buildMeasurementScorecard([mixed]);
  const overall = scorecard.daily.find((row) => row.groupBy === "overall");
  assert.equal(overall.successRate, 0.5);
  assert.equal(overall.evidence.validated, 1);
  assert.equal(overall.evidence["permission-blocked"], 1);
  assert.equal(overall.tokens, null);
  assert.equal(scorecard.summary.evidence.validated, 1);
  assert.equal(scorecard.summary.evidence["permission-blocked"], 1);
});

test("local CLI validates records and emits deterministic JSON plus static HTML", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "aohys-measure-v2-cli-"));
  const input = resolve(directory, "runs.json");
  const output = resolve(directory, "scorecard");
  await writeFile(input, `${JSON.stringify([record()])}\n`);
  const script = resolve(import.meta.dirname, "..", "scripts", "measure-v2.mjs");

  const validation = spawnSync(process.execPath, [script, "validate", "--input", input], {
    encoding: "utf8",
  });
  assert.equal(validation.status, 0, validation.stderr);
  assert.equal(JSON.parse(validation.stdout).records, 1);

  const build = spawnSync(process.execPath, [
    script,
    "scorecard",
    "--input", input,
    "--output", output,
    "--baseline", "baseline",
    "--treatment", "treatment",
    "--current-roster-hash", ROSTER_HASH,
  ], { encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const result = JSON.parse(build.stdout);
  assert.equal(result.output, output);
  const json = JSON.parse(await readFile(resolve(output, "scorecard.json"), "utf8"));
  const html = await readFile(resolve(output, "index.html"), "utf8");
  assert.equal(json.summary.records, 1);
  assert.match(html, /Measurement scorecard v2/i);
  assert.match(html, /Rolling 7-day routes/i);
  assert.match(html, /Time to verified/i);
  assert.match(html, /First pass/i);
  assert.match(html, />CI ready</i);
  assert.match(html, />QA</i);
  assert.match(html, />Preview</i);
  assert.match(html, /Evidence/i);
  assert.match(html, /noindex,nofollow/i);
  assert.doesNotMatch(html, /prompt|secret|clinical/i);

  const rewritten = await writeMeasurementScorecard(json, output);
  assert.deepEqual(rewritten, {
    jsonPath: resolve(output, "scorecard.json"),
    htmlPath: resolve(output, "index.html"),
  });

  const unsafeRollback = spawnSync(process.execPath, [
    script,
    "scorecard",
    "--input", input,
    "--output", output,
    "--rollback-ref", "foo",
  ], { encoding: "utf8" });
  assert.notEqual(unsafeRollback.status, 0);
  assert.match(unsafeRollback.stderr, /git:|roster:/i);
});
