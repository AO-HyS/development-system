// @ts-check

import { spawn } from "node:child_process";

import { hasBehaviorSignature } from "./skills.mjs";
import {
  classifyHarnessFailure,
  classifyProbeAssertionFailure,
  sanitizeProbeEvidence,
} from "./harness-diagnostics.mjs";

export const skillBehaviorSignature = ["background agent", "primary sources", "markdown file"];
export const skillLoadBehaviorSignature = ["somewhere sensible", "say where"];

const catalogPrompt = "Without opening or activating a skill, name the exact available skill whose catalog description covers investigating questions against high-trust primary sources. Reply with only its skill name.";
const researchPrompt = "$research Read the full skill instructions. Then, according only to them: what kind of worker should do the job, what source class is mandatory, what single artifact must it create, and what exact fallback applies when the repository has no convention for those notes? Include the exact fallback phrases 'somewhere sensible' and 'say where' in one short sentence; do not perform the research.";

/** @param {{codexPath: string, repositoryRoot: string}} input */
export function buildCodexSkillProbeInvocations(input) {
  const common = ["-a", "never", "exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--json", "-C", input.repositoryRoot];
  return {
    version: { executable: input.codexPath, args: ["--version"] },
    catalog: { executable: input.codexPath, args: [...common, catalogPrompt] },
    skill: { executable: input.codexPath, args: [...common, researchPrompt] },
  };
}

/**
 * Codex CLI currently shares local runtime state across invocations. Running
 * the catalog and skill turns concurrently can therefore return exit-zero
 * processes without a final agent message. Keep the live proof sequential so
 * each observation is independently complete.
 *
 * @param {{
 *   invocations: ReturnType<typeof buildCodexSkillProbeInvocations>,
 *   execute: (invocation: {executable: string, args: string[]}) => Promise<any>,
 * }} input
 */
