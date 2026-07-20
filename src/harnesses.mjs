// @ts-check

import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";

const requiredChecks = [
  "instructions",
  "catalog",
  "load",
  "hooks",
  "roster",
  "modelRole",
  "sideEffects",
  "externalState",
  "noOverflow",
];

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {any} registry */
export function validateHarnessRegistry(registry) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(registry) || registry.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  if (!/^\d+\.\d+\.\d+$/.test(registry?.contractVersion ?? "")) {
    errors.push("contractVersion must use semantic versioning");
  }
  const adapters = registry?.adapters;
  if (!isRecord(adapters)) return [...errors, "adapters must be an object"];
  for (const harness of ["codex", "factory", "t3code"]) {
    if (!isRecord(adapters[harness])) errors.push(`missing adapter: ${harness}`);
  }
  for (const harness of ["codex", "factory"]) {
    const adapter = adapters[harness];
    if (!isRecord(adapter)) continue;
    if (adapter.kind !== "native") errors.push(`${harness} must be a native adapter`);
    for (const field of ["executable", "tools", "agents", "hooks", "stateNamespace", "activationPrefix"]) {
      if (typeof adapter[field] !== "string" || adapter[field].length === 0) {
        errors.push(`${harness}.${field} is required`);
      }
    }
  }
  const t3code = adapters.t3code;
  if (isRecord(t3code)) {
    if (t3code.kind !== "client-surface" || t3code.adapter !== "codex") {
      errors.push("t3code must remain a Codex client surface");
    }
    if (isRecord(adapters.codex) && t3code.stateNamespace !== adapters.codex.stateNamespace) {
      errors.push("t3code must share Codex observable state");
    }
  }
  return errors;
}

/** @param {any} registry @param {string} surface */
function resolveAdapter(registry, surface) {
  const declared = registry.adapters[surface];
  if (declared.kind === "client-surface") {
    return { ...registry.adapters[declared.adapter], surface, adapterId: declared.adapter };
  }
  return { ...declared, surface, adapterId: surface };
}

/** @param {any} scenario */
function validationPrompt(scenario) {
  return [
    "Observe this repository through the observable development contract.",
    "Return evidence only; do not edit files or trigger any lifecycle transition.",
    "Read the activated drive-development-flow skill, then do not search the repository or call any other tools.",
    `Scenario: ${scenario.id}. Fixture class: ${scenario.fixture}.`,
    `Natural-language action to classify: ${scenario.action ?? "Recommend the next development stage"}.`,
    "Report instructions, catalog exposure, actual load, hooks, roster, model/role,",
    "external side effects, external state, catalog overflow, and the observable lifecycle behavior.",
    "For catalogOverflow, inspect only skill-catalog truncation, omission, or scanner warnings. Lazy/deferred tool-schema loading is not skill-catalog overflow. Report false when no skill-catalog warning was exposed, true when one was, and null only when that signal is unavailable.",
    "Also report the first three named stages of the ordinary happy path as loadSignature.",
    "Reply with one JSON object using this exact shape; report observations, never pass/fail booleans:",
    '{"model":"observed model","reasoning":"observed reasoning","role":"observed role","loadSignature":["stage 1","stage 2","stage 3"],"evidence":{"instructionSources":["source read"],"catalogSkills":["critical skill observed"],"rosterSource":"source used","hookStatus":"active, safe-skip, or none","hookEvidence":"observed reason","externalSideEffects":["observed side effect, if any"],"externalState":"observed terminal state","catalogOverflow":null},"behavior":{"selectedStage":"observed stage","transition":"observed transition","authorization":"observed authorization","externalSideEffects":["observed side effect, if any"],"terminalState":"observed state"},"diagnostics":[]}',
  ].join(" ");
}

