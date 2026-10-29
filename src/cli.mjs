// @ts-check

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditInstallation,
  installVersion,
  executionMode,
  rollbackInstallation,
  validateInstallation,
  validateRepository,
} from "./core.mjs";
import {
  executeLifecycleOperation,
  readLifecycleState,
  runLifecycleRequest,
} from "./lifecycle.mjs";
import { createCommandDeliveryRuntime, runImplementPreview } from "./delivery.mjs";
import { writeTechnicalDocument } from "./technical-documents.mjs";
import { auditSkillCatalog, rollbackSkillSync, synchronizeSkillCatalog } from "./skills.mjs";
import { auditRepository, initializeRepository, normalizeRepository } from "./repositories.mjs";
import {
  auditGlobalGuardrails,
  enableGlobalGuardrails,
  rollbackGlobalGuardrails,
} from "./guardrails.mjs";
import {
  auditClaudeOrchestration,
  enableClaudeOrchestration,
  rollbackClaudeOrchestration,
} from "./claude-orchestration.mjs";
import { auditReportGate, enableReportGate, rollbackReportGate } from "./report-gate.mjs";
import { findAutomatedTests } from "./no-tests.mjs";
import { addMistake, annotateMistake, listMistakes } from "./mistakes.mjs";
import { formatThreadHealth, threadHealth } from "./thread-health.mjs";
import { runWorkingBackwardsScenario } from "./working-backwards.mjs";
import { createHumanLayerAdapter } from "./humanlayer-adapter.mjs";
import {
  createT3ImplementationHandoff,
  prepareTicketPublication,
  verifyT3HandoffFreshness,
} from "./working-backwards-handoff.mjs";
import { evaluateWorkingBackwards } from "./working-backwards-evaluation.mjs";
import { routeDefinition } from "./definition-router.mjs";
import { routeVisualGrill } from "./visual-grill.mjs";
import { buildDevelopmentRun } from "./development-run.mjs";
import { planParallelWork } from "./parallel-work.mjs";
import { planReleaseTrain } from "./release-train-v2.mjs";
import { buildCheckIn } from "./check-in.mjs";
import { buildLinearHygienePlan } from "./linear-hygiene.mjs";
import { processDevelopmentStewardReview } from "./development-steward.mjs";
import {
  auditDevelopmentStewardScheduler,
  disableDevelopmentStewardScheduler,
  installDevelopmentStewardScheduler,
} from "./development-steward-scheduler.mjs";
import { auditPostHogObservability } from "./posthog-observability.mjs";
import { auditConvexGuardian } from "./convex-guardian.mjs";
import { evaluateOrchestrationPilot } from "./orchestration-pilot.mjs";
import { planOrchestration } from "./orchestration-plan.mjs";
import { verifyPathConfinement } from "./path-confinement.mjs";
import { runSupervisedWorker } from "./supervised-worker.mjs";
import { codexQuota } from "./codex-quota.mjs";
import { auditSharedInstallation, rollbackSharedInstallation, setupSharedInstallation, withLegacyInstallationMutation } from "./shared-installation.mjs";
import { updateSharedInstallation } from "./shared-update.mjs";
import { loadPackageSource } from "./package-source.mjs";
import { resolveModelRoute } from "./model-routing.mjs";
import { readProviderFailures, recordProviderFailure } from "./provider-availability.mjs";
import { auditGovernanceHooks, enableGovernanceHooks, rollbackGovernanceHooks, withGovernanceHookRollback } from "./governance-installation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string | undefined} explicitVersion */
async function readSkillCatalog(explicitVersion) {
  if (explicitVersion) return JSON.parse(await readFile(resolve(repositoryRoot, "catalog", `${explicitVersion}.json`), "utf8"));
  const metadata = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "manifests", `${metadata.contractVersion ?? metadata.version}.json`), "utf8"));
  const artifact = manifest.artifacts.find((/** @type {{logicalName: string}} */ item) => item.logicalName === "skill-catalog");
  if (!artifact) throw new Error("Current contract has no skill catalog");
  return JSON.parse(await readFile(resolve(repositoryRoot, artifact.sourcePath), "utf8"));
}

/** @param {string[]} argv */
function parseArguments(argv) {
  const [command, ...tokens] = argv;
  /** @type {{home: string, version?: string, sourceCommit?: string, sourceRoot?: string, evidence?: string, workflow?: string, mode?: string, request?: string, terminalSlice?: string, lifecycleOperation?: string, plan?: string, repository?: string, confirm?: string, input?: string, projectsRoot?: string, codexPath?: string, nodePath?: string, root?: string, duringActiveRuns?: string, json: boolean}} */
  const options = { home: homedir(), json: false };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") {
      options.json = true;
      continue;
    }
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    if (token === "--home") options.home = value;
    else if (token === "--version") {
      if (!/^\d+\.\d+\.\d+$/u.test(value)) throw new Error("--version must use semantic versioning (major.minor.patch)");
      options.version = value;
    }
    else if (token === "--source-commit") options.sourceCommit = value;
    else if (token === "--source-root") options.sourceRoot = value;
    else if (token === "--evidence") options.evidence = value;
    else if (token === "--workflow") options.workflow = value;
    else if (token === "--mode") options.mode = value;
    else if (token === "--request") options.request = value;
    else if (token === "--terminal-slice") options.terminalSlice = value;
    else if (token === "--operation") options.lifecycleOperation = value;
    else if (token === "--plan") options.plan = value;
    else if (token === "--repository") options.repository = value;
    else if (token === "--confirm") options.confirm = value;
    else if (token === "--input") options.input = value;
    else if (token === "--projects-root") options.projectsRoot = value;
    else if (token === "--codex-path") options.codexPath = value;
    else if (token === "--node-path") options.nodePath = value;
    else if (token === "--root") options.root = value;
    else if (token === "--during-active-runs") options.duringActiveRuns = value;
    else throw new Error(`Unknown option: ${token}`);
    index += 1;
  }

  return { command, options };
}

