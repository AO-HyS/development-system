// @ts-check

import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** @param {unknown} value */
function strings(value) { return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : []; }
/** @param {string} value */
function safeSurface(value) {
  return value.length > 0 && value !== "." && !value.startsWith("/") && !value.startsWith("~") && !value.includes("\\") &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..");
}
/** @param {string} child @param {string} parent */
function inside(child, parent) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep));
}
/** @param {string} surface @param {string} owned */
function containedBy(surface, owned) { return surface === owned || surface.startsWith(`${owned}/`); }
/** @param {string} left @param {string} right */
function overlaps(left, right) { return containedBy(left, right) || containedBy(right, left); }

/**
 * Trusted-host filesystem proof used immediately before dispatch. It rejects
 * symlink components instead of relying on lexical repository paths alone.
 * @param {unknown} input
 */
export async function verifyPathConfinement(input) {
  /** @type {string[]} */ const errors = [];
  if (!isRecord(input)) return { operation: "verify-path-confinement", valid: false, errors: ["input must be an object"] };
  const repositoryRoot = typeof input.repositoryRoot === "string" ? input.repositoryRoot : "";
  const revision = typeof input.revision === "string" ? input.revision : "";
  const scope = strings(input.scope);
  const protectedSurfaces = strings(input.protectedSurfaces);
  const surfaces = strings(input.surfaces);
  if (!repositoryRoot) errors.push("repositoryRoot is required");
  if (!/^[a-f0-9]{40,64}$/u.test(revision)) errors.push("revision requires an exact Git object id");
  if (scope.length === 0 || surfaces.length === 0) errors.push("scope and surfaces require at least one path");
  /** @type {Array<[string, string[]]>} */
  const pathGroups = [["scope", scope], ["protectedSurfaces", protectedSurfaces], ["surfaces", surfaces]];
  for (const [name, values] of pathGroups) {
    if (values.some((value) => !safeSurface(value))) errors.push(`${name} contains an unsafe repository-relative path`);
  }
  if (surfaces.some((surface) => !scope.some((owned) => containedBy(surface, owned)))) errors.push("surfaces must stay inside scope");
  if (surfaces.some((surface) => protectedSurfaces.some((blocked) => overlaps(surface, blocked)))) errors.push("surfaces overlap protected surfaces");
  if (errors.length > 0) return { operation: "verify-path-confinement", valid: false, errors };

  let canonicalRoot = "";
  try { canonicalRoot = await realpath(repositoryRoot); }
  catch { return { operation: "verify-path-confinement", valid: false, errors: ["repositoryRoot must exist"] }; }

  const inspected = [...new Set([...scope, ...protectedSurfaces, ...surfaces])];
  for (const surface of inspected) {
    let current = canonicalRoot;
    for (const part of surface.split("/")) {
      const next = resolve(current, part);
      if (!inside(next, canonicalRoot)) { errors.push(`${surface}: path escapes repository root`); break; }
      try {
        const stat = await lstat(next);
        if (stat.isSymbolicLink()) { errors.push(`${surface}: symlink component is forbidden at ${part}`); break; }
        current = next;
      } catch (error) {
        if (isRecord(error) && error.code === "ENOENT") break;
        errors.push(`${surface}: path inspection failed`);
        break;
      }
    }
    try {
      const canonicalExisting = await realpath(current);
      if (!inside(canonicalExisting, canonicalRoot)) errors.push(`${surface}: canonical path escapes repository root`);
    } catch { errors.push(`${surface}: canonical path inspection failed`); }
  }

  const binding = { repositoryRoot: canonicalRoot, revision, scope: [...scope].sort(), protectedSurfaces: [...protectedSurfaces].sort(), surfaces: [...surfaces].sort() };
  return {
    operation: "verify-path-confinement",
    valid: errors.length === 0,
    errors,
    proof: errors.length === 0 ? {
      schemaVersion: 1,
      symlinkPolicy: "reject-existing-components",
      binding,
      sha256: createHash("sha256").update(JSON.stringify(binding)).digest("hex"),
    } : null,
  };
}
