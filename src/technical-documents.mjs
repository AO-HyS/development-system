// @ts-check
//
// Bounded local document generation. Pure local file output: no workflow
// creation, no lifecycle transitions, no provider or network calls, and no
// authority claims. Every document is editorial evidence, never verification.

import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const KINDS = new Set(["completion", "review", "explanation"]);
const KIND_LABELS = { en: { completion: "Completion", review: "Review", explanation: "Explanation" }, es: { completion: "Entrega", review: "Revisión", explanation: "Explicación" } };
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const MAX_MARKDOWN_CHARS = 500_000;

/** @param {unknown} value */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** @param {string} title */
function slugify(title) {
  const slug = title.trim().toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-").replaceAll(/^-+|-+$/gu, "").slice(0, 40).replaceAll(/^-+|-+$/gu, "");
  return slug || "document";
}

/** @param {unknown} visuals */
function validateVisuals(visuals) {
  if (visuals === undefined) return [];
  if (!Array.isArray(visuals)) throw new Error("Technical document visuals must be an array");
  const seen = new Set();
  return visuals.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Technical document visual ${index + 1} must be an object`);
    const id = entry.id;
    if (typeof id !== "string" || !SAFE_ID.test(id)) {
      throw new Error(`Technical document visual ${index + 1} requires a safe id ([A-Za-z0-9_-], up to 80 chars)`);
    }
    if (seen.has(id)) throw new Error(`Technical document visual id "${id}" is duplicated`);
    seen.add(id);
    for (const field of ["svg", "title", "caption", "description"]) {
      if (entry[field] !== undefined && typeof entry[field] !== "string") {
        throw new Error(`Technical document visual "${id}" field ${field} must be a string`);
      }
    }
    return { ...entry };
  });
}

/** @param {unknown} source */
function validateSource(source) {
  if (source === undefined) return undefined;
  if (!isRecord(source)) throw new Error("Technical document source must be an object");
  for (const field of ["repository", "revision"]) {
    if (source[field] !== undefined && typeof source[field] !== "string") {
      throw new Error(`Technical document source ${field} must be a string`);
    }
  }
  if (source.references !== undefined) {
    if (!Array.isArray(source.references) || !source.references.every((reference) => typeof reference === "string")) {
      throw new Error("Technical document source references must be an array of strings");
    }
  }
  return {
    ...(typeof source.repository === "string" ? { repository: source.repository } : {}),
    ...(typeof source.revision === "string" ? { revision: source.revision } : {}),
    ...(Array.isArray(source.references) ? { references: [...source.references] } : {}),
  };
}

/** @param {unknown} input */
function validatePacket(input) {
  if (!isRecord(input)) throw new Error("Technical document input must be an object");
  if (input.schemaVersion !== 1) throw new Error("Technical document packet schemaVersion must be 1");
  if (typeof input.kind !== "string" || !KINDS.has(input.kind)) {
    throw new Error("Technical document kind must be completion, review, or explanation");
  }
  if (!nonEmptyString(input.title)) throw new Error("Technical document title must be a non-empty string");
  if (typeof input.title !== "string" || input.title.includes("\n") || input.title.length > 300) {
    throw new Error("Technical document title must be a single line of up to 300 characters");
  }
  if (typeof input.markdown !== "string" || input.markdown.trim().length === 0) {
    throw new Error("Technical document markdown must be a non-empty string");
  }
  if (input.markdown.length > MAX_MARKDOWN_CHARS) throw new Error("Technical document markdown exceeds the local size bound");
  if (!nonEmptyString(input.status)) throw new Error("Technical document status must be a non-empty editorial string");
  if (typeof input.status !== "string" || input.status.includes("\n") || input.status.length > 300) {
    throw new Error("Technical document status must be a single line of up to 300 characters");
  }
  if (input.language !== undefined && typeof input.language !== "string") {
    throw new Error("Technical document language must be a string");
  }
  if (input.productName !== undefined && !nonEmptyString(input.productName)) {
    throw new Error("Technical document productName must be a non-empty string");
  }
  return {
    kind: /** @type {"completion" | "review" | "explanation"} */ (input.kind),
    title: input.title.trim(),
    markdown: input.markdown.endsWith("\n") ? input.markdown : `${input.markdown}\n`,
    status: input.status.trim(),
    language: typeof input.language === "string" && input.language.trim() ? input.language.trim() : undefined,
    productName: typeof input.productName === "string" ? input.productName.trim() : "Development System",
    source: validateSource(input.source),
    visuals: validateVisuals(input.visuals),
  };
}

/** @param {string} value */
function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Write one canonical Markdown + shared-reader HTML pair under
 * HOME/.development-system/private/documents. File names are derived from a
 * deterministic content hash, never from user paths. Fails closed on invalid
 * input, collisions with different bytes, or symlinked targets.
 * @param {{home: string, input: unknown}} options
 */
export async function writeTechnicalDocument(options) {
  if (!nonEmptyString(options.home)) throw new Error("Technical document generation requires --home");
  const packet = validatePacket(options.input);
  const { buildTechnicalReaderModel, renderTechnicalReaderHtml } = await import("../artifacts/1.8.3/skills/internal/working-backwards/scripts/t3-reader.mjs");
  const model = buildTechnicalReaderModel({
    presentation: "report",
    ...(packet.language ? { language: packet.language } : {}),
    productName: packet.productName,
    document: {
      type: KIND_LABELS[packet.language === "en" ? "en" : "es"][packet.kind],
      title: packet.title,
      status: packet.status,
      markdown: packet.markdown,
      ...(packet.source?.repository ? { repository: packet.source.repository } : {}),
    },
    // Preserved verbatim for the shared reader; visual rendering belongs to
    // the renderer (pr-lens fences referencing these ids), not to this writer.
    visuals: packet.visuals,
  });
  if (model.workflow.implementationAuthorized === true) throw new Error("Technical documents must never carry workflow authority");
  const html = renderTechnicalReaderHtml(model);
  const packetJson = JSON.stringify({ schemaVersion: 1, ...packet }, null, 2) + "\n";
  const identifier = `${slugify(packet.title)}-${sha256Hex(packetJson + html).slice(0, 16)}`;
  if (!SAFE_ID.test(identifier)) throw new Error("Technical document identifier is unsafe");
  const directory = resolve(options.home, ".development-system", "private", "documents");
  for (const part of [".development-system", ".development-system/private", ".development-system/private/documents"]) {
    const path = resolve(options.home, part);
    await mkdir(path, { recursive: true, mode: 0o700 });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Refusing a non-directory or symlinked document directory: ${path}`);
  }
  await chmod(directory, 0o700);
  const markdownPath = resolve(directory, `${identifier}.md`);
  const htmlPath = resolve(directory, `${identifier}.html`);
  const packetPath = resolve(directory, `${identifier}.json`);

  for (const [path, contents] of [[markdownPath, packet.markdown], [htmlPath, html], [packetPath, packetJson]]) {
    let existingStat = null;
    try {
      existingStat = await lstat(path);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") throw error;
    }
    if (!existingStat) {
      await writeFile(path, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await chmod(path, 0o600);
      continue;
    }
    if (!existingStat.isFile() || existingStat.nlink !== 1) {
      throw new Error(`Refusing to write through a non-regular document target: ${path}`);
    }
    const { readFile } = await import("node:fs/promises");
    const existing = await readFile(path, "utf8");
    if (existing !== contents) {
      throw new Error(`Technical document collision: ${path} already holds different bytes`);
    }
    await chmod(path, 0o600);
  }

  return {
    generated: true,
    kind: packet.kind,
    id: identifier,
    markdownPath,
    htmlPath,
    packetPath,
    packetSha256: sha256Hex(packetJson),
    sourceSha256: sha256Hex(packet.markdown),
    htmlSha256: sha256Hex(html),
    ...(packet.source ? { source: packet.source } : {}),
  };
}