/** @param {Record<string, unknown>} result */
function formatHuman(result) {
  if (result.operation === "jev-workflow") return `Jev workflow: ${result.status}.`;
  if (result.operation === "jev-workflow-measure") return `Workflow measurement written to ${result.output}.`;
  if (result.operation === "validate-atom-plan") return `Atom plan: ${result.status}.`;
  if (result.operation === "record-provider-failure") return `Provider failure cached for ${result.candidateId} until ${result.expiresAt}.`;
  if (result.operation === "setup") return `Development System ${result.version} and skill catalog ${result.catalogVersion} installed. Run audit and audit-skills to inspect installation state.`;
  if (result.operation === "shared-installation-audit" || result.operation === "update") {
    const active = /** @type {{packageVersion?: string, catalogVersion?: string, sourceCommit?: string} | undefined} */ (result.active);
    const problems = Array.isArray(result.problems) ? result.problems : [];
    const shared = /** @type {{sourceCommit?: string} | undefined} */ (result.shared);
    const label = result.operation === "update"
      ? `Development System ${result.version} (catalog ${result.catalogVersion ?? "unknown"}, ${String(shared?.sourceCommit ?? "unknown").slice(0, 12)}) installed`
      : `Development System ${active?.packageVersion ?? "unknown"} (catalog ${active?.catalogVersion ?? "unknown"}, ${String(active?.sourceCommit ?? "unknown").slice(0, 12)})`;
    const quota = /** @type {ReturnType<typeof codexQuota> | undefined} */ (result.codexQuota);
    const quotaLines = !quota ? "" : quota.state === "desconocido"
      ? "\nCodex weekly quota: desconocido (no rate limits in recent sessions)."
      : `\nCodex weekly quota:${quota.accounts.map((item) => `\n- ${item.account}${item.plan ? ` (${item.plan})` : ""}: ${item.usedPercent}% used, observed ${item.observedAt} [${item.freshness}]${item.resetsAt ? `, resets ${item.resetsAt}` : ""}${item.warn ? " WARNING >= 80%" : ""}`).join("")}`;
    return `${label}: ${result.ok ? "healthy" : "problems found"}.${problems.length ? `\n- ${problems.join("\n- ")}` : ""}${quotaLines}`;
  }
  if (result.operation === "install") {
    return `Installed Development System ${result.version} from ${result.sourceCommit}.`;
  }
  if (result.operation === "rollback") {
    return `Rolled back Development System from ${result.fromVersion} to ${result.toVersion ?? "the pre-install state"}.`;
  }
  if (result.operation === "rollback-skills") return "Rolled back the latest skill synchronization.";
  if (result.operation === "sync-skills") {
    return `Synchronized ${result.logicalSkillCount} logical skills with reversible cleanup.`;
  }
  if (result.operation === "audit-skills") return `Skill catalog ${result.status}.`;
  if (result.operation === "guardrails-enable" || result.operation === "guardrails-audit") {
    const problems = Array.isArray(result.problems) ? result.problems : [];
    return `Global guardrails ${result.status}.${problems.length ? `\n- ${problems.join("\n- ")}` : ""}`;
  }
  if (result.operation === "guardrails-rollback") return "Restored the prior global hook configuration.";
  if (result.operation === "claude-orchestration-enable") return `Claude orchestration ${result.status}${result.changed ? "" : " (unchanged)"}.`;
  if (result.operation === "claude-orchestration-audit") return `Claude orchestration ${result.status}.`;
  if (result.operation === "claude-orchestration-rollback") return `Claude orchestration rollback ${result.status}.`;
  if (result.operation === "report-gate-enable") return `Report gate ${result.status}${result.changed ? "" : " (unchanged)"}.`;
  if (result.operation === "report-gate-audit") return `Report gate ${result.status}.`;
  if (result.operation === "report-gate-rollback") return `Report gate rollback ${result.status}.`;
  if (result.operation === "check-no-tests") {
    const findings = /** @type {{path: string, kind: string, detail: string}[]} */ (Array.isArray(result.findings) ? result.findings : []);
    if (findings.length === 0) return `No automated tests found in ${result.root}.`;
    return [`${findings.length} automated test findings in ${result.root}:`, ...findings.map((finding) => `- ${finding.path} [${finding.kind}] ${finding.detail}`)].join("\n");
  }
  if (result.operation === "lifecycle-request") {
    const transition = /** @type {{status?: string, operation?: string} | undefined} */ (result.transition);
    return `Lifecycle transition ${transition?.status}: ${transition?.operation ?? result.selectedStage ?? "none"}.`;
  }
  if (result.operation === "lifecycle-execute") {
    const execution = /** @type {{status?: string, operation?: string} | undefined} */ (result.execution);
    return `Lifecycle operation ${execution?.status}: ${execution?.operation}.`;
  }
  if (result.operation === "lifecycle-status") {
    const state = /** @type {{workflowId?: string, stage?: string} | undefined} */ (result.state);
    return `Lifecycle ${state?.workflowId} is ${state?.stage}.`;
  }
  if (result.operation === "implement-preview") {
    return `Implement Preview ${result.status}; human decision required before promotion.`;
  }
  if (result.operation === "document") {
    return `Technical ${result.kind} document generated at ${result.htmlPath}. Editorial evidence only; no workflow authority granted.`;
  }
  if (result.operation === "working-backwards") {
    const profile = result.profile;
    const selected = profile && typeof profile === "object" && "selected" in profile
      ? profile.selected
      : "Standard";
    return `Working Backwards ${selected}; human gates remain required.`;
  }
  if (result.operation === "prepare-ticket-publication") return `Working Backwards publication intent ${result.ok ? "ready for separate authorization" : "blocked"}.`;
  if (result.operation === "t3-implementation-handoff") return "Private T3 handoff created; Implement Preview remains required.";
  if (result.operation === "working-backwards-handoff-freshness") return `T3 handoff ${result.fresh ? "fresh" : "requires refresh"}.`;
  if (result.operation === "working-backwards-evaluation") return result.ok === true && result.recommendation === "bounded-live-pilot-only"
    ? "Working Backwards evaluation recommends a bounded live pilot only."
    : "Working Backwards evaluation is not ready for a pilot.";
  if (result.operation === "working-backwards-humanlayer") return "HumanLayer supplied snapshot recorded as unverified input without granting lifecycle authority.";
  if (result.operation === "definition-route") return `Definition route: ${result.currentStage}; ${result.nextAction}.`;
  if (result.operation === "visual-grill-route") return `Visual grill route: ${result.mode}; ${Array.isArray(result.requiredFlow) ? result.requiredFlow.join(" → ") : "no visual flow"}.`;
  if (result.operation === "development-run") {
    const identity = result.identity && typeof result.identity === "object" ? result.identity : {};
    const speed = result.speed && typeof result.speed === "object" ? result.speed : {};
    const functionalEvidence = "functionalEvidence" in speed && speed.functionalEvidence && typeof speed.functionalEvidence === "object" ? speed.functionalEvidence : {};
    return `Development run ${"runId" in identity ? identity.runId : "unknown"}: ${result.valid ? "valid" : "invalid"}; functional evidence ${"status" in functionalEvidence ? functionalEvidence.status : "unproven"}.`;
  }
  if (result.operation === "orchestrator-pilot") return `Orchestrator pilot: ${String(result.decision ?? "unproven")}; read-only evidence.`;
  if (result.operation === "orchestration-plan") return `Orchestration plan: ${result.valid ? String(result.mode) : "blocked"}; no side effects.`;
  if (result.operation === "parallel-work") {
    const activeLaneCount = Array.isArray(result.activeLanes) ? result.activeLanes.length : 0;
    const frontierCount = Array.isArray(result.frontier) ? result.frontier.length : 0;
    return `Parallel Work: ${activeLaneCount} active lanes; ${frontierCount} frontier tickets; ${String(result.nextAction ?? "inspect the plan")}.`;
  }
  if (result.operation === "release-train-v2") {
    const outcome = result.outcome && typeof result.outcome === "object" ? result.outcome : {};
    return `Release Train v2: ${result.valid ? "valid" : "blocked"}; preview ${"preview" in outcome ? outcome.preview : "unproven"}; production ${"production" in outcome ? outcome.production : "unproven"}.`;
  }
  if (result.operation === "check-in") {
    const actions = Array.isArray(result.actions) ? result.actions.length : 0;
    return `Check-in: ${String(result.summary ?? "sin resumen")}; ${actions} acciones humanas.`;
  }
  if (result.operation === "linear-hygiene-audit") {
    const preview = Array.isArray(result.cleanupPreview) ? result.cleanupPreview.length : 0;
    return `Linear hygiene: ${result.valid ? "valid" : "blocked"}; ${preview} cleanup changes previewed; no writes applied.`;
  }
  if (result.operation === "development-steward") {
    const report = result.report && typeof result.report === "object" ? result.report : {};
    return `Development Steward: ${"summary" in report ? report.summary : "report unproven"}`;
  }
  if (result.operation === "development-steward-scheduler") {
    return `Development Steward scheduler: ${String(result.status ?? "unproven")}.`;
  }
  if (result.operation === "posthog-observability-audit") {
    const findings = Array.isArray(result.findings) ? result.findings.length : 0;
    return `PostHog observability: ${String(result.status ?? "unproven")}; ${findings} findings; no live writes.`;
  }
  if (result.operation === "audit-convex-guardian") {
    const findings = Array.isArray(result.findings) ? result.findings.length : 0;
    return `Convex Guardian: ${String(result.status ?? "unproven")}; ${findings} findings; read-only.`;
  }
  if (result.operation === "audit-repository") {
    return `Product repository ${result.status}; no files were changed.`;
  }
  if (result.operation === "initialize-repository" || result.operation === "normalize-repository") {
    return `Product repository ${result.status} by ${result.operation}.`;
  }
  const label = result.operation === "validate-repository" ? "Repository" : "Installation";
  return `${label} ${result.status}.`;
}

