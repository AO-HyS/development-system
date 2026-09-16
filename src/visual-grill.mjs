// @ts-check

const visualPattern = /\b(?:grill[^.]{0,36}(?:visuales?|apariencia|como luce|look)|como luce|como se ve|apariencia|visual(?:es)? direction|direccion visual|propuestas?[^.]{0,40}(?:visuales?|funcional)|design directions?)\b/iu;
const mixedPattern = /\b(?:tanto|both)\b[^.]{0,64}\b(?:funcionamiento|funcional|behavior)\b[^.]{0,64}\b(?:apariencia|visual|look)\b|\b(?:funcionamiento|funcional|behavior)\b[^.]{0,64}\b(?:apariencia|visual|look)\b/iu;
const proposalFirstPattern = /\b(?:propuestas?|alternativas?|directions?)\b[^.]{0,56}\b(?:antes|before)\b[^.]{0,36}\b(?:funcional|functional)\b/iu;
const explicitExplorationPattern = /\b(?:grill|propuestas?|alternativas?|explora|explore|muestra|show|directions?)\b/iu;
const implementationIntentPattern = /\b(?:implementa|implement|construye|build|ejecuta|execute|aplica|apply)\b/iu;
const continuationPattern = /\b(?:continua|continue|refina|refine|itera|iterate)\b[^.]{0,64}\b(?:direccion|direction|visual|apariencia)\b/iu;
const smallVisualPattern = /\b(?:pequeno|small|ajusta|adjust|corrige|fix|cambia|change|pulir|polish)\b[^.]{0,64}\b(?:espaciado|spacing|color|tokens?(?:\s+(?:de\s+)?)?(?:diseno|design|visual|color)|tipografia|typography|borde|radius|estilo|style|componente|component)\b/iu;
const functionalGrillPattern = /\b(?:grill|entrevista|interview)\b[^.]{0,48}\b(?:funcional|functional|producto|product|requisitos?|requirements?)\b/iu;

/** @param {unknown} value */
function records(value) {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object") : [];
}

/** @param {unknown} value */
function strings(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim())
    : [];
}

