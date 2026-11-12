// @ts-check
// The review gate's routing as an XState v5 machine (plan v5 1.4 pilot, 2.10.0; owner-free toward develop in 2.13.0).
//
// `pr-review-status` reads GitHub and the local records, reduces them to facts and sends them as one FACTS event.
// The machine then walks the gates in order (Codex findings, Codex review, Sol, behavioral evidence, merge pass) and
// stops in exactly one final state, which names the single next action (siguiente). Every cap and rule is a named
// guard, so a route the table does not allow cannot be taken. `development-system pr-review-status --diagram` prints
// this machine as a Mermaid diagram.
//
// 2.13.0 (plan ds-friction-plan-20261111 v5, A6): for a PR into develop no route ends in the owner. A spent Codex
// budget is covered by a Sol round; at the Sol cap the PR advances, loses the disputed change or stays out, and
// unexplained commits go to another PR (`review-policy.mjs` decides which). `ownerDecides` remains only for a PR
// into another base (main), where the merge is the owner's anyway. Evidence is asked before the first Sol round (A9).
//
// Reversal: the routing was a first-match if/else chain in pr-review-status.mjs until 2.10.0; restoring it and
// removing src/vendor/xstate/ undoes the pilot. The Steward measures it weekly (plan v5 1.4 criteria).
import { assign, createActor, setup } from "./vendor/xstate/xstate.esm.js";
import { BUDGET, CRITICAL_LIMIT } from "./review-policy.mjs";

/**
 * @typedef {object} GateFacts
 * @property {boolean} toDevelop         the PR's base is develop
 * @property {boolean} blocking          a Codex thread without a valid answer (a fix commit or a reasoned rejection)
 * @property {boolean} codexOk           Codex no-findings, or its requests are spent and the commits after are covered
 * @property {null | {error: boolean}} codexCoverage  coverage of commits after a budget-spent Codex review
 * @property {string} headState          pending | requested | running | answered | failed-terminal | unknown
 * @property {number} published          "@codex review" requests published on the PR
 * @property {number} budget             Codex request budget per PR
 * @property {string} solState           invalid | exempt | exemption-stale | missing | blocking | approved | covered | not-covered | waived | advanced
 * @property {boolean} solCoverageError  Sol coverage could not be read
 * @property {import("./review-policy.mjs").NextAction} solNext  what the lineage does next when Sol (or a spent Codex) still needs something
 * @property {boolean} evidenceOk        behavioral evidence accepted, or not required for this base
 * @property {boolean} mergeGate         a merge pass was written in this run
 */

/** @typedef {"codexFindings" | "retryRead" | "outOfScope" | "awaitCodex" | "ownerDecides" | "requestCodex" | "solRecordsInvalid" | "solExemptionStale" | "solRound" | "advance" | "withdrawChange" | "holdPr" | "recordEvidence" | "runGate" | "merge"} GateStep */

const FINAL = /** @type {const} */ ({ type: "final" });
const STOPS = ["advance", "withdraw", "split", "hold"];

