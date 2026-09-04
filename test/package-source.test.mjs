import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import {
  loadPackageSource,
  packageDirectoryHash,
  packageFileBytes,
  packageFileIsExecutable,
  verifyPackageFile,
} from "../src/package-source.mjs";
import { synchronizeSkillCatalog } from "../src/skills.mjs";

const canonicalRepository = "https://github.com/AO-HyS/development-system";
const packageName = "@aohys/development-system";
const packageVersion = "9.9.9";
const packageCommit = "a".repeat(40);
const otherCommit = "b".repeat(40);
const anyHash = "c".repeat(64);

function sha256Bytes(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function sha256File(absolutePath) {
  return sha256Bytes(readFileSync(absolutePath));
}

function hashDirectory(root, relativeDirectory) {
  const absoluteDirectory = join(root, ...relativeDirectory.split("/"));
  /** @type {Array<{path: string, contents: Buffer}>} */
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`unexpected symlink at ${dir}`);
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        files.push({ path: relative(absoluteDirectory, absolute), contents: readFileSync(absolute) });
      }
    }
  };
  walk(absoluteDirectory);
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.contents);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Build a minimal, git-less package fixture with valid canonical manifest,
 * catalog, and artifact content, plus a valid provenance marker.
 */
function createPackageFixture() {
  const root = mkdtempSync(join(tmpdir(), "ds-package-source-"));
  mkdirSync(join(root, "manifests"), { recursive: true });
  mkdirSync(join(root, "catalog"), { recursive: true });
  mkdirSync(join(root, "sources", "skills", "demo"), { recursive: true });

  writeFileSync(join(root, "sources", "contract.md"), "bootstrap contract\n");
  writeFileSync(join(root, "sources", "skills", "demo", "SKILL.md"), "---\nname: demo\n---\nDemo body\n");
  const runScript = join(root, "sources", "skills", "demo", "run.sh");
  writeFileSync(runScript, "#!/bin/sh\necho demo\n");
  chmodSync(runScript, 0o755);

  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: packageName, version: packageVersion }, null, 2)}\n`);

  const artifact = {
    id: "codex.contract",
    logicalName: "contract",
    sourcePath: "sources/contract.md",
    destination: ".codex/development-system/contract.md",
    harness: "codex",
    sha256: sha256File(join(root, "sources", "contract.md")),
    expectedMirrorOf: null,
  };
  const manifest = {
    schemaVersion: 1,
    contractVersion: "0.0.9",
    source: { repository: canonicalRepository, commit: "$INSTALL_COMMIT" },
    supportedHarnesses: [{ id: "codex" }, { id: "t3code" }, { id: "factory" }],
    artifacts: [artifact],
  };
  writeFileSync(join(root, "manifests", "0.0.9.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const catalog = {
    schemaVersion: 1,
    catalogVersion: "0.0.9",
    maxCatalogEntries: 8,
    supportedRoots: [".agents/skills"],
    supportedHarnesses: [{ id: "codex" }, { id: "t3code" }, { id: "factory" }],
    skills: [
      {
        logicalName: "demo",
        source: {
          repository: canonicalRepository,
          commit: "$INSTALL_COMMIT",
          path: "sources/skills/demo",
        },
        variants: [
          {
            id: "codex.demo",
            harness: "codex",
            destination: ".agents/skills/demo",
            sourceDirectory: "sources/skills/demo",
            folderSha256: hashDirectory(root, "sources/skills/demo"),
            executableFiles: ["run.sh"],
            expectedMirrorOf: null,
          },
        ],
      },
    ],
  };
  writeFileSync(join(root, "catalog", "0.0.9.json"), `${JSON.stringify(catalog, null, 2)}\n`);

  writeProvenance(root, {});
  return { root, manifest, catalog };
}

function defaultProvenanceFiles(root) {
  const paths = [
    "package.json",
    "manifests/0.0.9.json",
    "catalog/0.0.9.json",
    "sources/contract.md",
    "sources/skills/demo/SKILL.md",
    "sources/skills/demo/run.sh",
  ];
  const files = {};
  for (const path of paths) {
    const absolute = join(root, ...path.split("/"));
    files[path] = {
      sha256: sha256File(absolute),
      executable: (lstatSync(absolute).mode & 0o111) !== 0,
    };
  }
  return files;
}

function writeProvenance(root, extraFiles, options = {}) {
  const marker = {
    schemaVersion: options.schemaVersion ?? 1,
    repository: options.repository ?? canonicalRepository,
    commit: options.commit ?? packageCommit,
    packageVersion: options.packageVersion ?? packageVersion,
    files: { ...defaultProvenanceFiles(root), ...extraFiles },
  };
  writeFileSync(
    join(root, ".development-system-package.json"),
    `${JSON.stringify(marker, null, 2)}\n`,
  );
  return marker;
}

/** @param {(fixture: {root: string, manifest: unknown, catalog: unknown}) => Promise<void> | void} run */
async function withFixture(run) {
  const fixture = createPackageFixture();
  try {
    await run(fixture);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

function withLoadedFixture(run) {
  return withFixture(async (fixture) => {
    const source = loadPackageSource(fixture.root);
    assert.ok(source, "package provenance should load");
    return run(fixture, /** @type {NonNullable<typeof source>} */ (source));
  });
}

test("loadPackageSource returns null only when the package marker is absent", async () => {
  const root = mkdtempSync(join(tmpdir(), "ds-package-source-absent-"));
  try {
    assert.equal(loadPackageSource(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("valid git-less provenance loads commit, repository, version, and file table", async () => {
  await withLoadedFixture((fixture, source) => {
    assert.equal(source.commit, packageCommit);
    assert.equal(source.repository, canonicalRepository);
    assert.equal(source.packageVersion, packageVersion);
    assert.equal(source.files.size, 6);
    assert.deepEqual(source.files.get("sources/skills/demo/run.sh"), {
      sha256: sha256File(join(fixture.root, "sources", "skills", "demo", "run.sh")),
      executable: true,
    });
    assert.equal(
      source.files.get("sources/skills/demo/SKILL.md")?.executable,
      false,
    );

    const bytes = packageFileBytes(source, "sources/contract.md");
    assert.equal(bytes.toString("utf8"), "bootstrap contract\n");
    assert.equal(
      verifyPackageFile(source, "sources/contract.md", artifactHash(fixture)),
      sha256File(join(fixture.root, "sources", "contract.md")),
    );
    assert.equal(packageFileIsExecutable(source, "sources/skills/demo/run.sh"), true);
    assert.equal(packageFileIsExecutable(source, "sources/skills/demo/SKILL.md"), false);
  });
});

function artifactHash(fixture) {
  return sha256File(join(fixture.root, "sources", "contract.md"));
}

test("verifyPackageFile rejects unlisted paths and wrong expected hashes", async () => {
  await withLoadedFixture((fixture, source) => {
    assert.throws(
      () => verifyPackageFile(source, "undeclared/relative.txt", anyHash),
      /does not declare the file/,
    );
    assert.throws(
      () => verifyPackageFile(source, "sources/contract.md", anyHash),
      /does not match the expected hash/,
    );
    assert.throws(
      () => verifyPackageFile(source, "sources/contract.md", "not-a-hash"),
      /Expected package file hash is invalid/,
    );
  });
});

test("tampered packaged file content is rejected at load", async () => {
  await withFixture(async (fixture) => {
    writeFileSync(join(fixture.root, "sources", "contract.md"), "tampered\n");
    assert.throws(
      () => loadPackageSource(fixture.root),
      /Packaged file hash mismatch for sources\/contract\.md/,
    );
  });
});

test("missing packaged file is rejected at load", async () => {
  await withFixture(async (fixture) => {
    rmSync(join(fixture.root, "sources", "skills", "demo", "SKILL.md"));
    assert.throws(
      () => loadPackageSource(fixture.root),
      /Packaged file hash mismatch for sources\/skills\/demo\/SKILL\.md|ENOENT/,
    );
  });
});

test("executable bit divergence from provenance is rejected", async () => {
  await withFixture(async (fixture) => {
    chmodSync(join(fixture.root, "sources", "skills", "demo", "run.sh"), 0o644);
    assert.throws(
      () => loadPackageSource(fixture.root),
      /executable bit mismatch for sources\/skills\/demo\/run\.sh/,
    );
  });
});

test("declared files behind symbolic links are rejected", async () => {
  await withFixture(async (fixture) => {
    rmSync(join(fixture.root, "sources", "skills", "demo", "SKILL.md"));
    symlinkSync(join(fixture.root, "sources", "contract.md"), join(fixture.root, "sources", "skills", "demo", "SKILL.md"));
    assert.throws(
      () => loadPackageSource(fixture.root),
      /must not traverse a symbolic link/,
    );
  });
});

test("provenance paths through symbolic link ancestors are rejected", async () => {
  await withFixture(async (fixture) => {
    symlinkSync(join(fixture.root, "sources"), join(fixture.root, "link-dir"));
    writeProvenance(fixture.root, {
      "link-dir/contract.md": { sha256: sha256File(join(fixture.root, "sources", "contract.md")), executable: false },
    });
    assert.throws(
      () => loadPackageSource(fixture.root),
      /must not traverse a symbolic link/,
    );
  });
});

test("traversal, absolute, backslash, and dot-segment provenance paths are rejected", async () => {
  const badPaths = [
    ["../evil.txt", /must not contain empty, dot, or parent segments/],
    ["/etc/passwd", /must be relative/],
    ["sources\\contract.md", /must use POSIX separators/],
    ["./sources/contract.md", /must not contain empty, dot, or parent segments/],
    ["sources//contract.md", /must not contain empty, dot, or parent segments/],
  ];
  for (const [badPath, pattern] of badPaths) {
    await withFixture(async (fixture) => {
      writeProvenance(fixture.root, {
        [badPath]: { sha256: anyHash, executable: false },
      });
      assert.throws(() => loadPackageSource(fixture.root), pattern);
    });
  }
});

test("invalid commit, package version, package name, and schema are rejected without git fallback", async () => {
  const cases = [
    [{ commit: "A".repeat(40) }, /commit must be an exact lowercase 40-character/],
    [{ commit: "a".repeat(39) }, /commit must be an exact lowercase 40-character/],
    [{ packageVersion: "9.9" }, /packageVersion must use semantic versioning/],
    [{ packageVersion: "9.9.8" }, /must match package\.json/],
    [{ repository: "https://example.invalid/fork" }, /repository must be/],
    [{ schemaVersion: 2 }, /schemaVersion must equal 1/],
  ];
  for (const [options, pattern] of cases) {
    await withFixture(async (fixture) => {
      mkdirSync(join(fixture.root, ".git"), { recursive: true });
      writeProvenance(fixture.root, {}, options);
      assert.throws(() => loadPackageSource(fixture.root), pattern);
    });
  }
});

test("package provenance with unparseable JSON throws instead of falling back to git", async () => {
  await withFixture(async (fixture) => {
    mkdirSync(join(fixture.root, ".git"), { recursive: true });
    writeFileSync(join(fixture.root, ".development-system-package.json"), "{not json");
    assert.throws(() => loadPackageSource(fixture.root), /is not valid JSON/);
  });
});

test("packageDirectoryHash matches the canonical directory hash and rejects divergence", async () => {
  await withLoadedFixture(async (fixture, source) => {
    assert.equal(
      packageDirectoryHash(source, "sources/skills/demo"),
      fixture.catalog.skills[0].variants[0].folderSha256,
    );

    writeFileSync(join(fixture.root, "sources", "skills", "demo", "extra.txt"), "unlisted\n");
    assert.throws(
      () => packageDirectoryHash(source, "sources/skills/demo"),
      /contains an unlisted file: sources\/skills\/demo\/extra\.txt/,
    );
    rmSync(join(fixture.root, "sources", "skills", "demo", "extra.txt"));

    writeFileSync(join(fixture.root, "sources", "skills", "demo", "run.sh"), "#!/bin/sh\necho tampered\n");
    assert.throws(
      () => packageDirectoryHash(source, "sources/skills/demo"),
      /hash mismatch for sources\/skills\/demo\/run\.sh/,
    );

    rmSync(join(fixture.root, "sources", "skills", "demo", "run.sh"));
    assert.throws(
      () => packageDirectoryHash(source, "sources/skills/demo"),
      /declared under sources\/skills\/demo is missing: run\.sh/,
    );
  });
});

test("packageDirectoryHash rejects symbolic links and directories without declared files", async () => {
  await withLoadedFixture(async (fixture, source) => {
    rmSync(join(fixture.root, "sources", "skills", "demo", "run.sh"));
    symlinkSync(join(fixture.root, "sources", "contract.md"), join(fixture.root, "sources", "skills", "demo", "run.sh"));
    assert.throws(
      () => packageDirectoryHash(source, "sources/skills/demo"),
      /contains a symbolic link: sources\/skills\/demo\/run\.sh/,
    );
    rmSync(join(fixture.root, "sources", "skills", "demo", "run.sh"));

    mkdirSync(join(fixture.root, "scratch"), { recursive: true });
    assert.throws(
      () => packageDirectoryHash(source, "scratch"),
      /declares no files under scratch/,
    );
  });
});

test("synchronizeSkillCatalog installs from a git-less package in package mode", async () => {
  await withFixture(async (fixture) => {
    const home = mkdtempSync(join(tmpdir(), "ds-package-source-home-"));
    try {
      const result = await synchronizeSkillCatalog({
        home,
        sourceRoot: fixture.root,
        catalog: fixture.catalog,
      });
      assert.equal(result.ok, true);
      assert.equal(result.operation, "sync-skills");
      assert.equal(result.logicalSkillCount, 1);
      assert.equal(result.physicalVariantCount, 1);

      const installedSkill = readFileSync(join(home, ".agents", "skills", "demo", "SKILL.md"), "utf8");
      assert.match(installedSkill, /^name: demo$/m);
      const installedScript = statSync(join(home, ".agents", "skills", "demo", "run.sh"));
      assert.equal((installedScript.mode & 0o111) !== 0, true);

      const lock = JSON.parse(readFileSync(join(home, ".development-system", "skills-lock.json"), "utf8"));
      assert.equal(lock.sourceCommit, packageCommit);
      assert.equal(lock.catalogVersion, "0.0.9");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

test("a failed repeat synchronization preserves working skills and rollback evidence", async () => {
  await withFixture(async (fixture) => {
    const home = mkdtempSync(join(tmpdir(), "ds-repeat-sync-"));
    const originalCopy = fsPromises.cp;
    const snapshot = () => {
      const files = {};
      const walk = (directory, prefix = "") => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const name = prefix ? prefix + "/" + entry.name : entry.name;
          if (entry.isDirectory()) walk(join(directory, entry.name), name);
          else files[name] = readFileSync(join(directory, entry.name)).toString("base64");
        }
      };
      walk(home);
      return files;
    };
    try {
      writeFileSync(join(home, "unrelated.txt"), "keep");
      await synchronizeSkillCatalog({ home, sourceRoot: fixture.root, catalog: fixture.catalog });
      const before = snapshot();
      fsPromises.cp = async (source, destination, options) => {
        if (String(source).startsWith(join(fixture.root, "sources", "skills"))) throw new Error("injected skill copy failure");
        return originalCopy(source, destination, options);
      };
      syncBuiltinESMExports();
      await assert.rejects(synchronizeSkillCatalog({ home, sourceRoot: fixture.root, catalog: fixture.catalog }), /injected skill copy failure/);
      assert.deepEqual(snapshot(), before);
    } finally {
      fsPromises.cp = originalCopy;
      syncBuiltinESMExports();
      rmSync(home, { recursive: true, force: true });
    }
  });
});

test("unlisted files and a symlinked provenance marker fail closed", async () => {
  await withFixture(async (fixture) => {
    const extra = join(fixture.root, "injected.mjs");
    writeFileSync(extra, "export const injected = true;");
    assert.throws(() => loadPackageSource(fixture.root), /Unlisted file/);
    rmSync(extra);
    const marker = join(fixture.root, ".development-system-package.json");
    const saved = readFileSync(marker);
    rmSync(marker);
    const outside = join(mkdtempSync(join(tmpdir(), "ds-marker-")), "marker.json");
    try {
      writeFileSync(outside, saved);
      symlinkSync(outside, marker);
      assert.throws(() => loadPackageSource(fixture.root), /marker must not be a symbolic link/);
    } finally {
      rmSync(join(outside, ".."), { recursive: true, force: true });
    }
  });
});

test("package commit cannot be overridden and the catalog must equal its packaged bytes", async () => {
  await withFixture(async (fixture) => {
    const home = mkdtempSync(join(tmpdir(), "ds-package-source-home-"));
    try {
      await assert.rejects(
        synchronizeSkillCatalog({
          home,
          sourceRoot: fixture.root,
          catalog: fixture.catalog,
          sourceCommit: otherCommit,
        }),
        /--source-commit cannot override the packaged commit/,
      );

      const divergentCatalog = structuredClone(fixture.catalog);
      divergentCatalog.maxCatalogEntries = 9;
      await assert.rejects(
        synchronizeSkillCatalog({
          home,
          sourceRoot: fixture.root,
          catalog: divergentCatalog,
        }),
        /does not match its packaged provenance bytes/,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
