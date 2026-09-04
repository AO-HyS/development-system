import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildDistribution } from "../scripts/pack-distribution.mjs";
import { loadPackageSource } from "../src/package-source.mjs";

const canonicalRepository = "https://github.com/AO-HyS/development-system";

function git(root, ...args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Development System tests",
      GIT_AUTHOR_EMAIL: "tests@aohys.com",
      GIT_COMMITTER_NAME: "Development System tests",
      GIT_COMMITTER_EMAIL: "tests@aohys.com",
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

/**
 * Tiny committed Git fixture shaped like the canonical repository: only
 * runtime paths are committed; unrelated untracked files (docs, ignored
 * private reports) stay out of HEAD.
 */
function createGitFixture() {
  const root = mkdtempSync(join(tmpdir(), "ds-pack-dist-"));
  git(root, "init", "-q");
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "manifests"), { recursive: true });
  mkdirSync(join(root, "catalog"), { recursive: true });
  mkdirSync(join(root, "artifacts", "1.0.0", "skills", "demo"), { recursive: true });

  const bin = join(root, "bin", "aohys-development-system");
  writeFileSync(bin, "#!/bin/sh\necho development-system\n");
  chmodSync(bin, 0o755);

  writeFileSync(join(root, "src", "demo.mjs"), "export const demo = \"demo\";\n");
  writeFileSync(join(root, "scripts", "installer.mjs"), "import { demo } from \"../src/demo.mjs\";\nexport const installed = demo;\n");
  writeFileSync(join(root, "config", "agent-roster.json"), `${JSON.stringify({ routes: [] }, null, 2)}\n`);

  const manifest = {
    schemaVersion: 1,
    contractVersion: "0.0.9",
    source: { repository: canonicalRepository, commit: "$INSTALL_COMMIT" },
    supportedHarnesses: [{ id: "codex" }, { id: "t3code" }, { id: "factory" }],
    artifacts: [
      {
        id: "codex.demo",
        logicalName: "demo",
        sourcePath: "artifacts/1.0.0/skills/demo/SKILL.md",
        destination: ".codex/skills/demo/SKILL.md",
        harness: "codex",
        sha256: createHash("sha256").update("---\nname: demo\n---\nDemo body\n").digest("hex"),
        expectedMirrorOf: null,
      },
    ],
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
          path: "artifacts/1.0.0/skills/demo",
        },
        variants: [
          {
            id: "codex.demo",
            harness: "codex",
            destination: ".agents/skills/demo",
            sourceDirectory: "artifacts/1.0.0/skills/demo",
            folderSha256: createHash("sha256")
              .update("SKILL.md\0---\nname: demo\n---\nDemo body\n\0")
              .digest("hex"),
            executableFiles: [],
            expectedMirrorOf: null,
          },
        ],
      },
    ],
  };
  writeFileSync(join(root, "catalog", "0.0.9.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  writeFileSync(join(root, "artifacts", "1.0.0", "skills", "demo", "SKILL.md"), "---\nname: demo\n---\nDemo body\n");

  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    name: "@aohys/development-system",
    version: "9.9.9",
    private: true,
    bin: { "aohys-development-system": "./bin/aohys-development-system" },
  }, null, 2)}\n`);

  writeFileSync(join(root, ".gitignore"), "private/\n");
  git(root, "add", ".gitignore", "package.json", "bin", "src", "scripts", "config", "manifests", "catalog", "artifacts");
  git(root, "commit", "-q", "-m", "fixture runtime");

  // Untracked, unrelated, non-runtime files that must not block nor leak.
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "notes.md"), "operator notes\n");
  mkdirSync(join(root, "private", "reports"), { recursive: true });
  writeFileSync(join(root, "private", "reports", "live.json"), "secret-report\n");

  const commit = git(root, "rev-parse", "HEAD").trim();
  return { root, commit };
}

/** @param {{root: string, commit: string}} fixture @param {(fixture: {root: string, commit: string}) => Promise<void> | void} run */
async function withFixture(fixture, run) {
  try {
    await run(fixture);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

function tarballList(tarballPath) {
  const result = spawnSync("tar", ["-tzf", tarballPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\n").filter(Boolean);
}

function extractTarball(tarballPath, extractRoot) {
  const result = spawnSync("tar", ["-xzf", tarballPath, "-C", extractRoot], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return join(extractRoot, "package");
}

test("a clean canonical fixture packs into a validated, installable tarball", async () => {
  const fixture = createGitFixture();
  await withFixture(fixture, (fx) => {
    const output = mkdtempSync(join(tmpdir(), "ds-pack-dist-out-"));
    try {
      const result = buildDistribution({ output, root: fx.root });

      assert.equal(result.ok, true);
      assert.equal(result.operation, "pack-distribution");
      assert.equal(result.commit, fx.commit);
      assert.equal(result.version, "9.9.9");
      assert.equal(result.filename, "aohys-development-system-9.9.9.tgz");
      assert.equal(result.path, join(output, result.filename));

      const tarball = readFileSync(result.path);
      assert.equal(result.sha256, createHash("sha256").update(tarball).digest("hex"));
      assert.match(result.sha512, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
      assert.equal(
        result.sha512,
        `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
      );

      const entries = tarballList(result.path).map((line) =>
        line.startsWith("package/") ? line.slice("package/".length) : line,
      ).filter((line) => line && !line.endsWith("/"));
      assert.ok(entries.includes(".development-system-package.json"));
      assert.ok(entries.includes("bin/aohys-development-system"));
      assert.ok(entries.includes("src/demo.mjs"));
      assert.ok(entries.includes("scripts/installer.mjs"));
      assert.ok(entries.includes("manifests/0.0.9.json"));
      assert.ok(entries.includes("catalog/0.0.9.json"));
      assert.ok(entries.includes("artifacts/1.0.0/skills/demo/SKILL.md"));
      assert.ok(!entries.some((entry) => entry.startsWith("docs/")));
      assert.ok(!entries.some((entry) => entry.startsWith("private/")));
      assert.ok(!entries.some((entry) => entry.startsWith("test/")));
      assert.ok(!entries.some((entry) => entry.startsWith(".git")));
      assert.ok(!entries.includes(".gitignore"));
      assert.ok(!entries.includes("scripts/pack-distribution.mjs"));
      assert.ok(!entries.includes("docs/notes.md"));

      const extractRoot = mkdtempSync(join(tmpdir(), "ds-pack-dist-extract-"));
      try {
        const packageRoot = extractTarball(result.path, extractRoot);
        const source = loadPackageSource(packageRoot);
        assert.ok(source, "extracted package must carry valid provenance");
        assert.equal(source.commit, fx.commit);
        assert.equal(source.packageVersion, "9.9.9");

        const extractedBin = statSync(join(packageRoot, "bin", "aohys-development-system"));
        assert.equal((extractedBin.mode & 0o111) !== 0, true, "the bin must remain executable");
        assert.equal(source.files.get("bin/aohys-development-system")?.executable, true);
        const extractedSkill = statSync(join(packageRoot, "artifacts", "1.0.0", "skills", "demo", "SKILL.md"));
        assert.equal((extractedSkill.mode & 0o111) === 0, true);
      } finally {
        rmSync(extractRoot, { recursive: true, force: true });
      }
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
});

