import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { buildCheckIn } from "../src/check-in.mjs";
import { auditPostHogObservability } from "../src/posthog-observability.mjs";

const baseInput = {
  repository: "AO/example",
  now: "2026-08-14T18:00:00.000Z",
  policy: {
    productionEnvironments: ["production"],
    canonicalHosts: ["app.example.com"],
    conversionEvents: ["signup_completed", "checkout_completed"],
    requiredWebVitals: ["LCP", "INP", "CLS"],
    minimumEligibleEvents: 3,
    parityCapabilities: ["exceptions", "releases", "source-maps", "alerts", "replay-privacy"],
  },
  instrumentation: {
    enabledEnvironments: ["production"],
    canonicalHosts: ["app.example.com"],
    identity: { anonymous: true, authenticated: true },
    conversionEvents: ["signup_completed", "checkout_completed"],
    exceptionCapture: true,
    release: "release-42",
    sourceMaps: [{ release: "release-42", status: "uploaded" }],
    webVitals: ["LCP", "INP", "CLS"],
    replay: { enabled: true, maskAllText: true, blockAllMedia: true, capturedProperties: ["plan"] },
  },
  observations: [
    { id: "event-1", kind: "event", event: "pageview", environment: "production", host: "app.example.com", release: "release-42", actorType: "human" },
    { id: "event-2", kind: "event", event: "signup_completed", environment: "production", host: "app.example.com", release: "release-42", actorType: "human" },
    { id: "event-3", kind: "web-vital", metric: "LCP", environment: "production", host: "app.example.com", release: "release-42", actorType: "human" },
  ],
  alertRoutes: [{ id: "production-errors", findingCodes: ["production-error"], owner: "product-engineering", destination: "private-operations", runbook: "docs/runbooks/errors.md", threshold: "one deterministic production exception" }],
  errors: [],
  legacyProviders: [{ provider: "sentry", repository: "AO/example", parity: { exceptions: true, releases: true, "source-maps": true, alerts: true, "replay-privacy": true } }],
};

test("a complete production contract is deterministic, read-only, and keeps provider retirement separate", () => {
  const first = auditPostHogObservability(baseInput);
  const second = auditPostHogObservability(structuredClone(baseInput));

  assert.deepEqual(first, second);
  assert.equal(first.valid, true);
  assert.equal(first.status, "passed");
  assert.equal(first.readOnly, true);
  assert.deepEqual(first.externalWriteIntents, []);
  assert.deepEqual(first.externalSideEffects, []);
  assert.equal(first.legacyProviders[0].parityStatus, "proven");
  assert.equal(first.legacyProviders[0].retirementEligible, true);
  assert.equal(first.legacyProviders[0].retirementPerformed, false);
});

test("preview contamination, release mismatch, and missing source maps are distinct actionable findings", () => {
  const report = auditPostHogObservability({
    ...structuredClone(baseInput),
    instrumentation: { ...structuredClone(baseInput.instrumentation), sourceMaps: [] },
    observations: [
      { id: "preview", kind: "event", event: "pageview", environment: "preview", host: "preview.example.dev", release: "release-42", actorType: "human", properties: { email: "private@example.com" } },
      { id: "mismatch", kind: "exception", environment: "production", host: "app.example.com", release: "release-41", actorType: "human", replayUrl: "https://private.example/replay/secret" },
      ...baseInput.observations,
    ],
  });

  assert.equal(report.status, "failed");
  assert.ok(report.findings.some((finding) => finding.code === "preview-contamination" && finding.evidenceIds.includes("preview")));
  assert.ok(report.findings.some((finding) => finding.code === "release-mismatch" && finding.evidenceIds.includes("mismatch")));
  assert.ok(report.findings.some((finding) => finding.code === "source-map-missing"));
  assert.ok(report.findings.some((finding) => finding.code === "production-error"));
  assert.equal(report.alerts.find((alert) => alert.findingCode === "production-error").status, "routed");
  assert.ok(report.checkInFindings.every((finding) => !JSON.stringify(finding).includes("private@example.com")));
  assert.ok(report.checkInFindings.every((finding) => !JSON.stringify(finding).includes("replay/secret")));
  const checkIn = buildCheckIn({ request: "Ya llegué", now: baseInput.now, evidence: report.checkInFindings });
  assert.equal(checkIn.valid, true);
  assert.ok(checkIn.actions.some((action) => action.id === "posthog:production-error"));
});