/** @param {any} behavior */
function normalizeBehavior(behavior) {
  const selected = String(behavior?.selectedStage ?? "").trim().toLowerCase();
  const transition = String(behavior?.transition ?? "").trim().toLowerCase();
  const authorization = String(behavior?.authorization ?? "").trim().toLowerCase();
  const terminalState = String(behavior?.terminalState ?? "").trim().toLowerCase();
  const externalSideEffects = Array.isArray(behavior?.externalSideEffects) ? behavior.externalSideEffects : [];
  const normalizedTransition = transition.includes("none") || transition.includes("recommend")
    ? "recommend-only"
    : transition;
  const unchangedTerminal = terminalState.includes("unchanged") ||
    terminalState.includes("recommend") ||
    terminalState.includes("advisory") ||
    terminalState.includes("awaiting-user") ||
    /\b(no|without)\b.*\b(change|transition|mutation|write)/.test(terminalState) ||
    (normalizedTransition === "recommend-only" && externalSideEffects.length === 0);
  return {
    selectedStage: selected.includes("wayfinder") ? "wayfinder" : selected,
    transition: normalizedTransition,
    authorization: authorization.includes("none") || authorization.includes("not required") || authorization.includes("recommend")
      ? "none"
      : authorization,
    externalSideEffects,
    terminalState: unchangedTerminal ? "unchanged" : terminalState,
  };
}

/** @param {unknown} value */
function describesUnchangedState(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return text.includes("unchanged") ||
    text.includes("remained unchanged") ||
    text.includes("untouched") ||
    /\b(no|not|without)\b.*\b(change|changes|changed|write|writes|written|mutation|mutations|touched|contacted)/.test(text);
}

/** @param {any} observed @param {any} behavior @returns {Record<string, boolean>} */
function deriveOperationalChecks(observed, behavior) {
  const evidence = observed?.evidence ?? {};
  const instructionSources = /** @type {unknown[]} */ (
    Array.isArray(evidence.instructionSources) ? evidence.instructionSources : []
  );
  const externalSideEffects = /** @type {unknown[] | null} */ (
    Array.isArray(evidence.externalSideEffects) ? evidence.externalSideEffects : null
  );
  return {
    instructions: instructionSources.some((/** @type {unknown} */ source) =>
      typeof source === "string" && source.length > 0
    ),
    catalog: observed?.catalogProof === true,
    load: observed?.loadProof === true,
    hooks: ["active", "safe-skip", "none"].includes(String(evidence.hookStatus ?? "").toLowerCase()) &&
      typeof evidence.hookEvidence === "string" && evidence.hookEvidence.length > 0,
    roster: typeof evidence.rosterSource === "string" && evidence.rosterSource.length > 0,
    modelRole: [observed?.model, observed?.reasoning, observed?.role].every(
      (value) => typeof value === "string" && value.length > 0,
    ),
    sideEffects: externalSideEffects !== null &&
      externalSideEffects.length === 0 && behavior.externalSideEffects.length === 0,
    externalState: describesUnchangedState(evidence.externalState) &&
      behavior.terminalState === "unchanged",
    noOverflow: observed?.catalogOverflowProof === true && evidence.catalogOverflow !== true,
  };
}

/**
 * @param {{registry: any, scenarios: any[], runtime: (request: any) => Promise<any>}} options
 */
