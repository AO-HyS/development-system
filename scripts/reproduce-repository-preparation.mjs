// @ts-check

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fingerprintRepository } from "../src/repositories.mjs";

const developmentSystemRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(developmentSystemRoot, "bin/development-system.mjs");
const repository = await mkdtemp(resolve(tmpdir(), "aohys-repository-preparation-scenario-"));

/** @param {string} path @param {string} contents */
async function seed(path, contents) {
  const target = resolve(repository, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

/** @param {string[]} args @param {number} expectedStatus */
function step(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [cli, ...args, "--repository", repository, "--json"], {
    cwd: developmentSystemRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

await seed("package.json", JSON.stringify({
  name: "fixture-react-convex-product",
  private: true,
  scripts: {
    review: "node -e \"process.exit(0)\"",
    validate: "node -e \"process.exit(0)\"",
    qa: "node -e \"process.exit(0)\"",
    preview: "node -e \"process.exit(0)\"",
  },
  dependencies: { react: "19.1.0", convex: "1.25.0" },
}));
await seed("AGENTS.md", "# Fixture product\nPreserve this product's language and design.\n");
await seed("RELEASE.md", "Human approval is required before release.\n");
await seed("src/theme.css", ":root { --fixture-brand: plum; }\n");

const packageBefore = await readFile(resolve(repository, "package.json"), "utf8");
const releaseBefore = await readFile(resolve(repository, "RELEASE.md"), "utf8");
const designBefore = await readFile(resolve(repository, "src/theme.css"), "utf8");
const beforeAudit = await fingerprintRepository(repository);
const audit = step(["audit-repository"]);
assert.equal(audit.operation, "audit-repository");
assert.equal(await fingerprintRepository(repository), beforeAudit);
assert.deepEqual(audit.stack.sort(), ["convex", "react"]);
assert.equal(step(["initialize-repository"], 1).operation, "error");

const initialized = step(["initialize-repository", "--confirm", "initialize"]);
assert.equal(initialized.status, "updated");
assert.deepEqual(initialized.readiness, { codex: "prepared", t3code: "prepared", factory: "prepared" });
assert.equal(step(["initialize-repository", "--confirm", "initialize"]).status, "unchanged");
assert.equal((await readFile(resolve(repository, ".development-system/repository.json"), "utf8")).includes("0.7.0"), true);
assert.equal(step(["audit-repository"]).status, "prepared");

const normalized = step(["normalize-repository", "--confirm", "normalize"]);
assert.equal(normalized.status, "updated");
assert.equal(step(["normalize-repository", "--confirm", "normalize"]).status, "unchanged");
assert.equal(await readFile(resolve(repository, "package.json"), "utf8"), packageBefore);
assert.equal(await readFile(resolve(repository, "RELEASE.md"), "utf8"), releaseBefore);
assert.equal(await readFile(resolve(repository, "src/theme.css"), "utf8"), designBefore);
assert.equal(normalized.paidServicesActivated, false);

process.stdout.write(`Repository preparation scenario complete. Fixture: ${repository}\n`);