test("broken instrumentation requires an explicit failed probe and sanitizes unsafe evidence identifiers", () => {
  const withoutProbe = auditPostHogObservability({
    ...structuredClone(baseInput),
    policy: { ...baseInput.policy, minimumEligibleEvents: 20 },
    observations: [],
  });
  const withProbe = auditPostHogObservability({
    ...structuredClone(baseInput),
    instrumentation: { ...structuredClone(baseInput.instrumentation), probe: { status: "failed", command: "fixture:capture-probe" } },
    observations: [{ id: "private@example.com", kind: "exception", environment: "production", host: "app.example.com", release: "release-42", actorType: "human" }],
  });

  assert.ok(withoutProbe.investigations.some((item) => item.code === "insufficient-sample"));
  assert.ok(!withoutProbe.findings.some((item) => item.code === "instrumentation-broken"));
  assert.ok(withProbe.findings.some((item) => item.code === "instrumentation-broken"));
  assert.ok(withProbe.checkInFindings.some((item) => item.evidenceIds.includes("redacted-evidence-id")));
  assert.ok(!JSON.stringify(withProbe.checkInFindings).includes("private@example.com"));
});

test("low traffic, bots, and expected validation never become silent instrumentation failures", () => {
  const report = auditPostHogObservability({
    ...structuredClone(baseInput),
    policy: { ...baseInput.policy, minimumEligibleEvents: 10 },
    observations: [
      { id: "bot", kind: "event", event: "pageview", environment: "production", host: "app.example.com", release: "release-42", actorType: "bot" },
      { id: "validation", kind: "exception", environment: "production", host: "app.example.com", release: "release-42", actorType: "validation" },
      { id: "human", kind: "event", event: "pageview", environment: "production", host: "app.example.com", release: "release-42", actorType: "human" },
    ],
  });

  assert.deepEqual(report.signalCounts, { eligible: 1, bots: 1, expectedValidation: 1, productionErrors: 0 });
  assert.ok(report.investigations.some((item) => item.code === "insufficient-sample"));
  assert.ok(!report.findings.some((item) => item.code === "instrumentation-broken"));
  assert.equal(report.observationClassifications.find((item) => item.id === "bot").classification, "bot-traffic");
  assert.equal(report.observationClassifications.find((item) => item.id === "validation").classification, "expected-validation");
});

test("only a reproducible bounded error with regression evidence can prepare a draft fix", () => {
  const report = auditPostHogObservability({
    ...structuredClone(baseInput),
    errors: [
      {
        id: "deterministic-error",
        fingerprint: "checkout-total-null",
        observationId: "exception-42",
        reproduction: { status: "passed", revision: "a".repeat(40), steps: ["Open checkout", "Submit known fixture"] },
        rootCause: { status: "bounded", module: "src/checkout/total.ts", explanation: "Null total reaches formatter." },
        regressionTest: { status: "passed", path: "test/checkout-total.test.ts" },
      },
      {
        id: "ambiguous-error",
        fingerprint: "sporadic-timeout",
        reproduction: { status: "not-reproduced", revision: "a".repeat(40), steps: [] },
        rootCause: { status: "unknown" },
        regressionTest: { status: "missing" },
      },
    ],
  });

  assert.deepEqual(report.automation.map((item) => [item.id, item.decision]), [
    ["deterministic-error", "prepare-draft-fix"],
    ["ambiguous-error", "investigate"],
  ]);
  assert.equal(report.automation[0].evidencePacket.revision, "a".repeat(40));
  assert.equal(report.automation[0].evidencePacket.regressionTestPath, "test/checkout-total.test.ts");
  assert.equal(report.automation[1].evidencePacket, null);
  assert.deepEqual(report.externalWriteIntents, []);
});

test("privacy and identity gaps fail closed, and incomplete parity keeps Sentry", () => {
  const report = auditPostHogObservability({
    ...structuredClone(baseInput),
    instrumentation: {
      ...structuredClone(baseInput.instrumentation),
      identity: { anonymous: true, authenticated: false },
      replay: { enabled: true, maskAllText: false, blockAllMedia: false, capturedProperties: ["email", "plan"] },
    },
    legacyProviders: [{ provider: "sentry", repository: "AO/example", parity: { exceptions: true } }],
  });

  assert.ok(report.findings.some((finding) => finding.code === "identity-incomplete"));
  assert.ok(report.findings.some((finding) => finding.code === "replay-privacy-unsafe"));
  assert.equal(report.legacyProviders[0].parityStatus, "unproven");
  assert.equal(report.legacyProviders[0].retirementEligible, false);
  assert.equal(report.legacyProviders[0].requiredAction, "keep-provider");
});

test("the installable skill documents the operational and privacy boundaries", async () => {
  const root = resolve(import.meta.dirname, "../artifacts/1.5.0/skills/internal/posthog-observability");
  const [skill, interfaceYaml] = await Promise.all([
    readFile(resolve(root, "SKILL.md"), "utf8"),
    readFile(resolve(root, "agents/openai.yaml"), "utf8"),
  ]);

  assert.match(skill, /read-only/i);
  assert.match(skill, /production-only/i);
  assert.match(skill, /deterministic reproduction/i);
  assert.match(skill, /never include replay URLs, PII, event properties/i);
  assert.match(skill, /Do not remove Sentry/i);
  assert.match(interfaceYaml, /display_name: "PostHog Observability"/);
});
