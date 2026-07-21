import assert from "node:assert/strict";
import test from "node:test";

import { lifecycleProbeDefinitions, responsePasses } from "../scripts/probe-lifecycle-interface.mjs";

test("lifecycle live-probe definitions cover the automatic router and every explicit phase", () => {
  assert.deepEqual(lifecycleProbeDefinitions.map((definition) => definition.skill), [
    "drive-development-flow",
    "wayfinder",
    "grill-with-docs",
    "to-spec",
    "to-tickets",
    "flow-implement",
    "flow-code-review",
  ]);
  assert.equal(new Set(lifecycleProbeDefinitions.map((definition) => definition.token)).size, 7);
  for (const definition of lifecycleProbeDefinitions) {
    assert.equal(responsePasses(definition.token, definition.token), true);
    assert.equal(responsePasses(`${definition.token} extra`, definition.token), false);
    assert.match(definition.fact, /gate|authority|review|ticket|deliver|implement|policy/i);
  }
});
