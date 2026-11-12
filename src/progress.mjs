// @ts-check
// `development-system progress <PR>...` (2.13.0, plan ds-friction-plan-20261111 v5, C4): the facts of an initiative's
// PRs, read from what already exists, so a progress answer does not depend on what the agent remembers.
//
// It takes the explicit list of PRs (the current branch would leave the earlier ones out) and reads four things per
// PR: its state on GitHub, the review gate's step when it is open, the Sol rounds in the ledger and the recorded
// behavioral evidence. It prints only facts. What it could not read is printed as `desconocido`, never as a fact, and
// one unreadable PR does not hide the others. It never says that something waits for the owner or that the work is
// finished: the coordinator decides that, against the authorization it already has. Read-only: no merge pass is
// written, nothing is requested and no record is added.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { readReceipts } from "./evidence.mjs";
import { readReviewRecords } from "./review-records.mjs";
import { parsePr, prReviewStatus } from "./pr-review-status.mjs";

export const UNKNOWN = "desconocido";

/**
 * @typedef {{state: "merged" | "open" | "closed", base: string, head: string, title: string, at: string}} GithubFacts
 * @typedef {{step: string, codex: string, sol: string, evidence: string, mergeReady: boolean}} GateFacts
 * @typedef {{rounds: number, last: string, notes: string[]}} LedgerFacts
 * @typedef {{receipts: number, forHead: boolean | null}} EvidenceFacts
 * @typedef {{pr: string, github: GithubFacts | null, gate: GateFacts | null, ledger: LedgerFacts | null, evidence: EvidenceFacts | null, unknown: string[]}} PrProgress
 * @typedef {{pull: (owner: string, repo: string, number: number) => any, gate: (pr: string, home: string) => any, records: (home: string, pr: string) => any[], receipts: (home: string, pr: string) => any[]}} Readers
 */

