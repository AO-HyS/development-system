// @ts-check

import { selectApplicableQualityChecks } from "./stack-quality-profiles.mjs";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** @param {unknown} value @returns {string[]} */
function strings(value) { return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : []; }

/** @type {Readonly<Record<string, {skills: string[], tactics: string[]}>>} */
const profileMap = Object.freeze({
  typescript: { skills: ["tdd"], tactics: ["type-discipline"] },
  react: { skills: ["vercel-react-best-practices", "impeccable"], tactics: ["subtract-before-add", "prove-it-works"] },
  ui: { skills: ["impeccable"], tactics: ["prove-it-works"] },
  convex: { skills: ["convex-best-practices", "convex:convex-expert", "convex-guardian"], tactics: ["fix-root-causes", "type-discipline"] },
  security: { skills: ["codex-security:security-diff-scan"], tactics: ["interrogate-assumptions"] },
  performance: { skills: ["convex-performance-audit"], tactics: ["how-and-why"] },
  browser: { skills: ["maintain-product-verification"], tactics: ["prove-it-works"] },
  architecture: { skills: ["codebase-design"], tactics: ["architect", "how-and-why"] },
  tanstack: { skills: ["vercel-react-best-practices"], tactics: ["subtract-before-add", "prove-it-works"] },
  turborepo: { skills: ["codebase-design"], tactics: ["architect", "dependency-direction"] },
  cloudflare: { skills: ["cloudflare-deploy"], tactics: ["prove-it-works"] },
  shadcn: { skills: ["shadcn", "impeccable"], tactics: ["subtract-before-add", "prove-it-works"] },
  electron: { skills: ["codebase-design"], tactics: ["platform-boundary"] },
  "expo-react-native": { skills: ["tamagui"], tactics: ["platform-boundary", "prove-it-works"] },
  ios: { skills: ["codebase-design"], tactics: ["platform-boundary"] },
  android: { skills: ["codebase-design"], tactics: ["platform-boundary"] },
});

const stackCapabilities = new Set(["react", "convex", "tanstack", "turborepo", "cloudflare", "shadcn", "electron", "expo-react-native", "ios", "android"]);

/**
 * Compose an auditable lane packet from declared ticket capabilities. Skill
 * names are references, not claims that a host discovered or loaded them.
 * @param {Record<string, unknown>} ticket
 * @param {{integrationChecks?: unknown, runtimeEvidence?: unknown}} [options]
 */
export function buildOrchestrationBundle(ticket, options = {}) {
  const errors = [];
  const id = typeof ticket.id === "string" ? ticket.id.trim() : "";
  const capabilities = strings(ticket.capabilities);
  const focusedChecks = strings(ticket.checks);
  const integrationChecks = strings(options.integrationChecks);
  if (!id) errors.push("ticket.id is required");
  if (capabilities.length === 0) errors.push(`${id || "ticket"} requires capabilities`);
  if (focusedChecks.length === 0) errors.push(`${id || "ticket"} requires focused checks`);
  if (integrationChecks.length === 0) errors.push("integrationChecks are required");
  const unknown = capabilities.filter((capability) => !(capability in profileMap));
  if (unknown.length > 0) errors.push(`unsupported capabilities: ${unknown.join(", ")}`);
  const profiles = capabilities.map((capability) => profileMap[capability]).filter(Boolean);
  const referenceSkills = [...new Set(["pstack-engineering", ...profiles.flatMap((profile) => profile.skills)])];
  const selectedStackCapabilities = capabilities.filter((capability) => stackCapabilities.has(capability));
  const qualitySelection = selectedStackCapabilities.length > 0
    ? selectApplicableQualityChecks({
        capabilities: selectedStackCapabilities,
        changedSurfaces: [{ id, capabilities: selectedStackCapabilities }],
      })
    : { valid: true, errors: [], checks: [] };
  if (!qualitySelection.valid) errors.push(...qualitySelection.errors);
  const qualityOracles = Array.isArray(qualitySelection.checks)
    ? qualitySelection.checks.flatMap((check) => check ? [check.oracle] : [])
    : [];
  const nonStackOracles = [
    ...(capabilities.includes("typescript") ? ["lint", "typecheck", "focused-tests"] : []),
    ...(capabilities.includes("security") ? ["codex-security"] : []),
    ...(capabilities.includes("performance") ? ["performance-audit"] : []),
    ...(capabilities.includes("browser") ? ["computer-use-evidence"] : []),
    ...(capabilities.includes("architecture") ? ["architecture-review"] : []),
    ...(capabilities.includes("ui") ? ["impeccable", "visual-review"] : []),
  ];
  return {
    schemaVersion: 1,
    valid: errors.length === 0,
    errors,
    ticketId: id,
    capabilities,
    tactics: [...new Set(profiles.flatMap((profile) => profile.tactics))],
    referenceSkills,
    focusedChecks,
    qualityOracles: [...new Set([...qualityOracles, ...nonStackOracles])],
    integrationChecks,
    runtimeRequirements: referenceSkills.map((skill) => ({
      skill,
      status: "unproven",
      fallback: "Use the repository contract and declared checks; do not claim skill influence without a host-validated runtime receipt.",
    })),
    provenance: {
      tactics: "Development System adaptation of selected PStack engineering patterns",
      authority: "none",
    },
    externalWriteIntents: [],
    externalSideEffects: [],
  };
}
