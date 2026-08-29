// @ts-check

const profiles = Object.freeze(["Quick", "Standard", "Complex"]);
/** @type {readonly (readonly [string, RegExp])[]} */
const hardRiskPatterns = Object.freeze([
  ["authorization", /\b(?:authorization|autorizacion|security|seguridad)\b/iu],
  ["sensitive-data", /\b(?:sensitive|sensible|personal data|datos personales)\b/iu],
  ["destructive-behavior", /\b(?:destructive|destructivo|delete|eliminar)\b/iu],
  ["migration", /\b(?:migration|migracion|backfill)\b/iu],
  ["paid-activation", /\b(?:paid|pago|cost|costo)\b/iu],
  ["multiple-repositories", /\b(?:multi[- ]?repo|multiple repositories|multiples repositorios)\b/iu],
  ["external-provider", /\b(?:provider|proveedor|webhook)\b/iu],
]);
const simpleRequestPattern = /\b(?:solo|solamente|nada mas|just|simply)\b[\s\S]{0,48}\b(?:implementa|implement|haz|make|cambia|change|corrige|fix)\b|\b(?:implementacion|implementation)\s+(?:simple|directa|direct)\b/iu;
const workingBackwardsIntentPattern = /\b(?:working[ -]?backwards|work[ -]?backwards|future customer story|amazon working backwards|product grill|technical grill)\b|\$working-backwards\b/iu;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function approved(value) {
  if (value === true) return true;
  if (typeof value === "string") return value.trim().toLowerCase() === "approved";
  if (!isRecord(value)) return false;
  const hasRevision = value.changesRequested === true
    || [value.feedback, value.revision, value.requestedChanges].some((entry) => typeof entry === "string" ? entry.trim().length > 0 : Array.isArray(entry) && entry.length > 0);
  return !hasRevision && (value.approved === true || value.status === "approved");
}

/** @param {unknown} value */
function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : [];
}

/** @param {unknown} value */
function requestedProfile(value) {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  return profiles.find((profile) => profile.toLowerCase() === candidate) ?? "Standard";
}

/** @param {Record<string, unknown>} input */
function quickEligible(input) {
  const evidence = isRecord(input.quickEvidence) ? input.quickEvidence : {};
  return evidence.behaviorSettled === true
    && evidence.scopeNarrow === true
    && evidence.rollbackEasy === true
    && evidence.singleSurface === true;
}

/** @param {string} profile */
function artifactsFor(profile) {
  const shared = ["product-grill-evidence", "working-backwards-brief", "technical-grill-evidence"];
  if (profile === "Quick") return [...shared, "acceptance-contract", "structure-outline", "ticket-map", "t3-implementation-handoff"];
  const standard = [...shared, "research-questions", "research-report", "product-contract", "domain-technical-design", "structure-outline", "ticket-map", "t3-implementation-handoff"];
  return profile === "Complex" ? [...standard.slice(0, -3), "risk-evidence", ...standard.slice(-3)] : standard;
}

const productTopics = Object.freeze([
  { id: "actor", question: "Who is this for?" },
  { id: "problem", question: "What problem do they experience today?" },
  { id: "outcome", question: "What useful outcome should become possible?" },
  { id: "experience", question: "How should the finished experience feel and behave?" },
  { id: "boundaries", question: "What is explicitly inside and outside this change?" },
]);

/** @param {unknown} value */
function pendingProductTopics(value) {
  const settled = new Set(isRecord(value) ? stringArray(value.settledTopics) : []);
  return productTopics.filter((topic) => !settled.has(topic.id));
}

/** @param {Record<string, unknown>} input @param {string[]} risks @param {string} profile */
function technicalTopics(input, risks, profile) {
  const repositoryKnown = isRecord(input.repository) && Object.keys(input.repository).length > 0;
  const topics = [
    { id: "behavior", reason: "approved-customer-story" },
    { id: "entities-and-states", reason: "approved-customer-story" },
    { id: "interfaces-and-data", reason: "implementation-contract" },
    { id: "testing-and-rollout", reason: "implementation-contract" },
  ];
  if (repositoryKnown) topics.unshift({ id: "current-repository-behavior", reason: "repository-evidence-present" });
  for (const risk of risks) topics.push({ id: `risk:${risk}`, reason: "hard-risk-trigger" });
  const settled = new Set(isRecord(input.technicalGrill) ? stringArray(input.technicalGrill.settledTopics) : []);
  const depth = profile === "Quick" ? "compact" : profile === "Complex" ? "risk-specific" : "complete";
  return topics.filter((topic) => !settled.has(topic.id)).map((topic) => ({ ...topic, depth }));
}

