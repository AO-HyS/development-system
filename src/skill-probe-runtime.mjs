// @ts-check

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";

import { hasBehaviorSignature } from "./skills.mjs";
import {
  classifyHarnessFailure,
  classifyProbeAssertionFailure,
  sanitizeProbeEvidence,
} from "./harness-diagnostics.mjs";
import { authenticateSkillProbeEvidence } from "./skill-evidence-auth.mjs";
import {
  invocationDigest,
  invocationDigestSchema,
  securityEnv,
} from "./invocation-digest.mjs";

export { invocationDigest, invocationDigestSchema };

/**
 * Live probe contracts for every skill whose catalog audit requires
 * executable, loaded, and influential Codex/T3 evidence. The behavior
 * signatures here must match the published catalog's
 * `operationalEvidenceContracts`; a sync test fails when they drift.
 *
 * Load proof is never a response phrase: it requires an observed Codex
 * JSONL command_execution that reads the exact absolute installed SKILL.md
 * path with exit_code 0 and an aggregated_output carrying the matching
 * frontmatter name.
 */
export const skillProbeContracts = [
  {
    logicalName: "research",
    catalogPrompt:
      "Without opening or activating a skill, name the exact available skill whose catalog description covers investigating questions against authoritative first-party evidence. Reply with only its skill name.",
    skillPrompt:
      "$research Read the full skill instructions from the exact installed file .agents/skills/research/SKILL.md. Then, according only to them: what kind of worker should do the job, what source class is mandatory, what single artifact must it create, and what exact fallback applies when the repository has no convention for those notes? Include the exact fallback phrases 'somewhere sensible' and 'say where' in one short sentence; do not perform the research.",
    catalogPattern: /^research\s*$/iu,
    loadPathMarkers: [".agents/skills/research/SKILL.md"],
    loadSignature: ["somewhere sensible", "say where"],
    behaviorSignature: ["background agent", "primary sources", "markdown file"],
  },
  {
    logicalName: "behavioral-evidence",
    catalogPrompt:
      "Without opening or activating a skill, name the exact available skill whose catalog description covers auditing changed and new tests for behavioral value and rejecting weakened assertions or snapshots. Reply with only its skill name.",
    skillPrompt:
      "$behavioral-evidence Read the full skill instructions from the exact installed file .agents/skills/behavioral-evidence/SKILL.md. Then, according only to them: how should tests be treated relative to the product behavior they observe, what is the disposition for an assertion loosened or a snapshot updated merely to turn a run green, and what must an independent verifier derive its oracle from? Include the exact phrase 'justifies nothing'; do not perform any audit.",
    catalogPattern: /^behavioral-evidence\s*$/iu,
    loadPathMarkers: [".agents/skills/behavioral-evidence/SKILL.md"],
    loadSignature: ["justifies nothing"],
    behaviorSignature: ["subordinate evidence", "weakened test", "accepted objective"],
  },
  {
    logicalName: "simplify-code",
    catalogPrompt:
      "Without opening or activating a skill, name the exact available skill whose catalog description covers reviewing a diff for safe removal and reuse plus a mandatory final simplification audit. Reply with only its skill name.",
    skillPrompt:
      "$simplify-code Read the full skill instructions from the exact installed file .agents/skills/simplify-code/SKILL.md. Then, according only to them: which mandatory pass must run before independent verification, which code must it cover, and what must it report about removals, retentions, and the remainder? Include the exact phrase 'why it must remain'; do not perform any review.",
    catalogPattern: /^simplify-code\s*$/iu,
    loadPathMarkers: [".agents/skills/simplify-code/SKILL.md"],
    loadSignature: ["why it must remain"],
    behaviorSignature: ["deletion pass", "production code and test code", "what was deleted"],
  },
  {
    logicalName: "install-anti-slop",
    catalogPrompt:
      "Without opening or activating a skill, name the exact available skill whose catalog description covers installing the anti-slop Oxlint plugin into a repository. Reply with only its skill name.",
    skillPrompt:
      "$install-anti-slop Read the full skill instructions from the exact installed file .agents/skills/install-anti-slop/SKILL.md. Then, according only to them: which script performs the contained install, and which destination arguments are refused outright, including rooted destinations, upward path segments, and destinations reached through links? Do not run any installer.",
    catalogPattern: /^install-anti-slop\s*$/iu,
    loadPathMarkers: [".agents/skills/install-anti-slop/SKILL.md"],
    loadSignature: ["install.mjs"],
    behaviorSignature: [
      "install.mjs",
      "absolute destinations",
      "nested traversal",
      ["symlink ancestor", "symlink ancestors", "symbolic link ancestor", "symbolic link ancestors"],
    ],
  },
];

