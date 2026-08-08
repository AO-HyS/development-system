// @ts-check

import { createHash } from "node:crypto";

/** @typedef {"portable" | "private"} Visibility */

/** @typedef {object} HumanLayerConfig
 * @property {{location: string, syncsExternally: boolean}} daemon
 * @property {{timing: string}} worktree
 * @property {string} worktreeTiming
 * @property {boolean} autoAdvance
 * @property {{slack: boolean, linear: boolean, external: boolean}} integrations
 */

/** @typedef {object} ArtifactCandidate
 * @property {string} id
 * @property {Visibility} visibility
 * @property {unknown} [content]
 */

/** @typedef {object} ArtifactDestination
 * @property {string} id
 * @property {Visibility} visibility
 * @property {boolean} [syncsExternally]
 * @property {boolean} [writable]
 */

const defaultConfig = {
  daemon: { location: "local", syncsExternally: false },
  worktree: { timing: "Never" },
  worktreeTiming: "Never",
  autoAdvance: false,
  integrations: { slack: false, linear: false, external: false },
};

/**
 * The first HumanLayer path is deliberately local and integration-free. Keep
 * this value declarative so callers can include it in a deterministic receipt.
 * @type {Readonly<HumanLayerConfig>}
 */
export const DEFAULT_HUMANLAYER_CONFIG = Object.freeze({
  daemon: Object.freeze({ ...defaultConfig.daemon }),
  worktree: Object.freeze({ ...defaultConfig.worktree }),
  worktreeTiming: defaultConfig.worktreeTiming,
  autoAdvance: defaultConfig.autoAdvance,
  integrations: Object.freeze({ ...defaultConfig.integrations }),
});

export const HUMANLAYER_ADAPTER_ID = "humanlayer";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @param {string} name */
function requireText(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

/** @param {unknown} value @returns {Visibility} */
function normalizeVisibility(value) {
  if (value === "portable" || value === "private") return value;
  throw new Error("artifact visibility must be portable or private");
}

/** @param {unknown} value @returns {string[]} */
function stringList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").map((item) => item)
    : [];
}

/** @param {unknown} value @returns {unknown} */
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stableValue(entry)]));
}

/** @param {unknown} value */
function hashValue(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")}`;
}

/** @param {Partial<HumanLayerConfig> | undefined} override @returns {HumanLayerConfig} */
function mergeConfig(override) {
  const candidate = isRecord(override) ? override : {};
  const daemon = isRecord(candidate.daemon)
    ? /** @type {Record<string, unknown>} */ (candidate.daemon)
    : {};
  const worktree = isRecord(candidate.worktree)
    ? /** @type {Record<string, unknown>} */ (candidate.worktree)
    : {};
  const integrations = isRecord(candidate.integrations)
    ? /** @type {Record<string, unknown>} */ (candidate.integrations)
    : {};
  const location = typeof daemon.location === "string" ? daemon.location : defaultConfig.daemon.location;
  const timing = typeof worktree.timing === "string"
    ? worktree.timing
    : typeof candidate.worktreeTiming === "string" ? candidate.worktreeTiming : defaultConfig.worktreeTiming;
  return {
    daemon: {
      location,
      syncsExternally: daemon.syncsExternally === true,
    },
    worktree: { timing },
    worktreeTiming: timing,
    autoAdvance: candidate.autoAdvance === true,
    integrations: {
      slack: integrations.slack === true,
      linear: integrations.linear === true,
      external: integrations.external === true,
    },
  };
}

/**
 * Link exactly one HumanLayer task to one canonical workflow. The map is
 * intentionally one-way: HumanLayer never becomes the source of truth.
 * @param {{taskId: string, workflowId: string, existingLinks?: Map<string, string>}} input
 */
