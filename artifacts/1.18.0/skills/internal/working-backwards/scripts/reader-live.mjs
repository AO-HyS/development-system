#!/usr/bin/env node

// @ts-check

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

/** @param {unknown} error */
function isMissing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {string} root @param {string} target */
function isContained(root, target) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

/** @param {string} root @param {string} target */
async function assertReadableRegularFile(root, target) {
  if (!isContained(root, target)) return false;
  let current = resolve(root);
  try {
    const rootEntry = await lstat(current);
    if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) return false;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  for (const segment of relative(root, target).split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) return false;
      if (current === target && !entry.isFile()) return false;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }
  return true;
}

/** @param {string} value */
function contentType(value) {
  return value.endsWith(".html") ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8";
}

/**
 * Start a bounded localhost Reader server. A cloudflared quick tunnel is added
 * only when `tunnel` is true; the random path remains required in both modes.
 * @param {{workspaceDir: string, readerFileName: string, ttlMs?: number, tunnel?: boolean, cloudflaredPath?: string}} input
 */
export async function startReaderLive(input) {
  const workspaceDir = resolve(input.workspaceDir);
  const root = dirname(workspaceDir);
  const workspaceSlug = basename(workspaceDir);
  const readerFileName = basename(input.readerFileName);
  const token = randomBytes(16).toString("hex");
  const ttlMs = Math.max(1_000, Math.min(input.ttlMs ?? 7_200_000, 86_400_000));
  /** @type {import("node:child_process").ChildProcessWithoutNullStreams | null} */
  let tunnelProcess = null;
  let stopped = false;
  /** @type {() => void} */
  let resolveClosed = () => {};
  const closed = new Promise((resolvePromise) => { resolveClosed = resolvePromise; });

  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
      if (segments.shift() !== token || segments.some((segment) => !segment || segment === "." || segment === "..")) {
        response.writeHead(404).end();
        return;
      }
      let target = "";
      if (segments.length === 1 && segments[0] === "index.html") target = resolve(root, "index.html");
      else if (segments.shift() === workspaceSlug && segments.length > 0) target = resolve(workspaceDir, ...segments);
      if (!target || !/\.(?:html|md)$/iu.test(target) || !(await assertReadableRegularFile(target === resolve(root, "index.html") ? root : workspaceDir, target))) {
        response.writeHead(404).end();
        return;
      }
      const bytes = await readFile(target);
      response.writeHead(200, {
        "Cache-Control": "no-store, private",
        "Content-Type": contentType(target),
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Reader live server did not bind a TCP port");
  const path = `/${token}/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(readerFileName)}`;
  const localUrl = `http://127.0.0.1:${address.port}${path}`;

  async function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(expiry);
    if (tunnelProcess && !tunnelProcess.killed) tunnelProcess.kill("SIGTERM");
    await new Promise((resolvePromise) => server.close(() => resolvePromise(undefined)));
    resolveClosed();
  }
  const expiry = setTimeout(() => { void stop(); }, ttlMs);
  expiry.unref();

  let remoteUrl = null;
  if (input.tunnel === true) {
    const cloudflaredPath = input.cloudflaredPath ?? "cloudflared";
    tunnelProcess = spawn(cloudflaredPath, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${address.port}`], { stdio: ["ignore", "pipe", "pipe"] });
    remoteUrl = await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for the temporary Reader tunnel")), 30_000);
      const inspect = (chunk) => {
        const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/iu);
        if (!match) return;
        clearTimeout(timer);
        resolvePromise(`${match[0]}${path}`);
      };
      tunnelProcess?.stdout.on("data", inspect);
      tunnelProcess?.stderr.on("data", inspect);
      tunnelProcess?.once("error", (error) => { clearTimeout(timer); reject(error); });
      tunnelProcess?.once("exit", (code) => { if (code && remoteUrl === null) { clearTimeout(timer); reject(new Error(`Temporary Reader tunnel exited with code ${code}`)); } });
    }).catch(async (error) => { await stop(); throw error; });
  }
  return { localUrl, remoteUrl, expiresAt: new Date(Date.now() + ttlMs).toISOString(), closed, stop };
}

function parseCli(argv) {
  const result = { workspaceDir: "", readerFileName: "", ttlMs: 7_200_000, tunnel: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--workspace") result.workspaceDir = argv[++index] ?? "";
    else if (value === "--reader") result.readerFileName = argv[++index] ?? "";
    else if (value === "--ttl-minutes") result.ttlMs = Number(argv[++index] ?? 120) * 60_000;
    else if (value === "--tunnel") result.tunnel = true;
  }
  if (!result.workspaceDir || !result.readerFileName) throw new Error("Usage: reader-live.mjs --workspace <private-workspace> --reader <reader.html> [--tunnel] [--ttl-minutes 120]");
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const live = await startReaderLive(parseCli(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ localUrl: live.localUrl, remoteUrl: live.remoteUrl, expiresAt: live.expiresAt })}\n`);
  const shutdown = () => { void live.stop(); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await live.closed;
}
