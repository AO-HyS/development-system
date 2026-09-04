import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  authenticateSkillProbeEvidence,
  ensureSkillEvidenceKey,
  skillEvidenceKeyPath,
  verifySkillProbeEvidenceAuthentication,
} from "../src/skill-evidence-auth.mjs";
import { invocationDigest } from "../src/skill-probe-runtime.mjs";
import { auditSkillCatalog } from "../src/skills.mjs";

const skillBody = `---
name: tracer-skill
description: Authenticated evidence fixture.
---

Return the tracer behavior.
`;

const structuralSkillBody = `---
name: structural-skill
description: Structural evidence fixture.
---

Return nothing.
`;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function installedFolderHash() {
  return createHash("sha256")
    .update("SKILL.md")
    .update("\0")
    .update(skillBody)
    .update("\0")
    .digest("hex");
}

async function fixture() {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-authenticated-evidence-"));
  const destination = resolve(home, ".agents/skills/tracer-skill");
  await mkdir(destination, { recursive: true });
  await writeFile(resolve(destination, "SKILL.md"), skillBody, "utf8");
  const key = await ensureSkillEvidenceKey(home);
  await writeFile(resolve(home, ".development-system/skills-lock.json"), `${JSON.stringify({
    schemaVersion: 1,
    catalogVersion: "0.24.0",
    sourceCommit: "a".repeat(40),
  }, null, 2)}\n`, { mode: 0o600 });
  const catalog = {
    schemaVersion: 1,
    catalogVersion: "0.24.0",
    maxCatalogEntries: 8,
    supportedRoots: [".agents/skills"],
    operationalEvidenceSkills: ["tracer-skill"],
    operationalEvidenceContracts: {
      "tracer-skill": { behaviorSignature: ["tracer behavior"] },
    },
    skills: [{
      logicalName: "tracer-skill",
      variants: [{
        id: "tracer-skill.codex",
        harness: "codex",
        destination: ".agents/skills/tracer-skill",
        folderSha256: installedFolderHash(),
        expectedMirrorOf: null,
      }],
    }],
  };
  const skillInvocation = {
    executable: "/opt/codex",
    argv: ["-a", "never", "exec", "--ephemeral", "--sandbox", "read-only", "skill-probe"],
    cwd: "/repo",
    env: { HOME: home },
  };
  const catalogInvocation = {
    executable: "/opt/codex",
    argv: ["-a", "never", "exec", "--ephemeral", "--sandbox", "read-only", "catalog-probe"],
    cwd: "/repo",
    env: { HOME: home },
  };
  const baseEvidence = {
    schemaVersion: 2,
    catalogVersion: "0.24.0",
    generatedAt: new Date().toISOString(),
    sourceCommit: "a".repeat(40),
    home,
    probeSucceeded: true,
    behaviorSignatures: { "tracer-skill": ["tracer behavior"] },
    installedHashes: { "tracer-skill.codex": installedFolderHash() },
    codex: {
      "tracer-skill": {
        catalogued: true,
        loaded: true,
        influenced: true,
        catalogResponseMatched: true,
        behaviorSignatureMatched: true,
        invocationDigestSchema: "canonical-executable-argv-cwd-safe-env-v1",
        invocationSha256: invocationDigest(skillInvocation),
        catalogInvocationSha256: invocationDigest(catalogInvocation),
        responseSha256: digest("tracer behavior"),
        catalogResponseSha256: digest("tracer-skill"),
        version: "codex-cli 1.2.3",
        exitCode: 0,
        scannerErrors: [],
        skillRead: {
          schemaVersion: 1,
          observed: true,
          commandProof: "cat-exact-installed-skill",
          path: resolve(destination, "SKILL.md"),
          frontmatterName: "tracer-skill",
          exitCode: 0,
          commandEventSha256: digest("exact command event"),
          commandSha256: digest(`cat ${resolve(destination, "SKILL.md")}`),
          frontmatterSha256: digest(skillBody),
        },
      },
    },
  };
  return { home, key, catalog, baseEvidence };
}

