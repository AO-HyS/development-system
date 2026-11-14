// @ts-check
// The words the gate prints when the next step is a review round (2.13.0, plan A7; Sol 6.1 High, Fable 5.2 for hard rounds since 2.14.0),
// and the brief every PR reviewer receives (plan A8 and A9). The gate says what to do; the written rule only says
// "run the gate and do what it says".
import { BUDGET, CRITICAL_LIMIT, nextReview } from "./review-policy.mjs";

/**
 * @typedef {{pending: {id: string, pr: string, slot: number, scope: string}[], nextSlot: number, slotsUsed: number, lastRound?: {pr: string, round: number, slot: number | null, result: string, fixInduced: boolean, critical: boolean, head: string, liveCritical?: string[]}}} LineageView
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
  // 2.15.0: every finding says live or latent; a confirmation round closes or repeats each live critical finding.
  const owed = lineage?.lastRound?.liveCritical ?? [];
  /** @param {string} scope */
  const record = (scope) => `development-system review record --pr ${prKey} --reviewer ${fable ? "fable --observed-model <id|unknown>" : "sol"} --head ${head} --scope ${scope} --result <blocking|non-blocking|none> --thread <hilo> --finding <id>:<ruta>@<prior|fix-induced|new>/<dominio crítico|none>/<live|latent>${scope === "fix-diff" && owed.length ? ` y, por cada hallazgo crítico vivo (${owed.join(", ")}), --closes <id> si quedó cerrado o el mismo id repetido como --finding ...@prior/<dominio>/live si sigue abierto` : ""}`;
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
  // 2.15.0: only code that decides one of the protected domains sends the first round to Fable; "hard" by judgment no longer does.
  const hint = (scope) => fable || degradedSol ? "" : `; si el PR cambia código que decide autorización, roles, límites de datos, dinero, privacidad de menores o consentimiento, córrela con Fable 5.2: desde Claude Code, Agent con subagent_type: reviewer y las líneas "Review kind: pr", "PR: ${prKey}", "Review scope: ${scope}" y "Review difficulty: hard: <qué decide ese código>" (el guard reserva la ronda); desde Codex, la misma reserva y un delegate_task de solo lectura a claude-fable-5-2`;
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
    : last.result === "blocking" ? (owed.length ? `es la confirmación de ${owed.join(", ")}: antes corrige cada uno en esta misma tarea, registra cómo terminó (development-system review dispose --pr ${last.pr} --finding <id> --outcome fixed --commit <commit del arreglo>, o --outcome rejected --note <motivo>), vuelve a correr los casos y graba la evidencia del head nuevo` : "corrige antes los hallazgos bloqueantes de la ronda anterior")
      : "llegaron commits que la cobertura no explica";
  const critical = slot > BUDGET ? ` Es la ronda ${slot} de ${CRITICAL_LIMIT}, la última: solo relee el arreglo del hallazgo crítico y lo que ese arreglo rompa; si el hallazgo sigue abierto después, el cambio disputado sale del PR.` : "";
  const redesign = last.fixInduced ? ` El bloqueo lo causó el arreglo anterior: rediseña la corrección y resérvala con --redesign <ruta>#<sha256 de sus bytes> (línea "Redesign:" del paquete).` : "";
  if (fable) return `${lead}corre la ronda ${slot} en fix-diff desde ${last.head.slice(0, 12)} con Fable 5.2 sobre el head ${head.slice(0, 12)}: ${why}.${critical}${redesign} D${fableRound("fix-diff", thread).slice(1)}`;
  return `${lead}corre la ronda ${slot} en fix-diff desde ${last.head.slice(0, 12)}: ${why}.${critical}${redesign} ${reserve("fix-diff", thread)}; regístrala con ${record("fix-diff")}${brief}${fallback}${hint("fix-diff")}`;
}

