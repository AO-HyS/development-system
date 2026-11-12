// @ts-check
// `development-system review <subcommand>`: the review ledger (Fable or Sol rounds) from the command line. Moved out of cli.mjs in 2.13.0 with
// the subcommands that let the agent finish a review without anyone's permission: brief (the reviewer packet), dispose
// (what happened to each finding), advance (the row at the round cap) and lines (the hashes a void names).
import { homedir } from "node:os";

/** @type {Record<string, Record<string, string>>} */
const FLAGS = {
  record: { "--home": "home", "--pr": "pr", "--reviewer": "reviewer", "--observed-model": "observedModel", "--head": "head", "--scope": "scope", "--result": "result", "--thread": "thread", "--exempt": "exempt", "--reason": "reason", "--from": "from", "--operator-approval": "operatorApproval" },
  coverage: { "--home": "home", "--pr": "pr", "--from": "from", "--to": "to", "--findings": "findings", "--verdict": "verdict", "--note": "note" },
  reserve: { "--home": "home", "--pr": "pr", "--scope": "scope", "--request-key": "requestKey", "--packet-hash": "packetHash", "--approval-id": "approvalId", "--redesign": "redesign", "--critical-thread": "criticalThread" },
  approve: { "--home": "home", "--pr": "pr", "--slot": "slot", "--scope": "scope", "--quote": "quote", "--source-ref": "sourceRef" },
  void: { "--home": "home", "--pr": "pr", "--line-hash": "lineHash", "--reason": "reason", "--quote": "quote" },
  release: { "--home": "home", "--pr": "pr", "--reservation-id": "reservationId", "--reason": "reason", "--quote": "quote" },
  waive: { "--home": "home", "--pr": "pr", "--head": "head", "--quote": "quote" },
  dispose: { "--home": "home", "--pr": "pr", "--finding": "finding", "--outcome": "outcome", "--commit": "commit", "--note": "note", "--round": "round" },
  advance: { "--home": "home", "--pr": "pr", "--head": "head" },
  lines: { "--home": "home", "--pr": "pr" },
  brief: { "--home": "home", "--pr": "pr" },
};

/**
 * The reviewer packet for the PR's next review round (Fable or Sol), read from the gate's own state (read-only).
 * @param {{home: string, pr?: string}} options
 */
async function reviewBrief({ home, pr }) {
  if (!pr) throw new Error("review brief needs --pr <owner/repo#number | PR URL>");
  const { prReviewStatus } = await import("./pr-review-status.mjs");
  const { reviewerBrief } = await import("./review-next.mjs");
  const status = prReviewStatus({ pr, home });
  const lineage = "error" in status.lineage ? null : status.lineage;
  if (status.step !== "solRound" || !lineage) return { ok: true, operation: "review-brief", pr: status.pr, round: false, brief: `No review round runs now for ${status.pr}. Siguiente: ${status.siguiente}` };
  const pending = lineage.pending.find((reservation) => reservation.pr === status.pr.toLowerCase());
  const slot = pending?.slot ?? lineage.nextSlot;
  const last = lineage.lastRound;
  const scope = /** @type {"full" | "fix-diff"} */ (pending?.scope ?? (slot === 1 || !last ? "full" : "fix-diff"));
  const evidence = /** @type {{receipt?: string}} */ (status.behavioralEvidence);
  const brief = reviewerBrief({
    prKey: status.pr, head: status.head, scope, from: scope === "fix-diff" ? last?.head : undefined, slot,
    receipt: ["ok", "nonvisual"].includes(status.behavioralEvidence.state) ? evidence.receipt : undefined,
    rejected: status.codexThreads.filter((thread) => thread.state === "rejected-needs-sol"),
    hard: status.reviewer === "fable" ? status.reviewerReason : "",
  });
  return { ok: true, operation: "review-brief", pr: status.pr, round: true, slot, scope, reviewer: status.reviewer, brief };
}