test("catalog 0.24 accepts only host-authenticated evidence and stores no raw provider output", async () => {
  const { home, key, catalog, baseEvidence } = await fixture();
  const evidence = authenticateSkillProbeEvidence(baseEvidence, key);
  const verification = await verifySkillProbeEvidenceAuthentication({ home, evidence });
  assert.deepEqual(verification, { valid: true, reason: null });
  assert.equal(JSON.stringify(evidence).includes("exact skill invocation"), false);
  assert.equal(Object.hasOwn(evidence.codex["tracer-skill"], "response"), false);
  assert.equal(Object.hasOwn(evidence.codex["tracer-skill"], "catalogResponse"), false);
  assert.deepEqual(evidence.behaviorSignatures, {
    "tracer-skill": catalog.operationalEvidenceContracts["tracer-skill"].behaviorSignature,
  });
  const audit = await auditSkillCatalog({ home, catalog, evidence });
  assert.equal(audit.ok, true, audit.problems.join("; "));
  assert.equal(audit.skills[0].states.loaded, true);
  assert.equal(audit.skills[0].states.influenced, true);

  const fabricated = structuredClone(baseEvidence);
  const fabricatedAudit = await auditSkillCatalog({ home, catalog, evidence: fabricated });
  assert.equal(fabricatedAudit.ok, false);
  assert.equal(fabricatedAudit.skills[0].states.loaded, false);
  assert.equal(fabricatedAudit.skills[0].states.influenced, false);
  assert.match(fabricatedAudit.problems.join("\n"), /no host authentication/);

  const tampered = structuredClone(evidence);
  tampered.codex["tracer-skill"].responseSha256 = digest("forged response");
  const tamperedAudit = await auditSkillCatalog({ home, catalog, evidence: tampered });
  assert.equal(tamperedAudit.ok, false);
  assert.equal(tamperedAudit.skills[0].states.influenced, false);
  assert.match(tamperedAudit.problems.join("\n"), /does not match this host or payload/);
});

test("foreign keys and signed stale evidence cannot establish operational health", async () => {
  const primary = await fixture();
  const foreign = await fixture();
  const foreignEvidence = authenticateSkillProbeEvidence(primary.baseEvidence, foreign.key);
  const foreignAudit = await auditSkillCatalog({
    home: primary.home,
    catalog: primary.catalog,
    evidence: foreignEvidence,
  });
  assert.equal(foreignAudit.ok, false);
  assert.equal(foreignAudit.skills[0].states.loaded, false);
  assert.match(foreignAudit.problems.join("\n"), /does not match this host or payload/);

  const stale = structuredClone(primary.baseEvidence);
  stale.generatedAt = "2020-01-01T00:00:00.000Z";
  const staleEvidence = authenticateSkillProbeEvidence(stale, primary.key);
  const staleAudit = await auditSkillCatalog({ home: primary.home, catalog: primary.catalog, evidence: staleEvidence });
  assert.equal(staleAudit.ok, false);
  assert.match(staleAudit.problems.join("\n"), /missing, stale, unsuccessful/);
});

test("authenticated evidence must match separately retained installation provenance", async () => {
  const fixtureValue = await fixture();
  const wrongSource = structuredClone(fixtureValue.baseEvidence);
  wrongSource.sourceCommit = "b".repeat(40);
  const wrongAudit = await auditSkillCatalog({
    home: fixtureValue.home,
    catalog: fixtureValue.catalog,
    evidence: authenticateSkillProbeEvidence(wrongSource, fixtureValue.key),
  });
  assert.equal(wrongAudit.ok, false);
  assert.equal(wrongAudit.skills[0].states.catalogued, false);
  assert.equal(wrongAudit.skills[0].states.loaded, false);
  assert.equal(wrongAudit.skills[0].states.influenced, false);
  assert.match(wrongAudit.problems.join("\n"), /sourceCommit does not match/);

  const missingSource = structuredClone(fixtureValue.baseEvidence);
  delete missingSource.sourceCommit;
  const missingAudit = await auditSkillCatalog({
    home: fixtureValue.home,
    catalog: fixtureValue.catalog,
    evidence: authenticateSkillProbeEvidence(missingSource, fixtureValue.key),
  });
  assert.equal(missingAudit.ok, false);
  assert.equal(missingAudit.skills[0].states.influenced, false);
  assert.match(missingAudit.problems.join("\n"), /sourceCommit does not match/);
});

test("authenticated evidence with signatures from another catalog fails closed", async () => {
  const fixtureValue = await fixture();
  const wrongContract = structuredClone(fixtureValue.baseEvidence);
  wrongContract.behaviorSignatures["tracer-skill"] = ["different catalog behavior"];
  const audit = await auditSkillCatalog({
    home: fixtureValue.home,
    catalog: fixtureValue.catalog,
    evidence: authenticateSkillProbeEvidence(wrongContract, fixtureValue.key),
  });
  assert.equal(audit.ok, false);
  assert.equal(audit.skills[0].states.catalogued, false);
  assert.equal(audit.skills[0].states.loaded, false);
  assert.equal(audit.skills[0].states.influenced, false);
  assert.match(audit.problems.join("\n"), /behavior signatures do not match the selected catalog/i);
});

