import assert from "node:assert/strict";
import test from "node:test";

import { resolveSkillProbeMetadata } from "../src/skill-probe-metadata.mjs";

const sourceCommit = "a".repeat(40);

function metadata(catalogVersion = "0.6.0") {
  return {
    installedLock: { sourceCommit, catalogVersion },
    codexCatalog: { catalogVersion },
    factoryCatalog: { catalogVersion },
  };
}

test("skill probe metadata follows the exact installed catalog version", () => {
  assert.deepEqual(resolveSkillProbeMetadata(metadata("1.2.3")), {
    sourceCommit,
    catalogVersion: "1.2.3",
  });
});

test("skill probe metadata rejects invalid or divergent installed catalogs", () => {
  assert.throws(
    () => resolveSkillProbeMetadata(metadata("next")),
    /has no valid version/,
  );
  assert.throws(
    () => resolveSkillProbeMetadata({
      ...metadata(),
      factoryCatalog: { catalogVersion: "0.5.1" },
    }),
    /do not match across lock, Codex, and Factory/,
  );
  assert.throws(
    () => resolveSkillProbeMetadata({
      ...metadata(),
      installedLock: { sourceCommit: "not-a-commit", catalogVersion: "0.6.0" },
    }),
    /no exact source commit/,
  );
});