/** @param {string[]} argv starting at "review" */
export async function runReviewCommand(argv) {
  const subcommand = argv[1];
  const valueFlags = subcommand !== undefined && Object.hasOwn(FLAGS, subcommand) ? FLAGS[subcommand] : undefined;
  if (!valueFlags) throw new Error(`Usage: development-system review <${Object.keys(FLAGS).join("|")}> [options]`);
  const json = argv.includes("--json");
  // --dry-run validates exactly like the real call (GitHub reads included) and writes nothing.
  const dryRunAllowed = subcommand === "record" || subcommand === "reserve" || subcommand === "advance";
  let dryRun = false;
  let withdrawn = false;
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {string[]} */
  const findings = [];
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") continue;
    if (arg === "--dry-run" && dryRunAllowed) { dryRun = true; continue; }
    if (arg === "--withdrawn" && subcommand === "advance") { withdrawn = true; continue; }
    const isFinding = arg === "--finding" && subcommand === "record";
    const key = Object.hasOwn(valueFlags, arg) ? valueFlags[arg] : undefined;
    if (!key && !isFinding) throw new Error(`Unknown option for review ${subcommand}: ${arg}`);
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (isFinding || !key) findings.push(value); else values[key] = value;
  }
  const home = values.home ?? homedir();
  const reviews = await import("./review-records.mjs");
  /** @param {any} result @param {(result: any) => string} format */
  const done = (result, format) => ({ result, output: json ? JSON.stringify(result) : format(result), json });
  if (subcommand === "record" && values.operatorApproval !== undefined) throw new Error(reviews.OPERATOR_APPROVAL_MOVED);
  if (subcommand === "record") return done(reviews.recordReview({ home, pr: values.pr, reviewer: values.reviewer, observedModel: values.observedModel, head: values.head, scope: values.scope, result: values.result, thread: values.thread, findings, exempt: values.exempt, reason: values.reason, from: values.from, dryRun }), reviews.formatReviewRecord);
  if (subcommand === "coverage") return done(reviews.recordCoverage({ home, pr: values.pr, from: values.from, to: values.to, findings: values.findings === undefined ? [] : values.findings.split(",").map((item) => item.trim()).filter(Boolean), verdict: values.verdict, note: values.note }), reviews.formatReviewRecord);
  if (subcommand === "waive") return done(reviews.waiveReview({ home, pr: values.pr, head: values.head, quote: values.quote }), reviews.formatReviewRecord);
  if (subcommand === "dispose" || subcommand === "advance") {
    const advance = await import("./review-advance.mjs");
    return done(subcommand === "dispose"
      ? advance.recordDisposition({ home, pr: values.pr, finding: values.finding, outcome: values.outcome, commit: values.commit, note: values.note, round: values.round })
      : advance.recordAdvance({ home, pr: values.pr, head: values.head, withdrawn, dryRun }), reviews.formatReviewRecord);
  }
  if (subcommand === "brief") return done(await reviewBrief({ home, pr: values.pr }), (result) => result.brief);
  if (subcommand === "lines") {
    if (!values.pr) throw new Error("review lines needs --pr <owner/repo#number | PR URL>");
    return done({ ok: true, operation: "review-lines", lines: reviews.ledgerLines(home, values.pr) }, reviews.formatReviewState);
  }
  return done(subcommand === "reserve"
    ? reviews.reserveReview({ home, pr: values.pr, scope: values.scope, requestKey: values.requestKey, packetHash: values.packetHash, approvalId: values.approvalId, redesign: values.redesign, criticalThread: values.criticalThread, dryRun })
    : subcommand === "approve"
      ? reviews.approveReview({ home, pr: values.pr, slot: values.slot, scope: values.scope, quote: values.quote, sourceRef: values.sourceRef })
      : subcommand === "void"
        ? reviews.voidReviewLine({ home, pr: values.pr, lineHash: values.lineHash, reason: values.reason, quote: values.quote })
        : reviews.releaseReservation({ home, pr: values.pr, reservationId: values.reservationId, reason: values.reason, quote: values.quote }), reviews.formatReviewState);
}