export async function runCodexSkillProbeSequence(input) {
  const codexVersion = await input.execute(input.invocations.version);
  const observe = async (
    /** @type {{executable: string, args: string[]}} */ invocation,
    /** @type {(result: any) => boolean} */ assertion,
  ) => {
    let result = await input.execute(invocation);
    let retriedFailedAssertions = 0;
    if (
      result?.exitCode === 0 &&
      result?.timedOut !== true &&
      result?.overflow !== true &&
      !assertion(result)
    ) {
      retriedFailedAssertions = 1;
      result = await input.execute(invocation);
    }
    return { result, attempts: 1 + retriedFailedAssertions, retriedFailedAssertions };
  };
  const catalogObservation = await observe(input.invocations.catalog, (result) =>
    /^research\s*$/iu.test(finalAgentMessage(String(result?.stdout ?? "")))
  );
  const skillObservation = await observe(input.invocations.skill, (result) => {
    const response = finalAgentMessage(String(result?.stdout ?? ""));
    const combined = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`;
    const loaded = combined.includes(".agents/skills/research/SKILL.md") ||
      hasBehaviorSignature(response, skillLoadBehaviorSignature);
    return loaded && hasBehaviorSignature(response, skillBehaviorSignature);
  });
  return {
    codexVersion,
    codexCatalog: catalogObservation.result,
    codex: skillObservation.result,
    observationAttempts: {
      version: 1,
      catalog: catalogObservation.attempts,
      skill: skillObservation.attempts,
      retriedFailedAssertions:
        catalogObservation.retriedFailedAssertions + skillObservation.retriedFailedAssertions,
    },
  };
}

/**
 * @param {{executable: string, args: string[], cwd: string, timeoutMs: number, maxBufferBytes?: number}} input
 */
export function runSkillProbeProcess(input) {
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) throw new Error("Skill probe timeout must be positive");
  const maxBufferBytes = input.maxBufferBytes ?? 20 * 1024 * 1024;
  return new Promise((resolveResult) => {
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let overflow = false;
    let timedOut = false;
    /** @type {string | null} */
    let errorCode = null;
    /** @param {"stdout" | "stderr"} key @param {Buffer | Uint8Array | string} chunk */
    const collect = (key, chunk) => {
      const value = chunk.toString("utf8");
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + Buffer.byteLength(value) > maxBufferBytes) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      if (key === "stdout") stdout += value;
      else stderr += value;
    };
    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.on("error", (error) => { errorCode = "code" in error ? String(error.code) : "SPAWN_ERROR"; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveResult({
        exitCode: typeof code === "number" ? code : null,
        signal,
        stdout,
        stderr,
        timedOut,
        overflow,
        command: [input.executable, ...input.args].join(" "),
        errorCode: overflow ? "MAX_BUFFER" : errorCode,
      });
    });
  });
}

/** @param {string} text */
function jsonLines(text) {
  return text.split("\n").flatMap((line) => {
    try { return [JSON.parse(line)]; }
    catch { return []; }
  });
}

/** @param {string} text */
function finalAgentMessage(text) {
  return jsonLines(text)
    .filter((event) => event?.type === "item.completed" && event.item?.type === "agent_message")
    .map((event) => event.item.text)
    .at(-1) ?? "";
}

/**
 * @param {{catalogVersion: string, sourceCommit: string, home: string, structuralCatalogLogicalSkills: number, installedHash: string, generatedAt: string, codexVersion: any, catalogResult: any, skillResult: any, observationAttempts?: {version: number, catalog: number, skill: number, retriedFailedAssertions: number}}} input
 */
export function buildCodexSkillProbeEvidence(input) {
  const codexCombined = `${input.skillResult.stdout}\n${input.skillResult.stderr}`;
  const codexAll = `${input.catalogResult.stdout}\n${input.catalogResult.stderr}\n${codexCombined}`;
  const codexFinal = finalAgentMessage(input.skillResult.stdout);
  const codexCatalogFinal = finalAgentMessage(input.catalogResult.stdout);
  const loaded = input.skillResult.exitCode === 0 && (
    codexCombined.includes(".agents/skills/research/SKILL.md") ||
    hasBehaviorSignature(codexFinal, skillLoadBehaviorSignature)
  );
  const catalogued = input.catalogResult.exitCode === 0 && /^research\s*$/iu.test(codexCatalogFinal);
  const influenced = input.skillResult.exitCode === 0 && loaded && hasBehaviorSignature(codexFinal, skillBehaviorSignature);
  const versionFailure = classifyHarnessFailure({
    harness: "codex-version",
    ...input.codexVersion,
    errorCode: input.codexVersion.timedOut === true
      ? "ETIMEDOUT"
      : input.codexVersion.overflow === true
        ? "MAX_BUFFER"
        : input.codexVersion.errorCode,
  });
  const processFailures = [
    versionFailure,
    classifyHarnessFailure({
      harness: "codex",
      ...input.catalogResult,
      errorCode: input.catalogResult.timedOut === true
        ? "ETIMEDOUT"
        : input.catalogResult.overflow === true
          ? "MAX_BUFFER"
          : input.catalogResult.errorCode,
    }),
    classifyHarnessFailure({
      harness: "codex",
      ...input.skillResult,
      errorCode: input.skillResult.timedOut === true
        ? "ETIMEDOUT"
        : input.skillResult.overflow === true
          ? "MAX_BUFFER"
          : input.skillResult.errorCode,
    }),
  ].filter(Boolean);
  const assertionFailure = processFailures.length === 0
    ? classifyProbeAssertionFailure({ harness: "codex", catalogued, loaded, influenced })
    : null;
  const failures = [...processFailures, assertionFailure].filter(Boolean);
  const safe = sanitizeProbeEvidence({
    response: codexFinal,
    catalogResponse: codexCatalogFinal,
    scannerErrors: [...codexAll.matchAll(/[^\n]*(?:skill scanner|failed to load skill)[^\n]*/giu)].map((match) => match[0]),
    failures,
  });
  const processSucceeded = (/** @type {any} */ result) =>
    result.exitCode === 0 &&
    result.timedOut !== true &&
    result.overflow !== true &&
    !result.errorCode;
  const probeSucceeded = Boolean(
    processFailures.length === 0 &&
    processSucceeded(input.codexVersion) &&
    processSucceeded(input.catalogResult) &&
    processSucceeded(input.skillResult) &&
    catalogued &&
    loaded &&
    influenced &&
    input.catalogResult.exitCode === 0 &&
    input.skillResult.exitCode === 0
  );
  return {
    schemaVersion: 1,
    catalogVersion: input.catalogVersion,
    evidenceScope: {
      kind: "critical-capability-live-probe",
      structuralCatalogLogicalSkills: input.structuralCatalogLogicalSkills,
      liveInfluenceSkills: ["research"],
      exhaustive: false,
      claim: "Live influence is proven only for the named skill and harness observations.",
    },
    generatedAt: input.generatedAt,
    sourceCommit: input.sourceCommit,
    home: input.home,
    skill: "research",
    behaviorSignature: skillBehaviorSignature,
    loadBehaviorSignature: skillLoadBehaviorSignature,
    probeSucceeded,
    installedHashes: { "research.codex": input.installedHash },
    codex: {
      research: {
        catalogued,
        loaded,
        influenced,
        command: input.skillResult.command,
        version: String(input.codexVersion.stdout ?? "").trim(),
        versionObservation: {
          exitCode: input.codexVersion.exitCode ?? null,
          timedOut: input.codexVersion.timedOut === true,
          overflow: input.codexVersion.overflow === true,
          failure: versionFailure,
        },
        exitCode: input.skillResult.exitCode,
        observationAttempts: input.observationAttempts ?? {
          version: 1,
          catalog: 1,
          skill: 1,
          retriedFailedAssertions: 0,
        },
        response: safe.response,
        catalogCommand: input.catalogResult.command,
        catalogResponse: safe.catalogResponse,
        catalogWarning: /skill descriptions were shortened/iu.test(codexAll),
        catalogOverflow: /skills? (?:were )?omitted|omitted_skills=[1-9]/iu.test(codexAll),
        scannerErrors: safe.scannerErrors,
        failure: failures[0] ?? null,
        failures,
      },
    },
  };
}
