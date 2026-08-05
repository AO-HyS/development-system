import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(repositoryRoot, "artifacts/1.1.0/skills/internal/exa-search/scripts/exa-search.mjs");

function run(cwd, ...args) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
}

test("Exa dry-run works outside the skill directory and uses bounded agent defaults", async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), "aohys-exa-cwd-"));
  const home = await mkdtemp(resolve(tmpdir(), "aohys-exa-home-"));
  const result = run(cwd, "search", "--query", "public framework release notes", "--dry-run", "--home", home);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.dryRun, true);
  assert.equal(output.payload.type, "auto");
  assert.equal(output.payload.numResults, 5);
  assert.deepEqual(output.payload.contents, { highlights: true });
  await assert.rejects(readFile(resolve(home, ".development-system/usage/exa.jsonl")));
});

test("Exa validates deprecated fields and advanced schema limits before network use", async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), "aohys-exa-invalid-"));
  const request = resolve(cwd, "request.json");
  await writeFile(request, JSON.stringify({ query: "public", useAutoprompt: true, contents: { highlights: true } }));
  const result = run(cwd, "request", "--input", request, "--dry-run", "--home", cwd);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stderr).error, /useAutoprompt/);

  await writeFile(request, JSON.stringify({
    query: "public",
    contents: { text: { verbosity: "compact" } },
  }));
  const uncapped = run(cwd, "request", "--input", request, "--dry-run", "--home", cwd);
  assert.equal(uncapped.status, 1);
  assert.match(JSON.parse(uncapped.stderr).error, /maxCharacters/);

  await writeFile(request, JSON.stringify({
    query: "public",
    contents: { text: { max_characters: 4000 } },
  }));
  const wrongCase = run(cwd, "request", "--input", request, "--dry-run", "--home", cwd);
  assert.equal(wrongCase.status, 1);
  assert.match(JSON.parse(wrongCase.stderr).error, /max_characters/);
});

test("Exa validates current category names and HIPAA transport restrictions locally", async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), "aohys-exa-compliance-"));
  const request = resolve(cwd, "request.json");
  await writeFile(request, JSON.stringify({
    query: "public scholarly source",
    category: "publication",
    contents: { highlights: true },
  }));
  assert.equal(run(cwd, "request", "--input", request, "--dry-run", "--home", cwd).status, 0);

  await writeFile(request, JSON.stringify({ query: "public", category: "research paper", contents: { highlights: true } }));
  const staleCategory = run(cwd, "request", "--input", request, "--dry-run", "--home", cwd);
  assert.equal(staleCategory.status, 1);
  assert.match(JSON.parse(staleCategory.stderr).error, /category/);

  for (const payload of [
    { query: "public", compliance: "hipaa", type: "auto", contents: { highlights: true, maxAgeHours: -1 } },
    { query: "public", compliance: "hipaa", type: "fast", contents: { summary: true, maxAgeHours: -1 } },
    { query: "public", compliance: "hipaa", type: "instant", contents: { highlights: true, maxAgeHours: 0 } },
  ]) {
    await writeFile(request, JSON.stringify(payload));
    const invalid = run(cwd, "request", "--input", request, "--dry-run", "--home", cwd);
    assert.equal(invalid.status, 1, invalid.stderr);
    assert.match(JSON.parse(invalid.stderr).error, /HIPAA/);
  }

  await writeFile(request, JSON.stringify({
    query: "public synthetic health policy",
    compliance: "hipaa",
    type: "fast",
    contents: { highlights: true, maxAgeHours: -1 },
  }));
  const valid = run(cwd, "request", "--input", request, "--dry-run", "--home", cwd);
  assert.equal(valid.status, 0, valid.stderr);
});

test("Exa and guard scripts are committed as executable contract surfaces", async () => {
  assert.notEqual((await stat(script)).mode & 0o111, 0);
  const guard = resolve(repositoryRoot, "artifacts/1.1.0/skills/internal/global-agent-guardrails/scripts/command-guard.mjs");
  assert.notEqual((await stat(guard)).mode & 0o111, 0);
});
