// @ts-check
// The review gate's routing as an XState v5 machine (plan v5 1.4 pilot, 2.10.0).
//
// `pr-review-status` reads GitHub and the local records, reduces them to facts and sends them as one FACTS event.
// The machine then walks the gates in order (Codex findings, Codex review, Sol, behavioral evidence, merge pass) and
// stops in exactly one final state, which names the single next action (siguiente). Every cap and rule is a named
// guard, so a route the table does not allow cannot be taken. `development-system pr-review-status --diagram` prints
// this machine as a Mermaid diagram.
//
// Reversal: the routing was a first-match if/else chain in pr-review-status.mjs until 2.10.0; restoring it and
// removing src/vendor/xstate/ undoes the pilot. The Steward measures it weekly (plan v5 1.4 criteria).
import { assign, createActor, setup } from "./vendor/xstate/xstate.esm.js";

/**
 * @typedef {object} GateFacts
 * @property {boolean} blocking          an open Codex thread, or a resolved one without a human reply
 * @property {boolean} codexOk           Codex no-findings, or budget-spent and covered
 * @property {null | {error: boolean}} codexCoverage  coverage of commits after a budget-spent Codex review
 * @property {string} headState          pending | requested | running | answered | failed-terminal | unknown
 * @property {number} published          "@codex review" requests published on the PR
 * @property {number} budget             Codex request budget per PR
 * @property {string} solState           invalid | exempt | exemption-stale | missing | blocking | approved | covered | not-covered | waived
 * @property {boolean} solCoverageError  Sol coverage could not be read
 * @property {boolean} evidenceOk        behavioral evidence accepted, or not required for this base
 * @property {boolean} mergeGate         a merge pass was written in this run
 */

/** @typedef {"codexFindings" | "retryRead" | "outOfScope" | "awaitCodex" | "ownerDecides" | "requestCodex" | "solRecordsInvalid" | "solExemptionStale" | "solRound" | "recordEvidence" | "runGate" | "merge"} GateStep */

const FINAL = /** @type {const} */ ({ type: "final" });

export const reviewGateMachine = setup({
  guards: {
    blockingFindings: ({ context }) => context.blocking,
    codexCoverageUnreadable: ({ context }) => !context.codexOk && context.codexCoverage?.error === true,
    codexCoverageOutOfScope: ({ context }) => !context.codexOk && context.codexCoverage !== null,
    codexInFlight: ({ context }) => !context.codexOk && (context.headState === "requested" || context.headState === "running"),
    codexBudgetSpent: ({ context }) => !context.codexOk && context.published >= context.budget,
    codexMissing: ({ context }) => !context.codexOk,
    solInvalid: ({ context }) => context.solState === "invalid",
    solExemptionStale: ({ context }) => context.solState === "exemption-stale",
    solNeedsRound: ({ context }) => context.solState === "missing" || context.solState === "blocking",
    solCoverageUnreadable: ({ context }) => context.solState === "not-covered" && context.solCoverageError,
    solOutOfScope: ({ context }) => context.solState === "not-covered",
    evidenceMissing: ({ context }) => !context.evidenceOk,
    passMissing: ({ context }) => !context.mergeGate,
  },
}).createMachine({
  id: "reviewGate",
  initial: "reading",
  context: {},
  states: {
    reading: { on: { FACTS: { target: "codex", actions: assign((/** @type {{event: {facts: GateFacts}}} */ { event }) => event.facts) } } },
    codex: {
      always: [
        { guard: "blockingFindings", target: "codexFindings" },
        { guard: "codexCoverageUnreadable", target: "retryRead" },
        { guard: "codexCoverageOutOfScope", target: "outOfScope" },
        { guard: "codexInFlight", target: "awaitCodex" },
        { guard: "codexBudgetSpent", target: "ownerDecides" },
        { guard: "codexMissing", target: "requestCodex" },
        { target: "sol" },
      ],
    },
    sol: {
      always: [
        { guard: "solInvalid", target: "solRecordsInvalid" },
        { guard: "solExemptionStale", target: "solExemptionStale" },
        { guard: "solNeedsRound", target: "solRound" },
        { guard: "solCoverageUnreadable", target: "retryRead" },
        { guard: "solOutOfScope", target: "outOfScope" },
        { target: "evidence" },
      ],
    },
    evidence: { always: [{ guard: "evidenceMissing", target: "recordEvidence" }, { target: "mergePass" }] },
    mergePass: { always: [{ guard: "passMissing", target: "runGate" }, { target: "merge" }] },
    codexFindings: FINAL, retryRead: FINAL, outOfScope: FINAL, awaitCodex: FINAL, ownerDecides: FINAL, requestCodex: FINAL,
    solRecordsInvalid: FINAL, solExemptionStale: FINAL, solRound: FINAL, recordEvidence: FINAL, runGate: FINAL, merge: FINAL,
  },
});

