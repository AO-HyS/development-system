// @ts-check
// The words the gate prints when the next step is a review round (2.13.0, plan A7; Sol 6.1 High, Fable 5.2 for hard rounds since 2.14.0),
// and the brief every PR reviewer receives (plan A8 and A9). The gate says what to do; the written rule only says
// "run the gate and do what it says".
import { BUDGET, CRITICAL_LIMIT, nextReview } from "./review-policy.mjs";

/**
 * @typedef {{pending: {id: string, pr: string, slot: number, scope: string}[], nextSlot: number, slotsUsed: number, lastRound?: {pr: string, round: number, slot: number | null, result: string, fixInduced: boolean, critical: boolean, head: string}}} LineageView
 */

/**
 * What the lineage does next for this PR. `moved` is true when the PR has commits no clean round covers.
 * @param {{lineage: LineageView | null, moved: boolean, pendingCritical: boolean}} input
 * @returns {ReturnType<typeof nextReview>}
 */
export function lineageNext({ lineage, moved, pendingCritical }) {
  // An unreadable lineage or a reserved, unrecorded slot is still "a round": the text says how to get past it.
  if (!lineage || lineage.pending.length) return { action: "round" };
  const last = lineage.lastRound;
  return nextReview({ nextSlot: lineage.nextSlot, last: last && { result: last.result, critical: last.critical }, moved, pendingCritical });
}

/**
 * The next review action in words, for a PR whose next step is a round. Sol 6.1 High runs the round through codex-review
 * (owner decision of 2026-11-12) and the text says how to run it with Fable when the coordinator judges it security
 * work or hard; a round the gate finds hard (`hardReason` in review-policy.mjs) goes to Fable 5.2, and back to Sol while
 * the lineage records Fable as unavailable. Either way it is one action of the agent, never a question.
 * @param {{lineage: LineageView | null, lineageError: string, prKey: string, head: string, exempt?: boolean, moved: boolean, rejected?: string[], receipt?: string, reviewer?: {reviewer: "fable" | "sol", reason: string, degraded?: boolean}}} input
 */
