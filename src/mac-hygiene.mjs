// @ts-check
// Read-only macOS hygiene diagnostic for `doctor` (DS 4.4.0).
// Inspects `/private/tmp/claude-501` accumulation and orphan MCP processes (ppid=1).
// Never deletes files and never terminates processes.
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";

const DEFAULT_TMP_DIR = "/private/tmp/claude-501";
const DEFAULT_TMP_WARN_BYTES = 50 * 1024 * 1024;
const DEFAULT_TMP_WARN_FILES = 500;
const MAX_TMP_ENTRIES = 5000;
const MAX_ORPHAN_REPORTED = 20;
const PS_TIMEOUT_MS = 2000;

const MCP_PATTERN = /\bmcp\b|@modelcontextprotocol|mcp-server|opencode-browse|playwright-mcp|convex-mcp|linear-mcp|context7/i;
const SYSTEM_PATH_PATTERN = /^\/(?:System|usr\/libexec|sbin)\//u;

/**
 * @typedef {{
 *   platform?: string,
 *   tmpDir?: string,
 *   psOutput?: string,
 *   tmpWarnBytes?: number,
 *   tmpWarnFiles?: number,
 * }} MacHygieneOptions
 */

/**
 * @typedef {{
 *   path: string,
 *   exists: boolean,
 *   fileCount: number,
 *   bytes: number,
 *   truncated: boolean,
 *   warn: boolean,
 * }} ClaudeTmpReport
 */

/**
 * @typedef {{
 *   pid: number,
 *   ppid: number,
 *   executable: string,
 * }} OrphanMcpProcess
 */

/**
 * @typedef {{
 *   count: number,
 *   processes: OrphanMcpProcess[],
 *   warn: boolean,
 * }} OrphanMcpReport
 */

/**
 * @typedef {{
 *   ok: boolean,
 *   platform: string,
 *   supported: boolean,
 *   claudeTmp: ClaudeTmpReport | null,
 *   orphanMcps: OrphanMcpReport | null,
 *   warnings: string[],
 * }} MacHygieneReport
 */

/** @param {number} bytes */
function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/**
 * Safely scans a temp directory without following symlinks and with an entry cap.
 * @param {string} tmpDir
 * @param {number} warnBytes
 * @param {number} warnFiles
 * @returns {ClaudeTmpReport}
 */
function scanClaudeTmp(tmpDir, warnBytes, warnFiles) {
  let rootStat;
  try {
    rootStat = lstatSync(tmpDir);
  } catch {
    return { path: tmpDir, exists: false, fileCount: 0, bytes: 0, truncated: false, warn: false };
  }
  if (rootStat.isSymbolicLink()) {
    return { path: tmpDir, exists: true, fileCount: 0, bytes: 0, truncated: false, warn: false };
  }
  if (!rootStat.isDirectory()) {
    const bytes = rootStat.isFile() ? rootStat.size : 0;
    const fileCount = rootStat.isFile() ? 1 : 0;
    return { path: tmpDir, exists: true, fileCount, bytes, truncated: false, warn: bytes >= warnBytes || fileCount >= warnFiles };
  }

  let fileCount = 0;
  let bytes = 0;
  let entries = 0;
  let truncated = false;
  /** @type {string[]} */
  const stack = [tmpDir];

  while (stack.length > 0 && !truncated) {
    const current = /** @type {string} */ (stack.pop());
    /** @type {string[]} */
    let children;
    try {
      children = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of children) {
      if (entries >= MAX_TMP_ENTRIES) {
        truncated = true;
        break;
      }
      entries += 1;
      const fullPath = path.join(current, name);
      let stat;
      try {
        stat = lstatSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) stack.push(fullPath);
      else if (stat.isFile()) {
        fileCount += 1;
        bytes += stat.size;
      }
    }
  }

  const warn = bytes >= warnBytes || fileCount >= warnFiles || truncated;
  return { path: tmpDir, exists: true, fileCount, bytes, truncated, warn };
}

/**
 * Reads `ps -eo pid=,ppid=,command=` with a short timeout.
 * @returns {string}
 */
