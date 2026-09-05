import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { writeTechnicalDocument } from "../src/technical-documents.mjs";
import { writeTechnicalReport } from "../artifacts/1.8.1/skills/internal/working-backwards/scripts/t3-report.mjs";

/** @param {string} value */
function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function packet(kind) {
  return {
    schemaVersion: 1,
    kind,
    title: `Technical ${kind} evidence`,
    markdown: `# Technical ${kind} evidence\n\nObserved behavior with measured checks.\n\n\`\`\`pr-lens\n{"id":"graph-1"}\n\`\`\`\n`,
    status: "Observed",
    language: "en",
    productName: "Development System",
    source: { repository: "example-repo", revision: "abc123", references: ["https://example.test/pr/1"] },
    visuals: [{ id: "graph-1", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><text x="8" y="25">Flow</text></svg>', title: "Delivery graph", caption: "Flow", description: "Nodes and edges" }],
  };
}

test("completion media stays portable after originals disappear and cannot grant verification", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-doc-media-"));
  try {
    const path = resolve(home, "capture.png");
    await writeFile(path, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=", "base64"));
    const input = { ...packet("completion"), evidence: { impact: "ui", comparisons: [{ id: "visible-change", title: "Affected flow", after: {path, alt:"Observed result", revision:"candidate"} }] } };
    const result = await writeTechnicalDocument({home, input});
    const canonical = JSON.parse(await readFile(result.packetPath, "utf8"));
    const html = await readFile(result.htmlPath, "utf8");
    assert.match(html, /data:image\/png;base64,/);
    assert.doesNotMatch(html, new RegExp(path));
    assert.deepEqual(canonical.evidence.gaps.map(gap => gap.kind), ["before", "recording"]);
    assert.match(html, /Evidence missing/);
    assert.equal(result.verified, undefined);
    await unlink(path);
    assert.deepEqual(await writeTechnicalDocument({home, input:canonical}), result);
  } finally { await rm(home, {recursive:true,force:true}); }
});

test("embedded video uses native controls without remote loads or autoplay", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-doc-video-"));
  try {
    const video = Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109]);
    const result = await writeTechnicalDocument({home, input:{...packet("review"),evidence:{impact:"ui",recordings:[{id:"flow",title:"Recorded flow",description:"A recording with an explicit scope",transcript:"Open and inspect the result.",asset:{dataUrl:`data:video/mp4;base64,${video.toString("base64")}`,alt:"Recorded flow",revision:"candidate"}}]}}});
    const html = await readFile(result.htmlPath, "utf8");
    assert.match(html, /<video controls playsinline preload="metadata"/);
    assert.match(html, /media-src data:/);
    assert.match(html, /Read the video walkthrough/);
    assert.doesNotMatch(html, /<video[^>]*autoplay/);
    assert.match(html, /data:video\/mp4;base64,/);
  } finally { await rm(home, {recursive:true,force:true}); }
});

test("completion, review, and explanation documents generate without workflow authority", async () => {
  for (const kind of ["completion", "review", "explanation"]) {
    const home = await mkdtemp(resolve(tmpdir(), "aohys-doc-home-"));
    try {
      const result = await writeTechnicalDocument({ home, input: packet(kind) });
      assert.equal(result.generated, true);
      assert.equal(result.kind, kind);
      assert.equal(result.verified, undefined);
      assert.equal(result.authority, undefined);
      assert.ok(result.markdownPath.startsWith(resolve(home, ".development-system", "private", "documents")));
      assert.ok(result.htmlPath.startsWith(resolve(home, ".development-system", "private", "documents")));
      assert.equal((await stat(resolve(home, ".development-system", "private", "documents"))).mode & 0o777, 0o700);
      assert.equal((await stat(result.markdownPath)).mode & 0o777, 0o600);
      assert.equal((await stat(result.htmlPath)).mode & 0o777, 0o600);
      const markdown = await readFile(result.markdownPath, "utf8");
      const html = await readFile(result.htmlPath, "utf8");
      const body = html.slice(html.indexOf("<body"), html.indexOf("<script>"));
      assert.equal(result.sourceSha256, sha256Hex(markdown));
      assert.equal(result.htmlSha256, sha256Hex(html));
      assert.match(markdown, /Observed behavior with measured checks/);
      assert.match(html, /Technical .* evidence/);
      assert.match(html, /Observed/);
      assert.equal(JSON.parse(await readFile(result.packetPath, "utf8")).source.repository, "example-repo");
      assert.match(html, /development-system-technical-reader/);
      assert.match(html, /reader-report/);
      assert.doesNotMatch(body, /is-authorized/);
      assert.doesNotMatch(body, /Implementation authorized/);
      assert.deepEqual(result.source, packet(kind).source);
    } finally { await rm(home, { recursive: true, force: true }); }
  }
});

