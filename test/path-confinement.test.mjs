import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { verifyPathConfinement } from "../src/path-confinement.mjs";

test("trusted-host path proof rejects a symlink escape", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "path-confinement-root-"));
  const outside = await mkdtemp(resolve(tmpdir(), "path-confinement-outside-"));
  await mkdir(resolve(root, "src", "allowed"), { recursive: true });
  await symlink(outside, resolve(root, "src", "allowed", "link"));
  const result = await verifyPathConfinement({
    repositoryRoot: root,
    revision: "a".repeat(40),
    scope: ["src/allowed"],
    protectedSurfaces: [],
    surfaces: ["src/allowed/link/file.mjs"],
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /symlink component/);
});

test("trusted-host path proof binds safe existing and prospective paths", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "path-confinement-safe-"));
  await mkdir(resolve(root, "src", "allowed"), { recursive: true });
  const result = await verifyPathConfinement({
    repositoryRoot: root,
    revision: "b".repeat(40),
    scope: ["src/allowed"],
    protectedSurfaces: ["src/allowed/secrets"],
    surfaces: ["src/allowed/new-file.mjs"],
  });
  assert.equal(result.valid, true);
  assert.equal(result.proof.symlinkPolicy, "reject-existing-components");
  assert.match(result.proof.sha256, /^[a-f0-9]{64}$/);
});