export function linkHumanLayerTask(input) {
  const taskId = requireText(input?.taskId, "taskId");
  const workflowId = requireText(input?.workflowId, "workflowId");
  if (Array.isArray(input?.taskId) || Array.isArray(input?.workflowId)) {
    throw new Error("one task must link to one workflow");
  }
  const existingLinks = input?.existingLinks;
  const priorWorkflow = existingLinks?.get(taskId);
  if (priorWorkflow && priorWorkflow !== workflowId) {
    throw new Error(`task ${taskId} is already linked to workflow ${priorWorkflow}`);
  }
  existingLinks?.set(taskId, workflowId);
  return {
    adapter: HUMANLAYER_ADAPTER_ID,
    taskId,
    workflowId,
    sourceOfTruth: "development-system",
    lifecycleAuthority: "development-system",
  };
}

/** @param {unknown} artifact @returns {ArtifactCandidate} */
function normalizeArtifact(artifact) {
  if (!isRecord(artifact)) throw new Error("artifact candidate must be an object");
  const visibility = artifact.visibility ?? artifact.classification;
  return {
    id: requireText(artifact.id, "artifact id"),
    visibility: normalizeVisibility(visibility),
    content: artifact.content,
  };
}

/** @param {unknown} destination @returns {ArtifactDestination} */
function normalizeDestination(destination) {
  if (!isRecord(destination)) throw new Error("artifact destination must be an object");
  const visibility = destination.visibility ?? destination.classification;
  return {
    id: requireText(destination.id, "destination id"),
    visibility: normalizeVisibility(visibility),
    syncsExternally: destination.syncsExternally === true || destination.externalSync === true,
    writable: destination.writable !== false,
  };
}

/**
 * Build a complete routing plan before invoking any writer. A private
 * artifact can only use a private, non-synchronizing destination.
 * @param {{artifacts: unknown[], destinations: unknown[]}} input
 */
export function routeHumanLayerArtifacts(input) {
  const artifacts = (input?.artifacts ?? []).map(normalizeArtifact);
  const destinations = (input?.destinations ?? []).map(normalizeDestination);
  /** @type {{artifactId: string, destinationId: string, visibility: Visibility}[]} */
  const routes = [];
  /** @type {{artifactId: string, visibility: Visibility, reason: string}[]} */
  const denied = [];

  for (const artifact of artifacts) {
    const eligible = destinations.filter((destination) => {
      if (!destination.writable || destination.visibility !== artifact.visibility) return false;
      if (artifact.visibility === "private" && destination.syncsExternally) return false;
      return true;
    });
    const destination = eligible[0];
    if (!destination) {
      denied.push({
        artifactId: artifact.id,
        visibility: artifact.visibility,
        reason: artifact.visibility === "private"
          ? "private-artifact-only-external-destination"
          : "no-matching-portable-destination",
      });
      continue;
    }
    routes.push({ artifactId: artifact.id, destinationId: destination.id, visibility: artifact.visibility });
  }

  return {
    ok: denied.length === 0,
    routes: denied.length === 0 ? routes : [],
    denied,
    externalWriteIntent: routes.some((route) => route.visibility === "portable"),
    sideEffects: [],
  };
}

/**
 * Record only explicitly observed runtime values. In particular, app and CLI
 * versions remain separate because they are independently versioned products.
 * @param {Record<string, unknown>} input
 * @param {HumanLayerConfig} config
 */
export function createHumanLayerReceipt(input = {}, config = DEFAULT_HUMANLAYER_CONFIG) {
  const appVersion = typeof input.appVersion === "string" ? input.appVersion : null;
  const cliVersion = typeof input.cliVersion === "string" ? input.cliVersion : null;
  return {
    adapter: HUMANLAYER_ADAPTER_ID,
    appVersion,
    cliVersion,
    versions: { app: appVersion, cli: cliVersion },
    daemonLocation: config.daemon.location,
    daemon: { ...config.daemon },
    agent: typeof input.agent === "string" ? input.agent : null,
    model: typeof input.model === "string" ? input.model : null,
    effort: typeof input.effort === "string" ? input.effort : null,
    loadedSkills: stringList(input.loadedSkills),
    promptAdditions: stringList(input.promptAdditions),
    taskId: typeof input.taskId === "string" ? input.taskId : null,
    sessionId: typeof input.sessionId === "string" ? input.sessionId : null,
    sideEffects: Array.isArray(input.sideEffects) ? input.sideEffects : [],
  };
}