export async function validateOperationalScenarios(options) {
  const registryErrors = validateHarnessRegistry(options.registry);
  if (registryErrors.length > 0) throw new Error(`Invalid harness registry:\n${registryErrors.join("\n")}`);
  /** @type {any[]} */
  const results = [];
  /** @type {any[]} */
  const failures = [];

  for (const scenario of options.scenarios) {
    if (scenario.expectedContractVersion && scenario.expectedContractVersion !== options.registry.contractVersion) {
      failures.push({
        scenario: scenario.id,
        surface: null,
        source: "canonical-source",
        message: `Scenario requires contract ${scenario.expectedContractVersion}, registry is ${options.registry.contractVersion}`,
      });
      continue;
    }
    for (const policyError of scenario.policyErrors ?? []) {
      failures.push({
        scenario: scenario.id,
        surface: null,
        source: "repo-policy",
        message: String(policyError),
      });
    }
    for (const surface of scenario.surfaces) {
      const adapter = resolveAdapter(options.registry, surface);
      try {
        const observed = await options.runtime({
          adapter,
          surface,
          scenario,
          prompt: validationPrompt(scenario),
          readOnly: true,
        });
        const behavior = normalizeBehavior(observed.behavior);
        const checks = deriveOperationalChecks(observed, behavior);
        const missingChecks = requiredChecks.filter((check) => checks[check] !== true);
        const behaviorMatches = isDeepStrictEqual(behavior, normalizeBehavior(scenario.expectedBehavior));
        const status = missingChecks.length === 0 && behaviorMatches ? "passed" : "failed";
        const result = {
          scenario: scenario.id,
          fixture: scenario.fixture,
          cwd: scenario.cwd,
          surface,
          adapter: adapter.adapterId,
          stateNamespace: adapter.stateNamespace,
          executable: observed.executable,
          version: observed.version,
          model: observed.model,
          reasoning: observed.reasoning,
          role: observed.role,
          checks,
          evidence: observed.evidence,
          behavior,
          rawBehavior: observed.behavior,
          diagnostics: observed.diagnostics ?? [],
          externalSideEffects: behavior.externalSideEffects,
          status,
        };
        results.push(result);
        if (missingChecks.length > 0) {
          failures.push({
            scenario: scenario.id,
            surface,
            source: "harness-runtime",
            message: `Operational checks failed: ${missingChecks.join(", ")}`,
          });
        }
        if (!behaviorMatches) {
          failures.push({
            scenario: scenario.id,
            surface,
            source: "adapter",
            message: "Observable behavior diverges from the canonical scenario",
          });
        }
      } catch (error) {
        failures.push({
          scenario: scenario.id,
          surface,
          source: "harness-runtime",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  for (const scenario of options.scenarios) {
    const codex = results.find((result) => result.scenario === scenario.id && result.surface === "codex");
    const t3code = results.find((result) => result.scenario === scenario.id && result.surface === "t3code");
    if (codex && t3code && !isDeepStrictEqual(codex.behavior, t3code.behavior)) {
      failures.push({
        scenario: scenario.id,
        surface: "t3code",
        source: "adapter",
        message: "T3Code diverged from the Codex observable contract and cannot become an independent adapter",
      });
    }
  }

  return {
    ok: failures.length === 0,
    operation: "validate-harnesses",
    contractVersion: options.registry.contractVersion,
    coverage: [...new Set(options.scenarios.map((scenario) => scenario.fixture))].sort(),
    results,
    failures,
  };
}

/**
 * Replace only the surfaces selected for a resumed operational run. A scenario-level
 * failure invalidates every prior surface result for that scenario.
 * @param {{contractVersion: string, resumeReport: any, scenarios: any[], scenarioReports: any[]}} options
 */
export function mergeOperationalReports(options) {
  const rerunAllScenarios = new Set(
    options.scenarios.filter((scenario) => scenario.rerunAll === true).map((scenario) => scenario.id),
  );
  const rerunKeys = new Set(options.scenarios.flatMap((scenario) =>
    scenario.surfaces.map((/** @type {string} */ surface) => `${scenario.id}:${surface}`)
  ));
  const retainedResults = (options.resumeReport?.results ?? []).filter(
    (/** @type {any} */ result) =>
      !rerunAllScenarios.has(result.scenario) && !rerunKeys.has(`${result.scenario}:${result.surface}`),
  );
  const retainedFailures = (options.resumeReport?.failures ?? []).filter(
    (/** @type {any} */ failure) =>
      !rerunAllScenarios.has(failure.scenario) && !rerunKeys.has(`${failure.scenario}:${failure.surface}`),
  );
  const failures = [...retainedFailures, ...options.scenarioReports.flatMap((item) => item.failures)];
  return {
    ok: failures.length === 0,
    operation: "validate-harnesses",
    contractVersion: options.contractVersion,
    coverage: [...new Set([
      ...(options.resumeReport?.coverage ?? []),
      ...options.scenarioReports.flatMap((item) => item.coverage),
    ])].sort(),
    results: [...retainedResults, ...options.scenarioReports.flatMap((item) => item.results)],
    failures,
  };
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

/** @param {string} text */
function parseLastJsonObject(text) {
  const events = jsonLines(text);
  const messages = events.flatMap((event) => {
    if (event?.type === "item.completed" && event.item?.type === "agent_message") return [event.item.text];
    if (event?.type === "result" && typeof event.result === "string") return [event.result];
    return [];
  });
  const candidate = messages.at(-1) ?? text.trim();
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? candidate;
  return JSON.parse(fenced.trim());
}

/**
 * Create the production subprocess runtime. Tests inject a runtime at this same Seam.
 * @param {{codexPath?: string, factoryPath?: string, timeoutMs?: number}} [options]
 */
export function createProcessHarnessRuntime(options = {}) {
  const codexPath = options.codexPath ?? "/Applications/ChatGPT.app/Contents/Resources/codex";
  const factoryPath = options.factoryPath ?? "/Applications/Factory.app/Contents/Resources/bin/droid";
  const timeoutMs = options.timeoutMs ?? 60_000;
  return async function processHarnessRuntime(/** @type {any} */ request) {
    const executable = request.adapter.adapterId === "factory" ? factoryPath : codexPath;
    const activatedPrompt = `${request.adapter.activationPrefix}drive-development-flow ${request.prompt}`;
    const args = request.adapter.adapterId === "factory"
      ? ["exec", "--cwd", request.scenario.cwd, "--output-format", "json", activatedPrompt]
      : [
          "-a", "never", "exec", "--ephemeral", "--sandbox", "read-only",
          "--skip-git-repo-check", "--json", "-C", request.scenario.cwd, activatedPrompt,
        ];
    const version = spawnSync(executable, ["--version"], { encoding: "utf8" });
    const run = spawnSync(executable, args, {
      cwd: request.scenario.cwd,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: timeoutMs,
      killSignal: "SIGTERM",
    });
    if (run.status !== 0 || run.error) {
      const timeoutMessage = run.error && "code" in run.error && run.error.code === "ETIMEDOUT"
        ? `${request.surface} exceeded the ${timeoutMs}ms operational deadline`
        : "";
      const error = new Error(timeoutMessage || run.stderr || run.stdout || `${request.surface} exited ${run.status}`);
      // @ts-ignore operational error code used by the diagnostic layer
      error.code = "HARNESS_RUNTIME";
      throw error;
    }
    const observed = parseLastJsonObject(`${run.stdout}\n${run.stderr}`);
    const combined = `${run.stdout}\n${run.stderr}`;
    const signature = Array.isArray(observed.loadSignature)
      ? observed.loadSignature.map((/** @type {unknown} */ item) => String(item).toLowerCase())
      : [];
    const signatureProven = ["grill-with-docs", "to-spec", "to-tickets"].every(
      (stage, index) => signature[index] === stage,
    );
    const activationProven = request.adapter.adapterId === "factory"
      ? /Skill ["']drive-development-flow["'] activated/i.test(combined)
      : /drive-development-flow\/SKILL\.md/i.test(combined);
    const catalogOverflowDetected = /(?:warning|error).{0,100}(?:skill catalog|skill scanner).{0,100}(?:overflow|truncat|omitt)/i
      .test(combined);
    return {
      ...observed,
      catalogProof: activationProven || signatureProven,
      catalogOverflowProof: !catalogOverflowDetected,
      loadProof: signatureProven,
      executable,
      version: version.stdout.trim() || version.stderr.trim(),
      diagnostics: [...(observed.diagnostics ?? []), { command: [executable, ...args].join(" "), exitCode: run.status }],
    };
  };
}