export const reviewGateMachine = setup({
  guards: {
    blockingFindings: ({ context }) => context.blocking,
    codexCoverageUnreadable: ({ context }) => !context.codexOk && context.codexCoverage?.error === true,
    codexUncoveredToMain: ({ context }) => !context.toDevelop && !context.codexOk && context.codexCoverage !== null,
    codexInFlight: ({ context }) => !context.codexOk && (context.headState === "requested" || context.headState === "running"),
    codexSpentToMain: ({ context }) => !context.toDevelop && !context.codexOk && context.published >= context.budget,
    // Toward develop a spent Codex budget is not a stop: a Sol round that reads the head covers it.
    codexSpent: ({ context }) => !context.codexOk && context.published >= context.budget,
    codexMissing: ({ context }) => !context.codexOk,
    solInvalid: ({ context }) => context.solState === "invalid",
    solExemptionStale: ({ context }) => context.solState === "exemption-stale",
    evidenceBeforeFirstRound: ({ context }) => context.solState === "missing" && !context.evidenceOk,
    solCoverageUnreadable: ({ context }) => context.solState === "not-covered" && context.solCoverageError,
    solRoundNext: ({ context }) => context.solNext === "round",
    solStopToMain: ({ context }) => !context.toDevelop && STOPS.includes(context.solNext),
    solAdvance: ({ context }) => context.solNext === "advance",
    solWithdraw: ({ context }) => context.solNext === "withdraw",
    solSplit: ({ context }) => context.solNext === "split",
    solHold: ({ context }) => context.solNext === "hold",
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
        { guard: "codexUncoveredToMain", target: "outOfScope" },
        { guard: "codexInFlight", target: "awaitCodex" },
        { guard: "codexSpentToMain", target: "ownerDecides" },
        { guard: "codexSpent", target: "sol" },
        { guard: "codexMissing", target: "requestCodex" },
        { target: "sol" },
      ],
    },
    sol: {
      always: [
        { guard: "solInvalid", target: "solRecordsInvalid" },
        { guard: "solExemptionStale", target: "solExemptionStale" },
        { guard: "evidenceBeforeFirstRound", target: "recordEvidence" },
        { guard: "solCoverageUnreadable", target: "retryRead" },
        { guard: "solRoundNext", target: "solRound" },
        { guard: "solStopToMain", target: "ownerDecides" },
        { guard: "solAdvance", target: "advance" },
        { guard: "solWithdraw", target: "withdrawChange" },
        { guard: "solSplit", target: "outOfScope" },
        { guard: "solHold", target: "holdPr" },
        { target: "evidence" },
      ],
    },
    evidence: { always: [{ guard: "evidenceMissing", target: "recordEvidence" }, { target: "mergePass" }] },
    mergePass: { always: [{ guard: "passMissing", target: "runGate" }, { target: "merge" }] },
    codexFindings: FINAL, retryRead: FINAL, outOfScope: FINAL, awaitCodex: FINAL, ownerDecides: FINAL, requestCodex: FINAL,
    solRecordsInvalid: FINAL, solExemptionStale: FINAL, solRound: FINAL, advance: FINAL, withdrawChange: FINAL, holdPr: FINAL,
    recordEvidence: FINAL, runGate: FINAL, merge: FINAL,
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

// Only a PR into a base other than develop reaches this (2.13.0); its merge is the owner's production stop anyway.
export const OWNER_DECIDES = "el PR no va a develop y la puerta no puede decidir sola: no promuevas el candidato; registra el bloqueo, sigue con trabajo independiente y súmalo a la única pregunta de producción";
const RETRY_READ = "GitHub no respondió completo: espera unos minutos y vuelve a correr pr-review-status; si persiste, reporta el bloqueo en tu avance y sigue con otro trabajo";

/**
 * The siguiente text for a final step: always an action the agent takes; toward develop it never asks anyone.
 * @param {GateStep} step
 * @param {{prKey: string, owner: string, repo: string, number: number, head: string, blockingIds: string[], exemptionHead?: string, recordsError?: string, uncovered?: string[], advanceNote?: string, open?: {id: string, paths: string[]}[], solNext: () => string}} info
 */
export function gateNextAction(step, { prKey, owner, repo, number, head, blockingIds, exemptionHead, recordsError, uncovered = [], advanceNote = "", open = [], solNext }) {
  const short = head.slice(0, 12);
  // A recorded advance that does not count is said first, with its reason, so the agent records it again or runs the round.
  const stale = advanceNote ? `el avance registrado no cuenta (${advanceNote}). ` : "";
  const ids = open.map((finding) => finding.id).join(", ") || "el hallazgo crítico";
  const paths = [...new Set(open.flatMap((finding) => finding.paths))].slice(0, 8).join(", ");
  const dispose = `development-system review dispose --pr ${prKey} --finding <id> --outcome fixed|rejected|follow-up [--commit <sha> | --note <razón>]`;
  switch (step) {
    case "codexFindings": return `contesta cada hilo de Codex pendiente (${blockingIds.slice(0, 5).join(", ")}${blockingIds.length > 5 ? ", …" : ""}): responde en el hilo citando el commit de este PR que lo arregla, o con «Rechazado: <razón>»; no hace falta resolver el hilo`;
    case "retryRead": return RETRY_READ;
    case "outOfScope": return `saca a otro PR lo que no es arreglo citado ni merge limpio de la base${uncovered.length ? ` (${uncovered.slice(0, 5).join("; ")}${uncovered.length > 5 ? "; …" : ""})` : ""} y vuelve a correr la puerta`;
    case "awaitCodex": return `espera la revisión de Codex del head ${short}; vuelve a correr pr-review-status sin --request`;
    case "ownerDecides": return OWNER_DECIDES;
    case "requestCodex": return `pide la revisión de Codex del head ${short}: development-system pr-review-status ${prKey} --request`;
    case "solRecordsInvalid": return `registros de Sol inválidos${recordsError ? ` (${recordsError})` : ""}: mira las filas con development-system review lines --pr ${prKey}, anula la mala con development-system review void --pr ${prKey} --line-hash <sha256> --reason <causa> y vuelve a correr la puerta`;
    case "solExemptionStale": return `la exención de Sol es del head ${exemptionHead?.slice(0, 12)}, no del ${short}: si el PR sigue siendo docs-only o low-risk regístrala para este head (development-system review record --pr ${prKey} --reviewer sol --head ${head} --exempt <docs-only|low-risk> --reason <motivo>); si ya no lo es, anúlala con development-system review void y corre la ronda full`;
    case "solRound": return `${stale}${solNext()}`;
    case "advance": return `${stale}avanza: van ${BUDGET} rondas y nada de lo abierto es crítico, así que no hay otra ronda. Arregla lo que encontró la última (${ids}) en commits que lleven la línea «fixes: <id>», registra cada hallazgo con ${dispose}, registra el avance con development-system review advance --pr ${prKey} --head <head final>, dilo en una línea en el hilo y en el PR («llegué a ${BUDGET} revisiones; arreglé lo último y avanzo sin otra ronda») y vuelve a correr la puerta`;
    case "withdrawChange": return `${stale}retira el cambio disputado: van ${CRITICAL_LIMIT} rondas y sigue abierto ${ids}. Saca del PR el cambio completo${paths ? ` (${paths})` : ""}, déjalo como seguimiento (development-system review dispose --pr ${prKey} --finding <id> --outcome follow-up --note <dónde queda>), regístralo con development-system review advance --pr ${prKey} --head <head final> --withdrawn y fusiona el resto. Si no se puede separar, no fusiones: di en tu siguiente avance «#${number} se queda fuera: ${CRITICAL_LIMIT} rondas y sigue abierto ${ids}» y sigue con el trabajo independiente`;
    case "holdPr": return `#${number} se queda fuera: el linaje gastó sus rondas sin una ronda válida. No fusiones; dilo en tu siguiente avance y sigue con el trabajo independiente`;
    case "recordEvidence": return `graba la evidencia de comportamiento del head ${short} con development-system evidence record (va antes de la primera ronda de Sol y otra vez sobre el head final)`;
    case "runGate": return `corre development-system pr-review-status ${prKey} --gate y fusiona con --match-head-commit ${head}`;
    case "merge": return `avanza: fusiona con gh pr merge ${number} -R ${owner}/${repo} --match-head-commit ${head}`;
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