/**
 * Bind prompt templates to the exact immutable behavior contracts selected by
 * the installed catalog. Unknown, duplicate, or malformed contracts fail
 * before any harness process is launched.
 * @param {unknown} installedCatalog
 */
export function bindSkillProbeContracts(installedCatalog) {
  if (installedCatalog === null || typeof installedCatalog !== "object" || Array.isArray(installedCatalog)) {
    throw new Error("Installed skill catalog is malformed");
  }
  const catalog = /** @type {Record<string, any>} */ (installedCatalog);
  if (!Array.isArray(catalog.operationalEvidenceSkills)) {
    throw new Error("Installed skill catalog has no operational evidence skill list");
  }
  const names = catalog.operationalEvidenceSkills;
  if (
    names.some((name) => typeof name !== "string" || name.length === 0) ||
    new Set(names).size !== names.length
  ) {
    throw new Error("Installed skill catalog has invalid operational evidence skill names");
  }
  const templates = new Map(skillProbeContracts.map((contract) => [contract.logicalName, contract]));
  const unknown = names.filter((name) => !templates.has(name));
  if (unknown.length > 0) throw new Error(`Installed skill catalog has no probe template for: ${unknown.join(", ")}`);
  const contracts = catalog.operationalEvidenceContracts;
  if (contracts === null || typeof contracts !== "object" || Array.isArray(contracts)) {
    throw new Error("Installed skill catalog has no operational evidence contracts");
  }
  return skillProbeContracts.filter((template) => names.includes(template.logicalName)).map((template) => {
    const signature = contracts[template.logicalName]?.behaviorSignature;
    const validRequirement = (/** @type {unknown} */ requirement) =>
      typeof requirement === "string"
        ? requirement.trim().length > 0
        : Array.isArray(requirement) && requirement.length > 0 &&
          requirement.every((alternative) => typeof alternative === "string" && alternative.trim().length > 0);
    if (!Array.isArray(signature) || signature.length === 0 || !signature.every(validRequirement)) {
      throw new Error(`Installed skill catalog has an invalid behavior contract for ${template.logicalName}`);
    }
    return { ...template, behaviorSignature: structuredClone(signature) };
  });
}

/** Kept for compatibility: the research skill's live behavior signature. */
export const skillBehaviorSignature = skillProbeContracts[0].behaviorSignature;
/** Kept for compatibility: the research skill's live load signature. */
export const skillLoadBehaviorSignature = skillProbeContracts[0].loadSignature;

/** @param {string} home @param {string} logicalName */
export function installedSkillPath(home, logicalName) {
  if (typeof home !== "string" || home.trim().length === 0) {
    throw new Error("Skill probe HOME is required");
  }
  const resolvedHome = resolve(home);
  if (!isAbsolute(resolvedHome)) throw new Error("Skill probe HOME must resolve to an absolute path");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(logicalName)) {
    throw new Error(`Skill probe logical name is unsafe: ${logicalName}`);
  }
  return resolve(resolvedHome, ".agents", "skills", logicalName, "SKILL.md");
}

/** @param {{codexPath: string, repositoryRoot: string, home: string, contracts?: typeof skillProbeContracts}} input */
export function buildCodexSkillProbeInvocations(input) {
  const contracts = input.contracts ?? skillProbeContracts;
  const common = ["-a", "never", "exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--json", "-C", input.repositoryRoot];
  return {
    version: { executable: input.codexPath, args: ["--version"] },
    skills: Object.fromEntries(contracts.map((contract) => [
      contract.logicalName,
      {
        catalog: { executable: input.codexPath, args: [...common, contract.catalogPrompt] },
        skill: {
          executable: input.codexPath,
          args: [
            ...common,
            contract.skillPrompt.replaceAll(
              contract.loadPathMarkers[0],
              installedSkillPath(input.home, contract.logicalName),
            ),
          ],
        },
      },
    ])),
  };
}

