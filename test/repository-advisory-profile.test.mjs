import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initializeRepository, normalizeRepository } from "../src/repositories.mjs";

test("repository preparation installs advisory guidance and preserves product lifecycle metadata", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "ds-advisory-repository-"));
  t.after(() => rm(repository, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", repository]);
  const productPackage = JSON.stringify({ name: "casa-fixture", scripts: { lint: "echo lint", test: "echo test", dev: "echo dev" } });
  await writeFile(join(repository, "package.json"), productPackage);

  const first = await initializeRepository({ repository, confirm: "initialize" });
  assert.equal(first.status, "updated");
  const adapterPath = join(repository, ".codex/development-system/repository.md");
  const contractPath = join(repository, ".development-system/repository.json");
  const adapter = await readFile(adapterPath, "utf8");
  assert.match(adapter, /coding-orchestration\/references\/jev-advisory\.md/);
  assert.match(adapter, /Luna 6 High priority[\s\S]*Astra 6 XHigh[\s\S]*Sol 6 Medium/);
  assert.match(adapter, /No per-tool or Stop gate is active/);
  assert.doesNotMatch(adapter, /activate the installed governed|Flash High|deterministic permits enforce|Jev checks each lifecycle boundary/i);

  const initial = JSON.parse(await readFile(contractPath, "utf8"));
  initial.lifecycle.productRelease = { branch: "develop", approval: "owner" };
  await writeFile(contractPath, JSON.stringify(initial, null, 2) + "\n");
  const normalized = await normalizeRepository({ repository, confirm: "normalize" });
  assert.equal(normalized.status, "updated");
  const actual = JSON.parse(await readFile(contractPath, "utf8"));
  assert.deepEqual(actual.lifecycle.productRelease, initial.lifecycle.productRelease);
  assert.equal(actual.contractVersion, "1.29.1");
  assert.equal(await readFile(join(repository, "package.json"), "utf8"), productPackage);
  const stableContract = await readFile(contractPath, "utf8");
  const stableAdapter = await readFile(adapterPath, "utf8");
  const repeated = await normalizeRepository({ repository, confirm: "normalize" });
  assert.equal(repeated.status, "unchanged");
  assert.equal(await readFile(contractPath, "utf8"), stableContract);
  assert.equal(await readFile(adapterPath, "utf8"), stableAdapter);
});
