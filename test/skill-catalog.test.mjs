import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  auditSkillCatalog,
  rollbackSkillSync,
  synchronizeSkillCatalog,
  validateSkillCatalog,
} from "../src/skills.mjs";

const skillBody = `---
name: tracer-skill
description: Emits the catalog tracer marker.
---

Reply with CATALOG_TRACER_ACTIVE.
`;

function skillHash(body = skillBody) {
  return createHash("sha256").update("SKILL.md\0").update(body).update("\0").digest("hex");
}

test("skill audit separates mirrors and the six operational states", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-skill-catalog-"));
  const shared = resolve(home, ".agents", "skills", "tracer-skill");
  const factory = resolve(home, ".factory", "skills", "tracer-skill");
  await mkdir(shared, { recursive: true });
  await mkdir(factory, { recursive: true });
  await writeFile(resolve(shared, "SKILL.md"), skillBody, "utf8");
  await writeFile(resolve(factory, "SKILL.md"), skillBody, "utf8");

  const audit = await auditSkillCatalog({
    home,
    catalog: {
      maxCatalogEntries: 8,
      supportedRoots: [".agents/skills", ".codex/skills", ".factory/skills"],
      skills: [
        {
          logicalName: "tracer-skill",
          variants: [
            {
              id: "tracer-skill.shared",
              harness: "codex",
              destination: ".agents/skills/tracer-skill",
              expectedMirrorOf: null,
            },
            {
              id: "tracer-skill.factory",
              harness: "factory",
              destination: ".factory/skills/tracer-skill",
              expectedMirrorOf: "tracer-skill.shared",
            },
          ],
        },
      ],
    },
    evidence: {
      codex: {
        "tracer-skill": { catalogued: true, loaded: true, influenced: true },
      },
      factory: {
        "tracer-skill": { catalogued: true, loaded: true, influenced: true },
      },
    },
  });

  assert.equal(audit.ok, true);
  assert.equal(audit.logicalSkillCount, 1);
  assert.equal(audit.physicalVariantCount, 2);
  assert.equal(audit.mirrors[0].status, "identical");
  assert.deepEqual(
    audit.skills.map((skill) => skill.states),
    [
      {
        exists: true,
        discovered: true,
        catalogued: true,
        loadable: true,
        loaded: true,
        influenced: true,
      },
      {
        exists: true,
        discovered: true,
        catalogued: true,
        loadable: true,
        loaded: true,
        influenced: true,
      },
    ],
  );
});

test("skill audit fails clean catalog health on broken links and overflow", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-skill-health-"));
  const root = resolve(home, ".factory", "skills");
  await mkdir(root, { recursive: true });
  await symlink("../../.agents/skills/missing", resolve(root, "broken"));
  await mkdir(resolve(root, "extra"));

  const audit = await auditSkillCatalog({
    home,
    catalog: {
      maxCatalogEntries: 1,
      supportedRoots: [".factory/skills"],
      skills: [],
    },
  });

  assert.equal(audit.ok, false);
  assert.equal(audit.catalogHealth.overflow, true);
  assert.deepEqual(audit.catalogHealth.brokenSymlinks, [".factory/skills/broken"]);
  assert.match(audit.problems.join("\n"), /broken symbolic link/i);
  assert.match(audit.problems.join("\n"), /catalog overflow/i);
});

test("skill audit rejects declared orphans, duplicate logical names, and missing operational evidence", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-skill-orphans-"));
  for (const name of ["tracer-skill", "tracer-skill-old", "retired"]) {
    const directory = resolve(home, ".agents", "skills", name);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "SKILL.md"), skillBody, "utf8");
  }
  const audit = await auditSkillCatalog({
    home,
    catalog: {
      maxCatalogEntries: 8,
      supportedRoots: [".agents/skills"],
      cleanup: [".agents/skills/retired"],
      operationalEvidenceSkills: ["tracer-skill"],
      skills: [{
        logicalName: "tracer-skill",
        variants: [{
          id: "tracer-skill.codex",
          harness: "codex",
          destination: ".agents/skills/tracer-skill",
          folderSha256: skillHash(),
          expectedMirrorOf: null,
        }],
      }],
    },
  });

  assert.equal(audit.ok, false);
  assert.deepEqual(audit.catalogHealth.orphanedEntries, [".agents/skills/retired"]);
  assert.deepEqual(audit.catalogHealth.unmanifestedDuplicates, [".agents/skills/tracer-skill-old"]);
  assert.match(audit.problems.join("\n"), /operational evidence/i);
});

