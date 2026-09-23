import test from "node:test";
import assert from "node:assert/strict";
import { executionMode } from "../src/core.mjs";

test("historical contracts select execution by explicit version boundary", () => {
  assert.equal(executionMode({ contractVersion: "1.24.0" }), "advisory-parent-execution");
  assert.equal(executionMode({ contractVersion: "1.25.0" }), "governed-hook-execution");
  assert.equal(executionMode({ contractVersion: "1.28.0" }), "governed-hook-execution");
});

test("new contracts use declared execution mode, not launcher presence", () => {
  assert.equal(executionMode({ contractVersion: "1.29.0", executionMode: "advisory-parent-execution", artifacts: [{ logicalName: "governance-runtime-hook-launcher-mjs" }] }), "advisory-parent-execution");
  assert.equal(executionMode({ contractVersion: "1.29.0", executionMode: "governed-hook-execution", artifacts: [] }), "governed-hook-execution");
  assert.equal(executionMode({ contractVersion: "1.29.0", artifacts: [] }), undefined);
});