/** @param {unknown} value */
function storyCandidate(value) {
  if (!isRecord(value)) return null;
  /** @param {string} key @param {string} [fallback] */
  const text = (key, fallback = "") => typeof value[key] === "string" ? value[key].trim() : fallback;
  return {
    role: "working-backwards-brief",
    status: "draft",
    actor: text("actor", "persona usuaria"),
    problem: text("problem"),
    desiredOutcome: text("desiredOutcome", text("outcome")),
    futureExperience: text("futureExperience", text("experience")),
    boundaries: stringArray(value.boundaries),
    technicalDecisions: [],
  };
}

/**
 * Route one definition request without mutating lifecycle, repository, HOME, or
 * trackers. State is explicit; natural language can request the bounded simple
 * path but cannot invent the evidence that makes it eligible.
 * @param {Record<string, unknown>} input
 */
export function routeDefinition(input) {
  const request = typeof input.request === "string" ? input.request.trim() : "";
  const semanticRequest = request.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const risks = [...new Set([
    ...stringArray(input.riskTriggers),
    ...hardRiskPatterns.filter(([, pattern]) => pattern.test(semanticRequest)).map(([risk]) => risk),
  ])];
  const hasHardRisk = risks.length > 0;
  const requested = requestedProfile(input.profile);
  const selectedProfile = hasHardRisk ? "Complex" : requested === "Quick" && !quickEligible(input) ? "Standard" : requested;
  const simpleRequested = input.simpleImplementationRequested === true || simpleRequestPattern.test(semanticRequest);
  const simpleEligible = simpleRequested && quickEligible(input) && !hasHardRisk;
  const workingBackwardsRequested = input.workingBackwardsRequested === true
    || workingBackwardsIntentPattern.test(semanticRequest)
    || input.productGrill !== undefined
    || input.customerStory !== undefined
    || input.technicalGrill !== undefined;

  let currentStage;
  let nextAction;
  if (simpleEligible) {
    currentStage = "simple-implementation";
    nextAction = "Request Implement Preview for the explicit simple slice";
  } else if (!workingBackwardsRequested) {
    currentStage = "implementation";
    nextAction = "Implement the requested change directly; invoke a definition flow only when you want one";
  } else if (!approved(input.productGrill)) {
    currentStage = "product-grill";
    nextAction = "Run Product Grill With Docs by Topic";
  } else if (!approved(input.customerStory)) {
    currentStage = "customer-story";
    nextAction = "Generate and approve a compact non-technical Future Customer Story";
  } else if (!approved(input.technicalGrill)) {
    currentStage = "technical-grill";
    nextAction = "Run the story-driven Technical Grill With Docs";
  } else {
    currentStage = "working-backwards-contracts";
    nextAction = selectedProfile === "Quick"
      ? "Produce the compact contracts, ticket map, and private handoff"
      : "Continue the programmed Working Backwards contracts and gates";
  }

  const activeTopics = currentStage === "product-grill"
    ? pendingProductTopics(input.productGrill)
    : currentStage === "technical-grill"
      ? technicalTopics(input, risks, selectedProfile)
      : [];

  return {
    ok: true,
    operation: "definition-route",
    supportedHarnesses: ["codex", "t3-code"],
    requestedProfile: requested,
    selectedProfile,
    hardRiskTriggers: risks,
    simpleImplementation: {
      requested: simpleRequested,
      eligible: simpleEligible,
      deniedReason: simpleRequested && !simpleEligible ? hasHardRisk ? "hard-risk-requires-complex" : "quick-evidence-incomplete" : null,
    },
    currentStage,
    nextAction,
    activeTopics,
    artifactCandidate: currentStage === "customer-story" ? storyCandidate(input.productGrill) : null,
    requiredArtifacts: simpleEligible || currentStage === "implementation" ? [] : artifactsFor(selectedProfile),
    workingBackwardsRequested,
    implementationAuthorized: false,
    externalWriteIntents: [],
    externalSideEffects: [],
  };
}
