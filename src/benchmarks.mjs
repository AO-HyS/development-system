// @ts-check

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const requiredCapabilities = [
  "orchestration",
  "implementation",
  "review",
  "architecture",
  "browser-qa",
  "visual-judgment",
];

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {any} suite */
export function validateBenchmarkSuite(suite) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(suite) || suite.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  if (typeof suite?.suiteId !== "string" || suite.suiteId.length === 0) errors.push("suiteId is required");
  if (!Array.isArray(suite?.cases)) return [...errors, "cases must be an array"];
  const covered = new Set();
  for (const benchmarkCase of suite.cases) {
    if (!isRecord(benchmarkCase)) {
      errors.push("benchmark cases must be objects");
      continue;
    }
    covered.add(benchmarkCase.capability);
    for (const field of ["id", "capability", "fixture", "instructions"]) {
      if (typeof benchmarkCase[field] !== "string" || benchmarkCase[field].length === 0) {
        errors.push(`${benchmarkCase.id ?? "case"}.${field} is required`);
      }
    }
    if (!Array.isArray(benchmarkCase.checks) || benchmarkCase.checks.length === 0) {
      errors.push(`${benchmarkCase.id}.checks are required`);
    }
    if (!Array.isArray(benchmarkCase.candidates) || benchmarkCase.candidates.length < 2) {
      errors.push(`${benchmarkCase.id} needs at least baseline and challenger candidates`);
    }
    for (const candidate of benchmarkCase.candidates ?? []) {
      for (const field of ["id", "harness", "model", "reasoning"]) {
        if (typeof candidate[field] !== "string" || candidate[field].length === 0) {
          errors.push(`${benchmarkCase.id}.${candidate.id ?? "candidate"}.${field} is required`);
        }
      }
    }
  }
  for (const capability of requiredCapabilities) {
    if (!covered.has(capability)) errors.push(`missing benchmark capability: ${capability}`);
  }
  return errors;
}

/** @param {any} benchmarkCase */
function fixtureHash(benchmarkCase) {
  return createHash("sha256")
    .update(JSON.stringify({
      fixture: benchmarkCase.fixture,
      instructions: benchmarkCase.instructions,
      checks: benchmarkCase.checks,
    }))
    .digest("hex");
}

/**
 * @param {{suite: any, runId: string, runtime: (request: any) => Promise<any>, concurrency?: number}} options
 */