/**
 * Execute a read-only skill probe through an injected fake/runtime. The four
 * observations are independent; no stronger state is inferred from a weaker
 * one (for example, discovery does not imply loading).
 * @param {{skill: string, observation?: unknown, probe?: (request: {skill: string, readOnly: true}) => unknown | Promise<unknown>}} input
 */
export async function probeHumanLayerReadOnly(input) {
  const skill = requireText(input?.skill, "skill");
  const observation = input?.observation !== undefined
    ? input.observation
    : typeof input?.probe === "function"
      ? await input.probe({ skill, readOnly: true })
      : {};
  const record = isRecord(observation) ? observation : {};
  const sideEffects = Array.isArray(record.sideEffects) ? record.sideEffects : [];
  return {
    ok: sideEffects.length === 0,
    operation: "humanlayer-read-only-probe",
    readOnly: true,
    skill,
    existence: null,
    discovery: null,
    loading: null,
    influence: null,
    exists: null,
    discovered: null,
    loaded: null,
    influenced: null,
    evidence: { existence: null, discovery: null, loading: null, influence: null },
    suppliedSnapshot: record,
    provenance: { kind: "unverified-input", verified: false, source: "caller-supplied-snapshot" },
    sideEffects,
  };
}

/**
 * Observe a local HumanLayer runtime only through injected read-only adapters.
 * Runtime booleans are derived from command and metadata provenance rather
 * than accepted from the caller.
 * @param {{
 *   skill: string,
 *   exec: (request: {command: string, args: string[], readOnly: true}) => Promise<unknown> | unknown,
 *   readMetadata: (request: {skill: string, readOnly: true}) => Promise<unknown> | unknown,
 *   now?: () => string,
 *   signature?: {id?: string, terms?: string[]}
 * }} input
 */
export async function probeHumanLayerLocalRuntime(input) {
  const skill = requireText(input?.skill, "skill");
  if (typeof input?.exec !== "function" || typeof input?.readMetadata !== "function") {
    throw new Error("local HumanLayer probe requires injected exec and readMetadata adapters");
  }
  const timestamp = typeof input.now === "function" ? input.now() : new Date().toISOString();
  const commandResult = await input.exec({ command: "humanlayer", args: ["--version"], readOnly: true });
  const command = isRecord(commandResult) ? commandResult : {};
  const metadataResult = await input.readMetadata({ skill, readOnly: true });
  const metadata = isRecord(metadataResult) ? metadataResult : {};
  const exitCode = typeof command.exitCode === "number" ? command.exitCode : null;
  const executablePath = typeof command.executablePath === "string" ? command.executablePath : null;
  const stdout = typeof command.stdout === "string" ? command.stdout : "";
  const catalogSkills = stringList(metadata.catalogSkills);
  const loadedSkills = stringList(metadata.loadedSkills);
  const signature = isRecord(input.signature) ? input.signature : {};
  const signatureTerms = stringList(signature.terms);
  const finalOutput = typeof metadata.finalOutput === "string" ? metadata.finalOutput : "";
  const existence = exitCode === 0 && executablePath !== null;
  const discovery = existence && catalogSkills.includes(skill);
  const loading = discovery && loadedSkills.includes(skill);
  const influence = loading && signatureTerms.length > 0 && signatureTerms.every((term) => finalOutput.includes(term));
  const artifacts = Array.isArray(metadata.artifacts)
    ? metadata.artifacts.filter(isRecord).map((artifact) => ({
        id: typeof artifact.id === "string" ? artifact.id : null,
        contentHash: hashValue(artifact.content),
        source: typeof artifact.source === "string" ? artifact.source : metadata.source ?? null,
      }))
    : [];
  return {
    ok: exitCode === 0,
    operation: "humanlayer-local-runtime-probe",
    readOnly: true,
    skill,
    evidence: { existence, discovery, loading, influence },
    existence,
    discovery,
    loading,
    influence,
    exists: existence,
    discovered: discovery,
    loaded: loading,
    influenced: influence,
    executablePath,
    version: stdout.trim() || null,
    task: isRecord(metadata.task) ? metadata.task : null,
    session: isRecord(metadata.session) ? metadata.session : null,
    comments: Array.isArray(metadata.comments) ? metadata.comments : [],
    artifacts,
    signature: {
      id: typeof signature.id === "string" ? signature.id : null,
      terms: signatureTerms,
      matched: influence,
    },
    provenance: {
      kind: "local-runtime",
      verified: true,
      command: "humanlayer --version",
      source: typeof metadata.source === "string" ? metadata.source : null,
      timestamp,
      exitCode,
    },
    sideEffects: [],
  };
}

