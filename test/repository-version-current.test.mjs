import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizeRepository } from "../src/repositories.mjs";

test("normalization distributes the package contract and its catalog without changing product files", async () => {
  const repository = await mkdtemp(join(tmpdir(), "ds-version-"));
  execFileSync("git", ["init", "--quiet", repository]);
  const original = JSON.stringify({ name: "fixture", scripts: { lint: "echo lint", test: "echo test", dev: "echo dev" } });
  await writeFile(join(repository, "package.json"), original);
  const result = await normalizeRepository({ repository, confirm: "normalize" });
  assert.equal(result.status, "updated");
  assert.ok(result.changedFiles.includes(".development-system/repository.json"));
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const contract = JSON.parse(await readFile(join(repository, ".development-system/repository.json"), "utf8"));
  assert.equal(contract.contractVersion, manifest.contractVersion);
  assert.equal(await readFile(join(repository, "package.json"), "utf8"), original);
  assert.ok((await readFile(join(repository, ".codex/development-system/repository.md"), "utf8")).includes(`Contract version: \`${manifest.contractVersion}\``));
  const released = JSON.parse(await readFile(new URL(`../manifests/${manifest.contractVersion}.json`, import.meta.url), "utf8"));
  const catalog = released.artifacts.find(item => item.logicalName === "skill-catalog").sourcePath.split("/").pop().replace(".json", "");
  assert.ok(JSON.stringify(contract).includes(catalog));
});
