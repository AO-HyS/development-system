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
import { auditSkillCatalog, rollbackSkillSync, synchronizeSkillCatalog } from "./skills.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string[]} argv */
function parseArguments(argv) {
  const [command, ...tokens] = argv;
  /** @type {{home: string, version?: string, sourceCommit?: string, sourceRoot?: string, evidence?: string, json: boolean}} */
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
    const version = options.version ?? "0.2.0";
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
    const version = options.version ?? "0.2.0";
    const catalog = JSON.parse(
      await readFile(resolve(repositoryRoot, "catalog", `${version}.json`), "utf8"),
    );
    result = await rollbackSkillSync({ home: options.home, catalog });
  } else if (command === "validate-repository") {
    result = await validateRepository();
  } else {
    throw new Error(
      "Usage: development-system <install|audit|validate|rollback|audit-skills|sync-skills|rollback-skills|validate-repository> [options]",
    );
  }

  const output = options.json ? JSON.stringify(result) : formatHuman(result);
  return { result, output, json: options.json };
}
