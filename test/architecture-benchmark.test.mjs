import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  buildArchitectureReport,
  hashGroundTruth,
  ingestArchitectureAnswers,
  readArchitectureScore,
  scoreArchitectureAnswers,
  validateArchitectureAnswer,
  validateArchitectureScore,
  validateArchitectureSuite,
  writeArchitectureReport,
} from "../src/architecture-benchmarks.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

function groundTruth(overrides = {}) {
  return {
    expected: {
      canonicalPaths: ["src/router.mjs", "src/gates.mjs"],
      symbols: [
        { path: "src/router.mjs", name: "routeRequest" },
        { path: "src/gates.mjs", name: "authorizeGate" },
      ],
      edges: [{
        from: "src/router.mjs#routeRequest",
        to: "src/gates.mjs#authorizeGate",
        kind: "calls",
      }],
      instructionFacts: ["explicit-human-approval"],
      gateFacts: ["merge-is-manual"],
    },
    forbiddenClaims: {
      paths: ["src/legacy-router.mjs"],
      symbols: [],
      edges: [],
      instructionFacts: ["router-may-auto-merge"],
      gateFacts: [],
    },
    unsupportedClaims: {
      paths: [],
      symbols: [{ path: "src/router.mjs", name: "autoMerge" }],
      edges: [],
      instructionFacts: [],
      gateFacts: ["production-is-automatic"],
    },
    ...overrides,
  };
}

function suite(overrides = {}) {
  const truth = groundTruth();
  const identity = {
    repositoryId: "development-system",
    repositoryCommit: COMMIT,
    caseId: "locate-router",
  };
  const value = {
    schemaVersion: 1,
    suiteId: "architecture-comprehension-v1",
    repositories: [{
      id: "development-system",
      commit: COMMIT,
      exclusions: ["evidence/private"],
      modes: { M0: true, M1: true, M2: true, M3: false, M4: true },
    }],
    cases: [{
      id: "locate-router",
      repositoryId: "development-system",
      taskClass: "C1",
      packetHash: HASH_A,
      acceptanceHash: HASH_B,
      fixtureHash: HASH_C,
      groundTruthHash: hashGroundTruth(truth, identity),
      ...truth,
    }],
    ...overrides,
  };
  return value;
}

function evidence(path) {
  return [{ path, startLine: 1, endLine: 2 }];
}

function answer(overrides = {}) {
  return {
    schemaVersion: 1,
    runId: "architecture-run-001",
    caseId: "locate-router",
    mode: "M2",
    route: {
      routeSlot: "architecture-analysis",
      role: "architecture-planner",
      harness: "codex",
      requestedModel: "gpt-5.6-sol",
      resolvedModel: "gpt-5.6-sol",
      reasoning: "xhigh",
    },
    startedAt: "2026-07-23T10:00:00.000Z",
    endedAt: "2026-07-23T10:01:00.000Z",
    tokens: null,
    costUsd: null,
    waitMs: null,
    claims: {
      paths: [
        { path: "./src/router.mjs", evidenceRefs: evidence("src/router.mjs") },
        { path: "src/gates.mjs", evidenceRefs: evidence("./src/gates.mjs") },
      ],
      symbols: [
        { path: "src/router.mjs", name: "routeRequest", evidenceRefs: evidence("src/router.mjs") },
        { path: "src/gates.mjs", name: "authorizeGate", evidenceRefs: evidence("src/gates.mjs") },
      ],
      edges: [{
        from: "src/router.mjs#routeRequest",
        to: "src/gates.mjs#authorizeGate",
        kind: "calls",
        evidenceRefs: evidence("src/router.mjs"),
      }],
      instructionFacts: [{
        id: "explicit-human-approval",
        evidenceRefs: evidence("src/router.mjs"),
      }],
      gateFacts: [{
        id: "merge-is-manual",
        evidenceRefs: evidence("src/gates.mjs"),
      }],
    },
    ...overrides,
  };
}

