#!/usr/bin/env node
// @ts-check
import { readFile, writeFile, mkdir, lstat, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTechnicalReaderModel, renderTechnicalReaderHtml } from "./t3-reader.mjs";

/**
 * Render a canonical technical report and write it to a managed .html file.
 * Existing output safety is preserved: 0600 permissions, the target must be a
 * regular non-aliased file, symlinks are never followed or overwritten, only
 * files carrying the managed report marker are regenerated, and regeneration
 * is atomic with a retry signal when the file changes mid-write.
 * @param {{input: Record<string, unknown>, outputPath: string}} options
 */
export async function writeTechnicalReport(options) {
  const outputPath = resolve(options.outputPath);
  if (!outputPath.endsWith(".html")) throw new Error("Output must be a separate .html file");
  const input = options.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Report input must be an object");
  const html = renderTechnicalReaderHtml(buildTechnicalReaderModel({ ...input, presentation: "report" }));
  let existingStat = null;
  try {
    existingStat = await lstat(outputPath);
    if (!existingStat.isFile() || existingStat.nlink !== 1) throw new Error("Report output must be a regular file with no aliases");
    const existing = await readFile(outputPath, "utf8");
    if (!existing.includes('<meta name="generator" content="development-system-technical-reader">') || !existing.includes('<body class="reader-report">')) {
      throw new Error("Refusing to overwrite a file that is not a managed report");
    }
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  if (!existingStat) {
    await writeFile(outputPath, html, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } else {
    const temporary = resolve(dirname(outputPath), `.report-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, html, { encoding: "utf8", flag: "wx", mode: 0o600 });
      const current = await lstat(outputPath);
      if (!current.isFile() || current.nlink !== 1 || current.ino !== existingStat.ino || current.mtimeMs !== existingStat.mtimeMs) {
        throw new Error("Report changed during generation; preserve it and retry");
      }
      await rename(temporary, outputPath);
    } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
  }
  return { presentation: "report", output: outputPath, bytes: Buffer.byteLength(html) };
}

/** @param {string[]} argv */
function parseReportArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!["--input", "--markdown", "--output"].includes(key) || !value || value.startsWith("--") || parsed[key]) {
      throw new Error("Use --input metadata.json [--markdown report.md] --output report.html");
    }
    parsed[key] = value;
  }
  return parsed;
}

const invokedAsCli = (() => {
  try {
    return !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedAsCli) {
  const cliOptions = parseReportArguments(process.argv.slice(2));
  if (!cliOptions["--input"] || !cliOptions["--output"]) throw new Error("--input and --output are required");
  const inputPath = resolve(cliOptions["--input"]);
  const outputPath = resolve(cliOptions["--output"]);
  if (outputPath === inputPath || (cliOptions["--markdown"] && outputPath === resolve(cliOptions["--markdown"]))) {
    throw new Error("Output must be a separate .html file");
  }
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  if (cliOptions["--markdown"]) input.document = { ...input.document, markdown: await readFile(resolve(cliOptions["--markdown"]), "utf8") };
  process.stdout.write(JSON.stringify(await writeTechnicalReport({ input, outputPath })) + "\n");
}