/** @param {string[]} argv */
function parseMistakeArguments(argv) {
  const [command, subcommand, ...tokens] = argv;
  const kind = command === "friction" ? "friction" : "mistake";
  const subcommands = kind === "mistake" ? ["add", "list", "annotate"] : ["add", "list"];
  if (!subcommands.includes(subcommand)) throw new Error(`Usage: development-system ${kind} <${subcommands.join("|")}> [options]`);
  /** @type {{kind: "mistake" | "friction", subcommand: "add" | "list" | "annotate", home: string, json: boolean, repeated: boolean, newId: boolean, by?: string, line?: string, id?: string, incident?: string, evidence?: string, summary?: string, fix?: string, control?: string, repository?: string, topic?: string, cause?: string}} */
  const options = { kind, subcommand: /** @type {"add" | "list" | "annotate"} */ (subcommand), home: homedir(), json: false, repeated: false, newId: false };
  /** @type {Record<string, string>} */
  const valueFlags = subcommand === "add"
    ? { "--home": "home", "--id": "id", "--incident": "incident", "--evidence": "evidence", "--summary": "summary", "--fix": "fix", "--control": "control", "--repository": "repository", "--topic": "topic", "--cause": "cause" }
    : subcommand === "annotate"
      ? { "--home": "home", "--line": "line", "--topic": "topic", "--cause": "cause" }
      : { "--home": "home", ...(kind === "mistake" ? { "--by": "by" } : {}) };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") { options.json = true; continue; }
    if (token === "--repeated" && subcommand === "list" && kind === "mistake") { options.repeated = true; continue; }
    if (token === "--new-id" && subcommand === "add") { options.newId = true; continue; }
    const key = /** @type {Record<string, string>} */ (valueFlags)[token];
    if (!key) throw new Error(`Unknown option for ${kind} ${subcommand}: ${token}`);
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    /** @type {Record<string, unknown>} */ (options)[key] = value;
    index += 1;
  }
  if (options.by !== undefined && !["id", "cause", "topic"].includes(options.by)) throw new Error("--by must be id, cause or topic");
  if (options.line !== undefined && !/^[1-9][0-9]*$/.test(options.line)) throw new Error("--line must be a positive line number of the mistake log");
  return options;
}

/** @param {string[]} argv */
function parseEvidenceArguments(argv) {
  const [, subcommand, ...tokens] = argv;
  if (subcommand !== "record") throw new Error(`Usage: development-system evidence record ${EVIDENCE_USAGE}`);
  /** @type {{home: string, json: boolean, captures: string[], [key: string]: unknown}} */
  const options = { home: homedir(), json: false, captures: [] };
  /** @type {Record<string, string>} */
  const valueFlags = { "--home": "home", "--pr": "pr", "--verified-sha": "verifiedSha", "--deployed-sha": "deployedSha", "--environment": "environment", "--account": "account", "--role": "role", "--allowed": "allowed", "--denied": "denied", "--effects": "effects", "--exception": "exception", "--reason": "reason", "--checks": "checks", "--owner-waiver": "ownerWaiver", "--platforms": "platforms" };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") { options.json = true; continue; }
    const value = tokens[index + 1];
    if (token === "--capture") {
      if (value === undefined || value.startsWith("--")) throw new Error("Missing value for --capture");
      options.captures.push(value); index += 1; continue;
    }
    const key = valueFlags[token];
    if (!key) throw new Error(`Unknown option for evidence record: ${token}`);
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    options[key] = value;
    index += 1;
  }
  return /** @type {{home: string, json: boolean, captures: string[], pr?: string, verifiedSha?: string, deployedSha?: string, environment?: string, account?: string, role?: string, allowed?: string, denied?: string, effects?: string, exception?: string, reason?: string, checks?: string, ownerWaiver?: string, platforms?: string}} */ (options);
}

/** @param {Record<string, unknown>} result */
function formatMistake(result) {
  if (result.operation === "mistake-annotate") {
    const annotation = /** @type {{line: number, topic?: string, cause?: string}} */ (result.annotation);
    return `Annotated mistake log line ${annotation.line}${annotation.topic ? ` topic ${annotation.topic}` : ""}${annotation.cause ? ` cause ${annotation.cause}` : ""}.`;
  }
  const kind = String(result.operation).startsWith("friction") ? "friction" : "mistake";
  if (String(result.operation).endsWith("-add")) {
    return result.status === "duplicate"
      ? `${kind === "friction" ? "Friction" : "Mistake"} ${result.id} incident ${result.incident} already recorded.`
      : `Recorded ${kind} ${result.id} (${result.incidents} distinct incidents).`;
  }
  const mistakes = /** @type {{id: string, ids?: string[], incidents: string[], summary: string | null, hint?: string}[]} */ (Array.isArray(result.mistakes) ? result.mistakes : []);
  const rejected = /** @type {{line: number, reason: string}[]} */ (Array.isArray(result.rejectedAnnotations) ? result.rejectedAnnotations : []);
  const warnings = rejected.map((item) => `Rejected annotation for line ${item.line}: ${item.reason}.`);
  if (mistakes.length === 0) return [result.repeated ? "No repeated mistakes recorded." : `No ${kind === "friction" ? "frictions" : "mistakes"} recorded.`, ...warnings].join("\n");
  return [...mistakes.flatMap((mistake) => [
    `${mistake.id}: ${mistake.incidents.length} incidents — ${mistake.summary ?? "no summary"}`,
    ...(mistake.ids && (mistake.ids.length > 1 || mistake.ids[0] !== mistake.id) ? [`  ids: ${mistake.ids.join(", ")}`] : []),
    ...(mistake.hint ? [`  ${mistake.hint}`] : []),
  ]), ...warnings].join("\n");
}

/** @param {string[]} argv */
function parseThreadHealthArguments(argv) {
  /** @type {{home: string, json: boolean, idleMinutes: number, session?: string, thread?: string, since?: string}} */
  const options = { home: homedir(), json: false, idleMinutes: 20 };
  const valueFlags = { "--home": "home", "--session": "session", "--thread": "thread", "--since": "since", "--idle-minutes": "idleMinutes" };
  const tokens = argv.slice(1);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") { options.json = true; continue; }
    const key = /** @type {Record<string, string>} */ (valueFlags)[token];
    if (!key) throw new Error(`Unknown option for thread-health: ${token}`);
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    /** @type {Record<string, unknown>} */ (options)[key] = key === "idleMinutes" ? Number(value) : value;
    index += 1;
  }
  return options;
}

const EVIDENCE_USAGE = "--pr <ref> --verified-sha <sha> (--deployed-sha <sha> --environment <url> --allowed pass|fail --denied pass|fail --effects pass|fail | --exception nonvisual --reason <text> --checks <text> | --owner-waiver <owner's exact words>) [--platforms ios,android,web] [--account <a>] [--role <r>] [--capture <path>]... [--home <dir>] [--json]";
const PR_REVIEW_USAGE = "<owner/repo#number | PR URL> [--request] [--gate] [--home <dir>] [--json]";
const COMMON_OPTIONS = "[--home <dir>] [--json]";

const GOVERNANCE_INPUT = "[--home <abs dir>] [--run <id>] (--input <file> | --input-json <json>) [--json]";
/** Governance subcommands and usage; the dispatcher rejects any subcommand absent here. */
/** @type {[string, string][]} */
const GOVERNANCE_TABLE = [
  ["begin", GOVERNANCE_INPUT],
  ["preflight", GOVERNANCE_INPUT],
  ["classify", GOVERNANCE_INPUT],
  ["prepare", `--boundary <id> ${GOVERNANCE_INPUT}`],
  ["status", "[--home <abs dir>] [--run <id>] [--json]"],
  ["advance", GOVERNANCE_INPUT],
  ["confirm-effort", GOVERNANCE_INPUT],
  ["close", GOVERNANCE_INPUT],
  ["recover", `--run <id> ${GOVERNANCE_INPUT}`],
  ["recover-host-attempt", `--run <id> ${GOVERNANCE_INPUT}`],
  ["execute", GOVERNANCE_INPUT],
  ["help", "[<command>] [--home <abs dir>] [--json]"],
  ["schema", "[<command>] [--home <abs dir>] [--json]"],
  ["examples", "[<command>] [--home <abs dir>] [--json]"],
].map(([name, usage]) => [`governance ${name}`, usage]);

