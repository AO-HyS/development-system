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

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string[]} argv */
function parseArguments(argv) {
  const [command, ...tokens] = argv;
  /** @type {{home: string, version?: string, sourceCommit?: string, sourceRoot?: string, evidence?: string, workflow?: string, mode?: string, request?: string, terminalSlice?: string, lifecycleOperation?: string, plan?: string, repository?: string, confirm?: string, input?: string, json: boolean}} */
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
  if (result.operation === "working-backwards-evaluation") return "Working Backwards evaluation recommends a bounded live pilot only.";
  if (result.operation === "working-backwards-humanlayer") return "HumanLayer observations recorded without granting lifecycle authority.";
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
    const version = options.version ?? "0.6.0";
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
    const version = options.version ?? "0.6.0";
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
      "Usage: development-system <install|audit|validate|rollback|audit-skills|sync-skills|rollback-skills|guardrails-enable|guardrails-audit|guardrails-rollback|validate-repository|audit-repository|initialize-repository|normalize-repository|lifecycle-request|lifecycle-execute|lifecycle-status|implement-preview|working-backwards|working-backwards-publication-intent|working-backwards-t3-handoff|working-backwards-handoff-freshness|working-backwards-evaluate|working-backwards-humanlayer> [options]",
    );
  }

  const output = options.json ? JSON.stringify(result) : formatHuman(result);
  return { result, output, json: options.json };
}