test("suite and answer schemas are closed, privacy-safe, and SHA-pin ground truth", () => {
  const validSuite = suite();
  assert.deepEqual(validateArchitectureSuite(validSuite), []);
  assert.deepEqual(validateArchitectureAnswer(answer()), []);

  const stale = structuredClone(validSuite);
  stale.cases[0].expected.canonicalPaths[0] = "src/moved-router.mjs";
  assert.match(validateArchitectureSuite(stale).join("\n"), /groundTruthHash.*does not match/i);

  const repinned = structuredClone(validSuite);
  repinned.repositories[0].commit = "f".repeat(40);
  assert.match(validateArchitectureSuite(repinned).join("\n"), /groundTruthHash.*does not match/i);

  const relabeled = structuredClone(validSuite);
  relabeled.cases[0].id = "relabeled-case";
  assert.match(validateArchitectureSuite(relabeled).join("\n"), /groundTruthHash.*does not match/i);

  const relabeledRepository = structuredClone(validSuite);
  relabeledRepository.repositories[0].id = "relabeled-repository";
  relabeledRepository.cases[0].repositoryId = "relabeled-repository";
  assert.match(
    validateArchitectureSuite(relabeledRepository).join("\n"),
    /groundTruthHash.*does not match/i,
  );

  const invalidAnswer = answer({
    prompt: "forbidden payload",
    claims: {
      ...answer().claims,
      narrative: "model prose",
      paths: [{ path: " /etc/passwd", evidenceRefs: evidence("src/router.mjs") }],
      edges: [{
        from: "src/../outside.mjs#escape",
        to: "src/gates.mjs#authorizeGate",
        kind: "calls",
        evidenceRefs: evidence("src/router.mjs"),
      }],
    },
  });
  const errors = validateArchitectureAnswer(invalidAnswer).join("\n");
  assert.match(errors, /prompt.*forbidden|prompt.*not allowed/i);
  assert.match(errors, /narrative.*not allowed/i);
  assert.match(errors, /claims\.paths.*repository-relative path/i);
  assert.match(errors, /claims\.edges.*controlled code reference/i);
});

test("exact normalized scoring produces numeric, judge-independent metrics", () => {
  const scored = scoreArchitectureAnswers(suite(), [answer()]);
  assert.equal(scored.runs.length, 1);
  assert.equal(scored.runs[0].status, "scored");
  assert.deepEqual(scored.runs[0].scores, {
    canonicalHitAt1: 1,
    pathRecall: 1,
    symbolRecall: 1,
    edgePrecision: 1,
    edgeRecall: 1,
    instructionCoverage: 1,
    gateCoverage: 1,
    validEvidenceRatio: 1,
    falseClaimRate: 0,
    taskPass: 1,
  });
  assert.ok(Object.values(scored.runs[0].scores).every(Number.isFinite));
});

test("false, forbidden, stale, and missing-evidence claims are penalized", () => {
  const bad = answer({
    claims: {
      ...answer().claims,
      paths: [
        ...answer().claims.paths,
        { path: "src/legacy-router.mjs", evidenceRefs: evidence("src/legacy-router.mjs") },
      ],
      symbols: [
        { path: "src/router.mjs", name: "routeRequest", evidenceRefs: [] },
        { path: "src/router.mjs", name: "autoMerge", evidenceRefs: evidence("src/router.mjs") },
      ],
      gateFacts: [{
        id: "production-is-automatic",
        evidenceRefs: evidence("src/gates.mjs"),
      }],
    },
  });

  const run = scoreArchitectureAnswers(suite(), [bad]).runs[0];
  assert.equal(run.scores.taskPass, 0);
  assert.ok(run.scores.falseClaimRate > 0);
  assert.ok(run.scores.symbolRecall < 1);
  assert.ok(run.scores.validEvidenceRatio < 1);
  assert.ok(run.penalties.forbiddenClaims > 0);
  assert.ok(run.penalties.unsupportedClaims > 0);
});