/** @param {string} value */
function normalized(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** @param {unknown} value */
function directionSelected(value) {
  if (!value || typeof value !== "object") return false;
  const brief = /** @type {Record<string, unknown>} */ (value);
  return typeof brief.selectedDirection === "string" && brief.selectedDirection.trim().length > 0
    || ["selected", "refining", "implementing", "verified"].includes(String(brief.phase ?? ""));
}

/** @param {unknown} value */
function answeredKeys(value) {
  const settled = new Set();
  for (const raw of records(value)) {
    const entry = /** @type {Record<string, unknown>} */ (raw);
    if (typeof entry.key !== "string" || !entry.key.trim()) continue;
    const status = String(entry.status ?? "answered");
    if (!["deferred", "tentative", "rejected", "open"].includes(status)) settled.add(entry.key.trim());
  }
  return settled;
}

/** @param {unknown} value @param {number | null} expectedCandidateCount */
function explorationReceipt(value, expectedCandidateCount) {
  if (!value || typeof value !== "object") return { status: "missing", events: [], issues: [] };
  const receipt = /** @type {Record<string, unknown>} */ (value);
  const events = records(receipt.events).map((raw) => {
    const event = /** @type {Record<string, unknown>} */ (raw);
    return { type: String(event.type ?? ""), at: String(event.at ?? "") };
  });
  const expected = ["candidates", "concept-seed", "comparison"];
  const observed = events.map((event) => event.type);
  const positions = expected.map((type) => observed.indexOf(type));
  const issues = [];
  if (positions.some((position) => position < 0)) issues.push("missing-required-event");
  if (positions.every((position) => position >= 0) && !(positions[0] < positions[1] && positions[1] < positions[2])) {
    issues.push("invalid-candidate-seed-comparison-order");
  }
  const candidates = records(receipt.candidates);
  if (candidates.length === 0) issues.push("missing-candidates");
  if (expectedCandidateCount !== null && candidates.length !== expectedCandidateCount) issues.push("candidate-count-mismatch");
  for (const raw of candidates) {
    const candidate = /** @type {Record<string, unknown>} */ (raw);
    if (![candidate.thesis, candidate.visibleDifference, candidate.opportunity, candidate.risk]
      .every((entry) => typeof entry === "string" && entry.trim())) {
      issues.push("candidate-contract-incomplete");
      break;
    }
  }
  const eventTimes = events.map((event) => Date.parse(event.at));
  if (events.length > 1 && eventTimes.every(Number.isFinite)) {
    for (let index = 1; index < eventTimes.length; index += 1) {
      if (eventTimes[index] < eventTimes[index - 1]) {
        issues.push("non-monotonic-event-time");
        break;
      }
    }
  }
  return { status: issues.length ? "invalid" : "valid", events, issues };
}

/**
 * Pure decision seam for a visual, mixed or functional grill. It classifies and
 * validates explicit state without writing HOME, product files or session data.
 * @param {Record<string, unknown>} input
 */
export function routeVisualGrill(input) {
  const request = typeof input.request === "string" ? input.request.trim() : "";
  const text = normalized(request);
  const brief = input.brief && typeof input.brief === "object"
    ? /** @type {Record<string, unknown>} */ (input.brief)
    : {};
  const selected = directionSelected(brief);
  const mixed = mixedPattern.test(text);
  const proposalFirst = proposalFirstPattern.test(text);
  const visualCandidate = visualPattern.test(text) || proposalFirst || mixed;
  const implementationOnly = implementationIntentPattern.test(text) && !explicitExplorationPattern.test(text);
  const visual = visualCandidate && !implementationOnly;
  const smallVisual = smallVisualPattern.test(text) && !/\b(?:grill|propuestas?|alternativas?|directions?)\b/iu.test(text);
  const functionalGrill = functionalGrillPattern.test(text) && !visual;

  let mode = "none";
  if (selected && !functionalGrill && (visual || continuationPattern.test(text))) mode = "continuation";
  else if (smallVisual) mode = "refinement";
  else if (mixed) mode = "mixed-grill";
  else if (visual) mode = "visual-grill";
  else if (functionalGrill) mode = "functional-grill";

  const requestedCount = Number.isInteger(input.requestedAlternatives)
    ? Number(input.requestedAlternatives)
    : /\b(?:tres|three|3)\b[^.]{0,24}\b(?:propuestas?|alternativas?|directions?|options?)\b/iu.test(text)
      ? 3
      : null;
  const interviewAnswers = answeredKeys(brief.interviewAnswers);
  const nextKeys = strings(input.nextProposalDecisionKeys);
  const openDecisionKeys = nextKeys.filter((key) => !interviewAnswers.has(key));
  const capabilities = input.capabilities && typeof input.capabilities === "object"
    ? /** @type {Record<string, unknown>} */ (input.capabilities)
    : {};
  const limitations = [];
  if (capabilities.imageGeneration === false) limitations.push("image-generation-unavailable");
  if (capabilities.vision === false) limitations.push("visual-judgment-unavailable");
  const rejected = brief.selectionStatus === "all-rejected";

  const requiredFlow = mode === "visual-grill" || mode === "mixed-grill"
    ? ["recover-decisions", "one-interview", "references", "candidates", "concept-seed", "comparison", "human-selection"]
    : mode === "continuation"
      ? ["recover-selected-direction", "refine", "prototype-interaction", "extend-after-selection", "independent-critique"]
      : mode === "refinement"
        ? ["impeccable-refinement", "focused-check"]
        : mode === "functional-grill"
          ? ["functional-interview"]
          : [];

  return {
    ok: true,
    operation: "visual-grill-route",
    mode,
    leadSkill: mode === "visual-grill" || mode === "mixed-grill" || mode === "continuation"
      ? "design-direction"
      : mode === "functional-grill"
        ? "grill-with-docs"
        : mode === "refinement"
          ? "impeccable"
          : null,
    questionSurface: mode === "visual-grill" || mode === "mixed-grill" ? "grill-with-docs" : null,
    interviewPolicy: {
      maximumConcurrentInterviews: mode === "visual-grill" || mode === "mixed-grill" ? 1 : 0,
      recoveredAnswerKeys: [...interviewAnswers].sort(),
      openDecisionKeys,
    },
    requestedAlternatives: requestedCount,
    exactAlternativeCountRequired: requestedCount === 3,
    selectedDirection: typeof brief.selectedDirection === "string" ? brief.selectedDirection : null,
    restartExploration: mode === "continuation" ? false : mode === "visual-grill" || mode === "mixed-grill",
    rejection: rejected ? { selectionRequired: false, nextAction: "revise-hypothesis-from-literal-correction" } : null,
    decisionLedger: {
      confirmedConstraints: records(brief.confirmedConstraints),
      verifiedProductFacts: records(brief.verifiedProductFacts),
      agentProposals: records(brief.agentProposals),
      identity: brief.identity ?? null,
      composition: brief.composition ?? null,
      interaction: brief.interaction ?? null,
    },
    explorationReceipt: explorationReceipt(brief.explorationReceipt, requestedCount),
    critiqueContract: {
      inputs: ["current-screenshots", "task-and-context", "confirmed-constraints", "selected-direction-if-any", "references-with-functions"],
      excludes: ["implementer-rationale", "self-evaluation", "earlier-critique"],
      outputs: ["constraint-conformity", "compositional-quality"],
      initialPasses: [1, 2],
      scoreRole: "supporting-only",
    },
    requiredFlow,
    limitations,
    allowedEvidence: [
      "html-css-prototype",
      ...(capabilities.vision === false ? [] : ["current-screenshot-review"]),
      ...(capabilities.imageGeneration === false ? [] : ["generated-image-reference"]),
    ],
    userSelectionStatus: selected ? "selected" : "pending",
    implementationAuthorized: false,
    externalWriteIntents: [],
    externalSideEffects: [],
  };
}
