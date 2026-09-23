#!/usr/bin/env node

// @ts-check

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

/** Every existing segment below root must be a real directory, never a link.
 * @param {string} root @param {string} target */
async function assertSafeDirectory(root, target) {
  if (!isContained(root, target)) return false;
  let current = resolve(root);
  for (const segment of relative(root, target).split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || !entry.isDirectory()) return false;
    } catch (error) {
      if (isMissing(error)) return true;
      throw error;
    }
  }
  return true;
}

/** @param {string} path @param {unknown} value */
async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await rename(temporary, path);
}

const QUESTION_BODY_LIMIT = 256 * 1024;

/** @param {unknown} data */
function validQuestions(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const questions = /** @type {Record<string, unknown>} */ (data).questions;
  return Array.isArray(questions) && questions.length <= 200 && questions.every((item) => item && typeof item === "object" && typeof item.question === "string" && item.question.length > 0 && item.question.length <= 2000 && typeof item.blockId === "string" && item.blockId.length <= 120);
}

/** @param {import("node:http").IncomingMessage} request */
async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > QUESTION_BODY_LIMIT) throw Object.assign(new Error("Payload too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** @param {import("node:http").ServerResponse} response @param {number} status @param {unknown} body */
function sendJson(response, status, body) {
  response.writeHead(status, { "Cache-Control": "no-store, private", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(body));
}

/** @param {string} value */
function contentType(value) {
  return value.endsWith(".html") ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8";
}

/**
 * Start a bounded localhost Reader server. A cloudflared quick tunnel is added
 * only when `tunnel` is true; the random path remains required in both modes.
 * Reports may POST margin questions to `<report>.questions.json`; each batch is
 * stored beside the workspace under `.questions/<report>/` with a revision.
 * @param {{workspaceDir: string, readerFileName: string, ttlMs?: number, tunnel?: boolean, cloudflaredPath?: string, onQuestions?: (event: {reader: string, responsesPath: string, revision: number, receipt: string, count: number}) => void}} input
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
  // One server owns each answer file; revisions coordinate tabs, the chain orders writes.
  let questionWrites = Promise.resolve();

  /** @param {import("node:http").IncomingMessage} request @param {import("node:http").ServerResponse} response @param {string[]} rest */
  async function handleQuestions(request, response, rest) {
    const name = rest[rest.length - 1];
    const reader = resolve(workspaceDir, ...rest.slice(0, -1), name.replace(/\.questions\.json$/u, ".html"));
    const questionsRoot = resolve(workspaceDir, ".questions");
    const directory = resolve(questionsRoot, ...rest.slice(0, -1), name.replace(/\.questions\.json$/u, ""));
    if (!isContained(questionsRoot, directory) || !(await assertReadableRegularFile(workspaceDir, reader)) || !(await assertSafeDirectory(workspaceDir, directory))) { response.writeHead(404).end(); return; }
    const responsesPath = resolve(directory, "responses.json");
    const current = async () => {
      try {
        const entry = await lstat(responsesPath);
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Questions file is not a regular file");
        return JSON.parse(await readFile(responsesPath, "utf8"));
      } catch (error) {
        if (isMissing(error)) return { revision: 0, data: null };
        throw error;
      }
    };
    if (request.method === "GET" || request.method === "HEAD") { sendJson(response, 200, await current()); return; }
    if (request.method !== "POST") { response.writeHead(405, { Allow: "GET, HEAD, POST" }).end(); return; }
    const origin = request.headers.origin;
    if (origin && (() => { try { return new URL(origin).host !== request.headers.host; } catch { return true; } })()) { sendJson(response, 403, { error: "Cross-origin questions are refused" }); return; }
    if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) { sendJson(response, 415, { error: "Send JSON" }); return; }
    let payload;
    try { payload = JSON.parse(await readBody(request)); } catch (error) { sendJson(response, /** @type {any} */ (error).status ?? 400, { error: "Invalid questions payload" }); return; }
    if (!payload || !Number.isInteger(payload.expectedRevision) || !validQuestions(payload.data)) { sendJson(response, 400, { error: "Invalid questions payload" }); return; }
    const write = questionWrites.then(async () => {
      const saved = await current();
      if (payload.expectedRevision !== saved.revision) return { status: 409, body: { error: "Revision conflict", revision: saved.revision, data: saved.data } };
      await mkdir(resolve(directory, "submissions"), { recursive: true, mode: 0o700 });
      if (!(await assertSafeDirectory(workspaceDir, resolve(directory, "submissions")))) throw new Error("Questions directory changed");
      const submittedAt = new Date().toISOString();
      const receipt = `${submittedAt.replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "")}-${randomBytes(6).toString("hex")}`;
      const result = { revision: saved.revision + 1, receipt, submittedAt, reader: relative(workspaceDir, reader), data: payload.data };
      await writeJsonAtomic(resolve(directory, "submissions", `${receipt}.json`), result);
      await writeJsonAtomic(responsesPath, result);
      input.onQuestions?.({ reader: relative(workspaceDir, reader), responsesPath, revision: result.revision, receipt, count: payload.data.questions.length });
      return { status: 200, body: { revision: result.revision, receipt } };
    });
    questionWrites = write.catch(() => {});
    const outcome = await write;
    sendJson(response, outcome.status, outcome.body);
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
      if (segments.shift() !== token || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\") || segment.includes("\0"))) {
        response.writeHead(404).end();
        return;
      }
      if (segments.length > 1 && segments[0] === workspaceSlug && segments[segments.length - 1].endsWith(".questions.json")) {
        await handleQuestions(request, response, segments.slice(1));
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
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
  const live = await startReaderLive({ ...parseCli(process.argv.slice(2)), onQuestions: (event) => process.stdout.write(`${JSON.stringify({ event: "questions", ...event })}\n`) });
  process.stdout.write(`${JSON.stringify({ localUrl: live.localUrl, remoteUrl: live.remoteUrl, expiresAt: live.expiresAt })}\n`);
  const shutdown = () => { void live.stop(); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await live.closed;
}