test("generation is idempotent and fails closed on collisions and symlinks", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-doc-collision-"));
  try {
    const input = packet("completion");
    const first = await writeTechnicalDocument({ home, input });
    const second = await writeTechnicalDocument({ home, input });
    assert.deepEqual(second, first);
    const changed = await writeTechnicalDocument({home, input:{...input, visuals: input.visuals.map(visual=>({...visual,caption:"A revised explanation"}))}});
    assert.notEqual(changed.htmlPath, first.htmlPath);
    assert.equal(JSON.parse(await readFile(changed.packetPath, "utf8")).visuals[0].caption, "A revised explanation");

    await writeFile(first.htmlPath, "Keep my hand-written document");
    await assert.rejects(writeTechnicalDocument({ home, input }), /collision/i);
    assert.equal(await readFile(first.htmlPath, "utf8"), "Keep my hand-written document");

    await unlink(first.htmlPath);
    const linkTarget = resolve(home, "external.html");
    await writeFile(linkTarget, "external");
    await symlink(linkTarget, first.htmlPath);
    assert.equal((await lstat(first.htmlPath)).isSymbolicLink(), true);
    await assert.rejects(writeTechnicalDocument({ home, input }), /non-regular/i);
    assert.equal((await lstat(first.htmlPath)).isSymbolicLink(), true);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("a symlinked private directory is rejected without touching its destination", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-doc-directory-"));
  const target = await mkdtemp(resolve(tmpdir(), "aohys-doc-target-"));
  try {
    await mkdir(resolve(home, ".development-system"));
    await symlink(target, resolve(home, ".development-system", "private"));
    const before = (await stat(target)).mode;
    await assert.rejects(writeTechnicalDocument({home,input:packet("review")}), /symlinked document directory/);
    assert.equal((await stat(target)).mode, before);
    await assert.rejects(stat(resolve(target, "documents")), {code:"ENOENT"});
  } finally { await rm(home, {recursive:true,force:true}); await rm(target, {recursive:true,force:true}); }
});

test("invalid and unsafe packets fail closed without writing documents", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-doc-invalid-"));
  try {
    const base = packet("review");
    const bad = [
      { ...base, schemaVersion: 2 },
      { ...base, kind: "summary" },
      { ...base, title: "   " },
      { ...base, title: "line one\nline two" },
      { ...base, markdown: "   " },
      { ...base, status: "" },
      { ...base, visuals: [{ id: "../escape" }] },
      { ...base, visuals: [{ id: "ok" }, { id: "ok" }] },
      { ...base, source: { references: ["https://example.test", 42] } },
      "not-an-object",
    ];
    for (const input of bad) await assert.rejects(writeTechnicalDocument({ home, input }), /must|requires|Technical document/i);
    await assert.rejects(stat(resolve(home, ".development-system")), { code: "ENOENT" });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("no user path escapes: hostile titles stay inside the private documents directory", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "aohys-doc-escape-"));
  try {
    const result = await writeTechnicalDocument({
      home,
      input: { ...packet("explanation"), title: "../../etc-technical-escape" },
    });
    assert.ok(result.markdownPath.startsWith(resolve(home, ".development-system", "private", "documents")));
    assert.ok(result.htmlPath.startsWith(resolve(home, ".development-system", "private", "documents")));
    await assert.rejects(stat(resolve(home, "etc-technical-escape.md")), { code: "ENOENT" });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("refactored t3-report helper keeps CLI-compatible output safety when imported", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "aohys-t3-report-"));
  try {
    const output = resolve(directory, "nested", "report.html");
    const input = { document: { title: "Imported report", status: "Observed", markdown: "# Imported report\n\nEvidence." } };
    const first = await writeTechnicalReport({ input, outputPath: output });
    assert.equal(first.output, output);
    assert.match(await readFile(output, "utf8"), /Imported report/);
    const second = await writeTechnicalReport({ input, outputPath: output });
    assert.equal(second.output, output);
    await writeFile(output, "Keep my hand-written document");
    await assert.rejects(writeTechnicalReport({ input, outputPath: output }), /managed report/);
    assert.equal(await readFile(output, "utf8"), "Keep my hand-written document");
    const missing = resolve(directory, "missing.html");
    const dangling = resolve(directory, "dangling.html");
    await mkdir(resolve(directory, "alias-dir"), { recursive: true });
    await symlink(missing, dangling);
    await assert.rejects(writeTechnicalReport({ input, outputPath: dangling }), /regular file|aliases/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
