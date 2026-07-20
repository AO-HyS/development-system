import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, readdir, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  auditRepository,
  fingerprintRepository,
  initializeRepository,
  normalizeRepository,
} from "../src/repositories.mjs";

const repositoryRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const cliPath = resolve(repositoryRoot, "bin/development-system.mjs");

async function write(root, path, contents) {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

async function snapshot(root, current = root) {
  const result = {};
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const target = resolve(current, entry.name);
    const path = relative(root, target);
    if (entry.isDirectory()) Object.assign(result, await snapshot(root, target));
    else result[path] = await readFile(target, "utf8");
  }
  return result;
}

function runCli(...args) {
  const run = spawnSync(process.execPath, [cliPath, ...args, "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return {
    status: run.status,
    stderr: run.stderr,
    json: run.stdout ? JSON.parse(run.stdout) : null,
  };
}

async function seedOperationalRepository(prefix = "aohys-repository-audit-", contaminated = true) {
  const repository = await mkdtemp(resolve(tmpdir(), prefix));
  await write(
    repository,
    "package.json",
    JSON.stringify({
      name: "lumen-console",
      private: true,
      scripts: {
        review: "node -e \"process.exit(0)\"",
        verify: "node -e \"process.exit(0)\"",
        qa: "node -e \"process.exit(0)\"",
        preview: "node -e \"process.exit(0)\"",
      },
      dependencies: { react: "19.1.0", convex: "1.25.0" },
    }),
  );
  await write(repository, "AGENTS.md", "# Lumen Console\nPreserve the Lumen product language.\n");
  await write(
    repository,
    "apps/web/AGENTS.md",
    contaminated
      ? "# Web instructions\nCopy the NutriPlan release train and nutrition vocabulary.\n"
      : "# Web instructions\nPreserve the Lumen product contract.\n",
  );
  await write(repository, "apps/web/.factory/commands/review.md", "# Factory review command\nReview Lumen.\n");
  await write(repository, ".agents/skills/domain-review/SKILL.md", "---\nname: domain-review\n---\n");
  if (contaminated) {
    await write(repository, ".legacy/skills/inert/SKILL.md", "---\nname: inert\n---\n");
  }
  await write(repository, ".codex/agents/reviewer.toml", "name = \"reviewer\"\n");
  await write(repository, ".factory/droids/foul.md", "# Foul reviewer\n");
  await write(repository, ".husky/pre-commit", "pnpm verify\n");
  return repository;
}

async function validOperationalEvidence(repository, path, harness = "codex") {
  return {
    schemaVersion: 2,
    repositoryRoot: repository,
    repositoryFingerprint: await fingerprintRepository(repository),
    generatedAt: new Date().toISOString(),
    observations: [{
      harness,
      path,
      discovered: true,
      catalogued: true,
      loadable: true,
      loaded: true,
      influenced: true,
      executable: harness === "factory" ? "droid" : "codex",
      version: "fixture-runtime-1",
      command: `${harness} activate ${path}`,
      catalogCommand: `${harness} list skills`,
      exitCode: 0,
      response: "The declared skill was loaded and changed the requested behavior.",
      pathSha256: createHash("sha256").update(await readFile(resolve(repository, path))).digest("hex"),
    }],
  };
}

async function trustedLiveVerifier({ observation }) {
  return {
    ...observation,
    discovered: true,
    catalogued: true,
    loadable: true,
    loaded: true,
    influenced: true,
    readOnly: true,
    executable: process.execPath,
    command: [process.execPath, "--version"],
    version: process.version,
    exitCode: 0,
    externalSideEffects: [],
    response: "VERIFIED_REPOSITORY_SKILL_INFLUENCE",
    behaviorSignature: ["verified repository skill influence"],
  };
}

test("repository audit reports precedence, residue, six-state evidence, and harness readiness without mutation", async () => {
  const repository = await seedOperationalRepository();
  const before = await snapshot(repository);
  const evidence = await validOperationalEvidence(repository, ".agents/skills/domain-review/SKILL.md");
  const audit = await auditRepository({
    repository,
    evidence,
    verifyObservation: trustedLiveVerifier,
  });

  assert.equal(audit.operation, "audit-repository");
  assert.equal(audit.externalSideEffects.length, 0);
  assert.deepEqual(await snapshot(repository), before);
  assert.deepEqual(audit.stack.sort(), ["convex", "react"]);
  assert.deepEqual(audit.inventory.instructions.map((instruction) => instruction.path), [
    "AGENTS.md",
    "apps/web/.factory/commands/review.md",
    "apps/web/AGENTS.md",
  ]);
  assert.equal(audit.inventory.instructions[1].scope, "apps/web");
  assert.ok(audit.inventory.instructions[1].precedence > audit.inventory.instructions[0].precedence);
  assert.equal(audit.inventory.instructions[1].operationalByHarness.factory.discovered, true);
  assert.equal(audit.inventory.instructions[1].operationalByHarness.codex.discovered, false);
  assert.deepEqual(audit.inventory.agents.map((entry) => entry.path), [".codex/agents/reviewer.toml"]);
  assert.deepEqual(audit.inventory.droids.map((entry) => entry.path), [".factory/droids/foul.md"]);
  assert.deepEqual(audit.inventory.hooks.map((entry) => entry.path), [".husky/pre-commit"]);
  assert.ok(audit.residue.some((entry) => entry.marker === "NutriPlan"));
  const loadedSkill = audit.inventory.skills.find((entry) => entry.path.includes("domain-review"));
  assert.deepEqual(loadedSkill.states, {
    exists: true,
    discovered: true,
    catalogued: true,
    loadable: true,
    loaded: true,
    influenced: true,
  });
  assert.equal(loadedSkill.operationalByHarness.codex.loaded, true);
  assert.equal(loadedSkill.operationalByHarness.factory.loaded, false);
  assert.equal(audit.evidence.observations[0].executable, process.execPath);
  assert.deepEqual(audit.evidence.observations[0].command, [process.execPath, "--version"]);
  assert.equal(audit.evidence.observations[0].response, "VERIFIED_REPOSITORY_SKILL_INFLUENCE");
  assert.notEqual(audit.evidence.observations[0].executable, evidence.observations[0].executable);
  const inertSkill = audit.inventory.skills.find((entry) => entry.path.includes("inert"));
  assert.equal(inertSkill.states.discovered, false);
  assert.equal(inertSkill.states.loaded, false);
  assert.ok(audit.readiness.codex.gaps.includes("foreign-product-residue"));
  assert.equal(audit.architectureDiagnostic.id, "improve-codebase-architecture");
  assert.equal(audit.architectureDiagnostic.mode, "manual");
  assert.equal(audit.architectureDiagnostic.effect, "proposal-only");
});

test("repository audit deterministically excludes caches and never reads a sparse file larger than 2 GiB", async () => {
  const repository = await seedOperationalRepository("aohys-repository-large-cache-", false);
  const cachePath = resolve(repository, ".turbo", "daemon", "11gb-cache.bin");
  await write(repository, ".turbo/daemon/11gb-cache.bin", "cache");
  await truncate(cachePath, (2 * 1024 * 1024 * 1024) + 1);
  const before = await stat(cachePath);

  const firstFingerprint = await fingerprintRepository(repository);
  const audit = await auditRepository({ repository });
  const secondFingerprint = await fingerprintRepository(repository);
  const after = await stat(cachePath);

  assert.equal(firstFingerprint, secondFingerprint);
  assert.equal(audit.repositoryFingerprint, firstFingerprint);
  assert.equal(audit.externalSideEffects.length, 0);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.ok(audit.fingerprint.excluded.some((entry) => entry.path === ".turbo"));
  assert.equal(audit.fingerprint.maximumFileBytesRead <= 1024 * 1024, true);

  const governedPath = resolve(repository, "large-source.bin");
  const governedSize = (2 * 1024 * 1024 * 1024) + 1;
  await writeFile(governedPath, "");
  await truncate(governedPath, governedSize);
  const beforeMiddleChange = await fingerprintRepository(repository);
  const handle = await open(governedPath, "r+");
  try {
    const distributedSampleOffset = Math.floor(((governedSize - (64 * 1024)) * 8) / 15);
    await handle.write(Buffer.from("changed-middle"), 0, 14, distributedSampleOffset);
  } finally {
    await handle.close();
  }
  const afterMiddleChange = await fingerprintRepository(repository);
  assert.notEqual(afterMiddleChange, beforeMiddleChange);
  const boundedAudit = await auditRepository({ repository });
  assert.equal(boundedAudit.fingerprint.maximumFileBytesRead <= 1024 * 1024, true);
});

test("residue detection preserves authorized Impeccable references but still finds inherited product rules", async () => {
  const repository = await seedOperationalRepository("aohys-repository-impeccable-", false);
  await write(
    repository,
    "AGENTS.md",
    "# Lumen Console\nPreserve the existing Impeccable visual and mobile configuration; do not change it.\n",
  );
  await write(
    repository,
    "apps/copied/AGENTS.md",
    "Adopt Impeccable as the global template and copy the NutriPlan release rules.\n",
  );

  const audit = await auditRepository({ repository });

  assert.equal(
    audit.residue.some((entry) => entry.path === "AGENTS.md" && entry.marker === "Impeccable"),
    false,
  );
  assert.equal(
    audit.allowedReferences.some((entry) => entry.path === "AGENTS.md" && entry.marker === "Impeccable"),
    true,
  );
  assert.equal(
    audit.residue.some((entry) => entry.path === "apps/copied/AGENTS.md" && entry.marker === "Impeccable"),
    true,
  );
  assert.equal(
    audit.residue.some((entry) => entry.path === "apps/copied/AGENTS.md" && entry.marker === "NutriPlan"),
    true,
  );
});

test("audit never upgrades file presence to operational load and CLI normalization requires a separate trigger", async () => {
  const repository = await seedOperationalRepository("aohys-repository-cli-");
  const audit = runCli("audit-repository", "--repository", repository);
  assert.equal(audit.status, 0, audit.stderr);
  assert.equal(audit.json.operation, "audit-repository");
  assert.ok(audit.json.inventory.skills.every((skill) => skill.states.loaded === false));
  assert.ok(audit.json.evidence.warnings.some((warning) => /operational evidence/i.test(warning)));
  assert.equal((await stat(resolve(repository, ".development-system")).catch(() => null)), null);

  const denied = runCli("normalize-repository", "--repository", repository);
  assert.notEqual(denied.status, 0);
  assert.match(denied.json.error, /--confirm normalize/i);
  assert.equal((await stat(resolve(repository, ".development-system")).catch(() => null)), null);
});

test("audit rejects stale or non-monotonic operational load claims", async () => {
  const repository = await seedOperationalRepository("aohys-repository-evidence-");
  const evidence = await validOperationalEvidence(repository, ".agents/skills/domain-review/SKILL.md", "factory");
  Object.assign(evidence.observations[0], {
    discovered: false,
    catalogued: false,
    loadable: false,
    loaded: false,
    influenced: true,
  });
  const audit = await auditRepository({
    repository,
    evidence,
    verifyObservation: trustedLiveVerifier,
  });

  const skill = audit.inventory.skills.find((entry) => entry.path.includes("domain-review"));
  assert.equal(skill.operationalByHarness.factory.influenced, false);
  assert.ok(audit.evidence.warnings.some((warning) => /invalid operational observation/i.test(warning)));
});

test("audit rejects fabricated operational claims without runtime and file-bound evidence", async () => {
  const repository = await seedOperationalRepository("aohys-repository-fabricated-", false);
  const audit = await auditRepository({
    repository,
    evidence: {
      schemaVersion: 2,
      repositoryRoot: repository,
      repositoryFingerprint: await fingerprintRepository(repository),
      generatedAt: new Date().toISOString(),
      observations: [{
        harness: "codex",
        path: ".agents/skills/domain-review/SKILL.md",
        discovered: true,
        catalogued: true,
        loadable: true,
        loaded: true,
        influenced: true,
      }],
    },
  });

  const skill = audit.inventory.skills.find((entry) => entry.path.includes("domain-review"));
  assert.equal(skill.operationalByHarness.codex.loaded, false);
  assert.ok(audit.evidence.warnings.some((warning) => /unattested|live observation verifier/i.test(warning)));
});

test("live observation verification fails closed on signature, runtime, timeout, or side effects", async () => {
  const repository = await seedOperationalRepository("aohys-repository-verifier-", false);
  const evidence = await validOperationalEvidence(repository, ".agents/skills/domain-review/SKILL.md");
  const invalidVerifiers = [
    async (context) => ({ ...await trustedLiveVerifier(context), behaviorSignature: ["missing signature"] }),
    async (context) => ({ ...await trustedLiveVerifier(context), exitCode: 1 }),
    async (context) => ({ ...await trustedLiveVerifier(context), externalSideEffects: ["wrote state"] }),
    async () => { throw new Error("probe timeout"); },
  ];

  for (const verifyObservation of invalidVerifiers) {
    const audit = await auditRepository({ repository, evidence, verifyObservation });
    const skill = audit.inventory.skills.find((entry) => entry.path.includes("domain-review"));
    assert.equal(skill.operationalByHarness.codex.loaded, false);
    assert.equal(skill.operationalByHarness.codex.influenced, false);
  }

  const sideEffecting = await auditRepository({
    repository,
    evidence,
    verifyObservation: async (context) => {
      await write(repository, "probe-side-effect.txt", "unexpected mutation\n");
      return trustedLiveVerifier(context);
    },
  });
  assert.equal(sideEffecting.inventory.skills.find((entry) => entry.path.includes("domain-review")).states.loaded, false);
  assert.ok(sideEffecting.evidence.warnings.some((warning) => /changed the repository/i.test(warning)));

  await write(repository, ".agents/skills/domain-review/SKILL.md", "---\nname: domain-review\n---\nchanged\n");
  const divergent = await auditRepository({ repository, evidence, verifyObservation: trustedLiveVerifier });
  assert.equal(divergent.inventory.skills.find((entry) => entry.path.includes("domain-review")).states.loaded, false);
  assert.ok(divergent.evidence.warnings.some((warning) => /fingerprint|current repository/i.test(warning)));
});

test("initialization is idempotent, stack-aware, and preserves product identity, design, commands, and release policy", async () => {
  const repository = await mkdtemp(resolve(tmpdir(), "aohys-repository-init-"));
  await write(
    repository,
    "package.json",
    JSON.stringify({
      name: "aurora-studio",
      private: true,
      scripts: {
        review: "node -e \"process.exit(0)\"",
        validate: "node -e \"process.exit(0)\"",
        "test:e2e": "node -e \"process.exit(0)\"",
        preview: "node -e \"process.exit(0)\"",
      },
      dependencies: { react: "19.1.0", convex: "1.25.0" },
    }),
  );
  await write(repository, "README.md", "# Aurora Studio\nProduct domain copy.\n");
  await write(repository, "RELEASE.md", "Release from develop after human approval.\n");
  await write(repository, "src/theme.css", ":root { --brand: orchid; }\n");
  const protectedBefore = await snapshot(repository);

  const first = await initializeRepository({ repository, confirm: "initialize" });
  const initialized = await snapshot(repository);
  const second = await initializeRepository({ repository, confirm: "initialize" });

  assert.equal(first.ok, true);
  assert.equal(second.status, "unchanged");
  assert.deepEqual(await snapshot(repository), initialized);
  for (const [path, contents] of Object.entries(protectedBefore)) {
    assert.equal(initialized[path], contents, `${path} was not preserved`);
  }
  const contract = JSON.parse(initialized[".development-system/repository.json"]);
  assert.equal(contract.product.name, "aurora-studio");
  assert.equal(contract.product.packageManager, "npm");
  assert.deepEqual(contract.product.stack.sort(), ["convex", "react"]);
  assert.equal(contract.commands.review.script, "review");
  assert.equal(contract.commands.validation.script, "validate");
  assert.equal(contract.commands.qa.script, "test:e2e");
  assert.equal(contract.commands.preview.script, "preview");
  assert.equal(contract.services.paidActivation, false);
  assert.equal(contract.architectureDiagnostic.effect, "proposal-only");
  assert.match(initialized[".codex/development-system/repository.md"], /React.*Convex/is);
  assert.match(initialized[".factory/development-system/repository.md"], /documented equivalent/i);
  assert.deepEqual(first.readiness, { codex: "prepared", t3code: "prepared", factory: "prepared" });

  const packageJson = JSON.parse(initialized["package.json"]);
  for (const capability of Object.values(contract.commands)) {
    assert.equal(packageJson.scripts[capability.script], "node -e \"process.exit(0)\"");
    const run = spawnSync(process.execPath, ["-e", "process.exit(0)"], { cwd: repository });
    assert.equal(run.status, 0, capability.script);
  }
});

test("normalization replaces only managed drift and remains deterministic", async () => {
  const repository = await seedOperationalRepository("aohys-repository-normalize-", false);
  await write(repository, "RELEASE.md", "Keep the product release policy.\n");
  await write(repository, "src/product-theme.css", ":root { --identity: lumen; }\n");
  await write(repository, ".development-system/repository.json", "{\"contractVersion\":\"stale\"}\n");
  await write(repository, ".codex/development-system/repository.md", "stale Codex adapter\n");
  await write(repository, ".factory/development-system/repository.md", "stale Factory adapter\n");
  const before = await snapshot(repository);

  await assert.rejects(normalizeRepository({ repository }), /confirm.*normalize/i);
  const normalized = await normalizeRepository({ repository, confirm: "normalize" });
  const after = await snapshot(repository);
  assert.equal(normalized.ok, true);
  assert.equal(normalized.status, "updated");
  for (const [path, contents] of Object.entries(before)) {
    if (path.includes("development-system/repository")) continue;
    assert.equal(after[path], contents, `${path} was not preserved`);
  }
  const contract = JSON.parse(after[".development-system/repository.json"]);
  assert.equal(contract.preparation.mode, "normalize");
  assert.equal(contract.product.name, "lumen-console");
  assert.deepEqual(contract.preserved.releasePolicyFiles, ["RELEASE.md"]);
  assert.deepEqual(contract.preserved.designFiles, ["src/product-theme.css"]);

  const again = await normalizeRepository({ repository, confirm: "normalize" });
  assert.equal(again.status, "unchanged");
  assert.deepEqual(await snapshot(repository), after);
});

test("preparation refuses managed symlink escapes", async () => {
  const repository = await seedOperationalRepository("aohys-repository-symlink-", false);
  const outside = await mkdtemp(resolve(tmpdir(), "aohys-repository-outside-"));
  await symlink(outside, resolve(repository, ".development-system"));

  await assert.rejects(
    initializeRepository({ repository, confirm: "initialize" }),
    /symbolic link/i,
  );
  assert.deepEqual(await readdir(outside), []);
});
