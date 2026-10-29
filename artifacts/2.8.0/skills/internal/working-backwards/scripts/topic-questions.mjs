// @ts-check

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const identifierPattern = /^[a-z][a-z0-9_]*$/u;
const formats = new Set(["native", "chat", "both"]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
}

/** @param {string} value */
function wordCount(value) {
  return value.split(/\s+/u).filter(Boolean).length;
}

/** @param {string} value */
function withoutTerminalPunctuation(value) {
  return value.replace(/[.!?]+$/u, "");
}

/** @param {string} impact @param {string} example */
function optionDescription(impact, example) {
  return `${withoutTerminalPunctuation(impact)}; por ejemplo, ${withoutTerminalPunctuation(example)}.`;
}

/**
 * Compose one Topic into both the native request_user_input payload and an
 * equivalent chat fallback. The function never asks more than three related
 * decisions and never mutates external state.
 *
 * @param {unknown} input
 */
export function composeTopicQuestions(input) {
  /** @type {string[]} */
  const errors = [];
  const value = isRecord(input) ? input : {};
  const topic = isRecord(value.topic) ? value.topic : {};
  const topicId = cleanText(topic.id);
  const topicLabel = cleanText(topic.label);
  const settledContext = Array.isArray(value.settledContext)
    ? value.settledContext.map(cleanText).filter(Boolean)
    : [];
  const decisions = Array.isArray(value.decisions) ? value.decisions : [];

  if (!identifierPattern.test(topicId)) errors.push("topic.id must be stable snake_case");
  if (!topicLabel) errors.push("topic.label is required");
  if (decisions.length < 1 || decisions.length > 3) {
    errors.push("one Topic must contain between one and three related decisions");
  }

  /** @type {Array<{header: string, id: string, question: string, options: Array<{label: string, description: string}>}>} */
  const questions = [];
  /** @type {Set<string>} */
  const seenIds = new Set();

  for (const [decisionIndex, rawDecision] of decisions.entries()) {
    const decision = isRecord(rawDecision) ? rawDecision : {};
    const prefix = `decisions[${decisionIndex}]`;
    const id = cleanText(decision.id);
    const header = cleanText(decision.header);
    const question = cleanText(decision.question);
    const options = Array.isArray(decision.options) ? decision.options : [];

    if (!identifierPattern.test(id)) errors.push(`${prefix}.id must be stable snake_case`);
    if (seenIds.has(id)) errors.push(`${prefix}.id must be unique`);
    seenIds.add(id);
    if (!header || header.length > 12) errors.push(`${prefix}.header must contain 1-12 characters`);
    if (!question) errors.push(`${prefix}.question is required`);
    if (options.length < 2 || options.length > 3) errors.push(`${prefix}.options must contain two or three choices`);

    const normalizedOptions = options.map((rawOption, optionIndex) => {
      const option = isRecord(rawOption) ? rawOption : {};
      const label = cleanText(option.label);
      const impact = cleanText(option.impact);
      const example = cleanText(option.example);
      const recommended = option.recommended === true;
      if (!label || wordCount(label) > 5) errors.push(`${prefix}.options[${optionIndex}].label must contain 1-5 words`);
      if (recommended && wordCount(label) > 4) errors.push(`${prefix}.options[${optionIndex}].recommended label must leave room for the Recommended suffix`);
      if (!impact) errors.push(`${prefix}.options[${optionIndex}].impact is required`);
      if (!example) errors.push(`${prefix}.options[${optionIndex}].example is required`);
      return { label, impact, example, recommended };
    });

    const recommended = normalizedOptions.filter((option) => option.recommended);
    if (recommended.length !== 1) errors.push(`${prefix}.options must contain exactly one recommended choice`);
    const orderedOptions = [
      ...recommended,
      ...normalizedOptions.filter((option) => !option.recommended),
    ].map((option) => ({
      label: option.recommended ? `${option.label} (Recommended)` : option.label,
      description: optionDescription(option.impact, option.example),
    }));

    questions.push({ header, id, question, options: orderedOptions });
  }

  const valid = errors.length === 0;
  const native = valid ? { questions } : null;
  const chat = valid
    ? [
        `Topic: ${topicLabel}`,
        ...(settledContext.length > 0
          ? ["", "Ya está asentado:", ...settledContext.map((item) => `- ${item}`)]
          : []),
        "",
        ...questions.flatMap((question, questionIndex) => [
          `${questionIndex + 1}. ${question.question}`,
          ...question.options.map((option, optionIndex) =>
            `   ${String.fromCharCode(65 + optionIndex)}. ${option.label} — ${option.description}`),
          "",
        ]),
        `Responde ${questions.map((_, index) => `${index + 1}<letra>`).join(", ")} (por ejemplo, 1A, 2C) y agrega cualquier matiz. También puedes escribir una opción distinta.`,
      ].join("\n").replace(/\n{3,}/gu, "\n\n")
    : null;

  return {
    schemaVersion: 1,
    operation: "compose-topic-questions",
    valid,
    errors,
    topic: { id: topicId, label: topicLabel },
    settledContext,
    interface: {
      preferred: "request_user_input",
      fallback: "chat",
      rule: "Use the native payload only when request_user_input is available in the active collaboration mode; otherwise send chat unchanged.",
    },
    native,
    chat,
    externalWriteIntents: [],
    externalSideEffects: [],
  };
}

/** @param {string[]} args */
function parseArgs(args) {
  const inputIndex = args.indexOf("--input");
  const formatIndex = args.indexOf("--format");
  const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : "";
  const format = formatIndex >= 0 ? args[formatIndex + 1] : "both";
  if (!inputPath) throw new Error("Usage: topic-questions.mjs --input <json-path> [--format native|chat|both]");
  if (!formats.has(format)) throw new Error("--format must be native, chat, or both");
  return { inputPath, format };
}

async function main() {
  const { inputPath, format } = parseArgs(process.argv.slice(2));
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const result = composeTopicQuestions(input);
  if (!result.valid) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  if (format === "native") process.stdout.write(`${JSON.stringify(result.native, null, 2)}\n`);
  else if (format === "chat") process.stdout.write(`${result.chat}\n`);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