test("read-only audit never creates missing authentication parents", async () => {
  const fixtureValue = await fixture();
  const home = await mkdtemp(resolve(tmpdir(), "aohys-read-only-skill-audit-"));
  const forged = {
    ...fixtureValue.baseEvidence,
    home,
    authentication: {
      schemaVersion: 1,
      algorithm: "hmac-sha256",
      keyId: "0".repeat(64),
      payloadSha256: "0".repeat(64),
      signature: "0".repeat(64),
    },
  };
  const audit = await auditSkillCatalog({ home, catalog: fixtureValue.catalog, evidence: forged });
  assert.equal(audit.ok, false);
  assert.equal(audit.skills[0].states.catalogued, false);
  assert.equal(audit.skills[0].states.loaded, false);
  assert.equal(audit.skills[0].states.influenced, false);
  await assert.rejects(lstat(resolve(home, ".development-system")), { code: "ENOENT" });
});

test("authenticated catalogs never derive any dynamic skill state from untrusted evidence", async () => {
  const fixtureValue = await fixture();
  fixtureValue.catalog.skills.push({
    logicalName: "structural-skill",
    variants: [{
      id: "structural-skill.codex",
      harness: "codex",
      destination: ".agents/skills/structural-skill",
      expectedMirrorOf: null,
    }],
  });
  fixtureValue.baseEvidence.codex["structural-skill"] = {
    catalogued: true,
    loaded: true,
    influenced: true,
  };
  const audit = await auditSkillCatalog({
    home: fixtureValue.home,
    catalog: fixtureValue.catalog,
    evidence: fixtureValue.baseEvidence,
  });
  const structural = audit.skills.find((skill) => skill.logicalName === "structural-skill");
  assert.equal(structural.states.catalogued, false);
  assert.equal(structural.states.loaded, false);
  assert.equal(structural.states.influenced, false);
});

test("symlinked or permissive host keys are rejected without following or repairing them", async () => {
  const symlinkFixture = await fixture();
  const signed = authenticateSkillProbeEvidence(symlinkFixture.baseEvidence, symlinkFixture.key);
  const keyPath = skillEvidenceKeyPath(symlinkFixture.home);
  const externalKey = resolve(symlinkFixture.home, "external.key");
  await writeFile(externalKey, `${symlinkFixture.key.toString("hex")}\n`, { mode: 0o600 });
  await rm(keyPath);
  await symlink(externalKey, keyPath);
  const symlinkVerification = await verifySkillProbeEvidenceAuthentication({ home: symlinkFixture.home, evidence: signed });
  assert.equal(symlinkVerification.valid, false);

  const permissiveFixture = await fixture();
  const permissiveEvidence = authenticateSkillProbeEvidence(permissiveFixture.baseEvidence, permissiveFixture.key);
  await chmod(skillEvidenceKeyPath(permissiveFixture.home), 0o644);
  const permissiveAudit = await auditSkillCatalog({
    home: permissiveFixture.home,
    catalog: permissiveFixture.catalog,
    evidence: permissiveEvidence,
  });
  assert.equal(permissiveAudit.ok, false);
  assert.equal(permissiveAudit.skills[0].states.loaded, false);
  assert.match(permissiveAudit.problems.join("\n"), /mode 0600/);
});

