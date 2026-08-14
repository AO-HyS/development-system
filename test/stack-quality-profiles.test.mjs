import assert from "node:assert/strict";
import test from "node:test";

import {
  auditStackQuality,
  getStackQualityCatalog,
  selectApplicableQualityChecks,
  selectStackQualityProfiles,
} from "../src/stack-quality-profiles.mjs";

const expectedProfiles = [
  "react",
  "tanstack",
  "turborepo",
  "shadcn",
  "convex",
  "cloudflare",
  "expo-react-native",
  "ios",
  "android",
  "electron",
];

test("the 1.5.0 catalog is capability-selective, sourced, and complete across architecture dimensions", () => {
  const catalog = getStackQualityCatalog();
  assert.equal(catalog.contractVersion, "1.5.0");
  assert.deepEqual(Object.keys(catalog.profiles), expectedProfiles);
  assert.equal(catalog.defaultNewMobileProfile, "expo-react-native");

  const dimensions = ["composition", "performance", "locality", "modules", "interfaces", "state", "dataFetching", "platformBoundaries"];
  for (const [profileId, profile] of Object.entries(catalog.profiles)) {
    assert.deepEqual(Object.keys(profile.dimensions), dimensions, profileId);
    assert.ok(profile.ruleIds.length > 0, profileId);
    assert.ok(profile.sourceIds.length > 0, profileId);
  }
  for (const [ruleId, rule] of Object.entries(catalog.rules)) {
    assert.equal(typeof catalog.oracles[rule.oracle], "string", ruleId);
    assert.ok(rule.sourceIds.length > 0, ruleId);
    for (const sourceId of rule.sourceIds) {
      assert.ok(["primary", "standard", "product-evidence"].includes(catalog.sources[sourceId].kind), `${ruleId}:${sourceId}`);
      assert.match(catalog.sources[sourceId].url, /^https:\/\//, `${ruleId}:${sourceId}`);
    }
  }
});

test("quality oracles have one explicit non-overlapping owner per rule", () => {
  const catalog = getStackQualityCatalog();
  assert.equal(catalog.rules["react.composition"].oracle, "react-doctor");
  assert.equal(catalog.rules["quality.no-type-erasure"].oracle, "lint");
  assert.equal(catalog.rules["quality.type-contract"].oracle, "typecheck");
  assert.equal(catalog.rules["quality.focused-behavior"].oracle, "focused-tests");
  assert.equal(catalog.rules["quality.visual-craft"].oracle, "impeccable");
  assert.equal(catalog.rules["security.trust-boundaries"].oracle, "codex-security");
  assert.equal(catalog.rules["convex.function-contract"].oracle, "convex-review");
  assert.ok(Object.values(catalog.rules).every((rule) => typeof rule.oracle === "string" && !Array.isArray(rule.oracle)));
});

test("mobile selection defaults new work to Expo while preserving deliberate native profiles", () => {
  assert.deepEqual(selectStackQualityProfiles({ capabilities: ["react"], newMobile: true }), {
    valid: true,
    errors: [],
    selected: ["react", "expo-react-native"],
    defaultApplied: true,
  });
  assert.deepEqual(selectStackQualityProfiles({ capabilities: ["android"], newMobile: true }), {
    valid: true,
    errors: [],
    selected: ["android"],
    defaultApplied: false,
  });
  const unsupported = selectStackQualityProfiles({ capabilities: ["universal-architecture"] });
  assert.equal(unsupported.valid, false);
  assert.match(unsupported.errors.join("\n"), /unsupported stack capability/);
});

test("changed surfaces select a stable provider-neutral oracle set without unchanged-stack checks", () => {
  const selection = selectApplicableQualityChecks({
    capabilities: ["react", "convex", "cloudflare"],
    changedSurfaces: [
      { id: "web-settings", capabilities: ["react"] },
      { id: "domain-functions", capabilities: ["convex"] },
    ],
  });

  assert.equal(selection.valid, true);
  assert.deepEqual(selection.changedSurfaceIds, ["web-settings", "domain-functions"]);
  assert.ok(selection.checks.some((check) => check.oracle === "react-doctor" && check.surfaceIds.includes("web-settings")));
  assert.ok(selection.checks.some((check) => check.oracle === "convex-review" && check.surfaceIds.includes("domain-functions")));
  assert.ok(!selection.checks.some((check) => check.oracle === "provider-checks"));
  assert.deepEqual(selection.externalWriteIntents, []);
  assert.deepEqual(selection.externalSideEffects, []);

  const empty = selectApplicableQualityChecks({ capabilities: ["react"], changedSurfaces: [] });
  assert.deepEqual(empty.checks, []);
  const invalid = selectApplicableQualityChecks({
    capabilities: ["react"],
    changedSurfaces: [{ id: "backend", capabilities: ["convex"] }],
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /undeclared capability/);
});

test("the read-only audit deterministically separates findings, recommendations, exceptions, and unproven evidence", () => {
  const input = {
    repository: "AO/example",
    capabilities: ["react", "shadcn"],
    files: [
      { path: "src/feature.ts", content: "export const parse = (value: unknown): any => value;" },
      { path: "src/adapters/vendor.ts", content: "export const value = source as unknown as VendorValue;" },
      { path: "vendor/external.ts", ownership: "external", content: "export const legacy: any = source;" },
    ],
    evidence: {
      "quality.type-contract": { status: "pass" },
      "quality.focused-behavior": { status: "pass" },
      "security.trust-boundaries": { status: "pass" },
      "react.composition": { status: "fail", detail: "A page component owns unrelated feature workflows." },
      "react.state-and-effects": { status: "pass" },
      "shadcn.current-components": { status: "recommendation", detail: "A reviewed CLI diff is available." },
      "shadcn.registry-and-icons": { status: "fail", detail: "The repository intentionally retains its icon family." },
    },
    exceptions: [
      {
        ruleId: "quality.no-type-erasure",
        repository: "AO/example",
        scope: "src/adapters/vendor.ts",
        boundary: "external",
        rationale: "The untyped vendor callback has no typed wire contract.",
        evidence: "vendor-sdk-4.1 callback payload declaration",
      },
      {
        ruleId: "shadcn.registry-and-icons",
        repository: "AO/example",
        scope: "ui/icons",
        pinnedVersion: "lucide-react@0.468.0",
        rationale: "The next release changes product-owned glyph geometry.",
        evidence: "visual-diff-2026-08-14",
      },
    ],
  };

  const first = auditStackQuality(input);
  const second = auditStackQuality(structuredClone(input));
  assert.deepEqual(first, second);
  assert.equal(first.valid, true);
  assert.deepEqual(first.externalWriteIntents, []);
  assert.deepEqual(first.externalSideEffects, []);
  assert.equal(first.status, "failed");
  assert.ok(first.findings.some((item) => item.ruleId === "quality.no-type-erasure" && item.path === "src/feature.ts"));
  assert.ok(first.findings.some((item) => item.ruleId === "react.composition"));
  assert.ok(first.recommendations.some((item) => item.ruleId === "shadcn.current-components"));
  assert.ok(first.exceptions.some((item) => item.ruleId === "quality.no-type-erasure" && item.scope === "src/adapters/vendor.ts"));
  assert.ok(first.exceptions.some((item) => item.ruleId === "shadcn.registry-and-icons"));
  assert.ok(first.unprovenEvidence.some((item) => item.ruleId === "quality.visual-craft"));
  assert.ok(!first.findings.some((item) => item.path === "vendor/external.ts"));
});

test("owned TypeScript escape hatches fail closed and broad exceptions are rejected", () => {
  const report = auditStackQuality({
    repository: "AO/example",
    capabilities: ["convex"],
    files: [{ path: "convex/items.ts", content: "// @ts-ignore\ntype Payload = any;\nconst pending: Promise<any> = input as Payload as Item;" }],
    evidence: {},
    exceptions: [{
      ruleId: "quality.no-type-erasure",
      repository: "AO/example",
      scope: "*",
      boundary: "external",
      rationale: "Legacy code",
      evidence: "migration note",
    }],
  });

  assert.equal(report.valid, true);
  assert.ok(report.findings.filter((item) => item.ruleId === "quality.no-type-erasure").length >= 2);
  assert.ok(report.findings.some((item) => /invalid exception/.test(item.detail)));
  assert.equal(report.exceptions.length, 0);
  assert.ok(report.unprovenEvidence.some((item) => item.ruleId === "convex.function-contract" && item.oracle === "convex-review"));
});

test("missing changed TypeScript content remains unproven instead of becoming an implicit lint pass", () => {
  const report = auditStackQuality({
    repository: "AO/example",
    capabilities: ["react"],
    evidence: {
      "quality.type-contract": { status: "pass" },
      "quality.focused-behavior": { status: "pass" },
      "quality.visual-craft": { status: "pass" },
      "security.trust-boundaries": { status: "pass" },
      "react.composition": { status: "pass" },
      "react.state-and-effects": { status: "pass" },
    },
  });

  assert.equal(report.status, "unproven");
  assert.ok(report.unprovenEvidence.some((item) => item.ruleId === "quality.no-type-erasure"));
});