const BROWSER_POOL_INPUT = "--input <file> [--home <dir>] [--json]";
/** Browser-pool operations and usage; the dispatcher rejects any operation absent here. */
/** @type {[string, string][]} */
const BROWSER_POOL_TABLE = [
  ["inventory", "[--home <dir>] [--json]"],
  ["status", "[--home <dir>] [--json]"],
  ["register", BROWSER_POOL_INPUT],
  ["unregister", BROWSER_POOL_INPUT],
  ["acquire", BROWSER_POOL_INPUT],
  ["release", BROWSER_POOL_INPUT],
  ["quarantine", BROWSER_POOL_INPUT],
  ["reconcile", BROWSER_POOL_INPUT],
].map(([name, usage]) => [`browser-pool ${name}`, usage]);

/** Single registry of command paths and usage lines; drives `commands` and `--help`. Nested commands list each leaf path. */
/** @type {[string, string][]} */
const COMMAND_TABLE = [
  ["setup", `[--version <x.y.z>] [--source-root <dir>] [--during-active-runs <who>] ${COMMON_OPTIONS}`],
  ["update", `[--version <x.y.z>] [--source-root <dir>] [--during-active-runs <who>] ${COMMON_OPTIONS}`],
  ["doctor", COMMON_OPTIONS],
  ["shared-audit", COMMON_OPTIONS],
  ["recover-shared", COMMON_OPTIONS],
  ["install", `[--version <x.y.z>] [--source-commit <sha>] [--source-root <dir>] ${COMMON_OPTIONS}`],
  ["audit", `[--version <x.y.z>] ${COMMON_OPTIONS}`],
  ["validate", `[--version <x.y.z>] ${COMMON_OPTIONS}`],
  ["rollback", COMMON_OPTIONS],
  ...GOVERNANCE_TABLE,
  ["governance-hooks-enable", COMMON_OPTIONS],
  ["governance-hooks-audit", COMMON_OPTIONS],
  ["governance-hooks-rollback", COMMON_OPTIONS],
  ["audit-skills", `[--version <x.y.z>] ${COMMON_OPTIONS}`],
  ["sync-skills", `[--version <x.y.z>] ${COMMON_OPTIONS}`],
  ["rollback-skills", COMMON_OPTIONS],
  ["guardrails-enable", COMMON_OPTIONS],
  ["guardrails-audit", COMMON_OPTIONS],
  ["guardrails-rollback", COMMON_OPTIONS],
  ["claude-orchestration-enable", COMMON_OPTIONS],
  ["claude-orchestration-audit", COMMON_OPTIONS],
  ["claude-orchestration-rollback", COMMON_OPTIONS],
  ["report-gate-enable", COMMON_OPTIONS],
  ["report-gate-audit", COMMON_OPTIONS],
  ["report-gate-rollback", COMMON_OPTIONS],
  ["check-no-tests", `[--root <dir>] ${COMMON_OPTIONS}`],
  ["allow-tests", "<directory> [--hours N] [--reason text] | --revoke <directory> [--home <dir>] [--json]"],
  ["test-grants", COMMON_OPTIONS],
  ["allow-docs", "<repo> --task <slug> [--hours N] [--reason text] | --revoke <repo> [--home <dir>] [--json]"],
  ["docs-grants", COMMON_OPTIONS],
  ["check-agents-rules", "[<file>...] [--base <ref>] [--head <ref>] [--root <dir>] [--allow <rule>]... [--threshold N] [--json]"],
  ["check-lint-floor", "[--root <dir>] [--snapshot <file> | --write <file>] [--allow <rule>]... [--json]"],
  ["mistake add", "--id <slug> --incident <ref> --evidence <ref> [--summary <text>] [--fix <text>] [--control <text>] [--repository <repo>] [--topic <t>] [--cause <slug>] [--new-id] [--home <dir>] [--json]"],
  ["mistake list", "[--repeated] [--by id|cause|topic] [--home <dir>] [--json]"],
  ["mistake annotate", "--line <n> [--topic <t>] [--cause <slug>] [--home <dir>] [--json]"],
  ["friction add", "--id <slug> --incident <ref> --evidence <ref> [--summary <text>] [--fix <text>] [--control <text>] [--repository <repo>] [--topic <t>] [--cause <slug>] [--new-id] [--home <dir>] [--json]"],
  ["friction list", COMMON_OPTIONS],
  ["evidence record", EVIDENCE_USAGE],
  ["review record", "--pr <ref> --reviewer sol --head <sha> --scope full|fix-diff --result blocking|non-blocking|none --thread <id> [--finding <id>:<path>[+<path>]]... [--operator-approval <operator's exact words> (a full round past the second)] | --exempt docs-only|low-risk --reason <text> [--home <dir>] [--json]"],
  ["review coverage", "--pr <ref> --from <sha> --to <sha> --findings <id,...> --verdict fix-only|out-of-scope --note <text> [--home <dir>] [--json]"],
  ["check-primitives", "[--root <dir>] [--ref <ref>] [--file <path>] [--json]"],
  ["pr-review-status", PR_REVIEW_USAGE],
  ["thread-health", "[--session <id>] [--thread <id>] [--since <time>] [--idle-minutes N] [--home <dir>] [--json]"],
  ...BROWSER_POOL_TABLE,
  ["commands", "[--json]"],
  ["validate-repository", `[--root <dir>] ${COMMON_OPTIONS}`],
  ["audit-repository", `[--repository <dir>] ${COMMON_OPTIONS}`],
  ["initialize-repository", `[--repository <dir>] ${COMMON_OPTIONS}`],
  ["normalize-repository", `[--repository <dir>] ${COMMON_OPTIONS}`],
  ["lifecycle-request", `--workflow <id> --request <text> [options] ${COMMON_OPTIONS}`],
  ["lifecycle-execute", `--workflow <id> --operation <op> [options] ${COMMON_OPTIONS}`],
  ["lifecycle-status", `--workflow <id> ${COMMON_OPTIONS}`],
  ["implement-preview", `[options] ${COMMON_OPTIONS}`],
  ["document", `--input <file> ${COMMON_OPTIONS}`],
  ["run-worker", "[options]"],
  ["definition-route", `--input <file> ${COMMON_OPTIONS}`],
  ["visual-grill-route", `--input <file> ${COMMON_OPTIONS}`],
  ["development-run", `--input <file> ${COMMON_OPTIONS}`],
  ["orchestrator-pilot", `--input <file> ${COMMON_OPTIONS}`],
  ["orchestration-plan", `--input <file> ${COMMON_OPTIONS}`],
  ["advisory-status", "[options]"],
  ["classify-atom", "[options]"],
  ["record-route-decision", "[options]"],
  ["jev-workflow-measure", `--input <file> ${COMMON_OPTIONS}`],
  ["validate-atom-plan", `--input <file> ${COMMON_OPTIONS}`],
  ["verify-path-confinement", `--input <file> ${COMMON_OPTIONS}`],
  ["model-route", `[options] ${COMMON_OPTIONS}`],
  ["record-provider-failure", `[options] ${COMMON_OPTIONS}`],
  ["parallel-work", `--input <file> ${COMMON_OPTIONS}`],
  ["work-multiple", `--input <file> ${COMMON_OPTIONS}`],
  ["release-train-v2", `--input <file> ${COMMON_OPTIONS}`],
  ["check-in", `--input <file> ${COMMON_OPTIONS}`],
  ["linear-hygiene", `--input <file> ${COMMON_OPTIONS}`],
  ["development-steward", `--input <file> ${COMMON_OPTIONS}`],
  ["development-steward-schedule-enable", `[options] ${COMMON_OPTIONS}`],
  ["development-steward-schedule-audit", COMMON_OPTIONS],
  ["development-steward-schedule-disable", COMMON_OPTIONS],
  ["posthog-observability", `--input <file> ${COMMON_OPTIONS}`],
  ["convex-guardian", `--input <file> ${COMMON_OPTIONS}`],
  ["working-backwards", `--input <file> ${COMMON_OPTIONS}`],
  ["working-backwards-publication-intent", `--input <file> ${COMMON_OPTIONS}`],
  ["working-backwards-t3-handoff", `--input <file> ${COMMON_OPTIONS}`],
  ["working-backwards-handoff-freshness", `--input <file> ${COMMON_OPTIONS}`],
  ["working-backwards-evaluate", `--input <file> ${COMMON_OPTIONS}`],
  ["working-backwards-humanlayer", `--input <file> ${COMMON_OPTIONS}`],
];