/**
 * The header and rules of a PR review packet (plan A8): what blocks, what the reviewer says of each finding, and what
 * the coordinator does with the findings afterwards. Printed by `development-system review brief`.
 * `hard` is the gate's reason when it orders the round to Fable (the packet then carries `Review difficulty: hard:`).
 * 2.15.0 (cases first): the packet lists the cases the author ran on this head and asks one question, which case is
 * missing; every finding says live or latent and only a live one blocks. `listed` are the live critical findings a
 * confirmation round closes or repeats, each with how the coordinator says it ended.
 * @param {{prKey: string, head: string, scope: "full" | "fix-diff", from?: string, slot: number, receipt?: string, cases?: {result: string, text: string}[], listed?: {id: string, paths: string[], round: number, pr: string, disposition?: {outcome: string, commit?: string, note?: string}}[], rejected?: {id: string, path: string, finding: string}[], hard?: string}} input
 */
export function reviewerBrief({ prKey, head, scope, from, slot, receipt, cases = [], listed = [], rejected = [], hard = "" }) {
  const lines = [
    "Review kind: pr",
    `PR: ${prKey}`,
    `Review scope: ${scope}`,
    ...(hard ? [`Review difficulty: hard: ${hard}`] : []),
    ...(rejected.length ? [`Critical thread: ${rejected[0].id}`] : []),
    `Head: ${head}`,
    ...(scope === "fix-diff" && from ? [`Diff: ${from}..${head} (the fix diff starts exactly at the head of the previous round)`] : []),
    ...(receipt ? [`Evidence receipt: ${receipt} (the change was run before this review; read what it covers)`] : []),
    ...(cases.length ? ["", "Cases the author ran on this head, with their result:", ...cases.map((entry) => `- ${entry.result}: ${entry.text}`)] : []),
    ...(listed.length ? ["", "Live critical findings of the round before, to confirm (for each answer `closed`, or repeat it with the same id):", ...listed.map((entry) => `- ${entry.id} (${entry.paths.join(", ")}; round ${entry.round} of ${entry.pr}): ${entry.disposition?.outcome === "fixed" ? `fixed in ${entry.disposition.commit}` : entry.disposition?.outcome === "rejected" ? `rejected: ${entry.disposition.note}` : "no disposition recorded"}`)] : []),
    "",
    `Round ${slot} of ${slot > BUDGET ? CRITICAL_LIMIT : BUDGET}. Rules for this review:`,
    "1. One question: which case is missing that can harm a user, their data, their money or a secret today, at this head? The author already ran the cases listed above; look for the one that is not there, the ugly paths first (wrong role, interrupted flow, repeated request, empty or hostile input).",
    "2. Mark every finding live or latent. live: at this head something reachable (the product, or a script, CI job or CLI that runs today) can harm a user, their data, their money or a secret; name the path that reaches it. latent: nothing reaches it today (a hole in a checker, lint or formal model with no violation in the code, unreachable code, or something that needs a deliberate change by someone with write access). Only a live finding blocks.",
    "3. At most one latent note per checker, lint or formal model in this PR; do not list its variants.",
    "4. For each finding say whether you reproduced it or only reasoned it. \"Not reproduced\" describes the evidence, not the severity.",
    "5. Give each finding as <id>:<path>[+<path>]@<prior|fix-induced|new>/<security|authorization|data-loss|money|minors-privacy|consent|none>/<live|latent>.",
    ...(listed.length ? ["6. This is the confirmation round, the last one: for each live critical finding listed above read only its fix (or its rejection) and what that fix breaks. Answer `closed`, or repeat the finding with the same id as live; a repeated finding takes the disputed change out of the PR."] : slot > BUDGET ? ["6. This is the last round: re-read only the fix of the open critical finding and what that fix breaks."] : []),
    ...(rejected.length ? ["", "Codex threads the coordinator rejected and you must judge (say for each whether the rejection holds):", ...rejected.map((thread) => `- ${thread.id} ${thread.path}: ${thread.finding}`)] : []),
    "",
    "Coordinator, after the round: check each finding against the code before touching anything. A live finding is a missing case: add it to the area's verification guide in this PR, fix it (prefer the fix that deletes or narrows code), run the cases again and record the evidence for the new head. A live critical finding is fixed in this task, never left for later: record it as fixed with its commit, or rejected with the reason, and the one confirmation round reads it. Latent findings stay as notes and need no disposition. Record what happened to each live finding with development-system review dispose.",
  ];
  return lines.join("\n");
}
