import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writePrivateEvidence } from "../src/private-evidence.mjs";

test("private evidence refuses a symbolic-link destination without touching its target", async () => {
  const home = mkdtempSync(join(tmpdir(), "private-evidence-home-"));
  const reports = join(home, ".development-system", "private", "reports");
  const external = join(home, "external.json");
  const destination = join(reports, "latest.json");
  mkdirSync(reports, { recursive: true });
  writeFileSync(external, "external\n");
  symlinkSync(external, destination);

  await assert.rejects(
    writePrivateEvidence({ home, destination, contents: "replacement\n" }),
    /symbolic link/i,
  );
  assert.equal(readFileSync(external, "utf8"), "external\n");
  rmSync(home, { recursive: true, force: true });
});

test("private evidence atomically replaces a permissive file with mode 0600", async () => {
  const home = mkdtempSync(join(tmpdir(), "private-evidence-mode-"));
  const destination = join(home, ".development-system", "private", "reports", "latest.json");
  mkdirSync(join(home, ".development-system", "private", "reports"), { recursive: true });
  writeFileSync(destination, "old\n");
  chmodSync(destination, 0o644);

  await writePrivateEvidence({ home, destination, contents: "new\n" });

  assert.equal(readFileSync(destination, "utf8"), "new\n");
  assert.equal(statSync(destination).mode & 0o777, 0o600);
  rmSync(home, { recursive: true, force: true });
});
