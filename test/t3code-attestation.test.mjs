import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("T3Code revalidation emits a separate hash-bound attestation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "t3code-attestation-"));
  const inputPath = join(directory, "capture.json");
  const outputPath = join(directory, "attestation.json");
  const input = `${JSON.stringify({ sourceCommit: "capture", observed: {} }, null, 2)}\n`;
  await writeFile(inputPath, input);
  const result = spawnSync(
    process.execPath,
    [
      resolve("scripts/revalidate-t3code-evidence.mjs"),
      "--input",
      inputPath,
      "--output",
      outputPath,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.equal(await readFile(inputPath, "utf8"), input);
  const attestation = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(attestation.ok, false);
  assert.equal(
    attestation.inputSha256,
    createHash("sha256").update(input).digest("hex"),
  );

  const overwrite = spawnSync(
    process.execPath,
    [
      resolve("scripts/revalidate-t3code-evidence.mjs"),
      "--input",
      inputPath,
      "--output",
      inputPath,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.notEqual(overwrite.status, 0);
  assert.match(overwrite.stderr, /must not overwrite/);
  assert.equal(await readFile(inputPath, "utf8"), input);
});
