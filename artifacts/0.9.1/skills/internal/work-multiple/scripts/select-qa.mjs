#!/usr/bin/env node

import { readFile } from "node:fs/promises";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const inputPath = option("--input");
if (!inputPath) throw new Error("Usage: select-qa.mjs --input <change.json>");
const input = JSON.parse(await readFile(inputPath, "utf8"));

const booleanFields = [
  "uiChanged",
  "behaviorChanged",
  "meaningfulRegression",
  "criticalFlow",
  "interactive",
  "responsiveBehavior",
  "navigation",
  "mutation",
  "labelOnly",
  "copyOnly",
  "iconOnly",
  "obviousStyleOnly",
];
for (const field of booleanFields) {
  if (input[field] !== undefined && typeof input[field] !== "boolean") {
    throw new Error(`${field} must be boolean when provided`);
  }
}

const uiChanged = input.uiChanged === true;
const behaviorChanged = input.behaviorChanged === true;
const meaningfulRegression = input.meaningfulRegression === true;
const criticalFlow = input.criticalFlow === true;
const interactive = input.interactive === true;
const responsiveBehavior = input.responsiveBehavior === true;
const navigation = input.navigation === true;
const mutation = input.mutation === true;
const mechanicalOnly =
  input.labelOnly === true ||
  input.copyOnly === true ||
  input.iconOnly === true ||
  input.obviousStyleOnly === true;
const behavioralRisk =
  behaviorChanged ||
  meaningfulRegression ||
  criticalFlow ||
  interactive ||
  responsiveBehavior ||
  navigation ||
  mutation;

if (!uiChanged && behavioralRisk) {
  throw new Error("A UI behavioral risk cannot be declared when uiChanged is false");
}

let result;
if (!uiChanged) {
  result = {
    decision: "not-applicable",
    reason: "No user-interface surface changed.",
  };
} else if (
  mechanicalOnly &&
  !behavioralRisk
) {
  result = {
    decision: "skipped",
    reason: "The UI change is mechanical and carries no behavioral risk.",
  };
} else if (
  behavioralRisk
) {
  result = {
    decision: "required",
    reason: "The change affects observable behavior or a meaningful user flow.",
  };
} else {
  result = {
    decision: "skipped",
    reason: "No meaningful interactive or regression risk was identified.",
  };
}

process.stdout.write(`${JSON.stringify(result)}\n`);
