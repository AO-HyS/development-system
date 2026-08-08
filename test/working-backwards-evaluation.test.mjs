import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { evaluateWorkingBackwards } from "../src/working-backwards-evaluation.mjs";

const fixturePath = resolve(import.meta.dirname, "..", "evidence", "working-backwards", "ticket-06-evaluation.json");

test("ticket 06 evidence is deterministic but incomplete without source packets", async () => {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const first = evaluateWorkingBackwards(fixture);
  const second = evaluateWorkingBackwards(fixture);

  assert.deepEqual(first, second);
  assert.equal(first.ok, false);
  assert.equal(first.status, "incomplete");
  assert.equal(first.dogfood.chatHistoryRequired, false);
  assert.deepEqual(first.dogfood.reconstructedFrom, ["approved-spec", "artifact-graph", "ticket-dependency-graph", "t3-handoff"]);
  assert.deepEqual(first.historicalCases.map((entry) => entry.label), ["historical-validation-case", "historical-validation-case"]);
  assert.deepEqual(first.historicalCases.map((entry) => entry.id), ["aohys-dashboard-navigation", "nutriplan-auth-resilience"]);
  assert.deepEqual(first.historicalCases.map((entry) => entry.classification), ["caught", "mixed"]);
  assert.ok(first.historicalCases.every((entry) => entry.unavailableFields.length > 0));
  assert.equal(first.comparison.mode, "unmatched-descriptive");
  assert.equal(first.claims.causal, "prohibited");
  assert.equal(first.claims.defaultRollout, "prohibited");
  assert.equal(first.recommendation, "not-ready");
  assert.ok(first.missingFields.some((field) => /source packet|source bindings|gate receipt/i.test(field)));
  assert.equal(first.ticket07.status, "blocked");
  assert.equal(first.ticket07.requires.selectedRealProductFeature, true);
  assert.equal(first.ticket07.requires.authorization, true);
  for (const metric of ["activeOperationalTime", "humanAttention", "tokens", "authoritativeCost", "revisions", "corrections", "checks", "reviewBlockers", "planToCodeDeviation", "privacy", "synchronization", "worktree", "authorization"]) {
    assert.ok(metric in first.signals, metric);
  }
});