/** @param {string} text */
function jsonLines(text) {
  return text.split("\n").flatMap((line) => {
    try { return [JSON.parse(line)]; }
    catch { return []; }
  });
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {string} text */
function finalAgentMessage(text) {
  return jsonLines(text)
    .filter((event) => event?.type === "item.completed" && event.item?.type === "agent_message")
    .map((event) => event.item.text)
    .at(-1) ?? "";
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Split a shell command into tokens honoring single and double quotes.
 * Returns null for unbalanced quoting so a malformed command fails closed.
 * @param {string} command @returns {string[] | null}
 */
function shellTokens(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (const char of command) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (/\s/u.test(char)) {
      if (current.length > 0) { tokens.push(current); current = ""; }
      continue;
    }
    current += char;
  }
  if (quote !== null) return null;
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/**
 * Extract the single path operand of a real read command. Only `cat` — the
 * expected probe command, optionally invoked through `/bin/zsh -lc` and with
 * an optional `cat --` separator — qualifies. echo or printf commands, other
 * executables, options, or extra operands fail closed with null.
 * @param {string} command @returns {string | null}
 */
function catReadOperand(command) {
  let tokens = shellTokens(command.trim());
  if (!tokens || tokens.length === 0) return null;
  if ((tokens[0] === "/bin/zsh" || tokens[0] === "zsh") && (tokens[1] === "-lc" || (tokens[1] === "-l" && tokens[2] === "-c"))) {
    const inner = tokens.slice(tokens[1] === "-lc" ? 2 : 3).join(" ").trim();
    if (!inner) return null;
    tokens = shellTokens(inner);
    if (!tokens || tokens.length === 0) return null;
  }
  const executable = tokens[0].split("/").at(-1);
  if (executable !== "cat") return null;
  const operands = tokens.slice(1);
  if (operands[0] === "--") operands.shift();
  if (operands.length !== 1) return null;
  return operands[0];
}

/**
 * The aggregated output must begin with a real YAML frontmatter block,
 * delimited by an opening `---` line and a closing `---` line, and the
 * matching name line must sit inside that first block. A name line in
 * ordinary body text is never load proof.
 * @param {string} aggregatedOutput @param {string} logicalName
 */
function frontmatterCarriesSkillName(aggregatedOutput, logicalName) {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(aggregatedOutput);
  if (!match) return false;
  return new RegExp(`^name:\\s*${escapeRegExp(logicalName)}\\s*$`, "mu").test(match[1]);
}

/**
 * Load evidence is an observed Codex JSONL command_execution, never prose. A
 * qualifying event is a real `cat` read whose path operand is exactly the
 * installed SKILL.md path for this skill, exits 0, and whose aggregated_output
 * begins with a frontmatter block carrying the skill's own frontmatter name.
 *
 * @param {{logicalName: string, loadPathMarkers: string[]}} contract
 * @param {any} result
 * @param {string | {installedPath: string, canonicalPath?: string} | string[]} expectedInstalledPath
 * @returns {{schemaVersion: 1, observed: boolean, command: string | null, commandProof: string | null, path: string | null, frontmatterName: string | null, exitCode: number | null, commandEventSha256: string | null, commandSha256: string | null, frontmatterSha256: string | null}}
 */
export function observedSkillReadEvent(contract, result, expectedInstalledPath) {
  const expectedPaths = (typeof expectedInstalledPath === "string"
    ? [expectedInstalledPath]
    : Array.isArray(expectedInstalledPath)
      ? expectedInstalledPath
      : [expectedInstalledPath?.installedPath, expectedInstalledPath?.canonicalPath]
  ).filter((path) => typeof path === "string" && isAbsolute(path));
  /** @type {{schemaVersion: 1, observed: boolean, command: string | null, commandProof: string | null, path: string | null, frontmatterName: string | null, exitCode: number | null, commandEventSha256: string | null, commandSha256: string | null, frontmatterSha256: string | null}} */
  const emptyReceipt = {
    schemaVersion: 1,
    observed: false,
    command: null,
    commandProof: null,
    path: null,
    frontmatterName: null,
    exitCode: null,
    commandEventSha256: null,
    commandSha256: null,
    frontmatterSha256: null,
  };
  if (expectedPaths.length === 0) return emptyReceipt;
  for (const line of String(result?.stdout ?? "").split("\n")) {
    let event;
    try { event = JSON.parse(line); }
    catch { continue; }
    const item = event?.type === "item.completed" ? event.item : null;
    if (item?.type !== "command_execution") continue;
    if (item.exit_code !== 0) continue;
    const command = typeof item.command === "string" ? item.command : "";
    const aggregatedOutput = typeof item.aggregated_output === "string" ? item.aggregated_output : "";
    const path = catReadOperand(command);
    // The read must target exactly the expected absolute installed SKILL.md
    // path (or the explicitly supplied canonical real path) — not a relative
    // repository decoy, backup, suffix, alias, or a path merely echoed.
    if (!path || !expectedPaths.includes(path)) continue;
    if (!frontmatterCarriesSkillName(aggregatedOutput, contract.logicalName)) continue;
    return {
      schemaVersion: 1,
      observed: true,
      command,
      commandProof: "cat-exact-installed-skill",
      path,
      frontmatterName: contract.logicalName,
      exitCode: 0,
      commandEventSha256: sha256(line),
      commandSha256: sha256(command),
      frontmatterSha256: sha256(aggregatedOutput),
    };
  }
  return emptyReceipt;
}

/**
 * Codex CLI currently shares local runtime state across invocations. Running
 * the catalog and skill turns concurrently can therefore return exit-zero
 * processes without a final agent message. Keep the live proof sequential so
 * each observation is independently complete.
 *
 * @param {{
 *   invocations: ReturnType<typeof buildCodexSkillProbeInvocations>,
 *   home: string,
 *   execute: (invocation: {executable: string, args: string[]}) => Promise<any>,
 *   contracts?: typeof skillProbeContracts,
 * }} input
 */
export async function runCodexSkillProbeSequence(input) {
  const contracts = input.contracts ?? skillProbeContracts;
  const codexVersion = await input.execute(input.invocations.version);
  /** @type {Record<string, {catalog: any, skill: any, attempts: {version: number, catalog: number, skill: number, retriedFailedAssertions: number}}>} */
  const observations = {};
  for (const contract of contracts) {
    const pair = input.invocations.skills[contract.logicalName];
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
    const catalogObservation = await observe(pair.catalog, (result) =>
      contract.catalogPattern.test(finalAgentMessage(String(result?.stdout ?? ""))),
    );
    const skillObservation = await observe(pair.skill, (result) => {
      const response = finalAgentMessage(String(result?.stdout ?? ""));
      return observedSkillReadEvent(contract, result, installedSkillPath(input.home, contract.logicalName)).observed &&
        hasBehaviorSignature(response, contract.behaviorSignature);
    });
    observations[contract.logicalName] = {
      catalog: catalogObservation.result,
      skill: skillObservation.result,
      attempts: {
        version: 1,
        catalog: catalogObservation.attempts,
        skill: skillObservation.attempts,
        retriedFailedAssertions:
          catalogObservation.retriedFailedAssertions + skillObservation.retriedFailedAssertions,
      },
    };
  }
  return { codexVersion, observations };
}

/**
 * @param {{executable: string, args: string[], cwd: string, timeoutMs: number, maxBufferBytes?: number, env?: NodeJS.ProcessEnv}} input
 */
export function runSkillProbeProcess(input) {
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) throw new Error("Skill probe timeout must be positive");
  const maxBufferBytes = input.maxBufferBytes ?? 20 * 1024 * 1024;
  return new Promise((resolveResult) => {
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      ...(input.env ? { env: input.env } : {}),
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
      const structuredInvocation = {
        executable: input.executable,
        argv: input.args,
        cwd: input.cwd,
        env: securityEnv(input.env),
      };
      resolveResult({
        exitCode: typeof code === "number" ? code : null,
        signal,
        stdout,
        stderr,
        timedOut,
        overflow,
        command: [input.executable, ...input.args].join(" "),
        structuredInvocation,
        invocationSha256: invocationDigest(structuredInvocation),
        errorCode: overflow ? "MAX_BUFFER" : errorCode,
      });
    });
  });
}