test("unavailable M3 is distinct from failure and excluded from scored aggregates", () => {
  const unavailable = answer({ runId: "architecture-run-m3", mode: "M3" });
  const scored = scoreArchitectureAnswers(suite(), [unavailable]);
  assert.equal(scored.runs[0].status, "unavailable");
  assert.equal(scored.runs[0].scores, null);
  assert.equal(scored.aggregates.length, 0);
  assert.deepEqual(scored.availability, { scored: 0, unavailable: 1 });
});

test("different packet or ground-truth identities never aggregate together", () => {
  const firstTruth = groundTruth();
  const secondTruth = groundTruth({
    expected: {
      ...groundTruth().expected,
      instructionFacts: ["explicit-human-approval", "nested-rules-apply"],
    },
  });
  const multiSuite = suite({
    cases: [
      suite().cases[0],
      {
        ...suite().cases[0],
        id: "locate-router-variant",
        packetHash: "d".repeat(64),
        groundTruthHash: hashGroundTruth(secondTruth, {
          repositoryId: "development-system",
          repositoryCommit: COMMIT,
          caseId: "locate-router-variant",
        }),
        ...secondTruth,
      },
    ],
  });
  const second = answer({
    runId: "architecture-run-002",
    caseId: "locate-router-variant",
    claims: {
      ...answer().claims,
      instructionFacts: [
        ...answer().claims.instructionFacts,
        { id: "nested-rules-apply", evidenceRefs: evidence("src/router.mjs") },
      ],
    },
  });
  const scored = scoreArchitectureAnswers(multiSuite, [answer(), second]);
  assert.equal(scored.aggregates.length, 2);
  assert.deepEqual(scored.aggregates.map((row) => row.n), [1, 1]);
  assert.notEqual(scored.aggregates[0].identity.packetHash, scored.aggregates[1].identity.packetHash);
  assert.notEqual(
    scored.aggregates[0].identity.groundTruthHash,
    scored.aggregates[1].identity.groundTruthHash,
  );
});

test("repetitions stay separate while aggregates retain nullable telemetry", () => {
  const second = answer({
    runId: "architecture-run-002",
    tokens: 1200,
    costUsd: 0.25,
    waitMs: 10,
  });
  const scored = scoreArchitectureAnswers(suite(), [answer(), second]);
  assert.equal(scored.runs.length, 2);
  assert.equal(scored.aggregates[0].n, 2);
  assert.equal(scored.aggregates[0].mean.tokens, null);
  assert.equal(scored.aggregates[0].mean.costUsd, null);
  assert.equal(scored.aggregates[0].mean.waitMs, null);
  assert.equal(scored.runs[0].telemetry.costUsd, null);
});

test("duplicate run IDs fail across recursively ingested answer files", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "architecture-answers-"));
  await mkdir(resolve(root, "nested"));
  await writeFile(resolve(root, "one.json"), JSON.stringify(answer()));
  await writeFile(resolve(root, "nested", "two.json"), JSON.stringify(answer()));
  await assert.rejects(ingestArchitectureAnswers(root), /duplicate runId.*architecture-run-001/i);
});

test("generated output recursion is skipped narrowly without hiding invalid JSON", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "architecture-recursion-"));
  await writeFile(resolve(root, "answer.json"), JSON.stringify(answer()));
  const report = buildArchitectureReport(scoreArchitectureAnswers(suite(), [answer()]));
  await mkdir(resolve(root, "generated"));
  await writeArchitectureReport(report, resolve(root, "generated"));
  assert.equal((await ingestArchitectureAnswers(root)).length, 1);

  await writeFile(resolve(root, "bad.json"), JSON.stringify({
    schemaVersion: 1,
    operation: "architecture-benchmark-report",
    runs: "not-a-generated-report",
  }));
  await assert.rejects(ingestArchitectureAnswers(root), /bad\.json.*run record|bad\.json.*answer/i);
});