/** Command groups whose leaf subcommands are listed individually, so `mistake --help` still resolves. */
const COMMAND_GROUPS = ["mistake", "friction", "evidence", "review", "governance", "browser-pool"];

function topLevelUsage() {
  const names = [...new Set(COMMAND_TABLE.map(([path]) => path.split(" ")[0]))];
  return `Usage: development-system <${names.join("|")}> [options]`;
}

/**
 * Help for `<path...> --help|-h`, answered before any validation or side effect.
 * @param {string[]} argv
 * @returns {string | undefined}
 */
function helpFor(argv) {
  if (!argv.includes("--help") && !argv.includes("-h")) return undefined;
  /** @type {string[]} */
  const words = [];
  for (const arg of argv) { if (arg.startsWith("-")) break; words.push(arg); }
  if (words.length === 0) return topLevelUsage();
  for (let length = Math.min(words.length, 2); length >= 1; length -= 1) {
    const path = words.slice(0, length).join(" ");
    const entry = COMMAND_TABLE.find(([candidate]) => candidate === path);
    if (entry) return `Usage: development-system ${entry[0]} ${entry[1]}`;
  }
  if (COMMAND_GROUPS.includes(words[0])) {
    const leaves = COMMAND_TABLE.filter(([path]) => path.startsWith(`${words[0]} `)).map(([path]) => path.slice(words[0].length + 1));
    return `Usage: development-system ${words[0]} <${leaves.join("|")}> [options]`;
  }
  return topLevelUsage();
}

/**
 * Installing while agent runs are active changes their instructions mid-run. setup, update and install stop when a
 * T3 run is active or its state is unknown, listing the threads; `--during-active-runs <who>` records who accepted
 * the concurrency and continues. It acknowledges the overlap only; it never authorizes the installation itself.
 * @param {{home: string, operation: string, version?: string, acceptedBy?: string}} options
 */
