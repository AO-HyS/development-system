import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCodexBenchmarkArgs,
  CODEX_BENCHMARK_ENVIRONMENT,
} from "../src/codex-benchmark-runtime.mjs";

test("benchmark runtime isolates user config without replacing canonical CODEX_HOME", () => {
  assert.deepEqual(
    buildCodexBenchmarkArgs([
      "--json",
      "--reasoning",
      "low",
      "--sandbox",
      "read-only",
      "Reply exactly OK",
    ]),
    [
      "exec",
      "--ignore-user-config",
      "--ephemeral",
      "--json",
      "--config",
      'model_reasoning_effort="low"',
      "--sandbox",
      "read-only",
      "Reply exactly OK",
    ],
  );
  assert.deepEqual(CODEX_BENCHMARK_ENVIRONMENT, {
    attribution: "environment-overhead",
    configScope: "process",
    preservesCanonicalCodexHome: true,
  });
});

test("benchmark runtime owns isolation flags and requires an explicit workload", () => {
  assert.throws(() => buildCodexBenchmarkArgs([]), /at least one/i);
  assert.throws(
    () => buildCodexBenchmarkArgs(["--ignore-user-config", "OK"]),
    /managed by the benchmark runtime/i,
  );
  assert.throws(
    () => buildCodexBenchmarkArgs(["--ephemeral", "OK"]),
    /managed by the benchmark runtime/i,
  );
  for (const flag of [
    "--profile",
    "-p",
    "--config",
    "-c",
    "--enable",
    "--disable",
    "--ignore-rules",
    "--dangerously-bypass-hook-trust",
    "--add-dir",
    "--output-last-message",
    "-o",
  ]) {
    assert.throws(
      () => buildCodexBenchmarkArgs([flag, "unsafe", "OK"]),
      /managed by the benchmark runtime/i,
    );
  }
  for (const argument of [
    "--profile=unsafe",
    "-punsafe",
    "--config=mcp_servers.expect.enabled=true",
    "-cmcp_servers.expect.enabled=true",
    "--enable=unsafe",
    "--disable=unsafe",
    "--add-dir=/tmp",
    "--output-last-message=/tmp/message",
    "-o/tmp/message",
  ]) {
    assert.throws(
      () => buildCodexBenchmarkArgs([argument, "OK"]),
      /managed by the benchmark runtime/i,
    );
  }
  assert.throws(
    () => buildCodexBenchmarkArgs(["--reasoning", "extreme", "OK"]),
    /reasoning must be one of/i,
  );
  assert.throws(
    () => buildCodexBenchmarkArgs(["--dangerously-bypass-approvals-and-sandbox", "OK"]),
    /managed by the benchmark runtime/i,
  );
  assert.throws(
    () => buildCodexBenchmarkArgs(["--sandbox", "danger-full-access", "OK"]),
    /sandbox must be read-only or workspace-write/i,
  );
  assert.throws(
    () => buildCodexBenchmarkArgs(["--sandbox=danger-full-access", "OK"]),
    /sandbox must be read-only or workspace-write/i,
  );
});