/** Runs the machine on one set of facts and returns the final step. @param {GateFacts} facts @returns {GateStep} */
export function gateStep(facts) {
  const actor = createActor(reviewGateMachine).start();
  actor.send({ type: "FACTS", facts });
  const snapshot = actor.getSnapshot();
  actor.stop();
  if (snapshot.status !== "done") throw new Error(`review gate machine stopped in ${JSON.stringify(snapshot.value)} without a final step`);
  return /** @type {GateStep} */ (snapshot.value);
}

export const OWNER_DECIDES = "decide el dueño";
const OUT_OF_SCOPE = "cambio fuera de alcance: sácalo a otro PR o decide el dueño (si ya dijo que no se revisa más: development-system review waive con sus palabras)";
const RETRY_READ = "GitHub no respondió completo: vuelve a correr pr-review-status; si persiste, decide el dueño";

/**
 * The siguiente text for a final step.
 * @param {GateStep} step
 * @param {{prKey: string, owner: string, repo: string, number: number, head: string, blockingIds: string[], exemptionHead?: string, solNext: () => string}} info
 */
export function gateNextAction(step, { prKey, owner, repo, number, head, blockingIds, exemptionHead, solNext }) {
  const short = head.slice(0, 12);
  switch (step) {
    case "codexFindings": return `atiende los hallazgos de Codex: corrige o responde por escrito cada hilo y resuélvelo (${blockingIds.slice(0, 5).join(", ")}${blockingIds.length > 5 ? ", …" : ""})`;
    case "retryRead": return RETRY_READ;
    case "outOfScope": return OUT_OF_SCOPE;
    case "awaitCodex": return `espera la revisión de Codex del head ${short}; vuelve a correr pr-review-status sin --request`;
    case "ownerDecides": return OWNER_DECIDES;
    case "requestCodex": return `pide la revisión de Codex del head ${short}: development-system pr-review-status ${prKey} --request`;
    case "solRecordsInvalid": return "registros de Sol inválidos: decide el dueño";
    case "solExemptionStale": return `la exención de Sol es del head ${exemptionHead?.slice(0, 12)}, no del ${short}: si sigue aplicando regístrala para este head (development-system review record --pr ${prKey} --reviewer sol --head ${head} --exempt <docs-only|low-risk> --reason <motivo>); si no, decide el dueño`;
    case "solRound": return solNext();
    case "recordEvidence": return `graba la evidencia de comportamiento del head ${short} con development-system evidence record, o cita la exención del dueño`;
    case "runGate": return `corre development-system pr-review-status ${prKey} --gate y fusiona con --match-head-commit ${head}`;
    case "merge": return `fusiona: gh pr merge ${number} -R ${owner}/${repo} --match-head-commit ${head}`;
  }
}

/** The machine as a Mermaid state diagram, read from its definition so it cannot drift. */
export function gateDiagram() {
  const lines = ["stateDiagram-v2", "  [*] --> reading"];
  /** @param {any} node */
  const walk = (node) => {
    for (const child of Object.values(node.states ?? {})) {
      const from = child.key;
      for (const [event, transitions] of [...(child.transitions ?? new Map()), ["", child.always ?? []]]) {
        for (const transition of transitions) {
          const guard = transition.guard ? (typeof transition.guard === "string" ? transition.guard : transition.guard.type) : "";
          const label = event === "" || event.startsWith("xstate.") ? (guard || "otherwise") : `${event}${guard ? ` [${guard}]` : ""}`;
          for (const target of transition.target ?? []) lines.push(`  ${from} --> ${target.key}: ${label}`);
        }
      }
      if (child.type === "final") lines.push(`  ${from} --> [*]`);
      walk(child);
    }
  };
  walk(reviewGateMachine.root);
  return lines.join("\n");
}