/** @param {any} result @param {string} harness */
function processFailure(result, harness) {
  return classifyHarnessFailure({
    harness,
    ...result,
    errorCode: result.timedOut === true
      ? "ETIMEDOUT"
      : result.overflow === true
        ? "MAX_BUFFER"
        : result.errorCode,
  });
}

/**
 * Build the private operational evidence consumed by `audit-skills`. One
 * entry per probe contract, bound to installed folder hashes; every field a
 * fail-closed audit reads is derived from the observed subprocess results.
 *
 * @param {{catalogVersion: string, sourceCommit: string, home: string, structuralCatalogLogicalSkills: number, installedHashes: Record<string, string>, generatedAt: string, codexVersion: any, observations: Record<string, {catalog: any, skill: any, attempts: {version: number, catalog: number, skill: number, retriedFailedAssertions: number}}>, authenticationKey?: Buffer | Uint8Array, contracts?: typeof skillProbeContracts}} input
 */
export function buildCodexSkillProbeEvidence(input) {
  const contracts = input.contracts ?? skillProbeContracts;
  const processSucceeded = (/** @type {any} */ result) =>
    result.exitCode === 0 &&
    result.timedOut !== true &&
    result.overflow !== true &&
    !result.errorCode;
  const versionFailure = classifyHarnessFailure({
    harness: "codex-version",
    ...input.codexVersion,
    errorCode: input.codexVersion.timedOut === true
      ? "ETIMEDOUT"
      : input.codexVersion.overflow === true
        ? "MAX_BUFFER"
        : input.codexVersion.errorCode,
  });
  const version = String(input.codexVersion.stdout ?? "").trim();
  const versionObservation = {
    exitCode: input.codexVersion.exitCode ?? null,
    timedOut: input.codexVersion.timedOut === true,
    overflow: input.codexVersion.overflow === true,
    failure: versionFailure,
  };
  /** @type {Record<string, unknown>} */
  const codex = {};
  /** @type {boolean[]} */
  const skillSuccess = [];
  for (const contract of contracts) {
    const observation = input.observations[contract.logicalName];
    const catalogResult = observation?.catalog ?? { exitCode: null, stdout: "", stderr: "", command: "", structuredInvocation: null, errorCode: "MISSING" };
    const skillResult = observation?.skill ?? { exitCode: null, stdout: "", stderr: "", command: "", structuredInvocation: null, errorCode: "MISSING" };
    const codexCombined = `${skillResult.stdout}\n${skillResult.stderr}`;
    const codexAll = `${catalogResult.stdout}\n${catalogResult.stderr}\n${codexCombined}`;
    const codexFinal = finalAgentMessage(skillResult.stdout);
    const codexCatalogFinal = finalAgentMessage(catalogResult.stdout);
    const skillRead = observedSkillReadEvent(
      contract,
      skillResult,
      installedSkillPath(input.home, contract.logicalName),
    );
    const skillInvocation = skillResult.structuredInvocation ?? null;
    const catalogInvocation = catalogResult.structuredInvocation ?? null;
    const skillInvocationSha256 = skillInvocation ? invocationDigest(skillInvocation) : null;
    const catalogInvocationSha256 = catalogInvocation ? invocationDigest(catalogInvocation) : null;
    // loaded is proven only by the observed successful skill read; response or
    // load-signature phrases alone are never load proof.
    const loaded = processSucceeded(skillResult) && skillRead.observed && skillRead.exitCode === 0;
    const catalogued = catalogResult.exitCode === 0 && contract.catalogPattern.test(codexCatalogFinal);
    const installedHash = input.installedHashes?.[`${contract.logicalName}.codex`];
    const influenced =
      processSucceeded(skillResult) &&
      loaded &&
      /^[a-f0-9]{64}$/u.test(installedHash ?? "") &&
      hasBehaviorSignature(codexFinal, contract.behaviorSignature);
    const failures = [
      versionFailure,
      processFailure(catalogResult, "codex"),
      processFailure(skillResult, "codex"),
    ].filter(Boolean);
    const assertionFailure = failures.length === 0
      ? classifyProbeAssertionFailure({ harness: "codex", catalogued, loaded, influenced })
      : null;
    const allFailures = [...failures, assertionFailure].filter(Boolean);
    const safe = sanitizeProbeEvidence({
      response: codexFinal,
      catalogResponse: codexCatalogFinal,
      scannerErrors: [...codexAll.matchAll(/[^\n]*(?:skill scanner|failed to load skill)[^\n]*/giu)].map((match) => match[0]),
      failures: allFailures,
    });
    const persistedSkillRead = {
      schemaVersion: skillRead.schemaVersion,
      observed: skillRead.observed,
      commandProof: skillRead.commandProof,
      path: skillRead.path,
      frontmatterName: skillRead.frontmatterName,
      exitCode: skillRead.exitCode,
      commandEventSha256: skillRead.commandEventSha256,
      commandSha256: skillRead.commandSha256,
      frontmatterSha256: skillRead.frontmatterSha256,
    };
    codex[contract.logicalName] = {
      catalogued,
      loaded,
      influenced,
      // Persist only authenticated digests, the exact digest schema marker,
      // and derived facts. Raw provider JSONL, final messages, frontmatter
      // bytes, and the structured invocation itself (whose argv carries the
      // raw prompt) stay ephemeral.
      skillRead: persistedSkillRead,
      invocationDigestSchema,
      invocationSha256: skillInvocationSha256,
      catalogInvocationSha256: catalogInvocationSha256,
      version,
      versionObservation,
      exitCode: skillResult.exitCode,
      observationAttempts: observation?.attempts ?? {
        version: 1,
        catalog: 1,
        skill: 1,
        retriedFailedAssertions: 0,
      },
      responseSha256: sha256(codexFinal),
      catalogResponseSha256: sha256(codexCatalogFinal),
      behaviorSignatureMatched: hasBehaviorSignature(codexFinal, contract.behaviorSignature),
      catalogResponseMatched: contract.catalogPattern.test(codexCatalogFinal),
      catalogWarning: /skill descriptions were shortened/iu.test(codexAll),
      catalogOverflow: /skills? (?:were )?omitted|omitted_skills=[1-9]/iu.test(codexAll),
      scannerErrors: safe.scannerErrors,
      failure: allFailures[0] ?? null,
      failures: allFailures,
    };
    skillSuccess.push(
      processSucceeded(catalogResult) &&
      processSucceeded(skillResult) &&
      catalogued &&
      loaded &&
      influenced,
    );
  }
  const probeSucceeded = Boolean(
    processSucceeded(input.codexVersion) &&
    skillSuccess.every(Boolean),
  );
  const evidence = {
    schemaVersion: 2,
    catalogVersion: input.catalogVersion,
    evidenceScope: {
      kind: "critical-capability-live-probe",
      structuralCatalogLogicalSkills: input.structuralCatalogLogicalSkills,
      liveInfluenceSkills: contracts.map((contract) => contract.logicalName),
      exhaustive: false,
      claim: "Live influence is proven only for the named skills and harness observations.",
    },
    generatedAt: input.generatedAt,
    sourceCommit: input.sourceCommit,
    home: input.home,
    behaviorSignatures: Object.fromEntries(contracts.map((contract) => [
      contract.logicalName,
      contract.behaviorSignature,
    ])),
    probeSucceeded,
    installedHashes: input.installedHashes,
    codex,
  };
  return input.authenticationKey
    ? authenticateSkillProbeEvidence(evidence, input.authenticationKey)
    : evidence;
}