export function solNextStep({ lineage, lineageError, prKey, head, exempt = false, moved, rejected = [], receipt, reviewer = { reviewer: "sol", reason: "", degraded: false } }) {
  const fable = reviewer.reviewer === "fable";
  const degradedSol = !fable && Boolean(reviewer.degraded ?? reviewer.reason);
  /** @param {string} scope */
  const record = (scope) => `development-system review record --pr ${prKey} --reviewer ${fable ? "fable --observed-model <id|unknown>" : "sol"} --head ${head} --scope ${scope} --result <blocking|non-blocking|none> --thread <hilo>${scope === "fix-diff" ? " --finding <id>:<ruta>@<prior|fix-induced|new>/<dominio crítico|none>" : " --finding <id>:<ruta>"}`;
  /** @param {string} scope @param {string} [extra] */
  const reserve = (scope, extra = "") => `development-system review reserve --pr ${prKey} --scope ${scope} --request-key <clave>${extra} (un delegate_task con "Review kind: pr" la reserva solo)`;
  const brief = `; el paquete del revisor sale de development-system review brief --pr ${prKey}`;
  /** @param {string} id */
  const release = (id) => `si Fable falla por cuota o no está disponible, libera la reserva con development-system review release --pr ${prKey} --reservation-id ${id} --reason "fable-unavailable: <mensaje observado>" y vuelve a correr la puerta`;
  // Fable from either host: one fresh read-only reviewer with the brief as its packet; the slot is reserved as for Sol.
  /** @param {string} scope @param {string} [extra] */
  const fableRound = (scope, extra = "") => `desde Claude Code, Agent con subagent_type: reviewer y el paquete de development-system review brief --pr ${prKey} con las líneas "Review kind: pr", "PR: ${prKey}", "Review scope: ${scope}" y "Review difficulty: hard: ${reviewer.reason}" (el guard reserva la ronda); desde Codex, development-system review reserve --pr ${prKey} --scope ${scope} --request-key <clave>${extra} y luego un delegate_task de solo lectura a claude-fable-5-2 con el mismo paquete. Regístrala con ${record(scope)}; ${release("<id de la reserva que muestra pr-review-status>")}`;
  const lead = fable ? `Esta ronda va con Fable 5.2 (${reviewer.reason}): ` : degradedSol ? `Fable no está disponible («${reviewer.reason}»), así que esta ronda va con Sol 6.1 High por codex-review: ` : "";
  // A normal Sol round says how the coordinator runs it with Fable instead when it judges the PR security work or hard.
  /** @param {string} scope */
  const hint = (scope) => fable || degradedSol ? "" : `; si el PR es de seguridad (autorización, roles, límites de datos, dinero, privacidad de menores, consentimiento) o la revisión es difícil (contrato o primitiva compartida, decisión de arquitectura abierta), córrela con Fable 5.2: desde Claude Code, Agent con subagent_type: reviewer y las líneas "Review kind: pr", "PR: ${prKey}", "Review scope: ${scope}" y "Review difficulty: hard: <motivo>" (el guard reserva la ronda); desde Codex, la misma reserva y un delegate_task de solo lectura a claude-fable-5-2`;
  // Fable is the native `reviewer` role, so a codex-review fallback while Fable is unavailable goes to Opus instead.
  const fallback = "; si codex-review devuelve un recibo fallback_required, el rol nativo de respaldo es reviewer-medium (Opus), nunca reviewer (que es Fable)";
  if (!lineage) return `no pude leer el linaje de la rama (${lineageError}): espera unos minutos y vuelve a correr pr-review-status; si persiste, reporta el bloqueo en tu avance y sigue con otro trabajo`;
  const mine = lineage.pending.find((reservation) => reservation.pr === prKey.toLowerCase());
  if (mine) return `${fable ? lead : ""}la ronda ${mine.slot} (${mine.scope}) ya está reservada para este PR: cuando ${fable ? "Fable" : "el revisor"} termine, regístrala con ${record(mine.scope)}${fable ? `; ${release(mine.id)}` : `${fallback}; si la declaraste difícil o de seguridad y la corrió Fable, regístrala con --reviewer fable --observed-model <id|unknown>`}`;
  const other = lineage.pending[0];
  if (other) return `la ronda ${other.slot} del linaje está reservada para ${other.pr} sin ronda registrada: regístrala allí o, si nunca corrió, libérala con development-system review release --pr ${other.pr} --reservation-id ${other.id} --reason <motivo>`;
  if (exempt) return `Codex gastó sus pedidos sin cubrir este head y el PR está exento de revisión: anula la exención (development-system review lines --pr ${prKey}; development-system review void --pr ${prKey} --line-hash <sha256> --reason "Codex sin cobertura") y corre la ronda full con ${fable ? `Fable 5.2 (${reviewer.reason}): ${fableRound("full")}` : `Sol 6.1 High${brief}${fallback}${hint("full")}`}`;
  const slot = lineage.nextSlot;
  const last = lineage.lastRound;
  const next = lineageNext({ lineage, moved, pendingCritical: rejected.length > 0 });
  const evidence = receipt ? `incluye en el paquete el recibo de evidencia ${receipt}` : "";
  if (next.scope === "full" || !last) {
    if (fable) return `${lead}corre la ronda ${slot} (full) con Fable 5.2 sobre el head ${head.slice(0, 12)}${evidence ? ` (${evidence})` : ""}: ${fableRound("full")}`;
    return `${lead}corre la ronda ${slot} (full) de Sol 6.1 High sobre el head ${head.slice(0, 12)}: ${reserve("full")}; regístrala con ${record("full")}${evidence ? `; ${evidence}` : ""}${brief}${fallback}${hint("full")}`;
  }
  const thread = rejected.length ? ` --critical-thread ${rejected[0]}` : "";
  const why = rejected.length ? `el revisor relee el rechazo de ${rejected.join(", ")} (hilo de Codex P0/P1, sin prioridad legible o de dominio crítico)`
    : last.result === "blocking" ? "corrige antes los hallazgos bloqueantes de la ronda anterior"
      : "llegaron commits que la cobertura no explica";
  const critical = slot > BUDGET ? ` Es la ronda ${slot} de ${CRITICAL_LIMIT}: solo relee el arreglo del hallazgo crítico y lo crítico que ese arreglo provoque.` : "";
  const redesign = last.fixInduced ? ` El bloqueo lo causó el arreglo anterior: rediseña la corrección y resérvala con --redesign <ruta>#<sha256 de sus bytes> (línea "Redesign:" del paquete).` : "";
  if (fable) return `${lead}corre la ronda ${slot} en fix-diff desde ${last.head.slice(0, 12)} con Fable 5.2 sobre el head ${head.slice(0, 12)}: ${why}.${critical}${redesign} D${fableRound("fix-diff", thread).slice(1)}`;
  return `${lead}corre la ronda ${slot} en fix-diff desde ${last.head.slice(0, 12)}: ${why}.${critical}${redesign} ${reserve("fix-diff", thread)}; regístrala con ${record("fix-diff")}${brief}${fallback}${hint("fix-diff")}`;
}

