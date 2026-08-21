import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { startReaderLive } from "../artifacts/1.5.9/skills/internal/working-backwards/scripts/reader-live.mjs";

test("the live Reader serves one tokenized private workspace and stops cleanly", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aohys-reader-live-"));
  const workspaceDir = resolve(root, "working-backwards", "my-initiative");
  const historyDir = resolve(workspaceDir, "reader-history");
  await mkdir(historyDir, { recursive: true });
  await writeFile(resolve(workspaceDir, "my-initiative.html"), "<!doctype html><title>Main Reader</title>", "utf8");
  await writeFile(resolve(historyDir, "01-product-grill.html"), "<!doctype html><title>Product Grill</title>", "utf8");
  await writeFile(resolve(workspaceDir, "01-product-grill.md"), "# Product Grill", "utf8");
  await writeFile(resolve(root, "working-backwards", "index.html"), "<!doctype html><title>Library</title>", "utf8");

  const live = await startReaderLive({ workspaceDir, readerFileName: "my-initiative.html", ttlMs: 10_000 });
  assert.match(live.localUrl, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{32}\/my-initiative\/my-initiative\.html$/u);
  assert.equal((await fetch(live.localUrl)).status, 200);
  assert.equal((await fetch(new URL("reader-history/01-product-grill.html", live.localUrl))).status, 200);
  assert.equal((await fetch(new URL("01-product-grill.md", live.localUrl))).status, 200);
  assert.equal((await fetch(new URL("../other-initiative/secret.md", live.localUrl))).status, 404);
  assert.equal((await fetch(new URL("../index.html", live.localUrl))).status, 200);
  await live.stop();
  await assert.rejects(fetch(live.localUrl));
});

test("the remote review mode adds an expiring tokenized quick-tunnel URL", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aohys-reader-tunnel-"));
  const workspaceDir = resolve(root, "working-backwards", "remote-review");
  const fakeCloudflared = resolve(root, "fake-cloudflared.mjs");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(resolve(workspaceDir, "remote-review.html"), "<!doctype html><title>Remote</title>", "utf8");
  await writeFile(fakeCloudflared, "#!/usr/bin/env node\nprocess.stderr.write('https://bounded-reader.trycloudflare.com\\n');\nsetInterval(() => {}, 1000);\n", "utf8");
  await chmod(fakeCloudflared, 0o700);

  const live = await startReaderLive({ workspaceDir, readerFileName: "remote-review.html", ttlMs: 10_000, tunnel: true, cloudflaredPath: fakeCloudflared });
  assert.match(live.remoteUrl ?? "", /^https:\/\/bounded-reader\.trycloudflare\.com\/[a-f0-9]{32}\/remote-review\/remote-review\.html$/u);
  assert.ok(Date.parse(live.expiresAt) > Date.now());
  await live.stop();
});
