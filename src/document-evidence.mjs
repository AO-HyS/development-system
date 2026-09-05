// @ts-check
//
// Local document-evidence normalization. No network, no credentials, no
// verification claims. Every asset is read from an explicit regular local
// file (symlink leaf refused, size checked before allocation) or from a
// canonical base64 data URL with magic-bytes verification.

import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute } from "node:path";

const IMPACTS = new Set(["ui", "backend-visible", "nonvisual"]);
const GAP_KINDS = new Set(["before", "after", "recording"]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;

const MAX_COMPARISONS = 12;
const MAX_RECORDINGS = 6;
const MAX_GAPS = 50;

const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const VIDEO_MAX_BYTES = 32 * 1024 * 1024;
const AGGREGATE_MAX_BYTES = 50 * 1024 * 1024;

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/webm"]);

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 5000;
const REASON_MAX = 2000;
const ALT_MAX = 500;
const REVISION_MAX = 200;
const TRANSCRIPT_MAX = 20000;
const CAPTURED_AT_MAX = 100;

const DATA_URL_RE = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Trimmed non-empty bounded text.
 * @param {unknown} value
 * @param {string} field
 * @param {number} max
 * @param {boolean} singleLine
 * @returns {string}
 */
function assertText(value, field, max, singleLine) {
  if (typeof value !== "string") throw new Error(`Document evidence ${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`Document evidence ${field} must be non-empty`);
  if (trimmed.length > max) throw new Error(`Document evidence ${field} exceeds ${max} characters`);
  if (singleLine && (trimmed.includes("\n") || trimmed.includes("\r"))) {
    throw new Error(`Document evidence ${field} must be a single line`);
  }
  return trimmed;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function assertId(value, field) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new Error(`Document evidence ${field} requires a safe id ([A-Za-z0-9_-], up to 80 chars)`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function assertCapturedAt(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Document evidence capturedAt must be a string");
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error("Document evidence capturedAt must be non-empty");
  if (trimmed.length > CAPTURED_AT_MAX) {
    throw new Error(`Document evidence capturedAt exceeds ${CAPTURED_AT_MAX} characters`);
  }
  if (Number.isNaN(Date.parse(trimmed))) throw new Error("Document evidence capturedAt must be a valid timestamp");
  return trimmed;
}

/** @param {Buffer} value */
function sha256HexBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Detect the media mime from magic bytes. Returns null for unknown/SVG/text.
 * @param {Buffer} bytes
 * @returns {string | null}
 */
function detectMime(bytes) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return "video/mp4";
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "video/webm";
  }
  return null;
}

/**
 * Parse a canonical base64 data URL without allocating the payload first.
 * @param {unknown} value
 * @param {string} field
 * @returns {{ mime: string, body: string }}
 */
function parseDataUrl(value, field) {
  if (typeof value !== "string") throw new Error(`Document evidence ${field} must be a canonical base64 data URL`);
  if (value.length > 2 + 64 + 8 + Math.ceil((VIDEO_MAX_BYTES * 4) / 3) + 16) {
    throw new Error(`Document evidence ${field} exceeds the media size bound`);
  }
  const match = DATA_URL_RE.exec(value);
  if (!match) throw new Error(`Document evidence ${field} must be a canonical base64 data URL`);
  const mime = match[1].toLowerCase();
  const body = match[2];
  if (!body) throw new Error(`Document evidence ${field} carries malformed base64`);
  if (body.includes("\n") || body.includes("\r") || body.includes(" ") || body.includes("\t")) {
    throw new Error(`Document evidence ${field} carries malformed base64`);
  }
  if (body.length % 4 !== 0) {
    throw new Error(`Document evidence ${field} carries malformed base64`);
  }
  return { mime, body };
}

/**
 * Estimated decoded size without allocating.
 * @param {string} body
 * @returns {number}
 */
function estimatedBytes(body) {
  let padding = 0;
  if (body.endsWith("==")) padding = 2;
  else if (body.endsWith("=")) padding = 1;
  return Math.floor((body.length * 3) / 4) - padding;
}

/**
 * @param {string} path
 * @param {string} field
 */
function assertLocalPathShape(path, field) {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`Document evidence ${field} path must be a non-empty string`);
  }
  if (path.includes("\0")) throw new Error(`Document evidence ${field} path is invalid`);
  if (SCHEME_RE.test(path) || path.startsWith("//") || path.includes("://")) {
    throw new Error(`Document evidence ${field} path must be a local absolute path, not a URL`);
  }
  if (!isAbsolute(path)) throw new Error(`Document evidence ${field} path must be an absolute local path`);
  if (path.toLowerCase().endsWith(".svg")) throw new Error(`Document evidence ${field} must not be SVG`);
}

/**
 * Read one explicit local media file: regular file only, symlink leaf refused,
 * size checked before allocation, magic bytes verified.
 * @param {string} path
 * @param {string} field
 * @param {Set<string>} allowed
 * @param {number} maxBytes
 * @returns {Promise<{ bytes: Buffer, mime: string }>}
 */
async function readLocalMedia(path, field, allowed, maxBytes) {
  assertLocalPathShape(path, field);
  const status = await lstat(path);
  if (status.isSymbolicLink()) throw new Error(`Document evidence ${field} must not be a symbolic link`);
  if (!status.isFile()) throw new Error(`Document evidence ${field} must be a regular file`);
  if (status.size > maxBytes) throw new Error(`Document evidence ${field} exceeds the media size bound`);
  if (status.size === 0) throw new Error(`Document evidence ${field} is not a supported media type`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== status.ino || opened.dev !== status.dev) throw new Error(`Document evidence ${field} changed during capture`);
    if (opened.size > maxBytes) throw new Error(`Document evidence ${field} exceeds the media size bound`);
    // Bound the read even if another process grows the file after stat.
    const buffer = Buffer.alloc(opened.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    if (offset !== opened.size) throw new Error(`Document evidence ${field} changed during capture`);
    bytes = buffer.subarray(0, offset);
  } finally { await handle.close(); }
  if (bytes.length > maxBytes) throw new Error(`Document evidence ${field} exceeds the media size bound`);
  if (bytes.length === 0) throw new Error(`Document evidence ${field} is not a supported media type`);
  const detected = detectMime(bytes);
  if (!detected || !allowed.has(detected)) {
    throw new Error(`Document evidence ${field} is not a supported media type`);
  }
  return { bytes, mime: detected };
}

/**
 * Decode one data URL asset with preflight, magic check, and mime match.
 * @param {string} dataUrl
 * @param {string} field
 * @param {Set<string>} allowed
 * @param {number} maxBytes
 * @returns {{ bytes: Buffer, mime: string }}
 */
function decodeDataUrlMedia(dataUrl, field, allowed, maxBytes) {
  const { mime, body } = parseDataUrl(dataUrl, field);
  if (!allowed.has(mime)) throw new Error(`Document evidence ${field} media type ${mime} is not allowed`);
  const estimate = estimatedBytes(body);
  if (estimate > maxBytes) throw new Error(`Document evidence ${field} exceeds the media size bound`);
  let bytes;
  try {
    bytes = Buffer.from(body, "base64");
  } catch {
    throw new Error(`Document evidence ${field} carries malformed base64`);
  }
  if (bytes.length !== estimate) throw new Error(`Document evidence ${field} carries malformed base64`);
  if (bytes.toString("base64") !== body) throw new Error(`Document evidence ${field} carries malformed base64`);
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new Error(`Document evidence ${field} exceeds the media size bound`);
  }
  const detected = detectMime(bytes);
  if (!detected || !allowed.has(detected)) {
    throw new Error(`Document evidence ${field} is not a supported media type`);
  }
  if (detected !== mime) throw new Error(`Document evidence ${field} mime ${mime} mismatches detected ${detected}`);
  return { bytes, mime: detected };
}

/**
 * Normalize one image (before/after/poster).
 * @param {unknown} input
 * @param {string} field
 * @returns {Promise<{ dataUrl: string, mimeType: string, bytes: number, sha256: string, alt: string, revision: string, capturedAt?: string }>}
 */
async function normalizeImage(input, field) {
  if (!isRecord(input)) throw new Error(`Document evidence ${field} must be an object`);
  const hasPath = typeof input.path === "string";
  const hasData = typeof input.dataUrl === "string";
  if (hasPath === hasData) throw new Error(`Document evidence ${field} requires exactly one of path or dataUrl`);
  const alt = assertText(input.alt, `${field} alt`, ALT_MAX, true);
  const revision = assertText(input.revision, `${field} revision`, REVISION_MAX, true);
  const capturedAt = assertCapturedAt(input.capturedAt);
  /** @type {{ bytes: Buffer, mime: string }} */
  let media;
  if (hasPath) {
    media = await readLocalMedia(input.path, field, IMAGE_MIMES, IMAGE_MAX_BYTES);
  } else {
    media = decodeDataUrlMedia(input.dataUrl, field, IMAGE_MIMES, IMAGE_MAX_BYTES);
  }
  const dataUrl = `data:${media.mime};base64,${media.bytes.toString("base64")}`;
  return {
    dataUrl,
    mimeType: media.mime,
    bytes: media.bytes.length,
    sha256: sha256HexBytes(media.bytes),
    alt,
    revision,
    ...(capturedAt === undefined ? {} : { capturedAt }),
  };
}

/**
 * Normalize one video asset.
 * @param {unknown} input
 * @param {string} field
 * @returns {Promise<{ dataUrl: string, mimeType: string, bytes: number, sha256: string, alt: string, revision: string, capturedAt?: string }>}
 */
async function normalizeVideo(input, field) {
  if (!isRecord(input)) throw new Error(`Document evidence ${field} must be an object`);
  const hasPath = typeof input.path === "string";
  const hasData = typeof input.dataUrl === "string";
  if (hasPath === hasData) throw new Error(`Document evidence ${field} requires exactly one of path or dataUrl`);
  const alt = assertText(input.alt, `${field} alt`, ALT_MAX, true);
  const revision = assertText(input.revision, `${field} revision`, REVISION_MAX, true);
  const capturedAt = assertCapturedAt(input.capturedAt);
  /** @type {{ bytes: Buffer, mime: string }} */
  let media;
  if (hasPath) {
    media = await readLocalMedia(input.path, field, VIDEO_MIMES, VIDEO_MAX_BYTES);
  } else {
    media = decodeDataUrlMedia(input.dataUrl, field, VIDEO_MIMES, VIDEO_MAX_BYTES);
  }
  const dataUrl = `data:${media.mime};base64,${media.bytes.toString("base64")}`;
  return {
    dataUrl,
    mimeType: media.mime,
    bytes: media.bytes.length,
    sha256: sha256HexBytes(media.bytes),
    alt,
    revision,
    ...(capturedAt === undefined ? {} : { capturedAt }),
  };
}

/**
 * Normalize document evidence to portable data URLs with explicit gaps.
 * Missing comparison sides are recorded as gaps; ui/backend-visible impacts
 * also record missing comparison/recording lists. Never infers verification
 * success: gaps only state what is missing.
 * @param {unknown} input
 * @param {"en"|"es"} language
 * @returns {Promise<undefined | { impact: string, reason?: string, comparisons: any[], recordings: any[], gaps: any[] }>}
 */
export async function normalizeDocumentEvidence(input, language = "en") {
  if (input === undefined) return undefined;
  if (!isRecord(input)) throw new Error("Document evidence input must be an object");
  if (typeof input.impact !== "string" || !IMPACTS.has(input.impact)) {
    throw new Error("Document evidence impact must be ui, backend-visible, or nonvisual");
  }
  const impact = input.impact;

  let reason;
  if (impact === "nonvisual") {
    reason = assertText(input.reason, "reason", REASON_MAX, false);
  } else if (input.reason !== undefined) {
    reason = assertText(input.reason, "reason", REASON_MAX, false);
  }

  const rawComparisons = input.comparisons === undefined ? [] : input.comparisons;
  const rawRecordings = input.recordings === undefined ? [] : input.recordings;
  const rawGaps = input.gaps === undefined ? [] : input.gaps;
  if (!Array.isArray(rawComparisons)) throw new Error("Document evidence comparisons must be an array");
  if (!Array.isArray(rawRecordings)) throw new Error("Document evidence recordings must be an array");
  if (!Array.isArray(rawGaps)) throw new Error("Document evidence gaps must be an array");
  if (rawComparisons.length > MAX_COMPARISONS) {
    throw new Error(`Document evidence comparisons exceed ${MAX_COMPARISONS}`);
  }
  if (rawRecordings.length > MAX_RECORDINGS) {
    throw new Error(`Document evidence recordings exceed ${MAX_RECORDINGS}`);
  }
  if (rawGaps.length > MAX_GAPS) throw new Error(`Document evidence gaps exceed ${MAX_GAPS}`);

  const seenIds = new Set();
  /** @type {any[]} */
  const comparisons = [];
  for (let index = 0; index < rawComparisons.length; index += 1) {
    const entry = rawComparisons[index];
    const field = `comparison ${index + 1}`;
    if (!isRecord(entry)) throw new Error(`Document evidence ${field} must be an object`);
    const id = assertId(entry.id, `${field} id`);
    if (seenIds.has(id)) throw new Error(`Document evidence id "${id}" is duplicated`);
    seenIds.add(id);
    const title = assertText(entry.title, `${field} title`, TITLE_MAX, true);
    let description;
    if (entry.description !== undefined) {
      description = assertText(entry.description, `${field} description`, DESCRIPTION_MAX, false);
    }
    let before;
    if (entry.before !== undefined) {
      before = await normalizeImage(entry.before, `comparison "${id}" before`);
    }
    let after;
    if (entry.after !== undefined) {
      after = await normalizeImage(entry.after, `comparison "${id}" after`);
    }
    comparisons.push({
      id,
      title,
      ...(description === undefined ? {} : { description }),
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    });
  }

  /** @type {any[]} */
  const recordings = [];
  for (let index = 0; index < rawRecordings.length; index += 1) {
    const entry = rawRecordings[index];
    const field = `recording ${index + 1}`;
    if (!isRecord(entry)) throw new Error(`Document evidence ${field} must be an object`);
    const id = assertId(entry.id, `${field} id`);
    if (seenIds.has(id)) throw new Error(`Document evidence id "${id}" is duplicated`);
    seenIds.add(id);
    const title = assertText(entry.title, `${field} title`, TITLE_MAX, true);
    const description = assertText(entry.description, `${field} description`, DESCRIPTION_MAX, false);
    let transcript;
    if (entry.transcript !== undefined) {
      transcript = assertText(entry.transcript, `${field} transcript`, TRANSCRIPT_MAX, false);
    }
    if (entry.asset === undefined) throw new Error(`Document evidence recording "${id}" requires an asset`);
    const asset = await normalizeVideo(entry.asset, `recording "${id}" asset`);
    let poster;
    if (entry.poster !== undefined) {
      poster = await normalizeImage(entry.poster, `recording "${id}" poster`);
    }
    recordings.push({
      id,
      title,
      description,
      ...(transcript === undefined ? {} : { transcript }),
      asset,
      ...(poster === undefined ? {} : { poster }),
    });
  }

  /** @type {any[]} */
  const gaps = [];
  for (let index = 0; index < rawGaps.length; index += 1) {
    const entry = rawGaps[index];
    const field = `gap ${index + 1}`;
    if (!isRecord(entry)) throw new Error(`Document evidence ${field} must be an object`);
    if (typeof entry.kind !== "string" || !GAP_KINDS.has(entry.kind)) {
      throw new Error(`Document evidence ${field} kind must be before, after, or recording`);
    }
    const gapReason = assertText(entry.reason, `${field} reason`, REASON_MAX, false);
    gaps.push({ kind: entry.kind, reason: gapReason });
  }

  const known = new Set(gaps.map((gap) => `${gap.kind}|${gap.reason}`));
  /** @param {{ kind: string, reason: string }} candidate */
  function addGap(candidate) {
    const key = `${candidate.kind}|${candidate.reason}`;
    if (known.has(key)) return;
    if (gaps.length >= MAX_GAPS) throw new Error(`Document evidence gaps exceed ${MAX_GAPS}`);
    known.add(key);
    gaps.push(candidate);
  }

  for (const comparison of comparisons) {
    if (comparison.before === undefined) {
      addGap({ kind: "before", reason: language === "es" ? `Falta la captura inicial de «${comparison.title}».` : `Comparison "${comparison.id}" has no before image.` });
    }
    if (comparison.after === undefined) {
      addGap({ kind: "after", reason: language === "es" ? `Falta la captura del resultado de «${comparison.title}».` : `Comparison "${comparison.id}" has no after image.` });
    }
  }
  if ((impact === "ui" || impact === "backend-visible") && comparisons.length === 0) {
    addGap({ kind: "before", reason: language === "es" ? "Falta la captura del estado inicial." : `No comparisons for ${impact} impact; before evidence is missing.` });
    addGap({ kind: "after", reason: language === "es" ? "Falta la captura del resultado." : `No comparisons for ${impact} impact; after evidence is missing.` });
  }
  if ((impact === "ui" || impact === "backend-visible") && recordings.length === 0 && !gaps.some(gap => gap.kind === "recording")) {
    addGap({ kind: "recording", reason: language === "es" ? "Falta una grabación del recorrido afectado." : `No recordings for ${impact} impact; recording evidence is missing.` });
  }

  let aggregate = 0;
  for (const comparison of comparisons) {
    for (const side of ["before", "after"]) {
      if (comparison[side] !== undefined) aggregate += comparison[side].bytes;
    }
  }
  for (const recording of recordings) {
    aggregate += recording.asset.bytes;
    if (recording.poster !== undefined) aggregate += recording.poster.bytes;
  }
  if (aggregate > AGGREGATE_MAX_BYTES) {
    throw new Error("Document evidence aggregate media exceeds 50MiB");
  }

  return {
    impact,
    ...(reason === undefined ? {} : { reason }),
    comparisons,
    recordings,
    gaps,
  };
}