/**
 * The header and rules of a PR review packet (plan A8): what blocks, what the reviewer says of each finding, and what
 * the coordinator does with the findings afterwards. Printed by `development-system review brief`.
 * `hard` is the gate's reason when it orders the round to Fable (the packet then carries `Review difficulty: hard:`).
 * @param {{prKey: string, head: string, scope: "full" | "fix-diff", from?: string, slot: number, receipt?: string, rejected?: {id: string, path: string, finding: string}[], hard?: string}} input
 */
export function reviewerBrief({ prKey, head, scope, from, slot, receipt, rejected = [], hard = "" }) {
  const lines = [
    "Review kind: pr",
    `PR: ${prKey}`,
    `Review scope: ${scope}`,
    ...(hard ? [`Review difficulty: hard: ${hard}`] : []),
    ...(rejected.length ? [`Critical thread: ${rejected[0].id}`] : []),
    `Head: ${head}`,
    ...(scope === "fix-diff" && from ? [`Diff: ${from}..${head} (the fix diff starts exactly at the head of the previous round)`] : []),
    ...(receipt ? [`Evidence receipt: ${receipt} (the change was run before this review; read what it covers)`] : []),
    "",
    `Round ${slot} of ${slot > BUDGET ? CRITICAL_LIMIT : BUDGET}. Rules for this review:`,
    "1. Critical domains come first and never lose their treatment: security, authorization, data loss, money, minors' privacy, consent. A finding there blocks even if it is outside the PR's objective, rare, or only reasoned.",
    "2. Outside those domains, blocking means the intended case goes wrong, or a real bug a user will hit. Anything else does not block.",
    "3. Point out code and guards the objective does not need.",
    "4. For each finding say whether you reproduced it or only reasoned it. \"Not reproduced\" describes the evidence, not the severity.",
    `5. Give each finding as <id>:<path>[+<path>]@<prior|fix-induced|new>/<security|authorization|data-loss|money|minors-privacy|consent|none>. A finding that does not name a domain counts as critical.`,
    ...(slot > BUDGET ? [`6. This is an extra round past the cap of ${BUDGET}: re-read only the fix of the open critical finding and any critical finding that fix causes.`] : []),
    ...(rejected.length ? ["", "Codex threads the coordinator rejected and you must judge (say for each whether the rejection holds):", ...rejected.map((thread) => `- ${thread.id} ${thread.path}: ${thread.finding}`)] : []),
    "",
    "Coordinator, after the round: check each finding against the code before touching anything; reject with its reason what does not apply; prefer the fix that deletes or narrows code; a non-critical finding outside the PR's objective becomes a follow-up; trim a fix that adds more than the finding asks. A critical finding is never downgraded and its rejection always goes back to the reviewer in the next round. Record what happened to each finding with development-system review dispose.",
  ];
  return lines.join("\n");
}