/** @type {Readers} */
const READERS = {
  pull: (owner, repo, number) => JSON.parse(execFileSync("gh", ["api", `repos/${owner}/${repo}/pulls/${number}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })),
  gate: (pr, home) => prReviewStatus({ pr, home }),
  records: readReviewRecords,
  receipts: readReceipts,
};

/** One short line of why a read failed. @param {unknown} error */
const why = (error) => String(error instanceof Error ? error.message : error).replace(/\s+/g, " ").trim().slice(0, 140);

// The gate machine's step for a base it does not decide alone. Printed as where the gate stands, not as a request.
const STEP = /** @type {Record<string, string>} */ ({ ownerDecides: "fuera de la puerta automática" });

/**
 * @param {{prs: string[], home?: string, readers?: Partial<Readers>}} options
 */
export function progress({ prs, home = homedir(), readers = {} }) {
  if (prs.length === 0) throw new Error("progress needs the explicit list of PRs: development-system progress <owner/repo#number>...");
  const read = { ...READERS, ...readers };
  const keys = [...new Set(prs.map((pr) => { const { owner, repo, number } = parsePr(pr); return `${owner}/${repo}#${number}`; }))];
  /** @type {PrProgress[]} */
  const rows = keys.map((pr) => {
    const { owner, repo, number } = parsePr(pr);
    /** @type {string[]} */
    const unknown = [];
    /** @template T @param {string} what @param {() => T} work @returns {T | null} */
    const attempt = (what, work) => { try { return work(); } catch (error) { unknown.push(`${what}: ${why(error)}`); return null; } };
    const github = attempt("GitHub", () => {
      const pull = read.pull(owner, repo, number);
      const state = pull.merged_at ? "merged" : pull.state === "open" ? "open" : pull.state === "closed" ? "closed" : null;
      if (!state || typeof pull.base?.ref !== "string" || typeof pull.head?.sha !== "string") throw new Error("GitHub's answer does not say the PR's state, base or head");
      return /** @type {GithubFacts} */ ({ state, base: pull.base.ref, head: pull.head.sha, title: String(pull.title ?? ""), at: String(pull.merged_at ?? pull.closed_at ?? pull.updated_at ?? "") });
    });
    const ledger = attempt("libro de rondas", () => {
      const records = read.records(home, pr);
      const rounds = records.filter((record) => record.type === "round");
      const last = rounds.at(-1);
      const notes = [
        ...records.filter((record) => record.type === "exemption").map((record) => `exento de Sol (${record.exempt})`),
        ...(records.some((record) => record.type === "waiver") ? ["dispensa registrada"] : []),
        ...(records.some((record) => record.type === "auto-advance") ? ["avance sin otra ronda registrado"] : []),
      ];
      return /** @type {LedgerFacts} */ ({ rounds: rounds.length, last: last ? `ronda ${last.round} ${last.scope} ${last.result}` : "", notes });
    });
    const evidence = attempt("evidencia", () => {
      const receipts = read.receipts(home, pr);
      return /** @type {EvidenceFacts} */ ({ receipts: receipts.length, forHead: github ? receipts.some((entry) => entry.receipt?.verifiedSha === github.head) : null });
    });
    // The gate is asked only for an open PR: after a merge its step says nothing, and a PR whose state is unknown
    // cannot be placed in it.
    const gate = github?.state !== "open" ? null : attempt("puerta", () => {
      const status = read.gate(pr, home);
      return /** @type {GateFacts} */ ({ step: String(status.step), codex: String(status.codex), sol: String(status.sol), evidence: String(status.evidencia), mergeReady: status.mergeReady === true });
    });
    return { pr, github, gate, ledger, evidence, unknown };
  });
  const count = (/** @type {(row: PrProgress) => boolean} */ test) => rows.filter(test).length;
  return {
    ok: true,
    operation: "progress",
    prs: rows,
    totals: { merged: count((row) => row.github?.state === "merged"), open: count((row) => row.github?.state === "open"), closed: count((row) => row.github?.state === "closed"), unknown: count((row) => row.github === null) },
  };
}

const STATE = { merged: "fusionado", open: "abierto", closed: "cerrado sin fusionar" };

/** @param {ReturnType<typeof progress>} result */
export function formatProgress(result) {
  const { totals } = result;
  const lines = [`${result.prs.length} PRs: ${totals.merged} fusionados, ${totals.open} abiertos, ${totals.closed} cerrados sin fusionar, ${totals.unknown} con estado ${UNKNOWN}.`];
  for (const row of result.prs) {
    const parts = [];
    if (row.github) parts.push(`${STATE[row.github.state]} (base ${row.github.base}, head ${row.github.head.slice(0, 12)}${row.github.state === "open" ? "" : `, ${row.github.at.slice(0, 10)}`})`);
    else parts.push(`estado ${UNKNOWN}`);
    if (row.gate) parts.push(`puerta: paso ${STEP[row.gate.step] ?? row.gate.step}, Codex ${row.gate.codex}, Sol ${row.gate.sol}, evidencia ${row.gate.evidence}, pase de fusión ${row.gate.mergeReady ? "disponible" : "no disponible"}`);
    else if (row.github?.state === "open") parts.push(`puerta ${UNKNOWN}`);
    if (row.ledger) parts.push(`rondas de Sol ${row.ledger.rounds}${row.ledger.last ? ` (última: ${row.ledger.last})` : ""}${row.ledger.notes.length ? `; ${row.ledger.notes.join("; ")}` : ""}`);
    else parts.push(`rondas ${UNKNOWN}`);
    if (row.evidence) parts.push(`evidencia registrada: ${row.evidence.receipts} ${row.evidence.receipts === 1 ? "recibo" : "recibos"}${row.evidence.receipts === 0 ? "" : row.evidence.forHead === null ? `, del head ${UNKNOWN}` : row.evidence.forHead ? ", uno del head" : ", ninguno del head"}`);
    else parts.push(`evidencia ${UNKNOWN}`);
    lines.push(`- ${row.pr}${row.github?.title ? ` «${row.github.title.slice(0, 70)}»` : ""}: ${parts.join(" | ")}`);
    for (const reason of row.unknown) lines.push(`  ${UNKNOWN}: ${reason}`);
  }
  return lines.join("\n");
}