export async function runBenchmarkSuite(options) {
  const errors = validateBenchmarkSuite(options.suite);
  if (errors.length > 0) throw new Error(`Invalid benchmark suite:\n${errors.join("\n")}`);
  /** @type {any[]} */
  const records = [];
  const jobs = options.suite.cases.flatMap((/** @type {any} */ benchmarkCase, /** @type {number} */ caseIndex) =>
    benchmarkCase.candidates.map((/** @type {any} */ candidate, /** @type {number} */ candidateIndex) => ({
      benchmarkCase,
      candidate,
      caseIndex,
      candidateIndex,
    }))
  );
  let nextJob = 0;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, jobs.length));
  async function worker() {
    for (;;) {
      const jobIndex = nextJob;
      nextJob += 1;
      const job = jobs[jobIndex];
      if (!job) return;
      const { benchmarkCase, candidate, caseIndex, candidateIndex } = job;
      const hash = fixtureHash(benchmarkCase);
      const result = await options.runtime({ benchmarkCase, candidate });
      records.push({
        schemaVersion: 1,
        runId: options.runId,
        suiteId: options.suite.suiteId,
        caseId: benchmarkCase.id,
        capability: benchmarkCase.capability,
        fixture: benchmarkCase.fixture,
        fixtureHash: hash,
        harness: candidate.harness,
        model: candidate.model,
        reasoning: candidate.reasoning,
        instructions: benchmarkCase.instructions,
        checks: [...benchmarkCase.checks],
        completed: result.completed === true,
        checksPassed: result.checksPassed === true,
        durationMs: result.durationMs,
        correctionMs: result.correctionMs,
        verifiedDeliveryMs: result.durationMs + result.correctionMs,
        tokens: result.tokens,
        costUsd: result.costUsd,
        corrections: result.corrections,
        findings: result.findings,
        slop: result.slop ?? [],
        output: result.output ?? "",
        command: result.command ?? "unavailable-from-runtime",
        exitCode: result.exitCode ?? null,
        costStatus: result.costUsd === null ? "unavailable-from-harness" : "reported",
        caseIndex,
        candidateIndex,
      });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  records.sort((left, right) => left.caseIndex - right.caseIndex || left.candidateIndex - right.candidateIndex);
  for (const record of records) {
    delete record.caseIndex;
    delete record.candidateIndex;
  }
  const rankings = Object.fromEntries(requiredCapabilities.map((capability) => [
    capability,
    records
      .filter((record) => record.capability === capability)
      .sort((left, right) =>
        Number(right.checksPassed) - Number(left.checksPassed) ||
        left.verifiedDeliveryMs - right.verifiedDeliveryMs ||
        left.corrections - right.corrections ||
        left.slop.length - right.slop.length
      )
      .map((record) => ({
        harness: record.harness,
        model: record.model,
        reasoning: record.reasoning,
        checksPassed: record.checksPassed,
        verifiedDeliveryMs: record.verifiedDeliveryMs,
        costUsd: record.costUsd,
        corrections: record.corrections,
        findings: record.findings,
        slop: record.slop,
      })),
  ]));
  return {
    ok: records.every((record) => record.completed && record.checksPassed),
    operation: "benchmark-run",
    runId: options.runId,
    suiteId: options.suite.suiteId,
    records,
    rankings,
  };
}

/** @param {any} roster */
export function resolveCapabilityRoster(roster) {
  if (!isRecord(roster) || roster.schemaVersion !== 1 || !isRecord(roster.capabilities)) {
    throw new Error("Capability roster schema is invalid");
  }
  /** @type {Record<string, any>} */
  const capabilities = {};
  for (const capability of requiredCapabilities) {
    const mapping = roster.capabilities[capability];
    if (!isRecord(mapping) || typeof mapping.role !== "string") {
      throw new Error(`Capability roster is missing ${capability}`);
    }
    capabilities[capability] = { role: mapping.role };
    for (const harness of ["codex", "factory"]) {
      const candidate = mapping[harness];
      if (!isRecord(candidate) || typeof candidate.model !== "string" || typeof candidate.reasoning !== "string") {
        throw new Error(`${capability}.${harness} mapping is invalid`);
      }
      if (candidate.model === "inherit" && (
        typeof candidate.resolvedModel !== "string" || candidate.resolvedModel.length === 0
      )) {
        throw new Error(`${capability}.${harness} inherit must have a resolved model`);
      }
      capabilities[capability][harness] = {
        requestedModel: candidate.model,
        model: candidate.model === "inherit" ? candidate.resolvedModel : candidate.model,
        reasoning: candidate.reasoning,
      };
    }
  }
  return { schemaVersion: 1, capabilities };
}

/** @param {string} text */
function jsonLines(text) {
  return text.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

/** @param {any} value @param {string[]} names @returns {number | null} */
function findNumericValue(value, names) {
  if (!value || typeof value !== "object") return null;
  for (const [key, nested] of Object.entries(value)) {
    if (names.includes(key) && typeof nested === "number") return nested;
    const found = /** @type {number | null} */ (findNumericValue(nested, names));
    if (found !== null) return found;
  }
  return null;
}

/** @param {string} text */
function finalMessage(text) {
  const messages = jsonLines(text).flatMap((event) => {
    if (event?.type === "item.completed" && event.item?.type === "agent_message") return [event.item.text];
    if (event?.type === "result" && typeof event.result === "string") return [event.result];
    return [];
  });
  return messages.at(-1) ?? text.trim();
}

/**
 * Production benchmark runtime. It uses the same fixture text and checks for every candidate.
 * @param {{codexPath?: string, factoryPath?: string, cwd: string, timeoutMs?: number}} options
 */
export function createProcessBenchmarkRuntime(options) {
  const codexPath = options.codexPath ?? "/Applications/ChatGPT.app/Contents/Resources/codex";
  const factoryPath = options.factoryPath ?? "/Applications/Factory.app/Contents/Resources/bin/droid";
  const timeoutMs = options.timeoutMs ?? 60_000;
  return async function processBenchmarkRuntime(/** @type {any} */ request) {
    const { benchmarkCase, candidate } = request;
    const prompt = [
      `Capability benchmark: ${benchmarkCase.capability}.`,
      benchmarkCase.instructions,
      "Return a complete final answer for independent verification.",
      "Fixture:",
      benchmarkCase.fixtureContents,
    ].join("\n\n");
    const executable = candidate.harness === "factory" ? factoryPath : codexPath;
    /** @param {string} currentPrompt */
    function execute(currentPrompt) {
      const args = candidate.harness === "factory"
        ? [
            "exec", "--cwd", options.cwd, "--output-format", "json",
            "--model", candidate.model, "--reasoning-effort", candidate.reasoning, currentPrompt,
          ]
        : [
            "-a", "never", "exec", "--ephemeral", "--sandbox", "read-only",
            "--skip-git-repo-check", "--json", "-C", options.cwd,
            "--model", candidate.model,
            "--config", `model_reasoning_effort=\"${candidate.reasoning}\"`,
            currentPrompt,
          ];
      const startedAt = process.hrtime.bigint();
      const run = spawnSync(executable, args, {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
        timeout: timeoutMs,
        killSignal: "SIGTERM",
      });
      return {
        run,
        args,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        combined: `${run.stdout ?? ""}\n${run.stderr ?? ""}`,
      };
    }
    const first = execute(prompt);
    let output = finalMessage(first.combined);
    let normalizedOutput = output.toLowerCase();
    let missingChecks = benchmarkCase.checks.filter(
      (/** @type {string} */ check) => !normalizedOutput.includes(check.toLowerCase()),
    );
    let correction = null;
    if (first.run.status === 0 && missingChecks.length > 0) {
      correction = execute([
        prompt,
        "Your first answer failed independent checks.",
        `Missing evidence terms: ${missingChecks.join(", ")}.`,
        "Correct the answer without adding unrequested scope.",
        "First answer:",
        output,
      ].join("\n\n"));
      output = finalMessage(correction.combined);
      normalizedOutput = output.toLowerCase();
      missingChecks = benchmarkCase.checks.filter(
        (/** @type {string} */ check) => !normalizedOutput.includes(check.toLowerCase()),
      );
    }
    const slop = (benchmarkCase.forbiddenTerms ?? []).filter(
      (/** @type {string} */ term) => normalizedOutput.includes(term.toLowerCase()),
    );
    const events = jsonLines(`${first.combined}\n${correction?.combined ?? ""}`);
    const inputTokens = findNumericValue(events, ["input_tokens", "inputTokens"]) ?? 0;
    const outputTokens = findNumericValue(events, ["output_tokens", "outputTokens"]) ?? 0;
    const costUsd = findNumericValue(events, ["cost_usd", "costUsd"]);
    return {
      completed: first.run.status === 0 && (!correction || correction.run.status === 0),
      checksPassed: first.run.status === 0 && (!correction || correction.run.status === 0) && missingChecks.length === 0,
      durationMs: first.durationMs,
      correctionMs: correction?.durationMs ?? 0,
      tokens: inputTokens + outputTokens,
      costUsd,
      corrections: correction ? 1 : 0,
      findings: missingChecks.length,
      slop,
      output,
      command: [executable, ...first.args.slice(0, -1), "<fixture-prompt>"].join(" "),
      exitCode: correction?.run.status ?? first.run.status,
    };
  };
}
