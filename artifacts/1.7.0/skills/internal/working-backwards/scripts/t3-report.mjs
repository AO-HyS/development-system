#!/usr/bin/env node
import { readFile, writeFile, mkdir, lstat, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { buildTechnicalReaderModel, renderTechnicalReaderHtml } from "./t3-reader.mjs";

const options = {};
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  if (!["--input", "--markdown", "--output"].includes(key) || !value || value.startsWith("--") || options[key]) {
    throw new Error("Use --input metadata.json [--markdown report.md] --output report.html");
  }
  options[key] = value;
}
if (!options["--input"] || !options["--output"]) throw new Error("--input and --output are required");
const inputPath = resolve(options["--input"]);
const outputPath = resolve(options["--output"]);
if (!outputPath.endsWith(".html") || outputPath === inputPath || (options["--markdown"] && outputPath === resolve(options["--markdown"]))) {
  throw new Error("Output must be a separate .html file");
}
const input = JSON.parse(await readFile(inputPath, "utf8"));
if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Report input must be an object");
if (options["--markdown"]) input.document = { ...input.document, markdown: await readFile(resolve(options["--markdown"]), "utf8") };
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
  if (error.code !== "ENOENT") throw error;
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
process.stdout.write(JSON.stringify({ presentation: "report", output: outputPath, bytes: Buffer.byteLength(html) }) + "\n");
