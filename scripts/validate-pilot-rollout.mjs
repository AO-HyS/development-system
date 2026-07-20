// @ts-check

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { validatePilotRolloutEvidence } from "../src/pilot-rollout.mjs";

const evidencePath = resolve(process.argv[2] ?? "evidence/pilot-rollout-2026-07-20.json");
const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
const result = { operation: "validate-pilot-rollout", evidencePath, ...validatePilotRolloutEvidence(evidence) };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