test("skill synchronization cleans explicit residue and rollback restores exact prior entries", async () => {
  const sourceRoot = await mkdtemp(resolve(tmpdir(), "aohys-skill-source-"));
  const home = await mkdtemp(resolve(tmpdir(), "aohys-skill-sync-"));
  const sourceSkill = resolve(sourceRoot, "skills", "tracer-skill");
  const installedSkill = resolve(home, ".agents", "skills", "tracer-skill");
  const brokenLink = resolve(home, ".factory", "skills", "obsolete-link");
  const unrelated = resolve(home, "notes", "keep.txt");
  await mkdir(sourceSkill, { recursive: true });
  await writeFile(resolve(sourceSkill, "SKILL.md"), skillBody, "utf8");
  await mkdir(installedSkill, { recursive: true });
  await writeFile(resolve(installedSkill, "SKILL.md"), "old local bytes\n", "utf8");
  await mkdir(resolve(home, ".factory", "skills"), { recursive: true });
  await symlink("../../.agents/skills/missing", brokenLink);
  await mkdir(resolve(home, "notes"), { recursive: true });
  await writeFile(unrelated, "preserve me\n", "utf8");
  execFileSync("git", ["init", "-q"], { cwd: sourceRoot });
  execFileSync("git", ["add", "."], { cwd: sourceRoot });
  execFileSync("git", ["-c", "user.name=AOHYS Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"], { cwd: sourceRoot });

  const catalog = {
    schemaVersion: 1,
    catalogVersion: "0.2.0",
    supportedHarnesses: [
      { id: "codex" },
      { id: "t3code" },
      { id: "factory" },
    ],
    maxCatalogEntries: 8,
    supportedRoots: [".agents/skills", ".factory/skills"],
    cleanup: [".factory/skills/obsolete-link"],
    skills: [
      {
        logicalName: "tracer-skill",
        source: { repository: "https://example.test/source", commit: "a".repeat(40), path: "skills/tracer-skill" },
        variants: [
          {
            id: "tracer-skill.shared",
            harness: "codex",
            sourceDirectory: "skills/tracer-skill",
            destination: ".agents/skills/tracer-skill",
            folderSha256: skillHash(),
            expectedMirrorOf: null,
          },
        ],
      },
    ],
  };

  const sync = await synchronizeSkillCatalog({ home, sourceRoot, catalog });
  assert.equal(sync.ok, true);
  assert.equal(await readFile(resolve(installedSkill, "SKILL.md"), "utf8"), skillBody);
  await assert.rejects(lstat(brokenLink));
  assert.equal(await readFile(unrelated, "utf8"), "preserve me\n");

  const statePath = resolve(home, ".development-system", "skill-sync-state.json");
  const originalState = JSON.parse(await readFile(statePath, "utf8"));
  const installedBackup = resolve(home, ".development-system", "skill-snapshots", originalState.snapshotId, originalState.entries[0].backup);
  await writeFile(resolve(installedBackup, "SKILL.md"), "tampered backup\n", "utf8");
  await assert.rejects(rollbackSkillSync({ home, catalog }), /snapshot integrity mismatch/i);
  assert.equal(await readFile(resolve(installedSkill, "SKILL.md"), "utf8"), skillBody);
  await writeFile(resolve(installedBackup, "SKILL.md"), "old local bytes\n", "utf8");
  const tamperedState = structuredClone(originalState);
  tamperedState.entries.push({ path: "notes", existed: false, backup: null });
  await writeFile(statePath, `${JSON.stringify(tamperedState)}\n`, "utf8");
  await assert.rejects(rollbackSkillSync({ home, catalog }), /unauthorized entry/i);
  assert.equal(await readFile(unrelated, "utf8"), "preserve me\n");
  await writeFile(statePath, `${JSON.stringify(originalState)}\n`, "utf8");

  const rollback = await rollbackSkillSync({ home, catalog });
  assert.equal(rollback.ok, true);
  assert.equal(await readFile(resolve(installedSkill, "SKILL.md"), "utf8"), "old local bytes\n");
  assert.equal((await lstat(brokenLink)).isSymbolicLink(), true);
  assert.equal(await readlink(brokenLink), "../../.agents/skills/missing");
  assert.equal(await readFile(unrelated, "utf8"), "preserve me\n");
});