async function guardActiveRuns({ home, operation, version, acceptedBy }) {
  const { activeRuns } = await import("./t3-state.mjs");
  const exclude = [process.env.CLAUDE_CODE_SESSION_ID ?? "", process.env.CODEX_THREAD_ID ?? ""];
  const observed = activeRuns({ home, exclude });
  const event = { at: new Date().toISOString(), operation, version: version ?? null, state: observed.state, reason: observed.reason, threads: observed.threads.map((run) => run.threadId), acceptedBy: acceptedBy ?? null };
  const ledger = resolve(home, ".development-system/private/runs/installs.jsonl");
  await mkdir(dirname(ledger), { recursive: true, mode: 0o700 });
  await appendFile(ledger, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  if (observed.state === "terminated" || acceptedBy) return observed;
  const listed = [...new Set(observed.threads.map((run) => `${run.threadId} (${run.status})`))].slice(0, 12).join(", ");
  throw new Error(`${operation} stopped: T3 runs are ${observed.state} (${observed.reason})${listed ? `: ${listed}` : ""}. Wait for them to finish, or rerun with --during-active-runs <who accepted> to record the overlap; that flag does not authorize the installation.`);
}

/** @param {string[]} argv */
export async function run(argv) {
  const help = helpFor(argv);
  if (help !== undefined) return { result: { ok: true, operation: "help" }, output: help, json: false };
  const standaloneMutators = ["install", "sync-skills", "rollback-skills", "guardrails-enable", "guardrails-rollback", "claude-orchestration-enable", "claude-orchestration-rollback", "report-gate-enable", "report-gate-rollback", "governance-hooks-enable", "governance-hooks-rollback"];
  if (standaloneMutators.includes(argv[0])) {
    const { options } = parseArguments(argv);
    return withLegacyInstallationMutation({ home: options.home, operation: argv[0], run: () => runCommand(argv) });
  }
  return runCommand(argv);
}

/** The command table is the dispatcher's accepted subcommand list for grouped commands. @param {string[]} argv */
function rejectUnlistedSubcommand(argv) {
  const sub = argv[1];
  if (sub === undefined || sub.startsWith("-")) return;
  if (!COMMAND_TABLE.some(([path]) => path === `${argv[0]} ${sub}`)) throw new Error(`Unknown ${argv[0]} subcommand: ${sub}`);
}

/** @param {string[]} argv */
async function runCommand(argv) {
  if (argv[0] === "browser-pool") {
    rejectUnlistedSubcommand(argv);
    const { runBrowserPool } = await import("../runtime/native-browser/cli.mjs");
    return runBrowserPool(argv.slice(1));
  }
  if (argv[0] === "thread-health") {
    const { json, ...options } = parseThreadHealthArguments(argv);
    const result = threadHealth(options);
    return { result, output: json ? JSON.stringify(result) : formatThreadHealth(result), json };
  }
  if (argv[0] === "check-agents-rules" || argv[0] === "check-lint-floor") {
    const json = argv.includes("--json");
    /** @type {string[]} */
    const allow = [], files = [];
    /** @type {Record<string, string>} */
    const values = {};
    for (let index = 1; index < argv.length; index += 1) {
      const arg = argv[index];
      if (arg === "--json") continue;
      if (["--base", "--head", "--root", "--snapshot", "--write", "--threshold"].includes(arg)) { values[arg.slice(2)] = argv[++index]; continue; }
      if (arg === "--allow") { allow.push(argv[++index]); continue; }
      if (arg.startsWith("--")) throw new Error(`Unknown option for ${argv[0]}: ${arg}`);
      files.push(arg);
    }
    const root = resolve(values.root ?? process.cwd());
    if (argv[0] === "check-agents-rules") {
      const { checkAgentsRules, formatAgentsRules } = await import("./agents-rules.mjs");
      const result = { ok: true, ...checkAgentsRules({ root, base: values.base, head: values.head, files, allow, threshold: values.threshold ? Number(values.threshold) : undefined }) };
      result.ok = result.valid;
      return { result, output: json ? JSON.stringify(result) : formatAgentsRules(result), json };
    }
    const { checkLintFloor, formatLintFloor } = await import("./lint-floor.mjs");
    const result = { ok: true, ...checkLintFloor({ root, snapshot: values.snapshot && resolve(values.snapshot), write: values.write && resolve(values.write), allow }) };
    result.ok = result.valid;
    return { result, output: json ? JSON.stringify(result) : formatLintFloor(result), json };
  }
  if (argv[0] === "allow-tests" || argv[0] === "test-grants") {
    const json = argv.includes("--json");
    /** @type {Record<string, string>} */
    const values = {};
    /** @type {string[]} */
    const roots = [];
    let revoke = false;
    for (let index = 1; index < argv.length; index += 1) {
      const arg = argv[index];
      if (arg === "--json") continue;
      if (arg === "--revoke" && argv[0] === "allow-tests") { revoke = true; continue; }
      if (["--home", "--hours", "--reason"].includes(arg) && (arg === "--home" || argv[0] === "allow-tests")) {
        const value = argv[++index];
        if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
        values[arg.slice(2)] = value;
        continue;
      }
      if (arg.startsWith("--") || argv[0] === "test-grants") throw new Error(`Unknown option for ${argv[0]}: ${arg}`);
      roots.push(arg);
    }
    const { allowTests, confirmOperatorGrant, listTestGrants, formatTestGrants } = await import("./test-grants.mjs");
    const home = values.home ?? homedir();
    if (argv[0] === "allow-tests" && roots.length !== 1) throw new Error("Usage: development-system allow-tests <directory> [--hours N] [--reason text] | --revoke <directory>");
    const result = argv[0] === "allow-tests"
      ? await allowTests({ home, root: roots[0], hours: values.hours === undefined ? undefined : Number(values.hours), reason: values.reason, revoke, confirm: confirmOperatorGrant })
      : listTestGrants({ home });
    return { result, output: json ? JSON.stringify(result) : formatTestGrants(result), json };
  }
  if (argv[0] === "commands") {
    const json = argv.includes("--json");
    const extra = argv.slice(1).find((arg) => arg !== "--json");
    if (extra !== undefined) throw new Error(`Unknown option for commands: ${extra}`);
    const paths = COMMAND_TABLE.map(([path]) => path);
    return { result: { ok: true, operation: "commands", commands: paths }, output: json ? JSON.stringify(paths) : paths.join("\n"), json };
  }
  if (argv[0] === "allow-docs" || argv[0] === "docs-grants") {
    const json = argv.includes("--json");
    /** @type {Record<string, string>} */
    const values = {};
    /** @type {string[]} */
    const roots = [];
    let revoke = false;
    for (let index = 1; index < argv.length; index += 1) {
      const arg = argv[index];
      if (arg === "--json") continue;
      if (arg === "--revoke" && argv[0] === "allow-docs") { revoke = true; continue; }
      if (["--home", "--hours", "--reason", "--task"].includes(arg) && (arg === "--home" || argv[0] === "allow-docs")) {
        const value = argv[++index];
        if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
        values[arg.slice(2)] = value;
        continue;
      }
      if (arg.startsWith("--") || argv[0] === "docs-grants") throw new Error(`Unknown option for ${argv[0]}: ${arg}`);
      roots.push(arg);
    }
    const { allowDocs, confirmOperatorDocsGrant, listDocsGrants, formatDocsGrants } = await import("./docs-grants.mjs");
    const home = values.home ?? homedir();
    if (argv[0] === "allow-docs" && (roots.length !== 1 || (!revoke && values.task === undefined))) throw new Error("Usage: development-system allow-docs <repo> --task <slug> [--hours N] [--reason text] | --revoke <repo>");
    const result = argv[0] === "allow-docs"
      ? await allowDocs({ home, root: roots[0], task: values.task, hours: values.hours === undefined ? undefined : Number(values.hours), reason: values.reason, revoke, confirm: confirmOperatorDocsGrant })
      : listDocsGrants({ home });
    return { result, output: json ? JSON.stringify(result) : formatDocsGrants(result), json };
  }
  if (argv[0] === "review") {
    const subcommand = argv[1];
    if (subcommand !== "record" && subcommand !== "coverage") throw new Error("Usage: development-system review <record|coverage> [options]");
    const json = argv.includes("--json");
    /** @type {Record<string, string>} */
    const valueFlags = subcommand === "record"
      ? { "--home": "home", "--pr": "pr", "--reviewer": "reviewer", "--head": "head", "--scope": "scope", "--result": "result", "--thread": "thread", "--exempt": "exempt", "--reason": "reason", "--operator-approval": "operatorApproval" }
      : { "--home": "home", "--pr": "pr", "--from": "from", "--to": "to", "--findings": "findings", "--verdict": "verdict", "--note": "note" };
    /** @type {Record<string, string>} */
    const values = {};
    /** @type {string[]} */
    const findings = [];
    for (let index = 2; index < argv.length; index += 1) {
      const arg = argv[index];
      if (arg === "--json") continue;
      const isFinding = arg === "--finding" && subcommand === "record";
      const key = valueFlags[arg];
      if (!key && !isFinding) throw new Error(`Unknown option for review ${subcommand}: ${arg}`);
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (isFinding) findings.push(value); else values[key] = value;
    }
    const home = values.home ?? homedir();
    const reviews = await import("./review-records.mjs");
    const result = subcommand === "record"
      ? await reviews.recordReview({ home, pr: values.pr, reviewer: values.reviewer, head: values.head, scope: values.scope, result: values.result, thread: values.thread, findings, exempt: values.exempt, reason: values.reason, operatorApproval: values.operatorApproval })
      : await reviews.recordCoverage({ home, pr: values.pr, from: values.from, to: values.to, findings: values.findings === undefined ? [] : values.findings.split(",").map((item) => item.trim()).filter(Boolean), verdict: values.verdict, note: values.note });
    return { result, output: json ? JSON.stringify(result) : reviews.formatReviewRecord(result), json };
  }
  if (argv[0] === "check-primitives") {
    const json = argv.includes("--json");
    /** @type {Record<string, string>} */
    const values = {};
    for (let index = 1; index < argv.length; index += 1) {
      const arg = argv[index];
      if (arg === "--json") continue;
      if (!["--root", "--ref", "--file"].includes(arg)) throw new Error(`Unknown option for check-primitives: ${arg}`);
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      values[arg.slice(2)] = value;
    }
    const { checkPrimitives, formatPrimitives } = await import("./primitives.mjs");
    const result = checkPrimitives({ root: resolve(values.root ?? process.cwd()), ref: values.ref, file: values.file });
    return { result, output: json ? JSON.stringify(result) : formatPrimitives(result), json };
  }
  if (argv[0] === "pr-review-status") {
    const json = argv.includes("--json");
    const request = argv.includes("--request");
    const gate = argv.includes("--gate");
    const homeIndex = argv.indexOf("--home");
    const home = homeIndex > 0 ? argv[homeIndex + 1] : homedir();
    const rest = homeIndex > 0 ? [...argv.slice(1, homeIndex), ...argv.slice(homeIndex + 2)] : argv.slice(1);
    const positional = rest.filter((arg) => !arg.startsWith("--"));
    if (!home || home.startsWith("--") || positional.length !== 1 || rest.some((arg) => arg.startsWith("--") && !["--json", "--request", "--gate"].includes(arg))) {
      throw new Error(`Usage: development-system pr-review-status ${PR_REVIEW_USAGE}`);
    }
    const { prReviewStatus, formatPrReviewStatus } = await import("./pr-review-status.mjs");
    const result = prReviewStatus({ pr: positional[0], request, gate, home });
    return { result, output: json ? JSON.stringify(result) : formatPrReviewStatus(result), json };
  }
  if (argv[0] === "evidence") {
    const { home, json, ...fields } = parseEvidenceArguments(argv);
    const { recordEvidence } = await import("./evidence.mjs");
    const result = recordEvidence({ home, ...fields });
    const output = json ? JSON.stringify(result) : `Evidence receipt ${result.status} for ${result.pr} at ${result.verifiedSha.slice(0, 12)}${result.problems.length ? ` (${result.problems.join("; ")})` : ""}: ${result.path}`;
    return { result, output, json };
  }
  if (argv[0] === "mistake" || argv[0] === "friction") {
    const { subcommand, home, json, repeated, kind, by, line, topic, cause, ...fields } = parseMistakeArguments(argv);
    const result = subcommand === "add"
      ? addMistake({ home, kind, topic, cause, ...fields })
      : subcommand === "annotate"
        ? annotateMistake({ home, line: Number(line), topic, cause })
        : listMistakes({ home, kind, repeated, by: /** @type {"id" | "cause" | "topic" | undefined} */ (by) });
    return { result, output: json ? JSON.stringify(result) : formatMistake(result), json };
  }
  if (argv[0] === "governance") {
    rejectUnlistedSubcommand(argv);
    const { runGovernance } = await import("../runtime/jev-governance/cli.mjs");
    return runGovernance(argv.slice(1));
  }
  if (["advisory-status", "classify-atom", "record-route-decision"].includes(argv[0])) {
    const { runAdvisory } = await import("../runtime/jev-advisory/cli.mjs");
    return runAdvisory([argv[0] === "advisory-status" ? "status" : argv[0], ...argv.slice(1)]);
  }
  const { command, options } = parseArguments(argv);
  let result;

  if (command === "shared-audit" || command === "doctor") {
    result = await auditSharedInstallation({ home: options.home, root: repositoryRoot });
    // Descriptive, separate from `ok`: a nearly spent Codex week is a warning, never an installation problem.
    if (command === "doctor") result = { ...result, codexQuota: codexQuota({ home: options.home }) };
  } else if (command === "recover-shared") {
    result = await rollbackSharedInstallation({ home: options.home, recover: true });
  } else if (command === "update") {
    await guardActiveRuns({ home: options.home, operation: "update", version: options.version, acceptedBy: options.duringActiveRuns });
    result = await updateSharedInstallation({ home: options.home, version: options.version, sourceRoot: options.sourceRoot, duringActiveRuns: options.duringActiveRuns });
  } else if (command === "setup") {
    await guardActiveRuns({ home: options.home, operation: "setup", version: options.version, acceptedBy: options.duringActiveRuns });
    if (!loadPackageSource(repositoryRoot)) {
      result = await updateSharedInstallation({ home: options.home, version: options.version, checkoutRoot: repositoryRoot, duringActiveRuns: options.duringActiveRuns });
      return { result, output: options.json ? JSON.stringify(result) : formatHuman(result), json: options.json };
    }
    const metadata = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
    const version = options.version ?? metadata.contractVersion ?? metadata.version;
    const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "manifests", `${version}.json`), "utf8"));
    const catalogArtifact = manifest.artifacts.find((/** @type {{logicalName: string}} */ artifact) => artifact.logicalName === "skill-catalog");
    if (!catalogArtifact) throw new Error(`Contract ${version} has no skill catalog`);
    const catalog = JSON.parse(await readFile(resolve(repositoryRoot, catalogArtifact.sourcePath), "utf8"));
    result = await setupSharedInstallation({ home: options.home, root: repositoryRoot, version, install: async () => {
      const installation = await installVersion({ home: options.home, version, sourceCommit: options.sourceCommit });
      let governance;
      if (executionMode(manifest) === "governed-hook-execution" && manifest.artifacts.some((/** @type {{logicalName:string}} */ artifact) => artifact.logicalName === "governance-runtime-hook-launcher-mjs")) {
        governance = await enableGovernanceHooks({ home: options.home });
      }
      const skills = await synchronizeSkillCatalog({ home: options.home, sourceRoot: repositoryRoot, sourceCommit: options.sourceCommit, catalog });
      // Activation belongs to this complete transaction; standalone mutators
      // cannot change the receipt or race a shared update.
      const guardrails = await enableGlobalGuardrails({ home: options.home });
      const claudeOrchestration = await enableClaudeOrchestration({ home: options.home });
      const reportGate = await enableReportGate({ home: options.home });
      return { operation: "setup", ok: true, version, catalogVersion: catalog.catalogVersion, installation, skills, guardrails, claudeOrchestration, reportGate, ...(governance ? { governance } : {}) };
    }});
  } else if (command === "install") {
    if (!options.version) throw new Error("install requires --version <semver>");
    await guardActiveRuns({ home: options.home, operation: "install", version: options.version, acceptedBy: options.duringActiveRuns });
    result = await installVersion({
      home: options.home,
      version: options.version,
      sourceCommit: options.sourceCommit,
    });
  } else if (command === "audit") {
    result = await auditInstallation({ home: options.home });
  } else if (command === "validate") {
    result = await validateInstallation({ home: options.home });
  } else if (command === "rollback") {
    if (existsSync(resolve(options.home, ".development-system/shared-installation.json")) || existsSync(resolve(options.home, ".development-system/shared-installation-pending.json"))) {
      result = await rollbackSharedInstallation({ home: options.home });
    } else {
    result = await withLegacyInstallationMutation({ home: options.home, operation: command, run: async () => {
      const installation = await auditInstallation({ home: options.home });
      if (installation.status === "unsafe") throw new Error(installation.problems.join("; "));
      return installation.executionMode === "advisory-parent-execution"
        ? await rollbackInstallation({ home: options.home })
        : await withGovernanceHookRollback({ home: options.home, rollback: () => rollbackInstallation({ home: options.home }) });
    }});
    }
  } else if (command === "audit-skills" || command === "sync-skills") {
    const catalog = await readSkillCatalog(options.version);
    if (command === "audit-skills") {
      const evidence = options.evidence
        ? JSON.parse(await readFile(resolve(options.evidence), "utf8"))
        : undefined;
      result = await auditSkillCatalog({ home: options.home, catalog, evidence });
    } else {
      result = await synchronizeSkillCatalog({
        home: options.home,
        sourceRoot: options.sourceRoot ?? repositoryRoot,
        sourceCommit: options.sourceCommit,
        catalog,
      });
    }
  } else if (command === "rollback-skills") {
    const catalog = await readSkillCatalog(options.version);
    result = await rollbackSkillSync({ home: options.home, catalog });
  } else if (command === "guardrails-enable") {
    result = await enableGlobalGuardrails({ home: options.home });
  } else if (command === "guardrails-audit") {
    result = await auditGlobalGuardrails({ home: options.home });
  } else if (command === "guardrails-rollback") {
    result = await rollbackGlobalGuardrails({ home: options.home });
  } else if (command === "claude-orchestration-enable") {
    result = await enableClaudeOrchestration({ home: options.home });
  } else if (command === "claude-orchestration-audit") {
    result = await auditClaudeOrchestration({ home: options.home });
  } else if (command === "claude-orchestration-rollback") {
    result = await rollbackClaudeOrchestration({ home: options.home });
  } else if (command === "report-gate-enable") {
    result = await enableReportGate({ home: options.home });
  } else if (command === "report-gate-audit") {
    result = await auditReportGate({ home: options.home });
  } else if (command === "report-gate-rollback") {
    result = await rollbackReportGate({ home: options.home });
  } else if (command === "check-no-tests") {
    result = findAutomatedTests({ root: options.root ?? process.cwd() });
  } else if (command === "governance-hooks-enable") {
    result = await enableGovernanceHooks({ home: options.home });
  } else if (command === "governance-hooks-audit") {
    result = await auditGovernanceHooks({ home: options.home });
  } else if (command === "governance-hooks-rollback") {
    result = await rollbackGovernanceHooks({ home: options.home });
  } else if (command === "validate-repository") {
    result = await validateRepository();
  } else if (command === "audit-repository") {
    if (!options.repository) throw new Error("audit-repository requires --repository <path>");
    const evidence = options.evidence
      ? JSON.parse(await readFile(resolve(options.evidence), "utf8"))
      : undefined;
    result = await auditRepository({ repository: options.repository, evidence });
  } else if (command === "initialize-repository") {
    if (!options.repository) throw new Error("initialize-repository requires --repository <path>");
    result = await initializeRepository({ repository: options.repository, confirm: options.confirm });
  } else if (command === "normalize-repository") {
    if (!options.repository) throw new Error("normalize-repository requires --repository <path>");
    result = await normalizeRepository({ repository: options.repository, confirm: options.confirm });
  } else if (command === "lifecycle-request") {
    if (!options.workflow) throw new Error("lifecycle-request requires --workflow <id>");
    if (!options.request) throw new Error("lifecycle-request requires --request <natural language>");
    if (options.mode !== "recommend" && options.mode !== "transition") {
      throw new Error("lifecycle-request requires --mode <recommend|transition>");
    }
    result = await runLifecycleRequest({
      home: options.home,
      workflowId: options.workflow,
      mode: options.mode,
      request: options.request,
      terminalSlice: options.terminalSlice,
    });
  } else if (command === "lifecycle-execute") {
    if (!options.workflow) throw new Error("lifecycle-execute requires --workflow <id>");
    if (!options.lifecycleOperation) {
      throw new Error("lifecycle-execute requires --operation <operation>");
    }
    result = await executeLifecycleOperation({
      home: options.home,
      workflowId: options.workflow,
      operation: options.lifecycleOperation,
    });
  } else if (command === "lifecycle-status") {
    if (!options.workflow) throw new Error("lifecycle-status requires --workflow <id>");
    result = {
      ok: true,
      operation: "lifecycle-status",
      state: await readLifecycleState({ home: options.home, workflowId: options.workflow }),
      externalSideEffects: [],
    };
  } else if (command === "implement-preview") {
    if (!options.workflow) throw new Error("implement-preview requires --workflow <id>");
    if (!options.plan) throw new Error("implement-preview requires --plan <path>");
    const plan = JSON.parse(await readFile(resolve(options.plan), "utf8"));
    result = {
      operation: "implement-preview",
      ...(await runImplementPreview({
        home: options.home,
        workflowId: options.workflow,
        plan,
        runtime: createCommandDeliveryRuntime(plan),
      })),
    };
  } else if (command === "run-worker") {
    if (!options.input) throw new Error("run-worker requires --input <json-path>");
    result = await runSupervisedWorker(JSON.parse(await readFile(resolve(options.input), "utf8")));
  } else if (command === "document") {
    if (!options.input) throw new Error("document requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    if (options.mode && options.mode !== "historical") throw new Error("document --mode only accepts historical");
    result = { operation: "document", ...(await writeTechnicalDocument({ home: options.home, input, historical: options.mode === "historical" })) };
  } else if (command === "definition-route") {
    if (!options.input) throw new Error("definition-route requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = routeDefinition(input);
  } else if (command === "visual-grill-route") {
    if (!options.input) throw new Error("visual-grill-route requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = routeVisualGrill(input);
  } else if (command === "development-run") {
    if (!options.input) throw new Error("development-run requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = buildDevelopmentRun(input);
  } else if (command === "orchestrator-pilot") {
    if (!options.input) throw new Error("orchestrator-pilot requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = evaluateOrchestrationPilot(input);
  } else if (command === "jev-workflow") {
    throw new Error("Historical controller disabled in Development System 1.24.0. Use classify-atom and record-route-decision with parent-owned execution; historical controllers require their original preserved package.");
  } else if (command === "jev-workflow-measure") {
    if (!options.input) throw new Error("jev-workflow-measure requires --input <private-execution-directory>");
    const { measureWorkflow } = await import("../scripts/measure-jev-workflow.mjs");
    const measurement = await measureWorkflow(resolve(options.input));
    result = { operation: "jev-workflow-measure", ok: true, ...measurement };
  } else if (command === "validate-atom-plan") {
    if (!options.plan) throw new Error("validate-atom-plan requires --plan <plan.json>");
    const { validateAtomPlan } = await import("./orchestration.mjs");
    const errors = validateAtomPlan(JSON.parse(await readFile(resolve(options.plan), "utf8")));
    result = { operation: "validate-atom-plan", ok: errors.length === 0, status: errors.length === 0 ? "valid" : "invalid", errors };
  } else if (command === "orchestration-plan") {
    if (!options.input) throw new Error("orchestration-plan requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = planOrchestration(input);
  } else if (command === "verify-path-confinement") {
    if (!options.input) throw new Error("verify-path-confinement requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = await verifyPathConfinement(input);
  } else if (command === "record-provider-failure") {
    if (!options.input) throw new Error("record-provider-failure requires --input <json-path>");
    result = await recordProviderFailure({ home: options.home, observation: JSON.parse(await readFile(resolve(options.input), "utf8")) });
  } else if (command === "model-route") {
    if (!options.input) throw new Error("model-route requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    const roster = input && typeof input === "object" && input.roster
      ? input.roster
      : options.version
        ? JSON.parse(await readFile(resolve(repositoryRoot, "config", options.version, existsSync(resolve(repositoryRoot, "config", options.version, "agent-roster.json")) ? "agent-roster.json" : "capability-roster.json"), "utf8"))
        : JSON.parse(await readFile(resolve(repositoryRoot, "config", "agent-roster.json"), "utf8"));
    // An explicit observation packet is authoritative for a reproducible route
    // decision. Otherwise reuse unexpired negative observations from this host.
    const unavailable = input.unavailable ?? await readProviderFailures(options.home);
    result = resolveModelRoute({ ...input, unavailable, roster });
  } else if (command === "parallel-work" || command === "work-multiple") {
    if (!options.input) throw new Error(`${command} requires --input <json-path>`);
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = planParallelWork(input);
    if (command === "work-multiple") result = { ...result, deprecatedAlias: true, migrationAlias: "work-multiple" };
  } else if (command === "release-train-v2") {
    if (!options.input) throw new Error("release-train-v2 requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = planReleaseTrain(input);
  } else if (command === "check-in") {
    if (!options.input) throw new Error("check-in requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = buildCheckIn(input);
  } else if (command === "linear-hygiene") {
    if (!options.input) throw new Error("linear-hygiene requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = buildLinearHygienePlan(input);
  } else if (command === "development-steward") {
    if (!options.input) throw new Error("development-steward requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = await processDevelopmentStewardReview(input, { home: options.home });
  } else if (command === "development-steward-schedule-enable") {
    if (!options.projectsRoot) throw new Error("development-steward-schedule-enable requires --projects-root <path>");
    if (!options.codexPath) throw new Error("development-steward-schedule-enable requires --codex-path <absolute-path>");
    result = {
      operation: "development-steward-scheduler",
      ...(await installDevelopmentStewardScheduler({
        home: options.home,
        projectsRoot: resolve(options.projectsRoot),
        codexPath: resolve(options.codexPath),
        nodePath: options.nodePath ? resolve(options.nodePath) : undefined,
      })),
    };
  } else if (command === "development-steward-schedule-audit") {
    result = {
      operation: "development-steward-scheduler",
      ...(await auditDevelopmentStewardScheduler({ home: options.home })),
    };
  } else if (command === "development-steward-schedule-disable") {
    result = {
      operation: "development-steward-scheduler",
      ...(await disableDevelopmentStewardScheduler({ home: options.home })),
    };
  } else if (command === "posthog-observability") {
    if (!options.input) throw new Error("posthog-observability requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = auditPostHogObservability(input);
  } else if (command === "convex-guardian") {
    if (!options.input) throw new Error("convex-guardian requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = auditConvexGuardian(input);
  } else if (command === "working-backwards") {
    if (!options.input) throw new Error("working-backwards requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = await runWorkingBackwardsScenario({
      ...input,
      home: options.home,
      workflowId: options.workflow ?? input.workflowId,
    });
  } else if ([
    "working-backwards-publication-intent",
    "working-backwards-t3-handoff",
    "working-backwards-handoff-freshness",
    "working-backwards-evaluate",
    "working-backwards-humanlayer",
  ].includes(command ?? "")) {
    if (!options.input) throw new Error(`${command} requires --input <json-path>`);
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    if (command === "working-backwards-publication-intent") {
      result = prepareTicketPublication(input);
    } else if (command === "working-backwards-t3-handoff") {
      result = createT3ImplementationHandoff(input);
    } else if (command === "working-backwards-handoff-freshness") {
      result = { operation: "working-backwards-handoff-freshness", ...verifyT3HandoffFreshness(input) };
    } else if (command === "working-backwards-evaluate") {
      result = evaluateWorkingBackwards(input);
    } else {
      const adapter = createHumanLayerAdapter({ config: input.config });
      const observation = input.observation === undefined
        ? null
        : await adapter.probeReadOnly({ skill: "working-backwards", observation: input.observation });
      result = {
        ok: true,
        operation: "working-backwards-humanlayer",
        config: adapter.config,
        observation,
        receipt: adapter.receipt(input.receipt),
        feedback: adapter.feedbackReceipt(input.feedback),
        implementationAuthorized: false,
        externalSideEffects: [],
      };
    }
  } else {
    throw new Error(topLevelUsage());
  }

  const output = options.json ? JSON.stringify(result) : formatHuman(result);
  return { result, output, json: options.json };
}

/**
 * Runs one command, writes its output and sets the exit code (1 when ok is false).
 * @param {string[]} argv
 */
export async function main(argv) {
  const wantsJson = argv.includes("--json");
  try {
    const response = await run(argv);
    const { result, output } = response;
    process.stdout.write(`${output}\n`);
    if (result.ok === false && !["audit", "audit-repository"].includes(result.operation)) process.exitCode = 1;
    if ("code" in response && typeof response.code === "number" && response.code !== 0) process.exitCode = response.code;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (wantsJson) {
      process.stdout.write(`${JSON.stringify({ ok: false, operation: "error", error: message })}\n`);
    } else {
      process.stderr.write(`Development System error: ${message}\n`);
    }
    process.exitCode = 1;
  }
}

/** True when this module is the process entry point (`node src/cli.mjs ...`), including through symlinks. */
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isEntryPoint()) await main(process.argv.slice(2));