function readProcessTable() {
  try {
    return execFileSync("ps", ["-eo", "pid=,ppid=,command="], {
      encoding: "utf8",
      timeout: PS_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
}

/**
 * Extracts only a safe executable basename from a raw `ps` command line so CLI arguments
 * (which may hold tokens or headers) are never retained or serialized.
 * @param {string} command
 * @returns {string}
 */
function safeExecutable(command) {
  const firstToken = command.split(/\s+/u)[0] ?? "";
  const cleaned = firstToken.replace(/^['"]|['"]$/gu, "");
  const base = path.basename(cleaned);
  return base || "unknown";
}

/**
 * Finds orphan MCP / agent helper processes (ppid === 1).
 * @param {string | undefined} psOutput
 * @returns {OrphanMcpReport}
 */
function scanOrphanMcps(psOutput) {
  const raw = psOutput !== undefined ? psOutput : readProcessTable();
  /** @type {OrphanMcpProcess[]} */
  const matches = [];
  for (const rawLine of raw.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const command = match[3].trim();
    if (ppid !== 1 || pid === process.pid) continue;
    if (SYSTEM_PATH_PATTERN.test(command)) continue;
    if (!MCP_PATTERN.test(command)) continue;
    matches.push({
      pid,
      ppid,
      executable: safeExecutable(command),
    });
  }
  return {
    count: matches.length,
    processes: matches.slice(0, MAX_ORPHAN_REPORTED),
    warn: matches.length > 0,
  };
}

/**
 * Read-only macOS hygiene diagnostic: inspects Claude temp dir and orphan MCP processes.
 * @param {MacHygieneOptions} [options]
 * @returns {MacHygieneReport}
 */
export function macHygiene(options = {}) {
  const platform = options.platform ?? process.platform;
  const hasOverride = options.tmpDir !== undefined || options.psOutput !== undefined;
  if (platform !== "darwin" && !hasOverride) {
    return { ok: true, platform, supported: false, claudeTmp: null, orphanMcps: null, warnings: [] };
  }

  const tmpDir = options.tmpDir ?? DEFAULT_TMP_DIR;
  const tmpWarnBytes = options.tmpWarnBytes ?? DEFAULT_TMP_WARN_BYTES;
  const tmpWarnFiles = options.tmpWarnFiles ?? DEFAULT_TMP_WARN_FILES;

  const claudeTmp = scanClaudeTmp(tmpDir, tmpWarnBytes, tmpWarnFiles);
  const orphanMcps = scanOrphanMcps(options.psOutput);

  /** @type {string[]} */
  const warnings = [];
  if (claudeTmp.warn) {
    const countLabel = `${claudeTmp.fileCount}${claudeTmp.truncated ? "+" : ""}`;
    warnings.push(
      `${claudeTmp.path} acumula ${countLabel} archivos (${formatBytes(claudeTmp.bytes)}). Revisa y limpia subdirectorios antiguos a mano cuando no haya sesiones activas.`,
    );
  }
  if (orphanMcps.warn) {
    const pids = orphanMcps.processes.slice(0, 5).map((item) => item.pid);
    const extra = orphanMcps.count > pids.length ? ` (+${orphanMcps.count - pids.length} más)` : "";
    warnings.push(
      `${orphanMcps.count} proceso(s) MCP huérfano(s) (ppid=1): PID ${pids.join(", ")}${extra}. Inspecciona y detén a mano los que ya no correspondan a una sesión activa.`,
    );
  }

  return {
    ok: warnings.length === 0,
    platform,
    supported: true,
    claudeTmp,
    orphanMcps,
    warnings,
  };
}

/**
 * Formats a compact 1-3 line summary for `doctor` human output.
 * @param {MacHygieneReport} report
 * @returns {string[]}
 */
export function formatMacHygiene(report) {
  if (!report.supported) return [];
  if (report.warnings.length === 0) return ["Higiene Mac: limpio"];
  return ["Higiene Mac: avisos", ...report.warnings.map((warning) => `- ${warning}`)];
}
