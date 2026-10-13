// @ts-check
// Hard rule from the 2026-10-12 mistake log (agents-rewrite-dropped-rules):
// an AGENTS.md/CLAUDE.md rewrite must keep every behavior-constraining sentence
// of its base, either in the rewritten file or in a document the repository
// already tracks (moved reference). Fuzzy token matching tolerates rewording.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const imperative = /\b(?:must|never|always|only|do not|don't|does not|cannot|require[sd]?|forbid(?:den)?|prohibit|stop|ask|wait|before|until|unless|exactly|no\s+\w+|keep|preserve|use|run|verify|nunca|siempre|s[oó]lo|debe[n]?|no\s+\w+|prohib\w*|requiere\w*|espera\w*|pide|antes|conserva\w*|usa|ejecuta|verifica)\b/i;
const stop = new Set("the a an and or of to in on for with by from this that these those is are be it its as at into than then when where which who whose your you their there here also each every any all not no do does".split(" "));

/** @param {string} text */
export function ruleSentences(text) {
  const prose = text.replace(/```[\s\S]*?```/g, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const sentences = [];
  for (const block of prose.split(/\n\s*\n/)) {
    const flat = block.replace(/^\s*(?:[-*]|\d+\.)\s+/gm, "").replace(/^#+\s.*$/gm, "").replace(/\s+/g, " ").trim();
    for (const sentence of flat.split(/(?<=[.;:!?])\s+(?=[A-Z0-9`*"'¿¡])/)) {
      const value = sentence.trim();
      if (value.split(" ").length >= 4 && imperative.test(value)) sentences.push(value);
    }
  }
  return sentences;
}

/** @param {string} text */
function tokens(text) {
  // Five-letter stems tolerate rewording ("invokes"/"invoke", "enforced"/"enforce").
  return new Set(text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9_./@-]{3,}/g)?.filter(word => !stop.has(word)).map(word => word.slice(0, 5)) ?? []);
}

/** @param {Set<string>} rule @param {Set<string>} candidate */
function coverage(rule, candidate) {
  if (rule.size === 0) return 1;
  let hit = 0;
  for (const word of rule) if (candidate.has(word)) hit += 1;
  return hit / rule.size;
}

/**
 * Base rule sentences that no corpus block covers.
 * @param {string} previous @param {{file: string, words: Set<string>}[]} corpus @param {{threshold: number, allow: string[]}} options
 */
export function missingRules(previous, corpus, { threshold, allow }) {
  const missing = [];
  let kept = 0;
  for (const rule of ruleSentences(previous)) {
    if (allow.some(fragment => rule.includes(fragment))) { kept += 1; continue; }
    const words = tokens(rule);
    let best = { score: 0, file: "" };
    for (const block of corpus) {
      const score = coverage(words, block.words);
      if (score > best.score) best = { score, file: block.file };
      if (score >= 1) break;
    }
    if (best.score >= threshold) kept += 1;
    else missing.push({ rule, bestMatch: best.file || null, score: Number(best.score.toFixed(2)) });
  }
  return { kept, missing };
}

/** @param {string} text @param {string} file */
export function corpusBlocks(text, file) {
  return text.replace(/```[\s\S]*?```/g, " ").split(/\n\s*\n/).map(block => ({ file, words: tokens(block) }));
}

/**
 * @param {{ root: string, base: string, head?: string, files: string[], threshold?: number, allow?: string[] }} options
 */
export function checkAgentsRules({ root, base, head, files, threshold = 0.5, allow = [] }) {
  if (!base) throw new Error("check-agents-rules requires --base <ref>");
  if (files.length === 0) files = ["AGENTS.md"];
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const tracked = (head ? git("ls-tree", "-r", "--name-only", head) : git("ls-files")).split("\n").filter(file => file.endsWith(".md"));
  const corpus = [];
  for (const file of tracked) {
    let text;
    try { text = head ? git("show", `${head}:${file}`) : readFileSync(path.join(root, file), "utf8"); } catch { continue; }
    corpus.push(...corpusBlocks(text, file));
  }
  const results = [];
  for (const file of files) {
    let previous;
    try { previous = git("show", `${base}:${file}`); } catch { results.push({ file, kept: 0, missing: [], note: "absent at base" }); continue; }
    results.push({ file, ...missingRules(previous, corpus, { threshold, allow }) });
  }
  const missingCount = results.reduce((sum, entry) => sum + entry.missing.length, 0);
  return { operation: "check-agents-rules", base, head: head ?? "worktree", threshold, valid: missingCount === 0, missingCount, results };
}

/** @param {ReturnType<typeof checkAgentsRules>} result */
export function formatAgentsRules(result) {
  const lines = [];
  for (const entry of result.results) {
    lines.push(`${entry.file}: ${entry.kept ?? 0} base rules kept, ${entry.missing.length} missing${"note" in entry ? ` (${entry.note})` : ""}`);
    for (const miss of entry.missing) lines.push(`  missing: ${miss.rule}${miss.bestMatch ? `  [closest ${miss.bestMatch} ${miss.score}]` : ""}`);
  }
  lines.push(result.valid ? "AGENTS rules OK." : "Restore each missing rule, move it to a tracked doc, or pass --allow '<fragment>' for an intentional removal.");
  return lines.join("\n");
}
