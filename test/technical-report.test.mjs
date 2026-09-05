import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, symlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildTechnicalReaderModel, renderTechnicalReaderHtml } from "../artifacts/1.8.0/skills/internal/working-backwards/scripts/t3-reader.mjs";

const document = { title: "A readable report", status: "Observed", markdown: "# A readable report\n\nSummary.\n\n## Evidence\n\nA measured result." };
const workflow = { name: "Private workflow", gateLabel: "Secret gate", action: "Deploy", implementationAuthorized: true };

test("standalone reports carry editorial status without implying workflow authority", () => {
  const model = buildTechnicalReaderModel({ presentation: "report", document, workflow });
  const html = renderTechnicalReaderHtml(model);
  const body = html.slice(html.indexOf("<body"), html.indexOf("<script>"));
  assert.equal(model.workflow.implementationAuthorized, false);
  assert.match(body, /A readable report/);
  assert.match(body, /Observed/);
  assert.match(body, /href="#evidence"/);
  assert.doesNotMatch(body, /Private workflow|Secret gate|Deploy|authority-state|gate-card|artifacts-rail|No artifacts yet/);
});

test("existing workflow callers retain their authorization, phase and next action", () => {
  const html = renderTechnicalReaderHtml(buildTechnicalReaderModel({ document, workflow }));
  assert.match(html, /class="authority-state is-authorized"/);
  assert.match(html, /Secret gate/);
  assert.match(html, /Deploy/);
  assert.match(html, /Private workflow/);
});

test("report Markdown remains inert and the executable script matches its restrictive CSP", () => {
  const html = renderTechnicalReaderHtml(buildTechnicalReaderModel({ presentation: "report", document: { ...document, markdown: '# Evidence\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n```mermaid\nflowchart LR\n A --> B\n```' } }));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /href="javascript:|<script>alert/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const expected = html.match(/script-src 'sha256-([^']+)'/)[1];
  assert.equal(createHash("sha256").update(script).digest("base64"), expected);
  assert.match(html, /legacy-diagram/);
  assert.throws(() => buildTechnicalReaderModel({ presentation: "unknown", document }), /Unknown Reader presentation/);
});

test("report command renders canonical Markdown, regenerates its output and preserves unrelated files", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ds-report-"));
  try {
    const metadata = resolve(directory, "metadata.json");
    const markdown = resolve(directory, "report.md");
    const output = resolve(directory, "report.html");
    await writeFile(metadata, JSON.stringify({ document: { status: "Draft" } }));
    await writeFile(markdown, "# Canonical report\n\nMeasured evidence.");
    const command = resolve(import.meta.dirname, "../artifacts/1.8.0/skills/internal/working-backwards/scripts/t3-report.mjs");
    const args = [command, "--input", metadata, "--markdown", markdown, "--output", output];
    const first = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    assert.match(await readFile(output, "utf8"), /Canonical report/);
    assert.equal(spawnSync(process.execPath, args).status, 0);
    const canonical = await readFile(output, "utf8");
    const alias = resolve(directory, "alias.html");
    const missing = resolve(directory, "missing.html");
    const dangling = resolve(directory, "dangling.html");
    await symlink(output, alias);
    await symlink(missing, dangling);
    for (const target of [alias, dangling]) {
      assert.notEqual(spawnSync(process.execPath, [...args.slice(0, -1), target]).status, 0);
      assert.equal((await lstat(target)).isSymbolicLink(), true);
    }
    assert.equal(await readFile(output, "utf8"), canonical);
    await assert.rejects(lstat(missing), { code: "ENOENT" });
    await writeFile(metadata, "invalid JSON");
    assert.notEqual(spawnSync(process.execPath, args).status, 0);
    assert.equal(await readFile(output, "utf8"), canonical);
    await writeFile(metadata, JSON.stringify({ document: { status: "Draft" } }));
    await writeFile(output, "Keep my hand-written document");
    assert.notEqual(spawnSync(process.execPath, args).status, 0);
    assert.equal(await readFile(output, "utf8"), "Keep my hand-written document");
    assert.match(await readFile(markdown, "utf8"), /Measured evidence/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