test("catalog validation rejects undeclared divergent harness variants", async () => {
  const sourceRoot = await mkdtemp(resolve(tmpdir(), "aohys-skill-adapter-"));
  const codex = resolve(sourceRoot, "codex");
  const factory = resolve(sourceRoot, "factory");
  await mkdir(codex);
  await mkdir(factory);
  await writeFile(resolve(codex, "SKILL.md"), skillBody, "utf8");
  await writeFile(resolve(factory, "SKILL.md"), `${skillBody}\nFactory-only text.\n`, "utf8");

  const errors = await validateSkillCatalog(
    {
      schemaVersion: 1,
      catalogVersion: "0.2.0",
      supportedHarnesses: [
        { id: "codex", adapter: "native" },
        { id: "t3code", adapter: "codex" },
        { id: "factory", adapter: "native" },
      ],
      supportedRoots: [".codex/skills", ".factory/skills"],
      maxCatalogEntries: 8,
      cleanup: [],
      skills: [
        {
          logicalName: "tracer-skill",
          source: { repository: "https://example.test/source", commit: "a".repeat(40), path: "skills" },
          variants: [
            {
              id: "tracer.codex",
              harness: "codex",
              sourceDirectory: "codex",
              destination: ".codex/skills/tracer-skill",
              folderSha256: "1".repeat(64),
              expectedMirrorOf: null,
            },
            {
              id: "tracer.factory",
              harness: "factory",
              sourceDirectory: "factory",
              destination: ".factory/skills/tracer-skill",
              folderSha256: "0".repeat(64),
              expectedMirrorOf: null,
            },
          ],
        },
      ],
    },
    sourceRoot,
  );

  assert.match(errors.join("\n"), /divergent.*adapter contract/i);
});

test("catalog validation rejects nested symbolic links in canonical skill sources", async () => {
  const sourceRoot = await mkdtemp(resolve(tmpdir(), "aohys-skill-source-link-"));
  const source = resolve(sourceRoot, "skill");
  await mkdir(source);
  await writeFile(resolve(source, "SKILL.md"), skillBody, "utf8");
  await symlink("/tmp/outside-skill-content", resolve(source, "outside"));

  const errors = await validateSkillCatalog({
    schemaVersion: 1,
    catalogVersion: "0.2.0",
    supportedHarnesses: [{ id: "codex" }, { id: "t3code" }, { id: "factory" }],
    supportedRoots: [".agents/skills"],
    maxCatalogEntries: 8,
    cleanup: [],
    skills: [{
      logicalName: "tracer-skill",
      source: { repository: "https://example.test/source", commit: "a".repeat(40), path: "skill" },
      variants: [{
        id: "tracer.codex",
        harness: "codex",
        sourceDirectory: "skill",
        destination: ".agents/skills/tracer-skill",
        folderSha256: skillHash(),
        expectedMirrorOf: null,
      }],
    }],
  }, sourceRoot);

  assert.match(errors.join("\n"), /contains symbolic link/i);
});

test("skill synchronization rejects source bytes absent from the recorded Git commit", async () => {
  const sourceRoot = await mkdtemp(resolve(tmpdir(), "aohys-skill-untracked-source-"));
  const home = await mkdtemp(resolve(tmpdir(), "aohys-skill-untracked-home-"));
  execFileSync("git", ["init", "-q"], { cwd: sourceRoot });
  await writeFile(resolve(sourceRoot, ".gitignore"), "ignored-skill/\n", "utf8");
  execFileSync("git", ["add", ".gitignore"], { cwd: sourceRoot });
  execFileSync("git", ["-c", "user.name=AOHYS Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"], { cwd: sourceRoot });
  await mkdir(resolve(sourceRoot, "ignored-skill"));
  await writeFile(resolve(sourceRoot, "ignored-skill", "SKILL.md"), skillBody, "utf8");

  const catalog = {
    schemaVersion: 1,
    catalogVersion: "0.2.0",
    supportedHarnesses: [{ id: "codex" }, { id: "t3code" }, { id: "factory" }],
    supportedRoots: [".agents/skills"],
    maxCatalogEntries: 8,
    cleanup: [],
    skills: [{
      logicalName: "tracer-skill",
      source: { repository: "https://example.test/source", commit: "a".repeat(40), path: "ignored-skill" },
      variants: [{
        id: "tracer.codex",
        harness: "codex",
        sourceDirectory: "ignored-skill",
        destination: ".agents/skills/tracer-skill",
        folderSha256: skillHash(),
        expectedMirrorOf: null,
      }],
    }],
  };

  await assert.rejects(
    synchronizeSkillCatalog({ home, sourceRoot, catalog }),
    /absent from Git/i,
  );
});
