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
 * @param {{catalogVersion: string, sourceCommit: string, home: string, structuralCatalogLogicalSkills: number, installedHash: string, generatedAt: string, codexVersion: any, catalogResult: any, skillResult: any}} input
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
  const processFailures = [
    classifyHarnessFailure({ harness: "codex", ...input.catalogResult }),
    classifyHarnessFailure({ harness: "codex", ...input.skillResult }),
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
  const probeSucceeded = Boolean(catalogued && loaded && influenced && input.skillResult.exitCode === 0);
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
        exitCode: input.skillResult.exitCode,
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
