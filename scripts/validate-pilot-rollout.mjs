// @ts-check

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validatePilotRolloutEvidence } from "../src/pilot-rollout.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectsRoot = resolve(process.env.AOHYS_PROJECTS_ROOT ?? repositoryRoot, process.env.AOHYS_PROJECTS_ROOT ? "." : "..");
const evidencePath = resolve(process.argv[2] ?? resolve(repositoryRoot, "evidence/pilot-rollout-2026-07-20.json"));
const repositoryPaths = {
  "nutri-plan": resolve(projectsRoot, "nutri-plan"),
  "the-barber-central": resolve(projectsRoot, "the-barber-central"),
  "aohys.com": resolve(projectsRoot, "aohys"),
};

/** @param {string} cwd @param {string} commit */
function commitExists(cwd, commit) {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** @param {string} cwd @param {string} ancestor @param {string} descendant */
function isAncestor(cwd, ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** @param {any} reference @param {string} evidenceCommit */
async function loadArtifact(reference, evidenceCommit) {
  if (!reference || typeof reference.path !== "string" || !reference.path.startsWith("evidence/")) return null;
  const path = resolve(repositoryRoot, reference.path);
  if (!path.startsWith(resolve(repositoryRoot, "evidence") + "/")) return null;
  try {
    const bytes = execFileSync("git", ["show", `${evidenceCommit}:${reference.path}`], {
      cwd: repositoryRoot,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    });
    return {
      path: reference.path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      document: JSON.parse(bytes.toString("utf8")),
    };
  } catch {
    return null;
  }
}

/** @param {string} path */
async function pathExists(path) {
  return Boolean(await stat(path).catch(() => null));
}

let evidence;
try {
  evidence = JSON.parse(await readFile(evidencePath, "utf8"));
} catch (error) {
  const result = {
    operation: "validate-pilot-rollout",
    evidencePath,
    ok: false,
    decision: "blocked",
    errors: [`evidence packet is unavailable: ${error instanceof Error ? error.message : String(error)}`],
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 1;
}

if (evidence) {
  const evidenceCommit = evidence.candidate?.evidenceCommit;
  const pilotPairs = await Promise.all((evidence.pilots ?? []).map(async (/** @type {any} */ pilot) => {
    const repository = /** @type {Record<string, string>} */ (repositoryPaths)[pilot.name];
    const artifact = await loadArtifact(pilot.attestation, evidenceCommit);
    const claims = artifact?.document ?? pilot;
    return [pilot.name, {
      ...artifact,
      operationalSkillEvidence: await loadArtifact(claims.operationalSkillEvidence, evidenceCommit),
      commitExists: Boolean(repository) && commitExists(repository, claims.productCommit),
      recapExists: typeof claims.localVisualRecap?.privatePath === "string" &&
        await pathExists(resolve(homedir(), claims.localVisualRecap.privatePath)),
    }];
  }));
  const verification = {
    candidateCommitExists: commitExists(repositoryRoot, evidence.candidate?.sourceCommit),
    evidenceCommitExists: commitExists(repositoryRoot, evidenceCommit),
    evidenceDescendsFromSource: isAncestor(repositoryRoot, evidence.candidate?.sourceCommit, evidenceCommit),
    harnessEvidence: await loadArtifact(evidence.candidate?.harnessEvidence, evidenceCommit),
    skillEvidence: await loadArtifact(evidence.candidate?.skillEvidence, evidenceCommit),
    pilots: Object.fromEntries(pilotPairs),
  };
  const result = { operation: "validate-pilot-rollout", evidencePath, ...validatePilotRolloutEvidence(evidence, verification) };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}