test("envelope failures make every dynamic state false while structural states stay independently derived", async () => {
  const fixtureValue = await fixture();
  const structuralDestination = resolve(fixtureValue.home, ".agents/skills/structural-skill");
  await mkdir(structuralDestination, { recursive: true });
  await writeFile(resolve(structuralDestination, "SKILL.md"), structuralSkillBody, "utf8");
  fixtureValue.catalog.skills.push({
    logicalName: "structural-skill",
    variants: [{
      id: "structural-skill.codex",
      harness: "codex",
      destination: ".agents/skills/structural-skill",
      expectedMirrorOf: null,
    }],
  });
  fixtureValue.baseEvidence.codex["structural-skill"] = { catalogued: true, loaded: true, influenced: true };

  function assertDynamicFalse(audit) {
    for (const skill of audit.skills) {
      assert.equal(skill.states.catalogued, false, `${skill.logicalName} catalogued should be false`);
      assert.equal(skill.states.loaded, false, `${skill.logicalName} loaded should be false`);
      assert.equal(skill.states.influenced, false, `${skill.logicalName} influenced should be false`);
      assert.equal(skill.states.exists, true, `${skill.logicalName} exists should remain true`);
      assert.equal(skill.states.discovered, true, `${skill.logicalName} discovered should remain true`);
      assert.equal(skill.states.loadable, true, `${skill.logicalName} loadable should remain true`);
    }
  }

  const wrongCatalog = structuredClone(fixtureValue.baseEvidence);
  wrongCatalog.catalogVersion = "0.25.0";
  const wrongCatalogAudit = await auditSkillCatalog({
    home: fixtureValue.home,
    catalog: fixtureValue.catalog,
    evidence: authenticateSkillProbeEvidence(wrongCatalog, fixtureValue.key),
  });
  assert.equal(wrongCatalogAudit.ok, false);
  assertDynamicFalse(wrongCatalogAudit);

  const otherHome = await mkdtemp(resolve(tmpdir(), "aohys-other-home-"));
  const wrongHome = structuredClone(fixtureValue.baseEvidence);
  wrongHome.home = otherHome;
  const wrongHomeAudit = await auditSkillCatalog({
    home: fixtureValue.home,
    catalog: fixtureValue.catalog,
    evidence: authenticateSkillProbeEvidence(wrongHome, fixtureValue.key),
  });
  assert.equal(wrongHomeAudit.ok, false);
  assertDynamicFalse(wrongHomeAudit);

  const failedProbe = structuredClone(fixtureValue.baseEvidence);
  failedProbe.probeSucceeded = false;
  const failedProbeAudit = await auditSkillCatalog({
    home: fixtureValue.home,
    catalog: fixtureValue.catalog,
    evidence: authenticateSkillProbeEvidence(failedProbe, fixtureValue.key),
  });
  assert.equal(failedProbeAudit.ok, false);
  assertDynamicFalse(failedProbeAudit);

  const wrongHash = structuredClone(fixtureValue.baseEvidence);
  wrongHash.installedHashes["tracer-skill.codex"] = "c".repeat(64);
  const wrongHashAudit = await auditSkillCatalog({
    home: fixtureValue.home,
    catalog: fixtureValue.catalog,
    evidence: authenticateSkillProbeEvidence(wrongHash, fixtureValue.key),
  });
  assert.equal(wrongHashAudit.ok, false);
  assertDynamicFalse(wrongHashAudit);

  const missingHashes = structuredClone(fixtureValue.baseEvidence);
  delete missingHashes.installedHashes;
  const missingHashesAudit = await auditSkillCatalog({
    home: fixtureValue.home,
    catalog: fixtureValue.catalog,
    evidence: authenticateSkillProbeEvidence(missingHashes, fixtureValue.key),
  });
  assert.equal(missingHashesAudit.ok, false);
  assertDynamicFalse(missingHashesAudit);
});

test("per-observation detail failures make every dynamic state false while structural states stay healthy", async () => {
  const fixtureValue = await fixture();

  /** @param {Record<string, unknown>} observation */
  const cases = [
    ["wrong invocation schema marker", (observation) => {
      observation.invocationDigestSchema = "canonical-executable-argv-cwd-safe-env-v0";
    }],
    ["missing invocation schema marker", (observation) => {
      delete observation.invocationDigestSchema;
    }],
    ["malformed skill invocation digest", (observation) => {
      observation.invocationSha256 = "d".repeat(63);
    }],
    ["missing skill invocation digest", (observation) => {
      delete observation.invocationSha256;
    }],
    ["malformed catalog invocation digest", (observation) => {
      observation.catalogInvocationSha256 = "not-a-digest";
    }],
    ["missing catalog invocation digest", (observation) => {
      delete observation.catalogInvocationSha256;
    }],
    ["malformed response digest", (observation) => {
      observation.responseSha256 = "";
    }],
    ["missing response digest", (observation) => {
      delete observation.responseSha256;
    }],
    ["malformed catalog response digest", (observation) => {
      observation.catalogResponseSha256 = "zzz";
    }],
    ["missing catalog response digest", (observation) => {
      delete observation.catalogResponseSha256;
    }],
    ["empty version", (observation) => {
      observation.version = "";
    }],
    ["missing version", (observation) => {
      delete observation.version;
    }],
    ["non-zero exit code", (observation) => {
      observation.exitCode = 1;
    }],
    ["missing exit code", (observation) => {
      delete observation.exitCode;
    }],
  ];
  for (const [label, mutate] of cases) {
    const tampered = structuredClone(fixtureValue.baseEvidence);
    mutate(tampered.codex["tracer-skill"]);
    const audit = await auditSkillCatalog({
      home: fixtureValue.home,
      catalog: fixtureValue.catalog,
      evidence: authenticateSkillProbeEvidence(tampered, fixtureValue.key),
    });
    assert.equal(audit.ok, false, `${label}: audit must fail`);
    assert.match(
      audit.problems.join("\n"),
      /operational evidence (lacks executable, version, exit, or response detail|does not match the installed folder hash)/,
      `${label}: expected the detail problem`,
    );
    const states = audit.skills[0].states;
    assert.equal(states.catalogued, false, `${label}: catalogued must be false`);
    assert.equal(states.loaded, false, `${label}: loaded must be false`);
    assert.equal(states.influenced, false, `${label}: influenced must be false`);
    // The installed files are healthy, so structural states stay true.
    assert.equal(states.exists, true, `${label}: exists must stay true`);
    assert.equal(states.discovered, true, `${label}: discovered must stay true`);
    assert.equal(states.loadable, true, `${label}: loadable must stay true`);
  }
});
