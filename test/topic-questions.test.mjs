import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { composeTopicQuestions } from "../artifacts/1.5.7/skills/internal/working-backwards/scripts/topic-questions.mjs";

const root = resolve(import.meta.dirname, "..");
const examplePath = resolve(root, "artifacts/1.5.7/skills/internal/working-backwards/examples/orchestrator-audit-goals.json");
const scriptPath = resolve(root, "artifacts/1.5.7/skills/internal/working-backwards/scripts/topic-questions.mjs");

test("one Topic produces up to three native questions with recommendation and example first", async () => {
  const input = JSON.parse(await readFile(examplePath, "utf8"));
  const result = composeTopicQuestions(input);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.native.questions.length, 3);
  assert.deepEqual(result.native.questions.map((question) => question.id), [
    "success_metric",
    "comparison_baseline",
    "review_cadence",
  ]);
  for (const question of result.native.questions) {
    assert.ok(question.header.length <= 12);
    assert.ok(question.options.length >= 2 && question.options.length <= 3);
    assert.match(question.options[0].label, /\(Recommended\)$/u);
    assert.match(question.options[0].description, /; por ejemplo, .+\.$/u);
  }
  assert.deepEqual(result.externalWriteIntents, []);
  assert.deepEqual(result.externalSideEffects, []);
});

test("chat fallback preserves the same ordered decisions, choices, impacts, and examples", async () => {
  const input = JSON.parse(await readFile(examplePath, "utf8"));
  const result = composeTopicQuestions(input);

  assert.match(result.chat, /^Topic: Metas de la auditoría del orquestador/mu);
  assert.match(result.chat, /1\. ¿Qué señal principal/u);
  assert.match(result.chat, /A\. Entrega verificada \(Recommended\)/u);
  assert.match(result.chat, /Equilibra velocidad, resultado aceptado y costo de corrección; por ejemplo, una tarea es mejor/u);
  assert.match(result.chat, /3\. ¿Cómo debería mantenerse útil/u);
  assert.match(result.chat, /Responde 1<letra>, 2<letra>, 3<letra>/u);
  assert.match(result.chat, /También puedes escribir una opción distinta/u);
});

test("invalid batching fails closed instead of silently dropping decisions", () => {
  const result = composeTopicQuestions({
    topic: { id: "mixed_topics", label: "Temas mezclados" },
    decisions: Array.from({ length: 4 }, (_, index) => ({
      id: `decision_${index}`,
      header: `D${index}`,
      question: `Decision ${index}?`,
      options: [
        { label: "Primera", impact: "Hace una cosa", example: "caso uno", recommended: true },
        { label: "Segunda", impact: "Hace otra cosa", example: "caso dos" },
      ],
    })),
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /between one and three related decisions/u);
  assert.equal(result.native, null);
  assert.equal(result.chat, null);
});

test("each decision requires exactly one recommendation and concrete examples", () => {
  const result = composeTopicQuestions({
    topic: { id: "quality", label: "Calidad" },
    decisions: [{
      id: "gate",
      header: "Gate",
      question: "Which gate?",
      options: [
        { label: "Fast", impact: "Runs quickly", recommended: true },
        { label: "Safe", impact: "Checks more", example: "run focused tests", recommended: true },
      ],
    }],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /exactly one recommended choice/u);
  assert.match(result.errors.join("\n"), /example is required/u);
});

test("CLI emits the native payload and the equivalent chat fallback", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "topic-questions-"));
  const inputPath = resolve(directory, "topic.json");
  try {
    await writeFile(inputPath, await readFile(examplePath));
    const nativeRun = spawnSync(process.execPath, [scriptPath, "--input", inputPath, "--format", "native"], { encoding: "utf8" });
    const chatRun = spawnSync(process.execPath, [scriptPath, "--input", inputPath, "--format", "chat"], { encoding: "utf8" });

    assert.equal(nativeRun.status, 0, nativeRun.stderr);
    assert.equal(JSON.parse(nativeRun.stdout).questions.length, 3);
    assert.equal(chatRun.status, 0, chatRun.stderr);
    assert.match(chatRun.stdout, /Topic: Metas de la auditoría/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
