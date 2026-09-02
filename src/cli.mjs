// @ts-check

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditInstallation,
  installVersion,
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
import { auditSkillCatalog, rollbackSkillSync, synchronizeSkillCatalog } from "./skills.mjs";
import { auditRepository, initializeRepository, normalizeRepository } from "./repositories.mjs";
import {
  auditGlobalGuardrails,
  enableGlobalGuardrails,
  rollbackGlobalGuardrails,
} from "./guardrails.mjs";
import { runWorkingBackwardsScenario } from "./working-backwards.mjs";
import { createHumanLayerAdapter } from "./humanlayer-adapter.mjs";
import {
  createT3ImplementationHandoff,
  prepareTicketPublication,
  verifyT3HandoffFreshness,
} from "./working-backwards-handoff.mjs";
import { evaluateWorkingBackwards } from "./working-backwards-evaluation.mjs";
import { routeDefinition } from "./definition-router.mjs";
import { buildDevelopmentRun } from "./development-run.mjs";
import { planParallelWork } from "./parallel-work.mjs";
import { planReleaseTrain } from "./release-train-v2.mjs";
import { buildCheckIn } from "./check-in.mjs";
import { buildLinearHygienePlan } from "./linear-hygiene.mjs";
import { buildDevelopmentStewardReview } from "./development-steward.mjs";
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

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string[]} argv */
function parseArguments(argv) {
  const [command, ...tokens] = argv;
  /** @type {{home: string, version?: string, sourceCommit?: string, sourceRoot?: string, evidence?: string, workflow?: string, mode?: string, request?: string, terminalSlice?: string, lifecycleOperation?: string, plan?: string, repository?: string, confirm?: string, input?: string, projectsRoot?: string, codexPath?: string, nodePath?: string, json: boolean}} */
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
    else if (token === "--version") options.version = value;
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
    else throw new Error(`Unknown option: ${token}`);
    index += 1;
  }

  return { command, options };
}

/** @param {Record<string, unknown>} result */
function formatHuman(result) {
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
  if (result.operation === "guardrails-enable") return `Global guardrails ${result.status}.`;
  if (result.operation === "guardrails-audit") return `Global guardrails ${result.status}.`;
  if (result.operation === "guardrails-rollback") return "Restored the prior global hook configuration.";
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
export async function run(argv) {
  const { command, options } = parseArguments(argv);
  let result;

  if (command === "install") {
    if (!options.version) throw new Error("install requires --version <semver>");
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
    result = await rollbackInstallation({ home: options.home });
  } else if (command === "audit-skills" || command === "sync-skills") {
    const version = options.version ?? "0.22.0";
    const catalog = JSON.parse(
      await readFile(resolve(repositoryRoot, "catalog", `${version}.json`), "utf8"),
    );
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
    const version = options.version ?? "0.22.0";
    const catalog = JSON.parse(
      await readFile(resolve(repositoryRoot, "catalog", `${version}.json`), "utf8"),
    );
    result = await rollbackSkillSync({ home: options.home, catalog });
  } else if (command === "guardrails-enable") {
    result = await enableGlobalGuardrails({ home: options.home });
  } else if (command === "guardrails-audit") {
    result = await auditGlobalGuardrails({ home: options.home });
  } else if (command === "guardrails-rollback") {
    result = await rollbackGlobalGuardrails({ home: options.home });
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
  } else if (command === "definition-route") {
    if (!options.input) throw new Error("definition-route requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = routeDefinition(input);
  } else if (command === "development-run") {
    if (!options.input) throw new Error("development-run requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = buildDevelopmentRun(input);
  } else if (command === "orchestrator-pilot") {
    if (!options.input) throw new Error("orchestrator-pilot requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = evaluateOrchestrationPilot(input);
  } else if (command === "orchestration-plan") {
    if (!options.input) throw new Error("orchestration-plan requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = planOrchestration(input);
  } else if (command === "verify-path-confinement") {
    if (!options.input) throw new Error("verify-path-confinement requires --input <json-path>");
    const input = JSON.parse(await readFile(resolve(options.input), "utf8"));
    result = await verifyPathConfinement(input);
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
    result = buildDevelopmentStewardReview(input);
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
    throw new Error(
      "Usage: development-system <install|audit|validate|rollback|audit-skills|sync-skills|rollback-skills|guardrails-enable|guardrails-audit|guardrails-rollback|validate-repository|audit-repository|initialize-repository|normalize-repository|lifecycle-request|lifecycle-execute|lifecycle-status|implement-preview|definition-route|development-run|orchestrator-pilot|orchestration-plan|verify-path-confinement|parallel-work|work-multiple|release-train-v2|check-in|linear-hygiene|development-steward|development-steward-schedule-enable|development-steward-schedule-audit|development-steward-schedule-disable|posthog-observability|convex-guardian|working-backwards|working-backwards-publication-intent|working-backwards-t3-handoff|working-backwards-handoff-freshness|working-backwards-evaluate|working-backwards-humanlayer> [options]",
    );
  }

  const output = options.json ? JSON.stringify(result) : formatHuman(result);
  return { result, output, json: options.json };
}