test("dirty tracked runtime source is rejected", async () => {
  const fixture = createGitFixture();
  await withFixture(fixture, (fx) => {
    writeFileSync(join(fx.root, "src", "demo.mjs"), "export const demo = \"tampered\";\n");
    assert.throws(
      () => buildDistribution({ root: fx.root }),
      /tracked path src\/demo\.mjs has uncommitted changes/,
    );
  });
});

test("untracked files inside runtime paths are rejected", async () => {
  const fixture = createGitFixture();
  await withFixture(fixture, (fx) => {
    writeFileSync(join(fx.root, "src", "rogue.mjs"), "export const rogue = true;\n");
    assert.throws(
      () => buildDistribution({ root: fx.root }),
      /untracked path src\/rogue\.mjs is inside the distributable runtime paths/,
    );
  });
});

test("untracked unrelated files are ignored and never leak into the tarball", async () => {
  const fixture = createGitFixture();
  await withFixture(fixture, (fx) => {
    const output = mkdtempSync(join(tmpdir(), "ds-pack-dist-out-"));
    try {
      const result = buildDistribution({ output, root: fx.root });
      const entries = tarballList(result.path).join("\n");
      assert.ok(!entries.includes("notes.md"));
      assert.ok(!entries.includes("live.json"));
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
});