test("private report files are protected and HTML is escaped", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "architecture-report-"));
  const escapedAnswer = answer({
    route: { ...answer().route, resolvedModel: "model-<script>alert(1)</script>" },
  });
  const scored = scoreArchitectureAnswers(suite(), [escapedAnswer], { validateAnswers: false });
  const paths = await writeArchitectureReport(buildArchitectureReport(scored), root);
  const html = await readFile(paths.htmlPath, "utf8");
  assert.match(html, /noindex,nofollow/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.equal((await stat(paths.jsonPath)).mode & 0o777, 0o600);
  assert.equal((await stat(paths.htmlPath)).mode & 0o777, 0o600);
});

test("existing scored input is closed and privacy-validated before report emission", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "architecture-scored-input-"));
  const scored = scoreArchitectureAnswers(suite(), [answer()]);
  assert.deepEqual(validateArchitectureScore(scored), []);

  const malicious = structuredClone(scored);
  malicious.rawModelOutput = "<script>alert(1)</script>";
  malicious.runs[0].route.transcript = "private transcript";
  malicious.aggregates[0].unknownMetric = 123;
  assert.match(
    validateArchitectureScore(malicious).join("\n"),
    /rawModelOutput.*forbidden|transcript.*forbidden|unknownMetric.*not allowed/i,
  );

  const inconsistent = structuredClone(scored);
  inconsistent.runs[0].scores.taskPass = 2;
  inconsistent.runs[0].identity.fixtureHash = "not-a-hash";
  inconsistent.aggregates[0].n = 99;
  inconsistent.aggregates[0].passRate = -1;
  const consistencyErrors = validateArchitectureScore(inconsistent).join("\n");
  assert.match(consistencyErrors, /scores\.taskPass.*between 0 and 1/i);
  assert.match(consistencyErrors, /identity\.fixtureHash.*SHA-256/i);
  assert.match(consistencyErrors, /aggregates\[0\]\.n.*matching scored runs/i);
  assert.match(consistencyErrors, /passRate.*between 0 and 1/i);

  const scoredPath = resolve(root, "malicious-score.json");
  const output = resolve(root, "report");
  await writeFile(scoredPath, JSON.stringify(malicious));
  await assert.rejects(readArchitectureScore(scoredPath), /invalid architecture benchmark score/i);

  const cli = spawnSync(
    process.execPath,
    [
      "scripts/architecture-benchmark.mjs",
      "report",
      "--scored",
      scoredPath,
      "--output",
      output,
    ],
    { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8" },
  );
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /rawModelOutput.*forbidden|transcript.*forbidden|unknownMetric.*not allowed/i);
  await assert.rejects(stat(resolve(output, "architecture-benchmark.json")), /ENOENT/);
});

test("CLI validates, scores, and reports existing scored data", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "architecture-cli-"));
  const suitePath = resolve(root, "suite.json");
  const answersPath = resolve(root, "answers.json");
  const scoreOutput = resolve(root, "score-output");
  const reportOutput = resolve(root, "report-output");
  await writeFile(suitePath, JSON.stringify(suite()));
  await writeFile(answersPath, JSON.stringify([answer()]));

  const validate = spawnSync(
    process.execPath,
    ["scripts/architecture-benchmark.mjs", "validate-suite", "--suite", suitePath],
    { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8" },
  );
  assert.equal(validate.status, 0, validate.stderr);

  const score = spawnSync(
    process.execPath,
    [
      "scripts/architecture-benchmark.mjs",
      "score",
      "--suite",
      suitePath,
      "--answers",
      answersPath,
      "--output",
      scoreOutput,
    ],
    { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8" },
  );
  assert.equal(score.status, 0, score.stderr);

  const report = spawnSync(
    process.execPath,
    [
      "scripts/architecture-benchmark.mjs",
      "report",
      "--scored",
      resolve(scoreOutput, "architecture-benchmark.json"),
      "--output",
      reportOutput,
    ],
    { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8" },
  );
  assert.equal(report.status, 0, report.stderr);
  assert.match(await readFile(resolve(reportOutput, "index.html"), "utf8"), /Architecture benchmark/);
});