/** @param {unknown} input */
export function humanLayerFeedbackReceipt(input = {}) {
  const value = isRecord(input) ? input : {};
  return {
    adapter: HUMANLAYER_ADAPTER_ID,
    accepted: false,
    reason: "feedback-only",
    gateGranted: false,
    lifecycleMutation: false,
    observed: {
      comments: Array.isArray(value.comments) ? value.comments : [],
      taskStatus: value.taskStatus ?? null,
      autoAdvance: value.autoAdvance === true,
    },
    sideEffects: [],
  };
}

/**
 * Construct an injectable operator surface. No HumanLayer process is touched
 * unless a caller explicitly supplies and invokes one of the injected hooks.
 * @param {{config?: Partial<HumanLayerConfig>, runtime?: {writeArtifact?: (request: Record<string, unknown>) => unknown | Promise<unknown>, exec?: (request: {command: string, args: string[], readOnly: true}) => unknown | Promise<unknown>, readMetadata?: (request: {skill: string, readOnly: true}) => unknown | Promise<unknown>, now?: () => string}}} [options]
 */
export function createHumanLayerAdapter(options = {}) {
  const config = mergeConfig(options.config);
  const links = new Map();
  const runtime = options.runtime ?? {};
  /** @param {{taskId: string, workflowId: string}} input */
  const linkTask = (input) => linkHumanLayerTask({ ...input, existingLinks: links });
  return {
    adapter: HUMANLAYER_ADAPTER_ID,
    config,
    linkTask,
    routeArtifacts: routeHumanLayerArtifacts,
    feedbackReceipt: humanLayerFeedbackReceipt,
    receipt: (input = {}) => createHumanLayerReceipt(input, config),
    probeReadOnly: probeHumanLayerReadOnly,
    /** @param {{skill: string, signature?: {id?: string, terms?: string[]}}} input */
    probeLocalRuntime: (input) => probeHumanLayerLocalRuntime({
      ...input,
      exec: /** @type {NonNullable<typeof runtime.exec>} */ (runtime.exec),
      readMetadata: /** @type {NonNullable<typeof runtime.readMetadata>} */ (runtime.readMetadata),
      now: runtime.now,
    }),
    /** @param {{artifacts: unknown[], destinations: unknown[]}} input */
    async materializeArtifacts(input) {
      const plan = routeHumanLayerArtifacts(input);
      if (!plan.ok || typeof runtime.writeArtifact !== "function") return plan;
      const artifacts = (input.artifacts ?? []).map(normalizeArtifact);
      const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
      const sideEffects = [];
      for (const route of plan.routes) {
        const artifact = byId.get(route.artifactId);
        await runtime.writeArtifact({ artifact, destinationId: route.destinationId, visibility: route.visibility });
        sideEffects.push({ type: "artifact-write", artifactId: route.artifactId, destinationId: route.destinationId });
      }
      return { ...plan, sideEffects };
    },
  };
}

// Descriptive aliases keep the small adapter easy to discover without adding
// another implementation surface.
export const createHumanLayerOperatorAdapter = createHumanLayerAdapter;
export const routeHumanLayerCandidates = routeHumanLayerArtifacts;
export const probeHumanLayerSkills = probeHumanLayerReadOnly;
export const recordHumanLayerReceipt = createHumanLayerReceipt;
