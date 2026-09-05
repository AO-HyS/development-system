import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { lstatSync, mkdirSync, symlinkSync, writeFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { normalizeDocumentEvidence } from "../src/document-evidence.mjs";

function makeTemp() {
  return mkdtempSync(join(tmpdir(), "document-evidence-"));
}

function pngBytes(extra = "payload") {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(extra)]);
}

function jpegBytes(extra = "payload") {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(extra)]);
}

function webpBytes(extra = "payload") {
  const head = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x01, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
  return Buffer.concat([head, Buffer.from(extra)]);
}

function mp4Bytes(extra = "payload") {
  const head = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  return Buffer.concat([head, Buffer.from(extra)]);
}

function webmBytes(extra = "payload") {
  return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from(extra)]);
}

function writeMedia(dir, name, bytes) {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

function imagePath(path, overrides = {}) {
  return { path, alt: "Screen caption", revision: "rev-1", ...overrides };
}

function videoPath(path, overrides = {}) {
  return { path, alt: "Clip caption", revision: "rev-1", ...overrides };
}

test("undefined input returns undefined", async () => {
  assert.equal(await normalizeDocumentEvidence(undefined), undefined);
});

test("nonvisual requires a reason and needs no visual gaps", async () => {
  const home = makeTemp();
  try {
    await assert.rejects(normalizeDocumentEvidence({ impact: "nonvisual" }), /reason/);
    await assert.rejects(normalizeDocumentEvidence({ impact: "nonvisual", reason: "   " }), /reason/);
    const out = await normalizeDocumentEvidence({ impact: "nonvisual", reason: "Change is config-only." });
    assert.equal(out.impact, "nonvisual");
    assert.equal(out.reason, "Change is config-only.");
    assert.deepEqual(out.comparisons, []);
    assert.deepEqual(out.recordings, []);
    assert.deepEqual(out.gaps, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("local image paths normalize to data URLs and re-normalize identically", async () => {
  const home = makeTemp();
  try {
    const before = writeMedia(home, "before.png", pngBytes("before-1"));
    const after = writeMedia(home, "after.jpg", jpegBytes("after-1"));
    const input = {
      impact: "ui",
      comparisons: [{ id: "hero", title: "Hero", description: "Hero change", before: imagePath(before), after: imagePath(after) }],
      recordings: [],
      gaps: [],
    };
    const out = await normalizeDocumentEvidence(input);
    assert.equal(out.comparisons.length, 1);
    assert.ok(out.comparisons[0].before.dataUrl.startsWith("data:image/png;base64,"));
    assert.equal(out.comparisons[0].before.mimeType, "image/png");
    assert.equal(out.comparisons[0].after.mimeType, "image/jpeg");
    assert.ok(out.comparisons[0].before.bytes > 0);
    assert.match(out.comparisons[0].before.sha256, /^[0-9a-f]{64}$/);
    assert.equal("path" in out.comparisons[0].before, false);
    assert.equal("path" in out.comparisons[0].after, false);
    const again = await normalizeDocumentEvidence(out);
    assert.deepEqual(again, out);
    assert.equal(again.comparisons[0].before.sha256, out.comparisons[0].before.sha256);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("missing comparison sides become explicit truthful gaps without success claims", async () => {
  const home = makeTemp();
  try {
    const after = writeMedia(home, "after.webp", webpBytes("only-after"));
    const out = await normalizeDocumentEvidence({
      impact: "backend-visible",
      comparisons: [{ id: "only-after", title: "Only after", after: imagePath(after) }],
      recordings: [{ id: "clip", title: "Clip", description: "A clip", asset: videoPath(writeMedia(home, "c.mp4", mp4Bytes("v"))) }],
    });
    const kinds = out.gaps.map((gap) => gap.kind);
    assert.ok(kinds.includes("before"));
    assert.equal(kinds.includes("after"), false);
    const beforeGap = out.gaps.find((gap) => gap.kind === "before");
    assert.match(beforeGap.reason, /only-after/);
    assert.match(beforeGap.reason.toLowerCase(), /missing|has no/);
    for (const gap of out.gaps) {
      assert.doesNotMatch(gap.reason.toLowerCase(), /verif|success|passed|proven/);
    }
    assert.equal(out.comparisons[0].before, undefined);
    const again = await normalizeDocumentEvidence(out);
    assert.deepEqual(again, out);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("ui without comparisons or recordings records explicit missing-evidence gaps", async () => {
  const out = await normalizeDocumentEvidence({ impact: "ui" });
  const kinds = out.gaps.map((gap) => gap.kind).sort();
  assert.deepEqual(kinds, ["after", "before", "recording"]);
  for (const gap of out.gaps) {
    assert.match(gap.reason.toLowerCase(), /missing/);
    assert.doesNotMatch(gap.reason.toLowerCase(), /verif|success/);
  }
  const again = await normalizeDocumentEvidence(out);
  assert.deepEqual(again, out);
});

test("media allowlists accept png/jpeg/webp/mp4/webm and reject svg or text", async () => {
  const home = makeTemp();
  try {
    const png = writeMedia(home, "a.png", pngBytes());
    const jpg = writeMedia(home, "b.jpg", jpegBytes());
    const webp = writeMedia(home, "c.webp", webpBytes());
    const mp4 = writeMedia(home, "d.mp4", mp4Bytes());
    const webm = writeMedia(home, "e.webm", webmBytes());
    const ok = await normalizeDocumentEvidence({
      impact: "ui",
      comparisons: [
        { id: "c1", title: "C1", before: imagePath(png), after: imagePath(jpg) },
        { id: "c2", title: "C2", before: imagePath(webp), after: imagePath(png) },
      ],
      recordings: [
        { id: "r1", title: "R1", description: "D1", asset: videoPath(mp4) },
        { id: "r2", title: "R2", description: "D2", asset: videoPath(webm) },
      ],
    });
    assert.equal(ok.comparisons.length, 2);
    assert.equal(ok.recordings.length, 2);

    const svg = writeMedia(home, "s.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    await assert.rejects(
      normalizeDocumentEvidence({ impact: "ui", comparisons: [{ id: "x", title: "X", before: imagePath(svg) }] }),
      /SVG|supported media/i,
    );
    const txt = writeMedia(home, "t.png", Buffer.from("plain text, not media"));
    await assert.rejects(
      normalizeDocumentEvidence({ impact: "ui", comparisons: [{ id: "y", title: "Y", before: imagePath(txt) }] }),
      /supported media/i,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mismatching mime and malformed base64 are rejected", async () => {
  const home = makeTemp();
  try {
    const png = pngBytes("mismatch");
    const declaredJpeg = `data:image/jpeg;base64,${png.toString("base64")}`;
    await assert.rejects(
      normalizeDocumentEvidence({
        impact: "ui",
        comparisons: [{ id: "m", title: "M", before: { dataUrl: declaredJpeg, alt: "A", revision: "r" } }],
      }),
      /mismatch/i,
    );
    await assert.rejects(
      normalizeDocumentEvidence({
        impact: "ui",
        comparisons: [{ id: "b", title: "B", before: { dataUrl: "data:image/png;base64,!!!", alt: "A", revision: "r" } }],
      }),
      /canonical|malformed/i,
    );
    await assert.rejects(
      normalizeDocumentEvidence({
        impact: "ui",
        comparisons: [{ id: "c", title: "C", before: { dataUrl: "data:image/png;base64,", alt: "A", revision: "r" } }],
      }),
      /malformed|canonical/i,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("remote, file-url, and relative paths are rejected", async () => {
  for (const bad of ["https://example.test/a.png", "http://example.test/a.png", "file:///tmp/a.png", "data:image/png;base64,AAAA", "relative/a.png", "//cdn.test/a.png"]) {
    await assert.rejects(
      normalizeDocumentEvidence({ impact: "ui", comparisons: [{ id: "p", title: "P", before: { path: bad, alt: "A", revision: "r" } }] }),
      /absolute local path|URL/i,
    );
  }
  await assert.rejects(
    normalizeDocumentEvidence({ impact: "ui", comparisons: [{ id: "q", title: "Q", before: { alt: "A", revision: "r" } }] }),
    /exactly one of path or dataUrl/,
  );
  await assert.rejects(
    normalizeDocumentEvidence({
      impact: "ui",
      comparisons: [{ id: "z", title: "Z", before: { path: "/tmp/z.png", dataUrl: `data:image/png;base64,${pngBytes().toString("base64")}`, alt: "A", revision: "r" } }],
    }),
    /exactly one of path or dataUrl/,
  );
});

test("size limits are enforced before allocation and in aggregate", async () => {
  const home = makeTemp();
  try {
    const big = writeMedia(home, "big.png", pngBytes("tiny"));
    truncateSync(big, 8 * 1024 * 1024 + 1);
    await assert.rejects(
      normalizeDocumentEvidence({ impact: "ui", comparisons: [{ id: "big", title: "Big", before: imagePath(big) }] }),
      /size bound/i,
    );
    const v1 = writeMedia(home, "v1.mp4", mp4Bytes("one"));
    const v2 = writeMedia(home, "v2.mp4", mp4Bytes("two"));
    truncateSync(v1, 26 * 1024 * 1024);
    truncateSync(v2, 26 * 1024 * 1024);
    await assert.rejects(
      normalizeDocumentEvidence({
        impact: "ui",
        recordings: [
          { id: "a1", title: "A1", description: "D1", asset: videoPath(v1) },
          { id: "a2", title: "A2", description: "D2", asset: videoPath(v2) },
        ],
      }),
      /aggregate/i,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("non-regular files and symlink leaves are refused", async () => {
  const home = makeTemp();
  try {
    const dir = join(home, "adir");
    mkdirSync(dir);
    await assert.rejects(
      normalizeDocumentEvidence({ impact: "ui", comparisons: [{ id: "d", title: "D", before: imagePath(dir) }] }),
      /regular file/i,
    );
    const target = writeMedia(home, "real.png", pngBytes("real"));
    const link = join(home, "link.png");
    symlinkSync(target, link);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    await assert.rejects(
      normalizeDocumentEvidence({ impact: "ui", comparisons: [{ id: "s", title: "S", before: imagePath(link) }] }),
      /symbolic link/i,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("ids are safe and unique, counts and text are bounded", async () => {
  const home = makeTemp();
  try {
    const png = writeMedia(home, "u.png", pngBytes("u"));
    await assert.rejects(
      normalizeDocumentEvidence({
        impact: "ui",
        comparisons: [{ id: "bad id!", title: "T", before: imagePath(png) }],
      }),
      /safe id/i,
    );
    await assert.rejects(
      normalizeDocumentEvidence({
        impact: "ui",
        comparisons: [{ id: "dup", title: "T1", before: imagePath(png) }],
        recordings: [{ id: "dup", title: "T2", description: "D", asset: videoPath(writeMedia(home, "v.mp4", mp4Bytes())) }],
      }),
      /duplicated/i,
    );
    await assert.rejects(
      normalizeDocumentEvidence({ impact: "ui", comparisons: [{ id: "e", title: "   ", before: imagePath(png) }] }),
      /non-empty/,
    );
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, title: `T${i}` }));
    await assert.rejects(normalizeDocumentEvidence({ impact: "nonvisual", reason: "R", comparisons: many }), /exceed 12/);
    const manyRec = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, title: `T${i}`, description: "D", asset: { dataUrl: `data:video/mp4;base64,${mp4Bytes(String(i)).toString("base64")}`, alt: "A", revision: "r" } }));
    await assert.rejects(normalizeDocumentEvidence({ impact: "nonvisual", reason: "R", recordings: manyRec }), /exceed 6/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
