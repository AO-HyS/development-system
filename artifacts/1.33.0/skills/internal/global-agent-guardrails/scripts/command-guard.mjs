#!/usr/bin/env node
// @ts-check

import { readFile } from "node:fs/promises";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { posix } from "node:path";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(await readFile(resolve(root, "references", "policy.json"), "utf8"));

/** @param {any} rule */
function compileRule(rule) {
  return { ...rule, regex: new RegExp(rule.pattern, rule.flags ?? "iu") };
}
const commandRules = policy.rules.filter((/** @type {any} */ rule) => (rule.match ?? "command") === "command").map(compileRule);
const pipelineRules = policy.rules.filter((/** @type {any} */ rule) => rule.match === "pipeline").map(compileRule);
const rawRules = policy.rules.filter((/** @type {any} */ rule) => rule.match === "raw").map(compileRule);
/** @type {Record<string, string>} */
const structural = Object.fromEntries(policy.structuralRules.map((/** @type {any} */ rule) => [rule.id, rule.reason]));
const testFilePatterns = policy.testFilePatterns.map((/** @type {string} */ source) => new RegExp(source, "u"));
const readOnlyCommands = new Set(policy.readOnlyCommands);
const sensitiveCommands = new Set(policy.sensitiveCommands);
const readOnlyGit = new Set(policy.readOnlyGitSubcommands);
const readOnlyGitBranchOptions = new Set(policy.readOnlyGitBranchOptions);
const maxDepth = Number(policy.maxSubstitutionDepth ?? 4);

const HOME = process.env.HOME || homedir();
const foldCase = process.platform === "darwin" || process.platform === "win32";
/** Unknown expansion marker inside word values. */
const UNKNOWN = "\u0000";
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "csh", "tcsh", "fish", "ash", "mksh", "yash", "rbash", "pdksh", "oksh", "posh"]);
/** Evaluation budget: the hook times out after 5 s, so the engine denies on its own before that. */
const DEADLINE_MS = 3000;
const MAX_COMMAND_BYTES = 64 * 1024;
let deadline = Infinity;
let clockDepth = 0;
/** Pipelines longer than this are not real usage; the pipeline rules would scan them quadratically. */
const MAX_PIPELINE_STAGES = 512;
const TOO_LARGE_REASON = "Command too large or too slow for the guard; split it into smaller commands.";
function checkDeadline() {
  if (Date.now() > deadline) throw new Block("guard-timeout", TOO_LARGE_REASON);
}
/** @template T @param {() => T} fn @returns {T} */
function withClock(fn) {
  if (clockDepth++ === 0) deadline = Date.now() + DEADLINE_MS;
  try { return fn(); }
  finally { if (--clockDepth === 0) deadline = Infinity; }
}
const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);
const SHELL_TOOLS = new Set(["Bash", "exec", "Monitor", "shell", "local_shell", "exec_command", "container.exec"]);
const OPENERS = new Set(["if", "then", "else", "elif", "do", "while", "until", "{", "!", "time", "coproc"]);
const CLOSERS = new Set(["fi", "done", "esac", "}"]);
const BRANCH_OPENERS = new Set(["if", "while", "until", "for", "select", "{"]);
const BRANCH_CLOSERS = new Set(["fi", "done", "}"]);

class Block extends Error {
  /** @param {string} ruleId @param {string} [reason] */
  constructor(ruleId, reason) {
    super(reason ?? structural[ruleId] ?? ruleId);
    this.ruleId = ruleId;
    this.reason = reason ?? structural[ruleId] ?? ruleId;
  }
}
class ParseError extends Error {}

/**
 * @typedef {{ value: string, literal: boolean, quoted: boolean, raw: string, subs: any[], procSubst: boolean, name?: string, glob?: boolean, opener?: boolean }} Word
 * @typedef {{ op: string, fd: string, target: Word | null, heredoc: any }} Redirect
 * @typedef {{ cwd: string | null, scope: string, depth: number, aliases?: Map<string, Word[] | null>, lenient?: boolean, cdpath?: boolean }} Context
 */

/** @returns {Word} */
function newWord() {
  return { value: "", literal: true, quoted: false, raw: "", subs: [], procSubst: false };
}

/** @param {string} value @returns {Word} */
function literalWord(value) {
  return { value, literal: true, quoted: true, raw: value, subs: [], procSubst: false };
}

/** Builtins whose arguments are variable names or arithmetic. */
const NAME_BUILTINS = new Set(["let", "printf", "print", "read", "declare", "typeset", "local", "export", "readonly", "integer", "float", "unset", "mapfile", "readarray", "getopts", "wait", "test", "[", "set", "vared"]);

/**
 * Text shaped like `name[$(…)]` (also nested, `a[b[0]+$(…)]`): bash runs the subscript when the
 * text is later used as a variable name or in arithmetic. A linear scan: any `$(` or backtick
 * while a `[` is open.
 * @param {string} value
 */
function checkSubscriptCode(value) {
  let open = 0;
  for (let j = 0; j < value.length; j++) {
    const c = value[j];
    if (c === "[") open++;
    else if (c === "]") { if (open > 0) open--; }
    else if (open > 0 && (c === "`" || (c === "$" && value[j + 1] === "("))) throw new Block("shell-arithmetic-injection");
  }
}

/** Set per command: the command changes what `cat` runs (function, alias, hash, enable, PATH), so its output is not known. */
let catRedefined = false;
/** Set by the parser when it reads such a change; parseScript then parses again with catRedefined. */
let catTouched = false;

/** Parse a whole script; when it changes what `cat` runs, parse it again so no `$(cat <<'EOF' …)` counts as literal. @param {string} text @param {number} depth */
function parseScript(text, depth) {
  catTouched = false;
  const list = new Parser(text, depth).parseAll();
  if (!catTouched || catRedefined) return list;
  catRedefined = true;
  return new Parser(text, depth).parseAll();
}

/** PATH, zsh `path`, and the bash and zsh tables that define functions, commands and aliases by name (`BASH_CMDS[cat]=…`). */
const CAT_LOOKUP_NAMES = /^(?:path|bash_cmds|bash_aliases|(?:dis_)?(?:functions|commands|aliases|galiases|saliases|builtins))$/iu;
/** One of those names anywhere in arithmetic text. */
const CAT_LOOKUP_WORD = new RegExp(String.raw`\b${CAT_LOOKUP_NAMES.source.slice(1, -1)}\b`, "iu");
/** Precommand words that run the next word as the command (`command -p`, `builtin --`, zsh `noglob`, `nocorrect`, `-`). */
const PRECOMMANDS = new Set(["builtin", "command", "noglob", "nocorrect", "-"]);

/**
 * Whether a simple command changes what `cat` runs: an alias, hash or enable naming cat, a PATH assignment (also through a
 * name-taking builtin such as `read`, `getopts` or `printf -v`, or a nameref), a function table entry, or a trap action that can.
 * @param {{ assigns: Word[], words: Word[] }} node
 */
function changesCat(node) {
  if (node.assigns.some((word) => CAT_LOOKUP_NAMES.test(word.name ?? ""))) return true;
  let words = node.words;
  while (words[0]?.literal && PRECOMMANDS.has(words[0].value)) {
    words = words.slice(1);
    while (words[0]?.literal && words[0].value.startsWith("-") && words.length > 1) words = words.slice(1);
  }
  const [head, ...rest] = words;
  if (!head?.literal) return false;
  /** A word naming a variable: a dynamic name, or PATH or a function table, alone or assigned. @param {Word | undefined} word */
  const namesLookup = (word) => {
    if (!word) return false;
    const name = /^([A-Za-z_]\w*)(?:\[[^\]]*\])?(?:\+?=|$)/u.exec(word.value)?.[1];
    return name === undefined ? !word.literal && !word.value.startsWith("-") : CAT_LOOKUP_NAMES.test(name);
  };
  switch (head.value) {
    // zsh `autoload cat` (from fpath) and `functions -c f cat` define cat as a function.
    case "alias": case "hash": case "enable": case "trap": case "autoload": case "functions":
      return rest.some((word) => !word.literal || /(?:^|[^\w.-])cat\b|\bpath(?:\+?=|\[|\s|$)/iu.test(word.value));
    case "printf": case "print": case "wait": case "set": {
      // Only the value of -v (printf, print), -p (wait) or -A (zsh set) names a variable, also inside an option cluster.
      const letter = { printf: "v", print: "v", wait: "p", set: "A" }[head.value];
      return rest.some((word, k) => {
        if (!/^[-+]\w/u.test(word.value) || (word.value[0] === "+" && head.value !== "set")) return false;
        const at = word.value.indexOf(letter, 1);
        if (at < 0) return false;
        const name = word.value.slice(at + 1);
        return namesLookup(name ? { ...word, value: name } : rest[k + 1]);
      });
    }
    case "test": case "[":
      return false;
    default:
      // A nameref (`declare -n p=PATH`) assigns through another name.
      if (["declare", "typeset", "local"].includes(head.value) && rest.some((word) => /^-[A-Za-z]*n/u.test(word.value))) return true;
      return NAME_BUILTINS.has(head.value) && rest.some(namesLookup);
  }
}

/** Output of a substitution that is only `cat` reading a quoted (literal) heredoc, or null. @param {any} list */
function literalOutput(list) {
  if (catRedefined || list.items.length !== 1 || list.items[0].commands.length !== 1) return null;
  const node = list.items[0].commands[0];
  if (node.type !== "simple" || node.assigns.length > 0 || node.words.length !== 1 || node.redirects.length !== 1) return null;
  const [head] = node.words;
  const [redirect] = node.redirects;
  if (!head.literal || head.value !== "cat" || !redirect.heredoc?.quoted || (redirect.fd && redirect.fd !== "0")) return null;
  return redirect.heredoc.body.replace(/\n+$/u, "");
}

/** @param {Word} word */
function markDynamic(word) {
  word.literal = false;
  word.value += UNKNOWN;
}

/** @param {string} c */
function isBlank(c) {
  return c === " " || c === "\t" || c === "\r";
}

/** @param {string} c */
function endsToken(c) {
  return c === "" || /[\s;&|<>()]/u.test(c);
}

class Parser {
  /** @param {string} source @param {number} depth */
  constructor(source, depth) {
    this.s = source;
    this.i = 0;
    this.depth = depth;
    this.nesting = 0;
    /** @type {any[]} */
    this.heredocs = [];
    /** @type {{ close: string, from: number, stop: number, found: boolean } | null} */
    this.closeScan = null;
    /** @type {{ from: number, stop: number, expands: Set<number> } | null} */
    this.braceScan = null;
    /** Open if/while/until/for/select bodies and brace groups (function bodies included): their commands may not run. */
    this.branches = 0;
    if (depth > maxDepth) throw new Block("shell-nesting-depth");
  }

  peek(offset = 0) { return this.s[this.i + offset] ?? ""; }
  eof() { return this.i >= this.s.length; }
  /** @param {string} text */
  at(text) { return this.s.startsWith(text, this.i); }
  /** @param {string} char */
  expect(char) {
    if (this.peek() !== char) throw new ParseError(`expected ${JSON.stringify(char)} at offset ${this.i}`);
    this.i++;
  }

  enter() {
    this.nesting++;
    if (this.depth + this.nesting > maxDepth) throw new Block("shell-nesting-depth");
  }
  leave() { this.nesting--; }

  parseAll() {
    const list = this.parseList({});
    if (!this.eof()) throw new ParseError(`unexpected ${JSON.stringify(this.peek())} at offset ${this.i}`);
    this.readHeredocs();
    return list;
  }

  skipBlanks() {
    for (;;) {
      const c = this.peek();
      if (isBlank(c)) { this.i++; continue; }
      if (c === "\\" && this.peek(1) === "\n") { this.i += 2; continue; }
      if (c === "#") { while (!this.eof() && this.peek() !== "\n") this.i++; continue; }
      return;
    }
  }

  skipBlanksAndNewlines() {
    for (;;) {
      this.skipBlanks();
      if (this.peek() === "\n") { this.newline(); continue; }
      return;
    }
  }

  newline() {
    this.i++;
    this.readHeredocs();
  }

  readHeredocs() {
    const pending = this.heredocs;
    this.heredocs = [];
    for (const heredoc of pending) {
      const lines = [];
      while (!this.eof()) {
        const end = this.s.indexOf("\n", this.i);
        const lineEnd = end < 0 ? this.s.length : end;
        const line = this.s.slice(this.i, lineEnd);
        this.i = end < 0 ? this.s.length : end + 1;
        const compared = (heredoc.strip ? line.replace(/^\t+/u, "") : line).replace(/\r$/u, "");
        if (compared === heredoc.delimiter) break;
        lines.push(heredoc.strip ? line.replace(/^\t+/u, "") : line);
      }
      heredoc.body = lines.join("\n");
      if (!heredoc.quoted) {
        const body = new Parser(heredoc.body, this.depth + this.nesting);
        const word = body.parseHeredocText();
        heredoc.subs = word.subs;
        heredoc.literal = word.literal;
      }
    }
  }

  /** Scan an unquoted heredoc body: only expansions are active. */
  parseHeredocText() {
    const word = newWord();
    while (!this.eof()) {
      const c = this.peek();
      if (c === "\\") {
        const next = this.peek(1);
        if (next === "\n") { this.i += 2; continue; }
        if (next === "$" || next === "`" || next === "\\") { word.value += next; this.i += 2; continue; }
        word.value += c; this.i++; continue;
      }
      if (c === "$") { this.parseDollar(word, true); continue; }
      if (c === "`") { this.parseBacktick(word, true); continue; }
      word.value += c; this.i++;
    }
    return word;
  }

  peekKeyword() {
    const re = /[^\s;&|<>()'"\\$`]+/uy;
    re.lastIndex = this.i;
    const match = re.exec(this.s);
    if (!match) return "";
    if (!endsToken(this.s[this.i + match[0].length] ?? "")) return "";
    return match[0];
  }

  /** @param {{paren?: boolean, caseItem?: boolean}} terms */
  parseList(terms) {
    const items = [];
    let conditional = false;
    for (;;) {
      this.skipBlanks();
      if (this.eof()) break;
      const c = this.peek();
      if (c === "\n") { this.newline(); continue; }
      if (c === ")") {
        if (terms.paren) break;
        throw new ParseError(`unexpected ")" at offset ${this.i}`);
      }
      if (c === ";") {
        if (terms.caseItem && (this.at(";;") || this.at(";&"))) break;
        this.i += this.at(";;&") ? 3 : this.at(";;") || this.at(";&") ? 2 : 1;
        continue;
      }
      if (c === "&" && !this.at("&>")) { this.i += this.at("&&") ? 2 : 1; continue; }
      if (c === "|" ) throw new ParseError(`unexpected "|" at offset ${this.i}`);
      if (terms.caseItem && this.peekKeyword() === "esac") break;
      const pipeline = this.parsePipeline();
      // After && or || a pipeline may not run; with & it runs in a subshell.
      pipeline.conditional = conditional || this.branches > 0;
      items.push(pipeline);
      this.skipBlanks();
      conditional = this.at("&&") || this.at("||");
      if (conditional) { this.i += 2; continue; }
      pipeline.background = this.peek() === "&" && !this.at("&>");
    }
    return { type: "list", items };
  }

  parsePipeline() {
    const commands = [];
    for (;;) {
      this.skipBlanks();
      commands.push(this.parseCommand());
      this.skipBlanks();
      if (this.peek() === "|" && this.peek(1) !== "|") {
        this.i += this.peek(1) === "&" ? 2 : 1;
        this.skipBlanksAndNewlines();
        continue;
      }
      return { type: "pipeline", commands, conditional: false, background: false };
    }
  }

  parseCommand() {
    checkDeadline();
    for (;;) {
      this.skipBlanks();
      if (this.peek() === "\n") { this.newline(); continue; }
      if (this.eof()) return { type: "simple", assigns: [], words: [], redirects: [] };
      if (this.at("((")) return this.parseArithmeticCommand();
      if (this.peek() === "(") {
        this.i++;
        this.enterSubshell();
        const body = this.parseList({ paren: true });
        this.expect(")");
        return { type: "subshell", body, redirects: this.parseRedirectsOnly() };
      }
      const keyword = this.peekKeyword();
      if (BRANCH_OPENERS.has(keyword)) this.branches++;
      if (BRANCH_CLOSERS.has(keyword)) this.branches = Math.max(0, this.branches - 1);
      if (OPENERS.has(keyword)) {
        this.i += keyword.length;
        if (keyword === "time") { this.skipBlanks(); if (this.at("-p") && endsToken(this.peek(2))) this.i += 2; }
        continue;
      }
      if (CLOSERS.has(keyword)) {
        this.i += keyword.length;
        return { type: "simple", assigns: [], words: [], redirects: this.parseRedirectsOnly() };
      }
      if (keyword === "for" || keyword === "select") return this.parseFor(keyword);
      if (keyword === "case") return this.parseCase();
      if (keyword === "[[") return this.parseConditional();
      if (keyword === "function") {
        this.i += keyword.length;
        this.skipBlanks();
        // zsh defines every name before the body: `function a cat { … }`.
        for (let start = -1; start !== this.i && this.i < this.s.length && (start === -1 || !/[{(;&|\n]/u.test(this.s[this.i]));) {
          start = this.i;
          const name = this.parseWord(true);
          if (!name.literal || name.value === "cat") catTouched = true;
          this.skipBlanks();
        }
        if (/^\(\s*\)/u.test(this.s.slice(this.i, this.i + 8))) this.i = this.s.indexOf(")", this.i) + 1;
        continue;
      }
      return this.parseSimple();
    }
  }

  enterSubshell() { /* subshells do not count as substitutions */ }

  parseSimple() {
    /** @type {{type: "simple", assigns: Word[], words: Word[], redirects: Redirect[]}} */
    const node = { type: "simple", assigns: [], words: [], redirects: [] };
    const assignment = /[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]\s]*\])?\+?=/uy;
    for (;;) {
      this.skipBlanks();
      const c = this.peek();
      if (this.eof() || c === "\n" || c === ";" || c === ")" || c === "|") break;
      if (c === "&" && !this.at("&>")) break;
      const redirect = this.tryRedirect();
      if (redirect) { node.redirects.push(redirect); continue; }
      if (c === "(") {
        if (node.words.length === 1 && node.assigns.length === 0 && node.redirects.length === 0 && /^\(\s*\)/u.test(this.s.slice(this.i, this.i + 8))) {
          if (!node.words[0].literal || node.words[0].value === "cat") catTouched = true;
          this.i = this.s.indexOf(")", this.i) + 1;
          this.skipBlanksAndNewlines();
          return this.parseCommand();
        }
        throw new ParseError(`unexpected "(" at offset ${this.i}`);
      }
      if (node.words.length === 0) {
        assignment.lastIndex = this.i;
        const match = assignment.exec(this.s);
        if (match) {
          checkSubscriptCode(match[0]);
          this.i += match[0].length;
          if (this.peek() === "(") {
            this.i++;
            const array = newWord();
            for (;;) {
              this.skipBlanksAndNewlines();
              if (this.eof()) throw new ParseError("unterminated array assignment");
              if (this.peek() === ")") { this.i++; break; }
              const element = this.parseWord(false);
              if (!element.raw) throw new ParseError(`unexpected ${JSON.stringify(this.peek())} in array assignment`);
              array.subs.push(...element.subs);
              array.value += `${element.value} `;
              if (!element.literal) array.literal = false;
            }
            array.name = match[0].replace(/(?:\[[^\]]*\])?\+?=$/u, "");
            node.assigns.push(array);
          } else {
            const value = this.parseWord(false, true);
            value.name = match[0].replace(/(?:\[[^\]]*\])?\+?=$/u, "");
            node.assigns.push(value);
          }
          continue;
        }
      }
      const word = this.parseWord(node.words.length === 0);
      if (!word.raw) throw new ParseError(`unexpected ${JSON.stringify(this.peek())} at offset ${this.i}`);
      node.words.push(word);
    }
    if (changesCat(node)) catTouched = true;
    return node;
  }

  parseRedirectsOnly() {
    /** @type {Redirect[]} */
    const redirects = [];
    for (;;) {
      this.skipBlanks();
      const redirect = this.tryRedirect();
      if (!redirect) return redirects;
      redirects.push(redirect);
    }
  }

  /** @returns {Redirect | null} */
  tryRedirect() {
    const re = /(\d*)(<<<|<<-|<<|<>|<&|>>|>&|>\||&>>|&>|<(?!\()|>(?!\())/uy;
    re.lastIndex = this.i;
    const match = re.exec(this.s);
    if (!match) return null;
    const [, fd, op] = match;
    this.i = re.lastIndex;
    this.skipBlanks();
    if (op === "<<" || op === "<<-") {
      const word = this.parseWord(false);
      if (!word.raw) throw new ParseError("missing heredoc delimiter");
      const heredoc = {
        delimiter: word.raw.replace(/['"\\]/gu, ""),
        quoted: /['"\\]/u.test(word.raw),
        strip: op === "<<-",
        body: "",
        subs: [],
        literal: true,
      };
      this.heredocs.push(heredoc);
      return { op, fd, target: null, heredoc };
    }
    const target = this.parseWord(false);
    if (!target.raw) throw new ParseError(`missing redirection target at offset ${this.i}`);
    return { op, fd, target, heredoc: null };
  }

  /** @param {boolean} commandPosition @param {boolean} [assignment] */
  parseWord(commandPosition, assignment = false) {
    const start = this.i;
    const word = newWord();
    for (;;) {
      if (this.eof()) break;
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\r" || c === "\n" || c === ";" || c === "&" || c === "|" || c === ")") break;
      if (c === "<" || c === ">") {
        if (this.peek(1) === "(") { this.parseProcessSubstitution(word); continue; }
        break;
      }
      if (c === "=" && this.i === start && this.peek(1) === "(" && !assignment) { this.parseProcessSubstitution(word); continue; }
      if (c === "(") {
        if (this.i === start || commandPosition) break;
        this.parseGlobGroup(word);
        continue;
      }
      if (c === "\\") {
        if (this.peek(1) === "\n") { this.i += 2; continue; }
        if (this.i + 1 >= this.s.length) { word.value += "\\"; this.i++; continue; }
        word.value += this.peek(1);
        word.quoted = true;
        this.i += 2;
        continue;
      }
      if (c === "'") {
        const end = this.s.indexOf("'", this.i + 1);
        if (end < 0) throw new ParseError("unterminated single quote");
        word.value += this.s.slice(this.i + 1, end);
        word.quoted = true;
        this.i = end + 1;
        continue;
      }
      if (c === '"') { this.parseDouble(word); word.quoted = true; continue; }
      if (c === "$") { this.parseDollar(word, false); continue; }
      if (c === "`") { this.parseBacktick(word, false); continue; }
      if (c === "~" && this.i === start) { this.parseTilde(word); continue; }
      // An unquoted `{` or `[` may open a pattern the scans below cannot pair (`{"}",h}`, `[\h]`); looseGlob reads it.
      if (c === "{" || c === "[") word.opener = true;
      if (c === "{" && this.isBraceExpansion()) { markDynamic(word); word.glob = true; }
      if (c === "*" || c === "?" || (c === "[" && this.closesInWord("]"))) word.glob = true;
      // zsh extended glob operators (^x, x#, x~y).
      if (c === "^" || c === "#" || (c === "~" && !/^[\s;&|<>()]?$/u.test(this.peek(1)))) word.glob = true;
      word.value += c;
      this.i++;
    }
    word.raw = this.s.slice(start, this.i);
    return word;
  }

  /** True when `close` appears later in the same unquoted word. Each scan's answer holds for every later position it covered, so a word is scanned once. @param {string} close */
  closesInWord(close) {
    const cached = this.closeScan;
    if (cached && cached.close === close && this.i >= cached.from && this.i < cached.stop) return cached.found;
    let j = this.i + 1;
    let found = false;
    for (; j < this.s.length; j++) {
      const c = this.s[j];
      if (c === close) { found = true; break; }
      if (/[\s;&|<>()'"`$\\]/u.test(c)) break;
    }
    this.closeScan = { close, from: this.i, stop: j, found };
    return found;
  }

  /** Unquoted `{a,b}` or `{a..b}` expands to several words. One pass per word pairs every brace with a stack. */
  isBraceExpansion() {
    const cached = this.braceScan;
    if (cached && this.i >= cached.from && this.i < cached.stop) return cached.expands.has(this.i);
    /** @type {{ at: number, separator: boolean }[]} */
    const open = [];
    const expands = new Set();
    let j = this.i;
    for (; j < this.s.length; j++) {
      if ((j & 1023) === 0) checkDeadline();
      const c = this.s[j];
      if (c === "\\") { j++; continue; }
      if (/[\s;&|<>()]/u.test(c)) break;
      if (c === "{") open.push({ at: j, separator: false });
      else if (c === "}") { const brace = open.pop(); if (brace?.separator) expands.add(brace.at); }
      else if (open.length > 0 && (c === "," || (c === "." && this.s[j + 1] === "."))) open[open.length - 1].separator = true;
    }
    this.braceScan = { from: this.i, stop: j, expands };
    return expands.has(this.i);
  }

  /** `~`, `~/x` and `~user` expand to a home directory; `~+`, `~-`, `~N` and unknown users are dynamic. @param {Word} word */
  parseTilde(word) {
    const re = /~([^\s;&|<>()'"\\$`/]*)/uy;
    re.lastIndex = this.i;
    const match = /** @type {RegExpExecArray} */ (re.exec(this.s));
    const name = match[1];
    const after = this.s[this.i + match[0].length] ?? "";
    if (after !== "/" && !endsToken(after)) { word.value += "~"; this.i++; return; }
    this.i += match[0].length;
    if (name === "" || name === basename(HOME)) { word.value += HOME; return; }
    if (/^[A-Za-z_][A-Za-z0-9._-]*$/u.test(name)) {
      const home = join(dirname(HOME), name);
      try { if (statSync(home).isDirectory()) { word.value += home; return; } } catch { /* unknown user */ }
    }
    markDynamic(word);
  }

  /** @param {Word} word */
  parseDouble(word) {
    this.i++;
    for (;;) {
      if (this.eof()) throw new ParseError("unterminated double quote");
      const c = this.peek();
      if (c === '"') { this.i++; return; }
      if (c === "\\") {
        const next = this.peek(1);
        if (next === "\n") { this.i += 2; continue; }
        if (next === "$" || next === "`" || next === '"' || next === "\\") { word.value += next; this.i += 2; continue; }
        word.value += c;
        this.i++;
        continue;
      }
      if (c === "$") { this.parseDollar(word, true); continue; }
      if (c === "`") { this.parseBacktick(word, true); continue; }
      word.value += c;
      this.i++;
    }
  }

  /** @param {Word} word @param {boolean} inDouble */
  parseDollar(word, inDouble) {
    const next = this.peek(1);
    if (next === "'") {
      if (inDouble) { word.value += "$"; this.i++; return; }
      throw new Block("shell-ansi-c-quoting");
    }
    if (next === '"') {
      if (inDouble) { word.value += "$"; this.i++; return; }
      this.i++;
      this.parseDouble(word);
      word.quoted = true;
      return;
    }
    if (next === "(") {
      if (this.peek(2) === "(") { this.parseArithmetic(word, 3); return; }
      this.i += 2;
      this.enter();
      const body = this.parseList({ paren: true });
      this.expect(")");
      this.leave();
      word.subs.push(body);
      // `$(cat <<'EOF' … EOF)` prints a literal heredoc (the usual commit-message form): the word keeps that text.
      const printed = this.heredocs.length > 0 ? null : literalOutput(body);
      if (printed === null) markDynamic(word);
      else word.value += printed;
      return;
    }
    if (next === "{") { this.parseParameter(word, inDouble); return; }
    if (/[A-Za-z_]/u.test(next)) {
      const re = /[A-Za-z_][A-Za-z0-9_]*/uy;
      re.lastIndex = this.i + 1;
      const name = /** @type {RegExpExecArray} */ (re.exec(this.s))[0];
      this.i += 1 + name.length;
      if (name === "HOME") word.value += HOME;
      else markDynamic(word);
      return;
    }
    if (next !== "" && "=~^+".includes(next) && /[A-Za-z_{]/u.test(this.peek(2))) {
      this.i++;
      if (this.peek(1) === "{") { this.parseParameter(word, inDouble); markDynamic(word); return; }
      const re = /[A-Za-z_][A-Za-z0-9_]*/uy;
      re.lastIndex = this.i + 1;
      this.i += 1 + /** @type {RegExpExecArray} */ (re.exec(this.s))[0].length;
      markDynamic(word);
      return;
    }
    if (next !== "" && /[0-9?#$!@*-]/u.test(next)) {
      this.i += 2;
      markDynamic(word);
      return;
    }
    word.value += "$";
    this.i++;
  }

  /** @param {Word} word @param {number} skip */
  parseArithmetic(word, skip) {
    this.i += skip;
    const start = this.i;
    this.enter();
    const scratch = newWord();
    let depth = 0;
    for (;;) {
      if (this.eof()) throw new ParseError("unterminated arithmetic expansion");
      const c = this.peek();
      if (c === "(") { depth++; this.i++; continue; }
      if (c === ")") {
        if (depth === 0) {
          if (this.peek(1) !== ")") throw new ParseError("malformed arithmetic expansion");
          this.i += 2;
          break;
        }
        depth--;
        this.i++;
        continue;
      }
      if (c === "$") { this.parseDollar(scratch, true); continue; }
      if (c === "`") { this.parseBacktick(scratch, true); continue; }
      if (c === "\\") { this.i += 2; continue; }
      this.i++;
    }
    this.leave();
    // Arithmetic can assign PATH (`(( PATH = 5 ))` looks up `cat` in `./5`).
    if (CAT_LOOKUP_WORD.test(this.s.slice(start, this.i - 2))) catTouched = true;
    word.subs.push(...scratch.subs);
    markDynamic(word);
  }

  /** @param {Word} word @param {boolean} inDouble */
  parseParameter(word, inDouble) {
    const start = this.i + 2;
    if (this.peek(2) === "!" && this.peek(3) !== "}") throw new Block("shell-indirect-expansion");
    if (this.peek(2) === "(") {
      const close = this.s.indexOf(")", start);
      const flags = close < 0 ? "" : this.s.slice(start + 1, close);
      if (/e/u.test(flags)) throw new Block("shell-indirect-expansion");
    }
    this.i += 2;
    const scratch = newWord();
    for (;;) {
      if (this.eof()) throw new ParseError("unterminated parameter expansion");
      const c = this.peek();
      if (c === "}") { this.i++; break; }
      if (c === "\\") { this.i += 2; continue; }
      if (c === "'" && !inDouble) {
        const end = this.s.indexOf("'", this.i + 1);
        if (end < 0) throw new ParseError("unterminated single quote");
        this.i = end + 1;
        continue;
      }
      if (c === '"') { this.parseDouble(scratch); continue; }
      if (c === "$") { this.parseDollar(scratch, inDouble); continue; }
      if (c === "`") { this.parseBacktick(scratch, inDouble); continue; }
      this.i++;
    }
    const content = this.s.slice(start, this.i - 1);
    // `${x:=value}` / `${x=value}` assign as they expand.
    const assigned = /^[A-Za-z_][A-Za-z0-9_]*:?=/u.exec(content);
    if (assigned) checkSubscriptCode(content.slice(assigned[0].length));
    // `${PATH:=…}`, `${path::=…}` (zsh) and `${(A)path=…}` change what `cat` runs.
    const target = /^(?:\([^)]*\))?([A-Za-z_]\w*)(?:\[[^\]]*\])?:{0,2}=/u.exec(content);
    if (target && CAT_LOOKUP_NAMES.test(target[1])) catTouched = true;
    word.subs.push(...scratch.subs);
    if (content === "HOME") word.value += HOME;
    else markDynamic(word);
  }

  /** @param {Word} word @param {boolean} inDouble */
  parseBacktick(word, inDouble) {
    let j = this.i + 1;
    let content = "";
    for (;;) {
      if (j >= this.s.length) throw new ParseError("unterminated backtick");
      const c = this.s[j];
      if (c === "`") break;
      if (c === "\\") {
        const next = this.s[j + 1] ?? "";
        if (next === "`" || next === "\\" || next === "$" || (inDouble && next === '"')) { content += next; j += 2; continue; }
        if (next === "\n") { j += 2; continue; }
      }
      content += c;
      j++;
    }
    this.i = j + 1;
    this.enter();
    const body = new Parser(content, this.depth + this.nesting).parseAll();
    this.leave();
    word.subs.push(body);
    markDynamic(word);
  }

  /** @param {Word} word */
  parseProcessSubstitution(word) {
    this.i += 2;
    this.enter();
    const body = this.parseList({ paren: true });
    this.expect(")");
    this.leave();
    word.subs.push(body);
    word.procSubst = true;
    markDynamic(word);
  }

  /** Extglob or zsh glob qualifier attached to a word. @param {Word} word */
  parseGlobGroup(word) {
    const start = this.i;
    let depth = 0;
    for (;;) {
      if (this.eof()) throw new ParseError("unterminated glob group");
      const c = this.peek();
      if (c === "\\") { this.i += 2; continue; }
      if (c === "'" || c === '"') {
        const end = this.s.indexOf(c, this.i + 1);
        if (end < 0) throw new ParseError("unterminated quote in glob group");
        this.i = end + 1;
        continue;
      }
      if (c === "(") depth++;
      if (c === ")") { depth--; if (depth === 0) { this.i++; break; } }
      this.i++;
    }
    const content = this.s.slice(start + 1, this.i - 1);
    if (/^\+/u.test(content) || /(?:^|[^A-Za-z0-9_])e[^\sA-Za-z0-9_|()]/u.test(content)) throw new Block("shell-glob-execution");
    word.value += `(${content})`;
    word.glob = true;
  }

  parseArithmeticCommand() {
    const word = newWord();
    this.parseArithmetic(word, 2);
    return { type: "data", words: [word], redirects: this.parseRedirectsOnly() };
  }

  /** @param {string} keyword */
  parseFor(keyword) {
    this.i += keyword.length;
    this.skipBlanks();
    if (this.at("((")) return this.parseArithmeticCommand();
    const words = [this.parseWord(false)];
    if (/^path$/iu.test(words[0].value)) catTouched = true;
    this.skipBlanksAndNewlines();
    if (this.peekKeyword() === "in") {
      this.i += 2;
      for (;;) {
        this.skipBlanks();
        const c = this.peek();
        if (this.eof() || c === "\n" || c === ";") break;
        const word = this.parseWord(false);
        if (!word.raw) throw new ParseError(`unexpected ${JSON.stringify(c)} in for list`);
        words.push(word);
      }
    }
    return { type: "data", words, redirects: [] };
  }

  parseCase() {
    this.i += 4;
    this.skipBlanks();
    const words = [this.parseWord(false)];
    this.skipBlanksAndNewlines();
    if (this.peekKeyword() !== "in") throw new ParseError("case without in");
    this.i += 2;
    const items = [];
    for (;;) {
      this.skipBlanksAndNewlines();
      if (this.eof()) throw new ParseError("unterminated case");
      if (this.peekKeyword() === "esac") { this.i += 4; break; }
      if (this.peek() === "(") this.i++;
      for (;;) {
        this.skipBlanks();
        const word = this.parseWord(false);
        if (!word.raw) throw new ParseError("empty case pattern");
        words.push(word);
        this.skipBlanks();
        if (this.peek() === "|") { this.i++; continue; }
        this.expect(")");
        break;
      }
      items.push(this.parseList({ caseItem: true }));
      this.skipBlanks();
      if (this.at(";;&")) this.i += 3;
      else if (this.at(";;") || this.at(";&")) this.i += 2;
    }
    return { type: "case", words, items, redirects: this.parseRedirectsOnly() };
  }

  parseConditional() {
    this.i += 2;
    const words = [];
    for (;;) {
      this.skipBlanks();
      if (this.peek() === "\n") { this.newline(); continue; }
      if (this.eof()) throw new ParseError("unterminated [[");
      if (this.peekKeyword() === "]]") { this.i += 2; break; }
      if (this.at("&&") || this.at("||")) { this.i += 2; continue; }
      if ("<>()!&|".includes(this.peek())) { this.i++; continue; }
      const word = this.parseWord(false);
      if (!word.raw) throw new ParseError("unexpected token in [[");
      words.push(word);
    }
    return { type: "data", cond: true, words, redirects: this.parseRedirectsOnly() };
  }
}

// ---------------------------------------------------------------- evaluation

/** @type {Map<string, string>} */
const canonicalCache = new Map();

/** @param {string} path */
function realpathOrNull(path) {
  try { return realpathSync(path); } catch { return null; }
}

/**
 * Resolve symlinks in the longest existing prefix of an absolute path; the missing remainder is appended as-is.
 * Existence is monotone along a path, so the prefix is found with a binary search instead of one realpath per level.
 * @param {string} path
 */
function canonicalPath(path) {
  const cached = canonicalCache.get(path);
  if (cached !== undefined) return cached;
  checkDeadline();
  let result = realpathOrNull(path);
  if (result === null && !isAbsolute(path)) result = path;
  if (result === null) {
    // parts[0] is "" for an absolute path; the prefix of k parts is parts.slice(0, k).join(sep), and k = 1 is the root.
    const parts = path.split(sep);
    let best = 1;
    let bestReal = realpathOrNull(sep) ?? sep;
    let low = 2;
    let high = parts.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const real = realpathOrNull(parts.slice(0, middle).join(sep));
      if (real === null) high = middle - 1;
      else { best = middle; bestReal = real; low = middle + 1; }
    }
    result = join(bestReal, ...parts.slice(best));
  }
  if (canonicalCache.size > 4096) canonicalCache.clear();
  canonicalCache.set(path, result);
  return result;
}

/** @param {string} path */
function fold(path) {
  return foldCase ? path.toLowerCase() : path;
}

/** @param {string} path */
function forms(path) {
  return [...new Set([fold(resolve(path)), fold(canonicalPath(resolve(path)))])];
}

const protectedTargets = policy.protectedWriteTargets.map((/** @type {string} */ entry) => {
  const directory = entry.endsWith("/**");
  const text = directory ? entry.slice(0, -3) : entry;
  const absolute = text === "~" ? HOME : text.startsWith("~/") ? join(HOME, text.slice(2)) : resolve(text);
  return { entry, directory, project: false, forms: forms(absolute) };
});

/** Whether writing a tree rooted at `candidate` can reach `protectedPath`; inside the project only its settings directory counts. */
function treeReaches(/** @type {string} */ candidate, /** @type {string} */ protectedPath, /** @type {boolean} */ project) {
  return project ? dirname(protectedPath) === candidate : protectedPath.startsWith(`${candidate}${sep}`);
}

/** @type {Map<string, typeof protectedTargets>} */
const projectTargetCache = new Map();

/** Guard targets inside the session's project (its .claude and .codex settings). @param {string} scope */
function projectTargets(scope) {
  let targets = projectTargetCache.get(scope);
  if (!targets) {
    targets = (policy.protectedProjectWriteTargets ?? []).map((/** @type {string} */ entry) => ({ entry, directory: false, project: true, forms: forms(join(scope, entry)) }));
    projectTargetCache.set(scope, targets);
  }
  return targets;
}

/**
 * "delete" and "tree" (a recursive copy or extraction rooted there) also hit every ancestor of a protected path.
 * @param {string} absolute @param {"write" | "delete" | "tree"} kind @param {typeof protectedTargets} targets
 */
function protectedMatch(absolute, kind, targets) {
  const candidates = forms(absolute);
  for (const target of targets) {
    for (const candidate of candidates) {
      for (const protectedPath of target.forms) {
        if (candidate === protectedPath) return target.entry;
        if (target.directory && candidate.startsWith(`${protectedPath}${sep}`)) return target.entry;
        if (kind === "tree" && treeReaches(candidate, protectedPath, target.project)) return target.entry;
        if (kind === "delete" && !target.project && protectedPath.startsWith(`${candidate}${sep}`)) return target.entry;
      }
    }
  }
  return null;
}

/**
 * A path whose directory is unknown (dynamic prefix, unknown working directory) still hits a protected path its literal tail can end.
 * @param {string} tail @param {"write" | "delete" | "tree"} kind @param {typeof protectedTargets} targets
 */
function protectedTail(tail, kind, targets) {
  const parts = tail.split("/").filter((part) => part && part !== ".");
  const suffix = fold(parts.slice(parts.lastIndexOf("..") + 1).join(sep));
  if (!suffix) return null;
  const segments = suffix.split(sep);
  for (const target of targets) {
    for (const protectedPath of target.forms) {
      const path = `${protectedPath}${sep}`;
      if (path.endsWith(`${sep}${suffix}${sep}`)) return target.entry;
      if (kind !== "write" && (target.project ? dirname(protectedPath).endsWith(`${sep}${suffix}`) : path.includes(`${sep}${suffix}${sep}`))) return target.entry;
      if (!target.directory) continue;
      if (segments.some((_, k) => k > 0 && path.endsWith(`${sep}${segments.slice(0, k).join(sep)}${sep}`))) return target.entry;
      if (existsSync(join(protectedPath, suffix))) return target.entry;
      if (protectedFiles(protectedPath).some((file) => file === suffix || file.endsWith(`${sep}${suffix}`))) return target.entry;
    }
  }
  return null;
}

/** @type {Map<string, string[]>} */
const protectedFileCache = new Map();

/** Files under a protected directory (relative, case-folded), so an unknown directory still reaches nested files. @param {string} directory */
function protectedFiles(directory) {
  let files = protectedFileCache.get(directory);
  if (!files) {
    try { files = readdirSync(directory, { recursive: true, encoding: "utf8" }).slice(0, 5000).map(fold); } catch { files = []; }
    protectedFileCache.set(directory, files);
  }
  return files;
}

/**
 * A glob target (`setting?.json`, `hooks.js[n]`, `*`) expands to whatever it matches, so it hits every protected path it can
 * match. Quoted glob characters are treated as pattern characters too. With an unknown directory only the pattern's tail counts.
 * @param {string | null} absolute @param {string} text @param {"write" | "delete" | "tree"} kind @param {typeof protectedTargets} targets
 */
function protectedGlob(absolute, text, kind, targets) {
  const patterns = (absolute === null ? [text] : globForms(absolute)).flatMap(broadGlob).map((form) => fold(form).split(sep)
    .filter((part, k, parts) => part && part !== "." && !(part === "**" && parts[k - 1] === "**")).map(globSegment));
  for (const pattern of patterns) {
    for (const target of targets) {
      for (const protectedPath of target.forms) {
        const path = protectedPath.split(sep).filter(Boolean);
        /** @type {Set<string>} */
        const outcomes = new Set();
        const seen = new Set();
        for (let start = 0; start < (absolute === null ? path.length : 1); start++) globOutcomes(pattern, 0, path, start, outcomes, seen);
        if (outcomes.has("exact") || (target.directory && outcomes.has("inside"))) return target.entry;
        if (kind === "tree" && outcomes.has(target.project ? "parent" : "ancestor")) return target.entry;
        if (kind === "delete" && !target.project && outcomes.has("ancestor")) return target.entry;
      }
    }
  }
  return null;
}

/** The glob and its form with the literal directory prefix resolved through symlinks. @param {string} absolute */
function globForms(absolute) {
  const parts = absolute.split(sep);
  const first = parts.findIndex((part) => /[*?[{}()^#~\u0002]/u.test(part));
  if (first <= 1) return [absolute];
  return [...new Set([absolute, join(canonicalPath(parts.slice(0, first).join(sep)), ...parts.slice(first))])];
}

/**
 * The glob with every brace expansion, extglob or zsh group or qualifier and zsh operator (^ # ~) replaced by ANY_TEXT, which
 * matches any text including a leading dot; a region that spans `/` becomes `ANY/**\/ANY`. A repeated region that spans `/`
 * also yields the forms without it. @param {string} text @returns {string[]}
 */
function broadGlob(text) {
  const chars = [...text];
  const n = chars.length;
  const braces = bracketPairs(chars, "{", "}");
  const groups = bracketPairs(chars, "(", ")");
  const classes = classCloses(chars);
  const nextSlash = new Int32Array(n + 1).fill(n);
  for (let k = n - 1; k >= 0; k--) nextSlash[k] = chars[k] === "/" ? k : nextSlash[k + 1];
  // Each element is one pattern unit (a character, a bracket expression or ANY_TEXT), so `x#` can drop the unit before it.
  /** @type {string[]} */
  const out = [];
  // Units `x#` repeats that span `/`: zero copies drop a directory level, more copies add some.
  /** @type {number[]} */
  const levels = [];
  for (let i = 0; i < n; i++) {
    const c = chars[i];
    const close = c === "{" ? braces[i] : c === "(" ? groups[i] : -1;
    if (close > 0) {
      // `@(…)`, `?(…)`, `*(…)`, `+(…)`, `!(…)`: the operator belongs to the group.
      if (c === "(" && ["@", "+", "!", "?", "*"].includes(out.at(-1) ?? "")) out.pop();
      out.push(nextSlash[i] < close ? `${ANY_TEXT}/**/${ANY_TEXT}` : ANY_TEXT);
      i = close;
      continue;
    }
    // A bracket expression inside one segment stays as it is: `^` and `!` there negate it.
    const end = c === "[" ? classEnd(chars, i, classes) : -1;
    if (end > 0 && nextSlash[i] > end) {
      out.push(chars.slice(i, end + 1).join(""));
      i = end;
      continue;
    }
    // `a~b` matches at most what `a` matches, `^x` anything in its segment, `x#` also no x.
    if (c === "~" && i > 0 && i < n - 1) break;
    if (c === "^") {
      out.push(ANY_TEXT);
      i = nextSlash[i] - 1;
    } else if (c === "#") {
      const unit = out.pop() ?? "";
      out.push(unit.includes("/") ? `${ANY_TEXT}/**/${ANY_TEXT}` : ANY_TEXT);
      if (unit.includes("/") && levels.at(-1) !== out.length - 1) levels.push(out.length - 1);
    } else out.push(c);
  }
  // Each repeated level is read as present or absent. From the fifth on, the rest of the glob becomes one level that is
  // any text with or without directories, so the forms stay at most 32.
  /** @type {Map<number, string>} */
  const absent = new Map(levels.slice(0, 4).map((k) => [k, ""]));
  if (levels.length > 4) {
    out.length = levels[4];
    out.push(`${ANY_TEXT}/**/${ANY_TEXT}`);
    absent.set(levels[4], ANY_TEXT);
  }
  const choices = [...absent.keys()];
  /** @type {string[]} */
  const forms = [];
  for (let mask = 0; mask < 1 << choices.length; mask++) {
    forms.push(out.map((unit, k) => {
      const bit = choices.indexOf(k);
      return bit >= 0 && mask & (1 << bit) ? /** @type {string} */ (absent.get(k)) : unit;
    }).join(""));
  }
  return forms;
}

/** For each opener the index of its closer (one kind of pair, nested), or -1, in one pass. @param {string[]} chars @param {string} open @param {string} close */
function bracketPairs(chars, open, close) {
  const match = new Int32Array(chars.length).fill(-1);
  /** @type {number[]} */
  const stack = [];
  for (let k = 0; k < chars.length; k++) {
    if (chars[k] === open) stack.push(k);
    else if (chars[k] === close && stack.length > 0) match[/** @type {number} */ (stack.pop())] = k;
  }
  return match;
}

/**
 * For each index, the `]` that ends a bracket expression body read from there, skipping [:name:], [.x.] and [=x=], or -1.
 * Built right to left in one pass so every bracket lookup is constant time. @param {string[]} chars
 */
function classCloses(chars) {
  const n = chars.length;
  /** @type {Record<string, Int32Array>} */
  const terms = {};
  for (const kind of [":", ".", "="]) {
    const next = new Int32Array(n + 2).fill(-1);
    for (let k = n - 1; k >= 0; k--) next[k] = chars[k] === kind && chars[k + 1] === "]" ? k : next[k + 1];
    terms[kind] = next;
  }
  const scan = new Int32Array(n + 2).fill(-1);
  for (let k = n - 1; k >= 0; k--) {
    if (chars[k] === "]") scan[k] = k;
    else if (chars[k] === "[" && terms[chars[k + 1]]) {
      const term = terms[chars[k + 1]][k + 2];
      scan[k] = term < 0 ? -1 : scan[term + 2];
    } else scan[k] = scan[k + 1];
  }
  return scan;
}

/** Set per command: dotglob, GLOBIGNORE or zsh GLOB_DOTS lets a pattern character match a leading dot. */
let dotGlob = false;
const ANY_TEXT = "\u0002";

/**
 * A path segment as a matcher: `**` for any number of segments, glob tokens for pattern characters, the text otherwise.
 * @typedef {{ tokens: ("*" | ((c: string) => boolean))[], hidden: boolean }} GlobSegment
 * @param {string} segment @returns {string | GlobSegment}
 */
function globSegment(segment) {
  if (segment === "**") return "**";
  if (!/[*?[\u0002]/u.test(segment)) return segment;
  const chars = [...segment];
  const classes = classCloses(chars);
  /** @type {GlobSegment["tokens"]} */
  const tokens = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === "*" || c === ANY_TEXT) { if (tokens.at(-1) !== "*") tokens.push("*"); continue; }
    if (c === "?") { tokens.push(() => true); continue; }
    const end = c === "[" ? classEnd(chars, i, classes) : -1;
    if (end > 0) { tokens.push(charClass(chars.slice(i + 1, end))); i = end; continue; }
    tokens.push((d) => d === c);
  }
  // Like the shell, a pattern character does not match a leading dot.
  return { tokens, hidden: !dotGlob && /^[*?[]/u.test(segment) && !segment.includes(ANY_TEXT) };
}

/**
 * Index of the `]` closing the bracket expression at i, or -1. A `]` first in the set is literal.
 * @param {string[]} chars @param {number} i @param {Int32Array} classes from classCloses(chars)
 */
function classEnd(chars, i, classes) {
  let k = i + 1;
  if (chars[k] === "!" || chars[k] === "^") k++;
  if (chars[k] === "]") k++;
  return k < chars.length ? classes[k] : -1;
}

/** A bracket expression as a character test; a named class or a reversed range matches any character. @param {string[]} body */
function charClass(body) {
  const negate = body[0] === "!" || body[0] === "^";
  const set = negate ? body.slice(1) : body;
  const singles = new Set();
  /** @type {Set<string>} */
  const ranges = new Set();
  for (let k = 0; k < set.length; k++) {
    if ((set[k] === "[" && [":", ".", "="].includes(set[k + 1])) || (set[k + 1] === "-" && k + 2 < set.length && set[k] > set[k + 2])) return () => true;
    if (set[k + 1] === "-" && k + 2 < set.length) { ranges.add(`${set[k]}${set[k + 2]}`); k += 2; }
    else singles.add(set[k]);
  }
  const spans = [...ranges].map((range) => [...range]);
  return (/** @type {string} */ c) => (singles.has(c) || spans.some(([low, high]) => c >= low && c <= high)) !== negate;
}

/** Whether a glob segment matches a whole name. Backtracking only to the last `*` keeps this O(pattern × name). @param {GlobSegment} glob @param {string} name */
function globMatch(glob, name) {
  const text = [...name];
  if (glob.hidden && text[0] === ".") return false;
  const { tokens } = glob;
  let t = 0;
  let s = 0;
  let star = -1;
  let mark = 0;
  while (s < text.length) {
    const token = tokens[t];
    if (token === "*") { star = t++; mark = s; }
    else if (token && token(text[s])) { t++; s++; }
    else if (star >= 0) { t = star + 1; s = ++mark; }
    else return false;
  }
  while (tokens[t] === "*") t++;
  return t === tokens.length;
}

/**
 * How glob segments relate to a path from index j: "exact", "inside" (the pattern goes below it), "ancestor" (it stops above),
 * "parent" (it stops at the directory holding the path).
 * @param {(string | GlobSegment)[]} pattern @param {number} i @param {string[]} path @param {number} j @param {Set<string>} outcomes @param {Set<number>} seen
 */
function globOutcomes(pattern, i, path, j, outcomes, seen) {
  const state = i * (path.length + 1) + j;
  if (seen.has(state)) return;
  seen.add(state);
  if ((seen.size & 1023) === 0) checkDeadline();
  if (i === pattern.length) {
    outcomes.add(j === path.length ? "exact" : "ancestor");
    if (j === path.length - 1) outcomes.add("parent");
    return;
  }
  if (j === path.length) { outcomes.add("inside"); return; }
  const segment = pattern[i];
  if (segment === "**") {
    globOutcomes(pattern, i + 1, path, j, outcomes, seen);
    globOutcomes(pattern, i, path, j + 1, outcomes, seen);
    return;
  }
  if (typeof segment === "string" ? segment === path[j] : globMatch(segment, path[j])) globOutcomes(pattern, i + 1, path, j + 1, outcomes, seen);
}

/** @param {string} scope @param {string} absolute */
function insideScope(scope, absolute) {
  const pairs = [[resolve(scope), resolve(absolute)], [canonicalPath(resolve(scope)), canonicalPath(resolve(absolute))]];
  for (const [base, target] of pairs) {
    const rel = relative(base, target);
    if (rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) return rel.split(sep).join("/");
  }
  return null;
}

/**
 * Quotes or escapes inside a glob (`{"}",h}`, `[\h]`, `(h|[")"])`) and a bracket holding brace or group text (`[{s],x}`) pair
 * differently in the shell than in broadGlob, so such a target is also read with its first opener to its last closer as
 * ANY_TEXT. @param {Word} word @param {string} text @returns {string | null}
 */
function looseGlob(word, text) {
  const first = text.search(/[[{(]/u);
  if (first < 0 || !(word.glob || word.opener)) return null;
  let mixed = /["'\\]/u.test(word.raw ?? "");
  for (let k = first, open = false; !mixed && k < text.length; k++) {
    if (text[k] === "[") open = true;
    else if (text[k] === "]" || text[k] === "/") open = false;
    else if (open && "{}(),".includes(text[k])) mixed = true;
  }
  if (!mixed) return null;
  let last = text.length - 1;
  while (last > first && !"]})".includes(text[last])) last--;
  if (last === first) return null;
  const region = text.slice(first, last + 1);
  return `${text.slice(0, first)}${region.includes("/") ? `${ANY_TEXT}/**/${ANY_TEXT}` : ANY_TEXT}${text.slice(last + 1)}`;
}

/** @param {Word} word @param {"write" | "delete" | "tree"} kind @param {Context} ctx */
function checkTarget(word, kind, ctx) {
  if (!word || !word.value) return;
  // A brace expansion marks the word unknown just before its `{`; the glob check reads the braces instead.
  const text = word.value.replaceAll(`${UNKNOWN}{`, "{").replaceAll(UNKNOWN, "x");
  const absolute = resolve(ctx.cwd ?? ctx.scope, text);
  const targets = [...protectedTargets, ...projectTargets(ctx.scope)];
  const unknown = word.value.lastIndexOf(UNKNOWN);
  const tail = unknown >= 0 ? word.value.slice(unknown + 1) : ctx.cwd === null && !isAbsolute(text) ? text : null;
  const loose = looseGlob(word, text);
  const hit = protectedMatch(absolute, kind, targets) ?? (tail === null ? null : protectedTail(tail, kind, targets))
    ?? (word.glob ? protectedGlob(ctx.cwd === null && !isAbsolute(text) ? null : absolute, text, kind, targets) : null)
    ?? (loose === null ? null : protectedGlob(ctx.cwd === null && !isAbsolute(loose) ? null : resolve(ctx.cwd ?? ctx.scope, loose), loose, kind, targets));
  if (hit) throw new Block("guard-config-write", `${structural["guard-config-write"]} Target: ${hit}`);
  if (kind !== "write") return;
  const rel = insideScope(ctx.scope, absolute);
  if (rel !== null && testFilePatterns.some((/** @type {RegExp} */ pattern) => pattern.test(rel))) {
    throw new Block("test-file-write", `${structural["test-file-write"]} Target: ${rel}`);
  }
}

/** @param {string} patch @param {Context} ctx */
function checkPatch(patch, ctx) {
  for (const line of patch.split(/\r?\n/u)) {
    const match = /^\s*\*\*\* (Add File|Update File|Move to|Delete File):\s*(.+?)\s*$/u.exec(line);
    if (!match) continue;
    checkTarget(literalWord(match[2]), match[1] === "Delete File" ? "delete" : "write", ctx);
  }
}

/** @param {string} value */
function commandName(value) {
  // zsh `=name` expands to the command's path.
  return basename(value.replace(/^=(?=.)/u, "")).toLowerCase();
}

/** Value of the last `-X value`, `-Xvalue`, `--long value` or `--long=value` among a wrapper's options. @param {Word[]} options @param {string} short @param {string} long */
function optionWord(options, short, long) {
  /** @type {Word | undefined} */
  let found;
  for (let i = 0; i < options.length; i++) {
    const value = options[i].value;
    if (value === short || value === long) found = options[i + 1] ?? literalWord("");
    else if (value.startsWith(`${long}=`)) found = { ...options[i], value: value.slice(long.length + 1) };
    else if (value.startsWith(short) && value.length > short.length) found = { ...options[i], value: value.slice(short.length) };
  }
  return found;
}

/** @param {Word[]} words @param {number} index */
function takeOptionValue(words, index) {
  return words[index + 1];
}

/**
 * Strip command wrappers. Returns null when args[0] is not a wrapper.
 * @param {string} name @param {Word[]} args @param {Context} ctx
 * @returns {{args: Word[], appended?: boolean, replace?: string | null, chdir?: Word} | null}
 */
function unwrapWrapper(name, args, ctx) {
  const rest = args.slice(1);
  /** @param {Set<string>} withValue @param {boolean} [assignments] */
  const skipOptions = (withValue, assignments = false) => {
    let i = 0;
    while (i < rest.length) {
      const value = rest[i].value;
      if (value === "--") { i++; break; }
      const assignment = assignments ? /^([A-Za-z_][A-Za-z0-9_]*)=/u.exec(value) : null;
      if (assignment) { checkExecVariable(assignment[1], { ...rest[i], value: value.slice(assignment[0].length) }, ctx); i++; continue; }
      if (!value.startsWith("-") || value === "-") break;
      if (withValue.has(value)) { i += 2; continue; }
      i++;
    }
    return rest.slice(i);
  };
  switch (name) {
    case "sudo": case "doas": {
      const after = skipOptions(new Set(["-u", "-g", "-h", "-p", "-C", "-D", "-r", "-t", "-U", "-T", "--user", "--group", "--host", "--prompt", "--chdir"]), true);
      // `sudo -s cmd` / `sudo -i cmd` hand the arguments to a shell as one command string.
      const options = rest.slice(0, rest.length - after.length);
      const viaShell = options.some((word) => /^-[A-Za-z]*[si]/u.test(word.value) || word.value === "--shell" || word.value === "--login");
      if (viaShell && after.length === 0) return { args: [literalWord("sh")] };
      if (viaShell) evaluateRunnerText(after, ctx);
      return { args: after, chdir: optionWord(options, "-D", "--chdir") };
    }
    case "arch": {
      let i = 0;
      while (i < rest.length) {
        const value = rest[i].value;
        if (value === "--") { i++; break; }
        if (value === "-e") {
          const assignment = rest[i + 1] ? /^([A-Za-z_][A-Za-z0-9_]*)=/u.exec(rest[i + 1].value) : null;
          if (assignment && rest[i + 1]) checkExecVariable(assignment[1], { ...rest[i + 1], value: rest[i + 1].value.slice(assignment[0].length) }, ctx);
          i += 2;
          continue;
        }
        if (value === "-d" || value === "-arch") { i += 2; continue; }
        if (!value.startsWith("-") || value === "-") break;
        i++;
      }
      return { args: rest.slice(i) };
    }
    case "busybox":
      return { args: skipOptions(new Set()) };
    case "env": {
      let i = 0;
      while (i < rest.length) {
        const value = rest[i].value;
        if (value === "--") { i++; break; }
        const split = /^-[A-Za-z]*S/u.exec(value);
        if (split || value === "--split-string" || value.startsWith("--split-string=")) {
          /** @type {Word | undefined} */
          let code;
          if (value.startsWith("--split-string=")) code = { ...rest[i], value: value.slice(15) };
          else if (split && value.length > split[0].length) code = { ...rest[i], value: value.slice(split[0].length) };
          else { code = rest[i + 1]; i++; }
          if (!code || !code.literal) throw new Block("shell-dynamic-command");
          const tail = rest.slice(i + 1);
          if (tail.some((word) => !word.literal)) throw new Block("shell-dynamic-command");
          evaluateShellText([code.value, ...tail.map((word) => shellQuote(word.value))].join(" "), ctx);
          return { args: [] };
        }
        if (value === "-u" || value === "-C" || value === "--unset" || value === "--chdir") { i += 2; continue; }
        const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=/u.exec(value);
        if (assignment) checkExecVariable(assignment[1], { ...rest[i], value: value.slice(assignment[0].length) }, ctx);
        if (assignment || (value.startsWith("-") && value.length > 1) || value === "-") { i++; continue; }
        break;
      }
      return { args: rest.slice(i), chdir: optionWord(rest.slice(0, i), "-C", "--chdir") };
    }
    case "nohup": case "builtin":
      return { args: rest };
    case "command":
      if (rest[0] && (rest[0].value === "-v" || rest[0].value === "-V")) return { args: [] };
      return { args: skipOptions(new Set()) };
    case "exec":
      return { args: skipOptions(new Set(["-a"])) };
    case "nice":
      return { args: skipOptions(new Set(["-n", "--adjustment"])) };
    case "time":
      return { args: skipOptions(new Set(["-o", "-f"])) };
    case "stdbuf":
      return { args: skipOptions(new Set(["-i", "-o", "-e"])) };
    case "caffeinate":
      return { args: skipOptions(new Set(["-t", "-w"])) };
    case "timeout": {
      const after = skipOptions(new Set(["-s", "-k", "--signal", "--kill-after"]));
      return { args: after.slice(1) };
    }
    case "xargs": {
      const withValue = new Set(["-I", "-n", "-P", "-L", "-l", "-d", "-E", "-e", "-s", "-a", "-J", "-R", "-S", "--max-args", "--max-procs", "--delimiter", "--arg-file", "--max-lines", "--replace", "--eof"]);
      /** @type {string | null} */
      let replace = null;
      let i = 0;
      while (i < rest.length) {
        const value = rest[i].value;
        if (value === "--") { i++; break; }
        if (!value.startsWith("-") || value === "-") break;
        if (value === "-I" || value === "-J" || value === "--replace") { replace = rest[i + 1]?.value ?? "{}"; i += 2; continue; }
        if (/^-[IJ]./u.test(value)) replace = value.slice(2);
        else if (value === "-i") replace = "{}";
        else if (/^-i./u.test(value)) replace = value.slice(2);
        else if (value.startsWith("--replace=")) replace = value.slice(10) || "{}";
        if (withValue.has(value)) { i += 2; continue; }
        i++;
      }
      return { args: rest.slice(i), appended: true, replace };
    }
    default:
      return null;
  }
}

/** @param {Word[]} rest */
function parseGit(rest) {
  let i = 0;
  /** Inline configuration (`-c key=value`, `--config-env key=VAR`); values can name programs Git executes. @type {Word[]} */
  const configs = [];
  while (i < rest.length) {
    const value = rest[i].value;
    if (value === "-c" || value === "--config-env") { if (rest[i + 1]) configs.push(rest[i + 1]); i += 2; continue; }
    if (value.startsWith("--config-env=")) { configs.push({ ...rest[i], value: value.slice(13) }); i++; continue; }
    if (["-C", "--git-dir", "--work-tree", "--namespace", "--super-prefix"].includes(value)) { i += 2; continue; }
    if (value.startsWith("-")) { i++; continue; }
    break;
  }
  const sub = rest[i];
  const subArgs = rest.slice(i + 1);
  let readOnly = false;
  if (sub && sub.literal) {
    if (sub.value === "branch") {
      readOnly = subArgs.length > 0 && subArgs.every((word) => word.literal && (readOnlyGitBranchOptions.has(word.value) || /^--(?:format|sort|color)(?:=|$)/u.test(word.value)));
    } else {
      readOnly = readOnlyGit.has(sub.value);
    }
  }
  // --output writes a file and -O/--open-files-in-pager runs a program: not read-only.
  if (subArgs.some((word) => /^--output(?:=|$)|^-O|^--open-files-in-pager(?:=|$)/u.test(word.value))) readOnly = false;
  if (configs.some((word) => !word.literal)) readOnly = false;
  return { subIndex: i, sub, readOnly, configs };
}

/** Long options of the subcommands the rules inspect; Git accepts any unambiguous prefix of them. @type {Record<string, string[]>} */
const GIT_LONG_OPTIONS = {
  reset: ["--hard", "--soft", "--mixed", "--merge", "--keep", "--quiet", "--patch", "--recurse-submodules", "--no-recurse-submodules", "--pathspec-from-file", "--pathspec-file-nul", "--intent-to-add", "--refresh", "--no-refresh"],
  clean: ["--force", "--dry-run", "--interactive", "--quiet", "--exclude"],
  push: ["--force", "--force-with-lease", "--no-force-with-lease", "--force-if-includes", "--no-force-if-includes", "--mirror", "--all", "--branches", "--tags", "--follow-tags", "--no-follow-tags", "--delete", "--dry-run", "--porcelain", "--prune", "--verbose", "--quiet", "--progress", "--set-upstream", "--atomic", "--no-atomic", "--signed", "--no-signed", "--verify", "--no-verify", "--thin", "--no-thin", "--receive-pack", "--exec", "--repo", "--push-option", "--recurse-submodules", "--no-recurse-submodules", "--ipv4", "--ipv6"],
  branch: ["--delete", "--force", "--move", "--copy", "--list", "--all", "--remotes", "--verbose", "--quiet", "--track", "--no-track", "--set-upstream-to", "--unset-upstream", "--contains", "--no-contains", "--merged", "--no-merged", "--column", "--no-column", "--sort", "--points-at", "--format", "--color", "--no-color", "--abbrev", "--no-abbrev", "--edit-description", "--create-reflog", "--ignore-case", "--show-current", "--omit-empty", "--recurse-submodules"],
  checkout: ["--force", "--quiet", "--progress", "--no-progress", "--ours", "--theirs", "--track", "--no-track", "--guess", "--no-guess", "--detach", "--orphan", "--ignore-skip-worktree-bits", "--merge", "--conflict", "--patch", "--ignore-other-worktrees", "--overwrite-ignore", "--no-overwrite-ignore", "--recurse-submodules", "--no-recurse-submodules", "--overlay", "--no-overlay", "--pathspec-from-file", "--pathspec-file-nul"],
  switch: ["--create", "--force-create", "--detach", "--guess", "--no-guess", "--force", "--discard-changes", "--merge", "--conflict", "--quiet", "--progress", "--no-progress", "--track", "--no-track", "--orphan", "--ignore-other-worktrees", "--recurse-submodules", "--no-recurse-submodules"],
};

/**
 * Spell abbreviated long options in full (`--har` is `--hard`) so the rules see what Git runs.
 * @param {Word[]} rest
 */
function expandGitOptions(rest) {
  const { subIndex, sub } = parseGit(rest);
  const options = sub?.literal ? GIT_LONG_OPTIONS[sub.value] : undefined;
  if (!options) return rest;
  const expanded = [...rest];
  for (let i = subIndex + 1; i < expanded.length; i++) {
    const word = expanded[i];
    if (word.value === "--") break;
    if (!word.literal || !word.value.startsWith("--")) continue;
    const eq = word.value.indexOf("=");
    const flag = eq < 0 ? word.value : word.value.slice(0, eq);
    if (flag.length < 3 || options.includes(flag)) continue;
    const matches = options.filter((option) => option.startsWith(flag));
    if (matches.length > 1) throw new Block("shell-parse-error", `Ambiguous abbreviated Git option ${flag}; spell the option in full.`);
    if (matches.length === 1) expanded[i] = { ...word, value: matches[0] + (eq < 0 ? "" : word.value.slice(eq)) };
  }
  return expanded;
}

/**
 * Configuration that makes an ordinary Git command destructive: autocorrect running a mistyped
 * command, clean without force, forced or deleting push refspecs, mirror pushes.
 * @param {string} key @param {string | null} value null when the key is set without `=` @param {boolean} literal
 */
function destructiveGitConfig(key, value, literal) {
  const name = key.toLowerCase();
  if (!(name === "help.autocorrect" || name === "clean.requireforce" || /^remote\..+\.(?:push|mirror)$/u.test(name))) return false;
  if (!literal) return true;
  const text = (value ?? "true").trim().toLowerCase();
  if (name === "help.autocorrect") return !/^(?:0|false|no|off|never|prompt|show)$/u.test(text);
  if (name === "clean.requireforce") return /^(?:false|no|off|0)$/u.test(text);
  if (name.endsWith(".mirror")) return !/^(?:false|no|off|0)$/u.test(text);
  return /^[+:]/u.test(text);
}

/** Git configuration keys whose values Git runs as programs or shell text. */
const GIT_EXEC_CONFIG = /^(?:alias\..+|core\.(?:pager|editor|sshcommand|fsmonitor|askpass|gitproxy)|pager\..+|sequence\.editor|diff\..*(?:external|textconv|command)|merge\..*driver|filter\..+\.(?:clean|smudge|process)|credential\..*helper|gpg\..*program|uploadpack\.packobjectshook|.*\.(?:cmd|command|program|helper|tool))$/iu;

/**
 * Evaluate inline Git configuration that Git may execute (aliases, pagers, editors, helpers).
 * @param {Word[]} configs @param {Word[]} subArgs @param {Context} ctx
 */
function evaluateGitConfigs(configs, subArgs, ctx) {
  for (const word of configs) {
    const index = word.value.indexOf("=");
    const key = index < 0 ? word.value : word.value.slice(0, index);
    if (destructiveGitConfig(key.replaceAll(UNKNOWN, "x"), index < 0 ? null : word.value.slice(index + 1), word.literal)) throw new Block("git-config-destructive");
    if (!GIT_EXEC_CONFIG.test(key.replaceAll(UNKNOWN, "x"))) continue;
    if (!word.literal || index < 0) throw new Block("shell-dynamic-command", "Inline Git configuration that names an executed program must be a literal key=value pair.");
    const value = word.value.slice(index + 1);
    if (/^alias\./iu.test(key) && !value.startsWith("!")) {
      const aliased = parseScript(value, ctx.depth + 1);
      const words = aliased.items.length === 1 && aliased.items[0].commands.length === 1 ? aliased.items[0].commands[0].words : null;
      if (!words || words.some((/** @type {Word} */ entry) => !entry.literal)) throw new Block("shell-dynamic-command");
      evaluateArgv([literalWord("git"), ...words, ...subArgs], [], { ...ctx, depth: ctx.depth + 1 }, false, false);
      continue;
    }
    evaluateShellText(value.replace(/^!/u, ""), ctx);
  }
}

/**
 * Words an alias stands for; anything but one literal simple command is dynamic (null).
 * @param {string} text @param {Context} ctx @returns {Word[] | null}
 */
function aliasWords(text, ctx) {
  try {
    const list = parseScript(text, ctx.depth + 1);
    const words = list.items.length === 1 && list.items[0].commands.length === 1 ? list.items[0].commands[0].words : null;
    return words && words.length > 0 && words.every((/** @type {Word} */ word) => word.literal) ? words : null;
  } catch {
    return null;
  }
}

/** @param {Context} ctx @param {string} name @param {Word[] | null} words */
function defineAlias(ctx, name, words) {
  if (!ctx.aliases) ctx.aliases = new Map();
  ctx.aliases.set(commandName(name), words);
}

/** @param {string} name */
function isSensitive(name) {
  for (const entry of sensitiveCommands) if (name === entry || name.startsWith(`${entry}.`)) return true;
  return false;
}

/** @param {string} script */
function scanSed(script) {
  const out = { exec: false, /** @type {string[]} */ writes: [], uncertain: false };
  const s = script;
  const n = s.length;
  let i = 0;
  const toEol = () => {
    const end = s.indexOf("\n", i);
    const text = s.slice(i, end < 0 ? n : end);
    i = end < 0 ? n : end + 1;
    return text;
  };
  const toSeparator = () => { while (i < n && !/[;\n}]/u.test(s[i])) i++; };
  /** @param {string} delimiter */
  const skipDelimited = (delimiter) => {
    while (i < n) {
      const c = s[i];
      if (c === "\\") { i += 2; continue; }
      if (c === delimiter) { i++; return true; }
      i++;
    }
    return false;
  };
  const skipAddress = () => {
    const c = s[i] ?? "";
    if (/[0-9]/u.test(c)) { while (i < n && /[0-9~]/u.test(s[i])) i++; return true; }
    if (c === "$") { i++; return true; }
    if (c === "/" || c === "\\") {
      const delimiter = c === "/" ? "/" : s[i + 1];
      i += c === "/" ? 1 : 2;
      if (!delimiter || !skipDelimited(delimiter)) return false;
      while (s[i] === "I" || s[i] === "M") i++;
      return true;
    }
    return true;
  };
  while (i < n) {
    const c = s[i];
    if (/[\s;}{]/u.test(c)) { i++; continue; }
    if (c === "#") { toEol(); continue; }
    if (/[0-9$/\\]/u.test(c)) {
      if (!skipAddress()) { out.uncertain = true; return out; }
      while (s[i] === " " || s[i] === "\t") i++;
      if (s[i] === ",") {
        i++;
        while (s[i] === " " || s[i] === "\t") i++;
        if (s[i] === "+" || s[i] === "~") i++;
        if (!skipAddress()) { out.uncertain = true; return out; }
      }
    }
    while (s[i] === " " || s[i] === "\t") i++;
    if (s[i] === "!") { i++; while (s[i] === " " || s[i] === "\t") i++; }
    const command = s[i++];
    if (command === undefined) break;
    switch (command) {
      case "{": case "}": case "=": case "d": case "D": case "g": case "G": case "h": case "H":
      case "n": case "N": case "p": case "P": case "x": case "z": case "F": case ";": case "\n":
        break;
      case "l": case "q": case "Q": case "L":
        while (i < n && /[0-9 ]/u.test(s[i])) i++;
        break;
      case ":": case "b": case "t": case "T":
        toSeparator();
        break;
      case "a": case "i": case "c":
        while (i < n) { const line = toEol(); if (!line.endsWith("\\")) break; }
        break;
      case "r": case "R":
        toEol();
        break;
      case "w": case "W":
        out.writes.push(toEol().trim());
        break;
      case "e":
        out.exec = true;
        toEol();
        break;
      case "s": {
        const delimiter = s[i++];
        if (!delimiter || delimiter === "\n" || delimiter === "\\" || !skipDelimited(delimiter) || !skipDelimited(delimiter)) { out.uncertain = true; return out; }
        while (i < n && /[gpiImMe0-9w]/u.test(s[i])) {
          const flag = s[i++];
          if (flag === "e") out.exec = true;
          if (flag === "w") { out.writes.push(toEol().trim()); break; }
        }
        break;
      }
      case "y": {
        const delimiter = s[i++];
        if (!delimiter || !skipDelimited(delimiter) || !skipDelimited(delimiter)) { out.uncertain = true; return out; }
        break;
      }
      default:
        out.uncertain = true;
        return out;
    }
  }
  return out;
}

/** @param {Word[]} rest */
function analyzeSed(rest) {
  const info = { inPlace: false, exec: false, /** @type {Word[]} */ writes: [], /** @type {Word[]} */ files: [], uncertain: false };
  /** @type {(Word | undefined)[]} */
  const scripts = [];
  let scriptGiven = false;
  /** @type {Word[]} */
  const operands = [];
  let i = 0;
  while (i < rest.length) {
    const word = rest[i];
    const value = word.value;
    if (value === "--") { operands.push(...rest.slice(i + 1)); break; }
    if (value === "--in-place" || value.startsWith("--in-place=")) { info.inPlace = true; i++; continue; }
    if (value === "--expression") { scripts.push(rest[i + 1]); scriptGiven = true; i += 2; continue; }
    if (value.startsWith("--expression=")) { scripts.push(literalWord(value.slice(13))); scriptGiven = true; i++; continue; }
    if (value === "--file" || value.startsWith("--file=")) { info.uncertain = true; scriptGiven = true; i += value.includes("=") ? 1 : 2; continue; }
    if (value.startsWith("--")) { i++; continue; }
    if (value.startsWith("-") && value.length > 1 && word.literal) {
      for (let j = 1; j < value.length; j++) {
        const flag = value[j];
        if (flag === "i") {
          info.inPlace = true;
          if (j === value.length - 1) {
            const next = rest[i + 1];
            if (next && next.literal && (next.value === "" || /^\.[\w.-]*$/u.test(next.value))) i++;
          }
          break;
        }
        if (flag === "e") {
          const attached = value.slice(j + 1);
          if (attached) scripts.push(literalWord(attached));
          else { scripts.push(rest[i + 1]); i++; }
          scriptGiven = true;
          break;
        }
        if (flag === "f") { info.uncertain = true; scriptGiven = true; if (j === value.length - 1) i++; break; }
        if (flag === "l") { if (j === value.length - 1) i++; break; }
      }
      i++;
      continue;
    }
    operands.push(word);
    i++;
  }
  if (!scriptGiven) scripts.push(operands.shift());
  info.files = operands;
  for (const script of scripts) {
    if (!script) continue;
    if (!script.literal) { info.uncertain = true; continue; }
    const result = scanSed(script.value);
    if (result.exec) info.exec = true;
    if (result.uncertain) info.uncertain = true;
    info.writes.push(...result.writes.filter(Boolean).map(literalWord));
  }
  return info;
}

/** @param {Word[]} rest */
function awkIsPureRead(rest) {
  let i = 0;
  while (i < rest.length) {
    const value = rest[i].value;
    if (value === "--") { i++; break; }
    if (value === "-f" || value.startsWith("--file")) return false;
    if (value === "-F" || value === "-v") { i += 2; continue; }
    if (value.startsWith("-") && value.length > 1) { i++; continue; }
    break;
  }
  const program = rest[i];
  return Boolean(program && program.literal && !/system\s*\(|\||>/u.test(program.value));
}

/** @param {Word[]} rest @param {Set<string>} withValue */
function operandsOf(rest, withValue) {
  /** @type {Word[]} */
  const operands = [];
  /** @type {Word | null} */
  let targetDirectory = null;
  let i = 0;
  let optionsDone = false;
  while (i < rest.length) {
    const word = rest[i];
    const value = word.value;
    if (!optionsDone && value === "--") { optionsDone = true; i++; continue; }
    if (!optionsDone && (value === "-t" || value === "--target-directory")) { targetDirectory = rest[i + 1] ?? null; i += 2; continue; }
    if (!optionsDone && value.startsWith("--target-directory=")) { targetDirectory = literalWord(value.slice(19)); i++; continue; }
    if (!optionsDone && withValue.has(value)) { i += 2; continue; }
    if (!optionsDone && value.startsWith("-") && value.length > 1 && word.literal) { i++; continue; }
    operands.push(word);
    i++;
  }
  return { operands, targetDirectory };
}

/** @param {Word[]} rest @param {Context} ctx @param {Set<string>} withValue */
function copyTargets(rest, ctx, withValue) {
  const { operands, targetDirectory } = operandsOf(rest, withValue);
  /** @type {Word[]} */
  const sources = targetDirectory ? operands : operands.slice(0, -1);
  const destination = targetDirectory ?? operands[operands.length - 1];
  if (!destination || sources.length === 0) return { sources, targets: [] };
  let directory = Boolean(targetDirectory) || destination.value.endsWith("/") || sources.length > 1;
  if (!directory && destination.literal) {
    try { directory = statSync(resolve(ctx.cwd ?? ctx.scope, destination.value)).isDirectory(); } catch { directory = false; }
  }
  // `src/` and `src/.` copy the directory's contents into the destination itself (BSD cp -R, rsync).
  const targets = directory
    ? sources.map((source) => /\/\.?$/u.test(source.value) ? destination : literalWord(join(destination.value, basename(source.value))))
    : [destination];
  return { sources, targets };
}

/**
 * curl -O saves each URL under its last path segment in the working directory.
 * @param {Word[]} rest @param {(word: Word, kind: "write" | "delete" | "tree") => void} add
 */
function remoteNames(rest, add) {
  for (const word of rest) {
    const match = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/u.exec(word.value);
    if (match) add(literalWord(basename(match[1]) || "index.html"), "write");
  }
}

/** An ex command name from its shortest to its full spelling: `exName("sp", "lit")` reads `sp`, `spl`, `spli` and `split`. @param {string} short @param {string} [more] */
function exName(short, more = "") {
  return short + [...more].reduceRight((tail, c) => `(?:${c}${tail})?`, "");
}

/** Ex commands that write, open or dump to a named file (`:w`, `:e`, `:drop`, `:args`, `:redir >`, `:mksession`, `:hardcopy >`, ed `W` and `f`). */
const EDITOR_FILE_NAMES = [
  ["w", "rite"], ["wq"], ["x", "it"], ["W"], ["f", "ile"], ["sav", "eas"], ["up", "date"], ["wn", "ext"], ["wN", "ext"],
  ["wp", "revious"], ["wa", "ll"], ["xa", "ll"], ["wqa", "ll"], ["e", "dit"], ["E"], ["ex"], ["vi", "sual"], ["vie", "w"],
  ["sp", "lit"], ["vs", "plit"], ["new"], ["vne", "w"], ["sv", "iew"], ["tabe", "dit"], ["tabnew"], ["tabf", "ind"],
  ["fin", "d"], ["sf", "ind"], ["bad", "d"], ["arga", "dd"], ["arge", "dit"], ["ar", "gs"], ["n", "ext"], ["dr", "op"],
  ["ped", "it"], ["diffs", "plit"], ["mks", "ession"], ["mkvie", "w"], ["mkv", "imrc"], ["mk", "exrc"], ["wv", "iminfo"],
  ["wsh", "ada"], ["wu", "ndo"], ["redi", "r"], ["ha", "rdcopy"],
].map(([short, more]) => exName(short, more)).join("|");
/**
 * An editor command that writes or opens a named file, after an optional line address (`:w FILE`, `%w FILE`, `1,$w!FILE`,
 * `:sav ++enc=x FILE`, `e +10 FILE`, `redir! > FILE`, `exe "w FILE"`).
 */
const EDITOR_FILE_COMMAND = new RegExp(String.raw`(?:^|[|:\s"'])[%.$\d,;+-]*(?:${EDITOR_FILE_NAMES})(?:!\s*|\s+|(?=>))(?:\+\+?[^\s+]\S*\s+)*(?:>>?!?\s*)?([^\s|"']+)`, "gu");
/** A shell command in an editor line: `:!cmd`, a range filter (`%!cmd`, `1,2!cmd`), `r !cmd`, `w !cmd`, `e !cmd`, `exe "!cmd"`. */
const EDITOR_SHELL_ESCAPE = /(?:^|[|:\s"])(?:[%.$\d,'<>+-]*|(?:r|read)\s*|(?:e|edit|w|write)\s+)!(.*)$/u;
/** Command modifiers and `:*do` loops that may come before an ex command (`sil!`, `vert`, `keepalt`, `bufdo`, `3verbose`). */
const EDITOR_MODIFIERS = String.raw`(?:(?:sil(?:e(?:n(?:t)?)?)?!?|uns\w*|vert\w*|lefta\w*|abo\w*|rightb\w*|bel\w*|to\w*|bo\w*|tab|hid\w*|conf\w*|bro\w*|keep\w*|loc\w*|noa\w*|nos\w*|san\w*|\d*verb\w*|(?:win|buf|arg|tab|c|cf|l|lf)do)\s+)*`;
/**
 * Vim script the guard cannot read: process, file and option-setting functions, embedded languages, a terminal or shell,
 * commands that run a configured program (`:make`, `:grep`, `:cscope`), a sourced script, or `:execute` of built text.
 */
const EDITOR_CODE = new RegExp(String.raw`\b(?:system|systemlist|writefile|delete|rename|mkdir|execute|feedkeys|job_start|jobstart|termopen|term_start|libcall|libcallnr|luaeval|pyeval|py3eval|pyxeval|perleval|rubyeval|chansend|setbufvar|setwinvar|settabvar|settabwinvar)\s*\(|(?:^|[|:])\s*${EDITOR_MODIFIERS}(?:lua\w*|py\w*|perl\w*|ruby\w*|mz\w*|tcl\w*|ter\w*|${[["sh", "ell"], ["so", "urce"], ["ru", "ntime"], ["mak", "e"], ["lmak", "e"], ["gr", "ep"], ["lgr", "ep"], ["grepa", "dd"], ["lgrepa", "dd"], ["cs", "cope"], ["lcs", "cope"], ["scs", "cope"]].map(([short, more]) => exName(short, more)).join("|")})\b|(?:^|[|:])\s*${EDITOR_MODIFIERS}exe(?:c|cu|cut|cute)?\s+(?!(["'])[^"']*\1\s*(?:\||$))`, "u");
/** A `:set` or `:let &` of an option that names a program or an expression the editor runs (`shell`, `makeprg`, `diffexpr`). */
const EDITOR_PROGRAM_OPTION = new RegExp(String.raw`(?:^|\|)[\s:]*${EDITOR_MODIFIERS}(?:exe\w*\s+["'])?(?:se\w*|let)(?=\s)[^|]*?[\s&](?:[lg]:)?(?:sh|shell\w*|s(?:cf|p|rr|xq|xe)|mp|makeprg|gp|grepprg|ep|equalprg|fp|formatprg|kp|keywordprg|csprg|cscopeprg|\w*expr|\w*func|pex|dex|fex|inex|inde|fde|ccv|cfu|ofu|tfu)\s*[+^-]?=`, "u");
/** A directory change inside the editor (`:cd`, `:lcd`, `:tcd`, `chdir()`, `autochdir`) moves the base of later relative file names. */
const EDITOR_CD = /(?:^|[|:\s"'])(?:cd|chd(?:ir?)?|lcd|lch(?:d(?:ir?)?)?|tcd|tch(?:d(?:ir?)?)?)(?:!|\s|$)|\bchdir\s*\(|\b(?:acd|autochdir)\b/u;
/** A line address before an ex or ed command: numbers, `.`, `$`, `%`, marks, offsets and `/re/` or `?re?` searches. */
const EDITOR_ADDRESS = /^(?:[\s:%.$\d,;+-]|'[\w<>[\]]|\/(?:[^/\\]|\\.)*\/?|\?(?:[^?\\]|\\.)*\??)*/u;

/** Index just after the next unescaped `delimiter` at or after `from`, or the text length. @param {string} text @param {number} from @param {string} delimiter */
function delimitedEnd(text, from, delimiter) {
  for (let k = from; k < text.length; k++) {
    if (text[k] === "\\") k++;
    else if (text[k] === delimiter) return k + 1;
  }
  return text.length;
}

/**
 * Read an ex, vim or ed script: each file a write or edit command names is a write target, shell commands (`:!`, range
 * filters, `r !`) are evaluated, and vimscript or normal-mode keys the guard cannot read are blocked. Substitution text and,
 * in a script read line by line, the lines typed after `a`, `i` or `c` up to `.` are data.
 * @param {string} script @param {boolean} ed @param {boolean} typed whether `a`, `i` and `c` read the following lines
 * @param {{ moved: boolean, write: (value: string) => void }} editor @param {Context} ctx
 */
function editorScript(script, ed, typed, editor, ctx) {
  let typing = false;
  for (const line of script.split(/\r?\n/u)) {
    if (typing) { typing = line !== "."; continue; }
    let rest = line;
    for (;;) {
      rest = rest.slice(EDITOR_ADDRESS.exec(rest)?.[0].length ?? 0);
      // `:g/re/cmd` runs cmd; `:s` stops at the first unescaped `|` (ed has no `|`).
      const global = /^(?:g|global|v|vglobal|G|V)!?([^\w\s"|\\])/u.exec(rest);
      if (global) { rest = rest.slice(delimitedEnd(rest, global[0].length, global[1])); continue; }
      const substitute = /^(?:s|substitute)[^\w\s"|\\]/u.exec(rest);
      if (!substitute) break;
      const end = ed ? rest.length : delimitedEnd(rest, substitute[0].length, "|");
      if (!ed && /\\=/u.test(rest.slice(0, end)) && EDITOR_CODE.test(rest.slice(0, end))) {
        throw new Block("shell-dynamic-command", "A substitution expression that calls a process or file function cannot be inspected.");
      }
      rest = rest.slice(end);
      if (!rest) break;
    }
    if (typed && /^(?:a|i|c|append|insert|change)!?\s*$/u.test(rest)) { typing = true; continue; }
    const shell = (ed ? /^(?:(?:r|w|W|e|E)\s*)?!(.*)$/u : /^(?:(?:r|read)\s*|(?:w|write|e|edit)\s+)?!(.*)$/u).exec(rest);
    if (shell) { evaluateShellText(shell[1], ctx); continue; }
    if (!ed && EDITOR_CD.test(rest)) editor.moved = true;
    for (const match of rest.matchAll(EDITOR_FILE_COMMAND)) editor.write(match[1]);
    const escape = EDITOR_SHELL_ESCAPE.exec(rest);
    if (escape) evaluateShellText(escape[1], ctx);
    if (ed) continue;
    const keys = /(?:^|[|:\s"'])norm(?:a|al)?!?\s/u.exec(rest);
    if (EDITOR_CODE.test(rest) || EDITOR_PROGRAM_OPTION.test(rest)
      || (keys && /[!Q@]|"=|<[Cc]-[RrOo\\]>|[\x0f\x12\x1c]/u.test(rest.slice(keys.index + keys[0].length)))) {
      throw new Block("shell-dynamic-command", "An editor script that calls a process or file function, an embedded language, a configured program, a built `:execute` or normal-mode keys that run commands cannot be inspected.");
    }
  }
}

/**
 * Collect file targets written (or deleted) by a command. @param {string} name @param {Word[]} rest @param {Context} ctx
 * @param {ReturnType<typeof analyzeSed> | null} sed @param {{ redirects: Redirect[], stdinPiped: boolean }} stdin
 */
function commandTargets(name, rest, ctx, sed, stdin) {
  /** @type {{word: Word, kind: "write" | "delete" | "tree"}[]} */
  const targets = [];
  const add = (/** @type {Word} */ word, /** @type {"write" | "delete" | "tree"} */ kind) => targets.push({ word, kind });
  /** @param {string} value */
  const optionValue = (value) => literalWord(value.slice(value.indexOf("=") + 1));
  switch (name) {
    case "tee": case "sponge":
      operandsOf(rest, new Set(["--output-error"])).operands.forEach((word) => add(word, "write"));
      break;
    case "cp": case "install": case "ln": case "rsync": case "ditto": {
      const { targets: written } = copyTargets(rest, ctx, new Set(["-S", "--suffix", "-m", "--mode", "-o", "--owner", "-g", "--group"]));
      const recursive = name === "rsync" || name === "ditto"
        || (name === "cp" && rest.some((word) => word.literal && (/^-[A-Za-z]*[Rra]/u.test(word.value) || word.value === "--recursive" || word.value === "--archive")));
      written.forEach((word) => { add(word, "write"); if (recursive) add(word, "tree"); });
      break;
    }
    case "tar": case "bsdtar": case "gtar": case "unzip": {
      // Extraction writes whatever the archive holds under -C/-d or the working directory.
      const first = rest[0]?.value ?? "";
      const extract = name === "unzip" ? !rest.some((word) => word.value === "-l" || word.value === "-p" || word.value === "-t")
        : /^[A-Za-z]*x/u.test(first) || rest.some((word) => word.literal && (/^-[A-Za-z]*x/u.test(word.value) || word.value === "--extract" || word.value === "--get"));
      if (!extract) break;
      /** @type {Word} */
      let directory = literalWord(".");
      for (let i = 0; i < rest.length; i++) {
        const value = rest[i].value;
        if ((value === "-C" || value === "--directory" || (name === "unzip" && value === "-d")) && rest[i + 1]) directory = rest[++i];
        else if (value.startsWith("--directory=")) directory = optionValue(value);
      }
      add(directory, "tree");
      break;
    }
    case "perl": case "ruby": {
      if (!rest.some((word) => word.literal && /^-[0-9aclnpstuwTUWX]*i/u.test(word.value))) break;
      let code = false;
      /** @type {Word[]} */
      const files = [];
      for (let i = 0; i < rest.length; i++) {
        const word = rest[i];
        if (word.literal && word.value === "--") { files.push(...rest.slice(i + 1)); break; }
        if (word.literal && /^-[A-Za-z]*[eE]$/u.test(word.value)) { code = true; i++; continue; }
        if (word.literal && word.value.startsWith("-") && word.value.length > 1) continue;
        files.push(word);
      }
      (code ? files : files.slice(1)).forEach((word) => add(word, "write"));
      break;
    }
    case "curl": {
      const writes = new Set(["--output", "--dump-header", "--cookie-jar", "--trace", "--trace-ascii", "--stderr", "--etag-save", "--hsts", "--alt-svc"]);
      for (let i = 0; i < rest.length; i++) {
        const word = rest[i];
        const value = word.value;
        if (!word.literal || !value.startsWith("-") || value === "-") continue;
        if (value.startsWith("--")) {
          const option = value.split("=")[0];
          if (writes.has(option)) add(value.includes("=") ? optionValue(value) : rest[++i] ?? literalWord(""), "write");
          else if (option === "--remote-name" || option === "--remote-name-all") remoteNames(rest, add);
          continue;
        }
        // In a cluster like -sSLo the first option that takes a value uses the rest of the word or the next word.
        for (let k = 1; k < value.length; k++) {
          if (value[k] === "O") { remoteNames(rest, add); continue; }
          if (!"oDcHdXuAebFTKmwxrCEYyztUPQ".includes(value[k])) continue;
          const attached = value.slice(k + 1);
          const target = attached ? literalWord(attached) : rest[++i];
          if ("oDc".includes(value[k]) && target) add(target, "write");
          break;
        }
      }
      break;
    }
    case "wget":
      for (let i = 0; i < rest.length; i++) {
        const word = rest[i];
        const value = word.value;
        if (!word.literal) continue;
        const long = /^--(output-document|output-file|append-output|directory-prefix)(=)?/u.exec(value);
        const short = /^-[A-Za-z]*?([OoaP])(.*)$/u.exec(value);
        const kind = long?.[1] === "directory-prefix" || short?.[1] === "P" ? "tree" : "write";
        if (long) add(long[2] ? optionValue(value) : rest[++i] ?? literalWord(""), kind);
        else if (short && !value.startsWith("--")) add(short[2] ? literalWord(short[2]) : rest[++i] ?? literalWord(""), kind);
      }
      break;
    case "patch": {
      // patch writes the files its diff names, relative to -d or the working directory.
      /** @type {Word} */
      let directory = literalWord(".");
      for (let i = 0; i < rest.length; i++) {
        const value = rest[i].value;
        if ((value === "-o" || value === "--output") && rest[i + 1]) add(rest[++i], "write");
        else if ((value === "-d" || value === "--directory") && rest[i + 1]) directory = rest[++i];
        else if (value.startsWith("--directory=")) directory = optionValue(value);
        else if (["-i", "--input", "-r", "--reject-file", "-B", "-z", "-F", "-D"].includes(value)) i++;
        else if (!value.startsWith("-")) add(rest[i], "write");
      }
      add(directory, "tree");
      break;
    }
    case "chmod": case "chown": case "chgrp": case "chflags": {
      // The first operand is the mode, owner or flags (`-w` is a mode); --reference replaces it.
      // Locking a parent directory makes the guard unreadable, so ancestors count ("delete").
      const operands = rest.filter((word) => !(word.literal && (/^-[RfvhHLPcn]+$/u.test(word.value) || word.value === "--")));
      const reference = operands.some((word) => word.value.startsWith("--reference"));
      const recursive = rest.some((word) => word.literal && /^-[A-Za-z]*R/u.test(word.value));
      operands.filter((word) => !word.value.startsWith("--")).slice(reference ? 0 : 1).forEach((word) => add(word, recursive ? "tree" : "delete"));
      break;
    }
    case "mv": {
      const { sources, targets: written } = copyTargets(rest, ctx, new Set(["-S", "--suffix"]));
      written.forEach((word) => add(word, "write"));
      sources.forEach((word) => add(word, "delete"));
      break;
    }
    case "touch": case "truncate":
      operandsOf(rest, new Set(["-t", "-d", "-r", "-s", "--reference", "--size", "--date"])).operands.forEach((word) => add(word, "write"));
      break;
    case "ex": case "vi": case "vim": case "nvim": case "ed": case "view": {
      // Editor scripts (-c, --cmd, +cmd, a heredoc or piped keys) can write every file operand (`:w!` also under -R), any
      // file a `:w` or `:e` command names and the -w/-W keystroke log, and run shell commands through `:!`.
      /** @type {string[]} */
      const scripts = [];
      for (let i = 0; i < rest.length; i++) {
        const word = rest[i];
        const value = word.value;
        if ((value === "-w" || value === "-W") && rest[i + 1]) { add(rest[++i], "write"); continue; }
        const script = value === "-c" || value === "--cmd" ? rest[++i] ?? literalWord("")
          : /^-c./u.test(value) ? { ...word, value: value.slice(2) } : value.startsWith("+") ? { ...word, value: value.slice(1) } : null;
        if (!script) continue;
        if (!script.literal) throw new Block("shell-dynamic-command");
        scripts.push(script.value);
      }
      // Without a `-` operand (the buffer read from stdin), ed and ex mode (`ex`, `-e`, `-es`) read commands from stdin and
      // a visual editor reads keys, which the guard does not follow.
      /** @type {string[]} */
      const commands = [];
      if (name === "ed" || !rest.some((word) => word.literal && word.value === "-")) {
        const source = stdinSource(stdin.redirects);
        if (source?.heredoc?.literal === false) throw new Block("shell-dynamic-stdin");
        const exMode = name === "ed" || name === "ex" || rest.some((word) => word.literal && /^-[A-Za-z]*[eE][A-Za-z]*$/u.test(word.value));
        if (!exMode && (source?.heredoc || source?.op === "<<<")) {
          throw new Block("shell-dynamic-stdin", "Keys typed into a visual editor from stdin cannot be inspected.");
        }
        programFromStdin(stdin.redirects, ctx, { stdinPiped: stdin.stdinPiped, lenient: true }, commands);
      }
      // The editor expands `~`, environment variables, `%`/`#` (current and alternate file), `<cfile>`-style names and
      // wildcards in a file name; an expansion is unknown text, and after a `:cd` so is the base of a relative name.
      const editor = {
        moved: false,
        /** @param {string} value */
        write(value) {
          if (value.includes("`")) throw new Block("shell-dynamic-command", "A backtick file name in an editor command runs a shell command.");
          const text = value.replace(/^~(?=\/|$)/u, HOME).replace(/\$(?:\{\w+\}|\w+)|[%#][^/]*|<\w+>/gu, UNKNOWN);
          const word = literalWord(editor.moved && !isAbsolute(text) && !text.startsWith(UNKNOWN) ? `${UNKNOWN}/${text}` : text);
          if (/[*?[{]/u.test(text)) word.glob = true;
          add(word, "write");
        },
      };
      for (const script of scripts) editorScript(script, name === "ed", false, editor, ctx);
      for (const script of commands) editorScript(script, name === "ed", true, editor, ctx);
      operandsOf(rest, new Set(["-c", "--cmd", "-S", "-u", "-U", "-i", "-T", "-w", "-W", "-t", "-q"])).operands
        .filter((word) => !word.value.startsWith("+")).forEach((word) => add(word, "write"));
      break;
    }
    case "rm": case "unlink": case "rmdir": case "trash": case "srm":
      operandsOf(rest, new Set()).operands.forEach((word) => add(word, "delete"));
      break;
    case "sort": {
      for (let i = 0; i < rest.length; i++) {
        const value = rest[i].value;
        if (value === "-o" || value === "--output") { if (rest[i + 1]) add(rest[i + 1], "write"); i++; }
        else if (value.startsWith("--output=")) add(literalWord(value.slice(9)), "write");
        else if (/^-[A-Za-z]*o./u.test(value) && rest[i].literal && !value.startsWith("--")) add(literalWord(value.slice(value.indexOf("o") + 1)), "write");
      }
      break;
    }
    case "dd":
      rest.filter((word) => word.value.startsWith("of=")).forEach((word) => add({ ...word, value: word.value.slice(3) }, "write"));
      break;
    case "sed":
      if (sed?.inPlace) sed.files.forEach((word) => add(word, "write"));
      sed?.writes.forEach((word) => add(word, "write"));
      break;
    case "git": {
      const git = parseGit(rest);
      const sub = git.sub?.value;
      const subArgs = rest.slice(git.subIndex + 1);
      if (sub === "mv") {
        const { sources, targets: written } = copyTargets(subArgs, ctx, new Set());
        written.forEach((word) => add(word, "write"));
        sources.forEach((word) => add(word, "delete"));
      }
      if (sub === "rm") operandsOf(subArgs, new Set()).operands.forEach((word) => add(word, "delete"));
      for (let i = 0; i < subArgs.length; i++) {
        const value = subArgs[i].value;
        if (value === "--output" && subArgs[i + 1]) add(subArgs[i + 1], "write");
        else if (value.startsWith("--output=")) add({ ...subArgs[i], value: value.slice(9) }, "write");
      }
      break;
    }
    default:
      break;
  }
  return targets;
}

const WRITE_REDIRECTS = new Set([">", ">>", ">|", "&>", "&>>", "<>"]);

/** @param {Redirect[]} redirects @param {Context} ctx */
function checkRedirects(redirects, ctx) {
  for (const redirect of redirects) {
    if (!redirect.target) continue;
    if (WRITE_REDIRECTS.has(redirect.op)) checkTarget(redirect.target, "write", ctx);
    if (redirect.op === ">&" && !/^(?:\d+|-)$/u.test(redirect.target.value)) checkTarget(redirect.target, "write", ctx);
  }
}

/** @param {Word} word @param {Context} ctx */
function evaluateSubs(word, ctx) {
  for (const sub of word.subs) evaluateList(sub, { ...ctx });
}

/** @param {any} list @param {Context} ctx */
function evaluateList(list, ctx) {
  for (const pipeline of list.items) {
    const before = ctx.cwd;
    evaluatePipeline(pipeline, ctx);
    // A background directory change stays in its subshell; one after && or || may not happen.
    if (ctx.cwd !== before) ctx.cwd = pipeline.background ? before : pipeline.conditional ? null : ctx.cwd;
  }
}

/** @param {any} node @param {Context} ctx */
function effectiveName(node, ctx) {
  if (node.type === "subshell") return "(";
  if (node.type !== "simple" || node.words.length === 0) return "";
  let args = node.words;
  for (let guard = 0; guard < 8; guard++) {
    const head = args[0];
    if (!head || !head.literal || head.glob) return "?";
    const name = commandName(head.value);
    let next = null;
    try { next = unwrapWrapper(name, args, ctx); } catch { return "?"; }
    if (!next) return name;
    args = next.args;
  }
  return "?";
}

/** @param {any} pipeline @param {Context} ctx */
function evaluatePipeline(pipeline, ctx) {
  checkDeadline();
  if (pipeline.commands.length > MAX_PIPELINE_STAGES) throw new Block("guard-timeout", TOO_LARGE_REASON);
  const names = pipeline.commands.map((/** @type {any} */ node) => effectiveName(node, ctx));
  const joined = names.join("|");
  for (const rule of pipelineRules) if (rule.regex.test(joined)) throw new Block(rule.id, rule.reason);
  const piped = pipeline.commands.length > 1;
  pipeline.commands.forEach((/** @type {any} */ node, /** @type {number} */ index) => {
    const stage = piped ? { ...ctx } : ctx;
    evaluateNode(node, stage, index > 0);
    // zsh runs the last stage in this shell, bash in a subshell: a directory change there leaves it unknown.
    if (piped && index === pipeline.commands.length - 1 && stage.cwd !== ctx.cwd) ctx.cwd = null;
  });
}

/** @param {any} node @param {Context} ctx @param {boolean} stdinPiped */
function evaluateNode(node, ctx, stdinPiped) {
  if (node.type === "subshell") {
    evaluateList(node.body, { ...ctx });
    evaluateRedirectSubs(node.redirects, ctx);
    checkRedirects(node.redirects, ctx);
    return;
  }
  if (node.type === "data" || node.type === "case") {
    node.words.forEach((/** @type {Word} */ word) => { if (node.type === "data") checkSubscriptCode(word.value); evaluateSubs(word, ctx); });
    // Branches and loop bodies may not run: a directory change inside leaves the working directory unknown.
    const inner = { ...ctx };
    (node.items ?? []).forEach((/** @type {any} */ item) => evaluateList(item, inner));
    if (inner.cwd !== ctx.cwd) ctx.cwd = null;
    evaluateRedirectSubs(node.redirects, ctx);
    checkRedirects(node.redirects, ctx);
    return;
  }
  for (const word of [...node.assigns, ...node.words]) evaluateSubs(word, ctx);
  for (const word of node.assigns) { checkSubscriptCode(word.value); checkExecVariable(word.name ?? "", word, ctx); }
  evaluateRedirectSubs(node.redirects, ctx);
  checkRedirects(node.redirects, ctx);
  if (node.words.length === 0) return;
  evaluateArgv(node.words, node.redirects, ctx, stdinPiped, false);
}

/** Environment variables whose value programs (git, less, bash) run as a command. */
const EXEC_VARIABLES = new Set(["GIT_PAGER", "PAGER", "MANPAGER", "GIT_EDITOR", "EDITOR", "VISUAL", "GIT_SEQUENCE_EDITOR", "GIT_SSH", "GIT_SSH_COMMAND", "GIT_EXTERNAL_DIFF", "GIT_ASKPASS", "SSH_ASKPASS", "LESSOPEN", "LESSCLOSE", "BASH_ENV", "ENV", "PROMPT_COMMAND"]);

/** @param {string} name @param {Word} word @param {Context} ctx */
function checkExecVariable(name, word, ctx) {
  checkSubscriptCode(word.value);
  if (!EXEC_VARIABLES.has(name)) return;
  if (!word.literal) throw new Block("shell-dynamic-command", `${name} names a program that will be executed; it must be literal.`);
  // BASH_ENV and ENV name a startup file the shell sources, not command text.
  if (name === "BASH_ENV" || name === "ENV") { checkShellStartupFile(word, ctx); return; }
  if (word.value) evaluateShellText(word.value.replace(/^\|/u, ""), ctx);
}

/** Absolute, normalized forms of a path operand (lexical and symlink-resolved). @param {string} value @param {Context} ctx */
function pathForms(value, ctx) {
  const absolute = resolve(ctx.cwd ?? ctx.scope, value.replaceAll(UNKNOWN, "x"));
  return [absolute, canonicalPath(absolute)];
}

/** @param {string} value @param {Context} ctx */
function isDevicePath(value, ctx) {
  return pathForms(value, ctx).some((path) => /^\/(?:dev|proc)(?:\/|$)/u.test(posix.normalize(path)));
}

/** A startup file a shell sources (BASH_ENV, ENV, --rcfile, --init-file): devices and process substitution feed code. @param {Word | undefined} word @param {Context} ctx */
function checkShellStartupFile(word, ctx) {
  if (!word) return;
  if (word.procSubst || !word.literal) throw new Block("shell-dynamic-script");
  if (word.value && isDevicePath(word.value, ctx)) throw new Block("shell-dynamic-script");
}

/** @param {Redirect[]} redirects @param {Context} ctx */
function evaluateRedirectSubs(redirects, ctx) {
  for (const redirect of redirects) {
    if (redirect.target) evaluateSubs(redirect.target, ctx);
    if (redirect.heredoc) for (const sub of redirect.heredoc.subs) evaluateList(sub, { ...ctx });
  }
}

/** @param {string} text @param {Context} ctx */
function evaluateShellText(text, ctx) {
  for (const rule of rawRules) if (rule.regex.test(text)) throw new Block(rule.id, rule.reason);
  const depth = ctx.depth + 1;
  if (depth > maxDepth) throw new Block("shell-nesting-depth");
  const list = parseScript(text, depth);
  evaluateList(list, { ...ctx, depth });
}

/** @param {Redirect[]} redirects */
function stdinSource(redirects) {
  /** @type {Redirect | null} */
  let source = null;
  for (const redirect of redirects) {
    if (redirect.fd && redirect.fd !== "0") continue;
    if (redirect.heredoc || redirect.op === "<<<" || redirect.op === "<" || redirect.op === "<>") source = redirect;
  }
  return source;
}

/**
 * @param {Word[]} args @param {Redirect[]} redirects @param {Context} ctx @param {boolean} stdinPiped
 * @param {boolean} [lenient] shell named inside another command's arguments: only its own or piped stdin is inspected.
 */
function evaluateShell(args, redirects, ctx, stdinPiped, lenient = false) {
  const rest = args.slice(1);
  let i = 0;
  let hasCommand = false;
  let stdinMode = false;
  while (i < rest.length) {
    const word = rest[i];
    const value = word.value;
    if (!word.literal) break;
    if (value === "--" || value === "-") { i++; break; }
    if (value === "--rcfile" || value === "--init-file") { checkShellStartupFile(rest[i + 1], ctx); i += 2; continue; }
    if (/^--(?:rcfile|init-file)=/u.test(value)) { checkShellStartupFile({ ...word, value: value.slice(value.indexOf("=") + 1) }, ctx); i++; continue; }
    if (["-o", "+o", "-O", "+O"].includes(value)) { i += 2; continue; }
    if (/^[-+][A-Za-z]+$/u.test(value)) {
      if (value[0] === "-" && value.includes("c")) hasCommand = true;
      if (value[0] === "-" && value.includes("s")) stdinMode = true;
      i++;
      continue;
    }
    if (value.startsWith("--")) { i++; continue; }
    break;
  }
  const operand = rest[i];
  if (hasCommand) {
    if (!operand || !operand.literal) throw new Block("shell-dynamic-command");
    evaluateShellText(operand.value, ctx);
    return;
  }
  if (operand && !stdinMode && !isStdinDevice(operand, ctx)) {
    // A script file operand: a literal heredoc or here-string still feeds the script's stdin, which it may execute.
    const source = stdinSource(redirects);
    if (source?.heredoc || source?.op === "<<<") evaluateShellStdin(redirects, ctx, stdinPiped);
    return;
  }
  evaluateShellStdin(redirects, ctx, stdinPiped, lenient);
}

/**
 * Whether a script operand makes the shell read code from standard input (or another inherited stream).
 * Any path under /dev or /proc, after normalization and symlink resolution, counts as standard input.
 * @param {Word | undefined} word @param {Context} ctx
 */
function isStdinDevice(word, ctx) {
  if (!word) return false;
  if (word.procSubst) throw new Block("shell-dynamic-script");
  if (!word.literal || word.value === "-") return true;
  for (const path of pathForms(word.value, ctx)) {
    if (/^\/(?:dev\/fd|proc\/[^/]+\/fd)\/(?!0$)\d+$/u.test(posix.normalize(path))) throw new Block("shell-dynamic-script");
  }
  return isDevicePath(word.value, ctx);
}

/**
 * Evaluate what a shell reads as its script from standard input. Without its own literal source the shell inherits
 * stdin (a pipe, `exec 0<`, a redirected group or function), which the guard cannot see: blocked.
 * @param {Redirect[]} redirects @param {Context} ctx @param {boolean} stdinPiped @param {boolean} [lenient]
 */
function evaluateShellStdin(redirects, ctx, stdinPiped, lenient = false) {
  const source = stdinSource(redirects);
  if (source?.heredoc) {
    if (source.heredoc.literal === false) throw new Block("shell-dynamic-stdin");
    evaluateShellText(source.heredoc.body, ctx);
    return;
  }
  if (source?.op === "<<<") {
    if (!source.target || !source.target.literal) throw new Block("shell-dynamic-stdin");
    evaluateShellText(source.target.value, ctx);
    return;
  }
  checkStdinFile(source, ctx, stdinPiped, lenient);
}

/**
 * Standard input without a heredoc or here-string: a literal regular file is allowed; a device other than /dev/null, a
 * dynamic target, or an inherited or piped stream is blocked.
 * @param {Redirect | null} source @param {Context} ctx @param {boolean} stdinPiped @param {boolean} [lenient]
 */
function checkStdinFile(source, ctx, stdinPiped, lenient = false) {
  if (source?.target) {
    if (source.target.procSubst || !source.target.literal) throw new Block("shell-dynamic-script");
    const value = source.target.value;
    if (isDevicePath(value, ctx) && posix.normalize(resolve(ctx.cwd ?? ctx.scope, value)) !== "/dev/null") throw new Block("shell-dynamic-stdin");
    return;
  }
  if (lenient && !stdinPiped) return;
  throw new Block("shell-dynamic-stdin");
}

/** @param {Word[]} rest @param {Redirect[]} redirects */
function patchInput(rest, redirects) {
  const source = stdinSource(redirects);
  if (source?.heredoc) return source.heredoc.body;
  if (source?.op === "<<<" && source.target?.literal) return source.target.value;
  const literal = rest.find((word) => word.literal && word.value.includes("*** Begin Patch"));
  if (literal) return literal.value;
  return null;
}

/**
 * Runners that execute their remaining arguments (watch, ssh, flock, docker exec, pnpm exec, su -c, ...) cannot all be
 * listed as wrappers. Evaluate any argument position that names a destructive-capable command or a shell, and any
 * multi-word literal argument whose first token does, so anchored rules still see the nested command.
 * @param {string} name @param {Word[]} rest @param {Redirect[]} redirects @param {Context} ctx @param {boolean} stdinPiped
 */
function scanNestedCommands(name, rest, redirects, ctx, stdinPiped) {
  if (isSensitive(name) || SHELLS.has(name)) return;
  for (let k = 0; k < rest.length; k++) {
    const word = rest[k];
    if (!word.literal) continue;
    const nested = commandName(word.value);
    if (isSensitive(nested) || SHELLS.has(nested) || nested === "eval") {
      if (ctx.depth + 1 > maxDepth) throw new Block("shell-nesting-depth");
      // The runner hands its own stdin (redirects, pipe) to the nested command.
      evaluateArgv(rest.slice(k), redirects, { ...ctx, depth: ctx.depth + 1 }, stdinPiped, true, true);
      return;
    }
    // A literal argument that is itself shell code (`tmux new -d 'true; …'`, `parallel ::: '…'`); interpreter programs are
    // scanned by scanInterpreterCode instead.
    if (!/\s/u.test(word.value) || interpreterFamily(name)) continue;
    const leaders = commandPositions(word.value);
    const executes = leaders.some((leader) => isSensitive(leader) || SHELLS.has(leader) || leader === "eval");
    if (!executes && !leaders.some((leader) => LEADING_RUNNERS.has(leader))) continue;
    try { evaluateShellText(word.value, ctx); }
    catch (error) { if (!(error instanceof ParseError) || executes) throw error; }
  }
}

/** Wrappers and runners whose arguments form the command they run. */
const LEADING_RUNNERS = new Set(["sudo", "doas", "arch", "busybox", "env", "nohup", "builtin", "command", "exec", "nice", "time", "stdbuf", "caffeinate", "timeout", "xargs", "ssh", "watch", "su", "runuser", "script", "flock", "sg", "find", "parallel", "tmux", "screen", "source", "."]);

/**
 * Command names at command positions of shell-like text: the start and after `;` `&` `|` newline, backtick or `$(`, past
 * `(` `{` `!`, keywords and assignments. A `(` after a word (`f(x)`, prose) is not a command position.
 * @param {string} text
 */
function commandPositions(text) {
  const re = /(?:^|[;&|\n`]|\$\()(?:\s*(?:[({!]|(?:if|then|else|elif|do|while|until|time)(?=\s)))*\s*(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|<>(){}`]*\s+)*([^\s;&|<>(){}`]+)/gu;
  return [...text.matchAll(re)].map((match) => commandName(match[1].replace(/['"\\]/gu, "")));
}

/** Inline-program options per interpreter family; awk takes its program as the first operand. */
const INLINE_CODE = {
  python: /^-[A-Za-z]*c$/u, node: /^(?:-[A-Za-z]*[ep]|--eval|--print)$/u, bun: /^(?:-[A-Za-z]*[ep]|--eval|--print)$/u, deno: /^eval$/u,
  perl: /^-[A-Za-z0-9]*[eE]$/u, ruby: /^-[A-Za-z0-9]*e$/u, osascript: /^-e$/u, php: /^-[rBRE]$/u, rscript: /^-e$/u, lua: /^-e$/u,
};

/** Options whose value is the next word, per family, to find the script operand. */
const INTERPRETER_VALUE_OPTIONS = {
  python: ["-W", "-X", "-Q"], node: ["-r", "--require", "--import", "--loader", "--experimental-loader", "-C", "--conditions", "--title"],
  bun: ["-r", "--preload", "--cwd", "--config", "-c"], perl: ["-I"], ruby: ["-I", "-r", "-C", "-E", "-F"], php: ["-c", "-d", "-z"],
  osascript: ["-l", "-s"], lua: ["-l"],
};

/** Options after which an interpreter prints information, runs a module or checks syntax instead of reading a program. */
const INTERPRETER_NO_PROGRAM = /^(?:-V|-VV|-v|--version|-h|--help|-\?|--v8-options)$/u;
/** @type {Record<string, RegExp>} */
const FAMILY_NO_PROGRAM = { python: /^-m/u, php: /^-[mil]$/u };

/** Structural blocks that ordinary program strings trip without running anything; destructive rules still apply. */
const CODE_STRING_IGNORED = new Set(["dynamic-command-name", "shell-eval", "shell-ansi-c-quoting", "shell-indirect-expansion", "shell-glob-execution", "read-command-execution", "shell-arithmetic-injection"]);

/** @param {string} name @returns {keyof typeof INLINE_CODE | "awk" | null} */
function interpreterFamily(name) {
  if (/^python[0-9.]*$/u.test(name) || name === "pypy3") return "python";
  if (name === "nodejs") return "node";
  if (/^[gmn]?awk$/u.test(name)) return "awk";
  return Object.hasOwn(INLINE_CODE, name) ? /** @type {keyof typeof INLINE_CODE} */ (name) : null;
}

/**
 * Program texts an interpreter runs: its inline options, else a heredoc or here-string on stdin. A program the interpreter
 * reads from stdin without its own literal source (a pipe, an inherited stream, a device) cannot be seen and is blocked
 * like a shell's; `-m`, version and help options, xargs-appended operands and script files read no program from stdin.
 * @param {keyof typeof INLINE_CODE | "awk"} family @param {Word[]} rest @param {Redirect[]} redirects @param {Context} ctx
 * @param {{ stdinPiped: boolean, lenient: boolean, appended: boolean }} stdin
 */
function interpreterCode(family, rest, redirects, ctx, stdin) {
  /** @type {string[]} */
  const codes = [];
  if (family === "awk") {
    if (awkIsPureRead(rest)) return codes;
    for (let i = 0; i < rest.length; i++) {
      const value = rest[i].value;
      const file = value === "-f" || value === "--file" ? rest[i + 1] : /^-f./u.test(value) ? { ...rest[i], value: value.slice(2) } : value.startsWith("--file=") ? { ...rest[i], value: value.slice(7) } : null;
      if (file !== null) {
        // `-f -` and `-f /dev/stdin` read the program from standard input.
        if (file?.procSubst) throw new Block("shell-dynamic-script");
        if (file?.literal && (file.value === "-" || isStdinDevice(file, ctx))) programFromStdin(redirects, ctx, stdin, codes);
        return codes;
      }
      if (value === "-F" || value === "-v") { i++; continue; }
      if (value.startsWith("-") && value.length > 1) continue;
      codes.push(value);
      break;
    }
    return codes;
  }
  for (let i = 0; i < rest.length; i++) {
    const value = rest[i].value;
    if (!rest[i].literal) continue;
    if ((family === "node" || family === "bun") && /^--(?:eval|print)=/u.test(value)) codes.push(value.slice(value.indexOf("=") + 1));
    else if (INLINE_CODE[family].test(value) && rest[i + 1]) codes.push(rest[++i].value);
  }
  if (codes.length > 0) return codes;
  const operand = interpreterOperand(family, rest);
  if (operand === null) return codes;
  if (family === "deno" || family === "rscript" || stdin.appended || (operand && !isStdinDevice(operand, ctx))) {
    // A script file operand: a heredoc or here-string still feeds the script's stdin, which it may run.
    const source = stdinSource(redirects);
    if (source?.heredoc) codes.push(source.heredoc.body);
    else if (source?.op === "<<<" && source.target) codes.push(source.target.value);
    return codes;
  }
  programFromStdin(redirects, ctx, stdin, codes);
  return codes;
}

/**
 * The first operand (script path, `-`) after an interpreter's options; undefined without one, null when an option means no
 * program is read. A dynamic operand counts as a script path.
 * @param {keyof typeof INLINE_CODE} family @param {Word[]} rest
 * @returns {Word | undefined | null}
 */
function interpreterOperand(family, rest) {
  const withValue = INTERPRETER_VALUE_OPTIONS[/** @type {keyof typeof INTERPRETER_VALUE_OPTIONS} */ (family)] ?? [];
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word.procSubst) throw new Block("shell-dynamic-script");
    if (!word.literal) return word.value === UNKNOWN ? literalWord("script") : literalWord(word.value.replaceAll(UNKNOWN, "x"));
    const value = word.value;
    if (value === "--") return rest[i + 1];
    if (value === "-" || !value.startsWith("-")) return word;
    if ((INTERPRETER_NO_PROGRAM.test(value) && !(family === "python" && value === "-v")) || FAMILY_NO_PROGRAM[family]?.test(value)) return null;
    if (withValue.includes(value)) i++;
  }
  return undefined;
}

/** @param {Redirect[]} redirects @param {Context} ctx @param {{ stdinPiped: boolean, lenient: boolean }} stdin @param {string[]} codes */
function programFromStdin(redirects, ctx, stdin, codes) {
  const source = stdinSource(redirects);
  if (source?.heredoc) { codes.push(source.heredoc.body); return; }
  if (source?.op === "<<<") {
    if (!source.target || !source.target.literal) throw new Block("shell-dynamic-stdin");
    codes.push(source.target.value);
    return;
  }
  checkStdinFile(source, ctx, stdin.stdinPiped, stdin.lenient);
}

/**
 * String literals in program text, alone and joined where the program concatenates them (`+`, adjacency) or lists
 * them as argv (`,`, `[`), so `'r' + 'm -rf x'` and `['git', 'reset', '--hard']` read as the command they build.
 * @param {string} code
 */
function codeStrings(code) {
  const found = [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/gu)].map((match) => ({
    text: (match[1] ?? match[2] ?? match[3]).replace(/\\(.)/gu, "$1"),
    start: match.index,
    end: match.index + match[0].length,
  }));
  const strings = found.map((item) => item.text);
  /** Strings not joined with a neighbor: a lone "sh" is a shell started without arguments. @type {string[]} */
  const lone = [];
  let group = found[0]?.text ?? "";
  let size = found.length > 0 ? 1 : 0;
  for (let k = 1; k < found.length; k++) {
    const between = code.slice(found[k - 1].end, found[k].start);
    if (/^\s*\+?\s*$/u.test(between)) group += found[k].text;
    else if (/^\s*,\s*\[?\s*$/u.test(between)) group += ` ${found[k].text}`;
    else { strings.push(group); if (size === 1) lone.push(group); group = found[k].text; size = 0; }
    size++;
  }
  strings.push(group);
  if (size === 1) lone.push(group);
  return { strings, lone };
}

/** Program text that starts processes; with it, a lone shell-name string runs a shell reading the program's stdin. */
const PROCESS_API = /\b(?:system|exec\w*|spawn\w*|popen\w*|Popen|run|call|check_call|check_output|getoutput|getstatusoutput|qx|shell)\b|`|%x/u;

/**
 * Interpreters hand strings to a shell (os.system, execSync, system(), do shell script, qx{}, %x()). Evaluate each string
 * literal of an inline or stdin program, and each code fragment between delimiters (newline ; quotes brackets) for quote
 * forms the literal scan does not know, as shell text with interpolations (`${x}`, `$x`, `{x}`, `%s`) as placeholders.
 * @param {string} name @param {Word[]} rest @param {Redirect[]} redirects @param {Context} ctx
 * @param {{ stdinPiped: boolean, lenient: boolean, appended: boolean }} stdin
 */
function scanInterpreterCode(name, rest, redirects, ctx, stdin) {
  const family = interpreterFamily(name);
  if (!family) return;
  for (const code of interpreterCode(family, rest, redirects, ctx, stdin)) {
    const plain = code.replaceAll(UNKNOWN, "x");
    const { strings, lone } = codeStrings(plain);
    if (PROCESS_API.test(plain) && lone.some((text) => SHELLS.has(commandName(text.trim())))) {
      throw new Block("shell-dynamic-stdin", "The program starts a shell without a command; the shell reads the program's standard input, which cannot be inspected.");
    }
    for (const text of new Set([...strings, ...plain.split(/[\n;'"`(){}[\]]/u)])) {
      checkDeadline();
      if (!/\S\s+\S/u.test(text)) continue;
      const shellText = text.replace(/\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_.]*\}|%[sdr]/gu, "x");
      try { evaluateShellText(shellText, { ...ctx }); }
      catch (error) {
        if (error instanceof ParseError) continue;
        if (error instanceof Block && CODE_STRING_IGNORED.has(error.ruleId)) continue;
        throw error;
      }
    }
  }
}

/**
 * Evaluate words a command runner joins into one command string for a shell. Parse errors are ignored because the
 * runner, not this shell, interprets the text; dynamic words cannot be inspected and are blocked.
 * @param {Word[]} words @param {Context} ctx
 */
function evaluateRunnerText(words, ctx) {
  if (words.length === 0) return;
  if (words.some((word) => !word.literal)) throw new Block("shell-dynamic-command", "A command runner received a command string that is not literal.");
  evaluateRunnerString(words.map((word) => word.value).join(" "), ctx);
}

/** @param {string} text @param {Context} ctx */
function evaluateRunnerString(text, ctx) {
  try { evaluateShellText(text, ctx); }
  catch (error) { if (!(error instanceof ParseError)) throw error; }
}

/** Value of option `-x value`, `-xvalue` or `--long value` / `--long=value` at index i, or undefined. @param {Word[]} rest @param {number} i @param {string[]} short @param {string[]} long */
function runnerOptionValue(rest, i, short, long) {
  const value = rest[i].value;
  for (const option of long) {
    if (value === option) return rest[i + 1] ?? literalWord("");
    if (value.startsWith(`${option}=`)) return { ...rest[i], value: value.slice(option.length + 1) };
  }
  for (const option of short) {
    if (value === option) return rest[i + 1] ?? literalWord("");
    if (value.startsWith(option) && /^-[A-Za-z]$/u.test(option) && value.length > 2) return { ...rest[i], value: value.slice(2) };
  }
  return undefined;
}

const SSH_OPTIONS_WITH_VALUE = new Set(["-B", "-b", "-c", "-D", "-E", "-e", "-F", "-I", "-i", "-J", "-L", "-l", "-m", "-O", "-o", "-P", "-p", "-Q", "-R", "-S", "-W", "-w"]);

/**
 * Command runners that execute a literal argument as shell text (ssh remote words, watch, su/runuser/script/flock -c,
 * mapfile/readarray -C). Only these runners treat a whole argument as code; other commands' arguments stay data.
 * @param {string} name @param {Word[]} rest @param {Context} ctx
 */
function evaluateRunner(name, rest, ctx) {
  switch (name) {
    case "ssh": {
      let i = 0;
      while (i < rest.length) {
        const value = rest[i].value;
        if (value === "--") { i++; break; }
        if (!value.startsWith("-") || value === "-") break;
        if (value === "-o" || /^-o./u.test(value)) {
          const option = value === "-o" ? rest[i + 1] : { ...rest[i], value: value.slice(2) };
          if (option && /^\s*(?:proxycommand|localcommand|remotecommand|knownhostscommand)\s*[= ]/iu.test(option.value)) {
            if (!option.literal) throw new Block("shell-dynamic-command");
            evaluateRunnerString(option.value.replace(/^\s*[A-Za-z]+\s*[= ]\s*/u, ""), ctx);
          }
        }
        i += SSH_OPTIONS_WITH_VALUE.has(value) ? 2 : 1;
      }
      evaluateRunnerText(rest.slice(i + 1), ctx);
      return;
    }
    case "watch": {
      let i = 0;
      while (i < rest.length) {
        const value = rest[i].value;
        if (value === "--") { i++; break; }
        if (!value.startsWith("-") || value === "-") break;
        i += value === "-n" || value === "--interval" ? 2 : 1;
      }
      evaluateRunnerText(rest.slice(i), ctx);
      return;
    }
    case "su": case "runuser": case "script": case "flock": case "sg": {
      for (let i = 0; i < rest.length; i++) {
        const code = runnerOptionValue(rest, i, ["-c"], ["--command", "--session-command"]);
        if (code) evaluateRunnerText([code], ctx);
      }
      return;
    }
    case "mapfile": case "readarray": {
      for (let i = 0; i < rest.length; i++) {
        const code = runnerOptionValue(rest, i, ["-C"], []);
        if (code) evaluateRunnerText([code], ctx);
      }
      return;
    }
    default:
  }
}

/**
 * `git config [scope options] [set] <key> <value>` stores a setting that later git runs execute (aliases, pagers,
 * editors, helpers). Returns the stored key=value word, or null when the invocation does not set a value.
 * @param {Word[]} subArgs
 * @returns {Word | null}
 */
function gitConfigAssignment(subArgs) {
  const withValue = new Set(["-f", "--file", "--blob", "--type", "--default", "--comment", "--value"]);
  const reading = /^(?:--(?:get|get-all|get-regexp|get-urlmatch|get-color|get-colorbool|unset|unset-all|list|edit|rename-section|remove-section|show-origin|show-scope)|-l|-e)$/u;
  /** @type {Word[]} */
  const positional = [];
  for (let i = 0; i < subArgs.length; i++) {
    const word = subArgs[i];
    const value = word.value;
    if (reading.test(value)) return null;
    if (value === "--") { positional.push(...subArgs.slice(i + 1)); break; }
    if (withValue.has(value)) { i++; continue; }
    if (value.startsWith("-") && value.length > 1) continue;
    positional.push(word);
  }
  if (positional[0]?.literal && positional[0].value === "set") positional.shift();
  else if (positional[0]?.literal && ["get", "unset", "list", "edit", "rename-section", "remove-section"].includes(positional[0].value)) return null;
  const [key, value] = positional;
  if (!key || !value) return null;
  return { ...key, value: `${key.value}=${value.value}`, literal: key.literal && value.literal };
}

/**
 * @param {Word[]} argv @param {Redirect[]} redirects @param {Context} ctx @param {boolean} stdinPiped @param {boolean} appended
 * @param {boolean} [nested] named inside another command's arguments (runner fallback)
 */
function evaluateArgv(argv, redirects, ctx, stdinPiped, appended, nested = false) {
  checkDeadline();
  let args = argv;
  let viaXargs = false;
  /** @type {string | null} */
  let replace = null;
  for (let guard = 0; ; guard++) {
    const head = args[0];
    if (!head) return;
    if (!head.literal || head.glob) throw new Block("dynamic-command-name");
    if (guard > 8) throw new Block("shell-nesting-depth");
    // An alias or hashed name defined earlier in this command line runs what it stands for.
    const aliased = ctx.aliases?.get(commandName(head.value));
    if (aliased === null) throw new Block("dynamic-command-name");
    if (aliased) { args = [...aliased, ...args.slice(1)]; continue; }
    const next = unwrapWrapper(commandName(head.value), args, ctx);
    if (!next) break;
    args = next.args;
    if (next.appended) { appended = true; viaXargs = true; replace = next.replace ?? null; }
    // `env -C dir` and `sudo -D dir` run the command in that directory.
    if (next.chdir) ctx = { ...ctx, cwd: chdirTarget(next.chdir, ctx) };
  }
  // git-core executables (`.../git-core/git-reset`) are git subcommands.
  const gitCore = /^git-([a-z][a-z0-9-]*)$/u.exec(commandName(args[0].value));
  if (gitCore) args = [{ ...args[0], value: "git" }, { ...args[0], value: gitCore[1], raw: gitCore[1] }, ...args.slice(1)];
  const name = commandName(args[0].value);
  const rest = name === "git" ? expandGitOptions(args.slice(1)) : args.slice(1);

  if (viaXargs) {
    // xargs builds arguments from standard input, which the guard cannot see.
    if (SHELLS.has(name) || name === "eval" || name === "source" || name === ".") {
      throw new Block("shell-dynamic-command", "xargs passes standard input to a shell or eval; the command text cannot be inspected.");
    }
  }

  if (name === "eval") throw new Block("shell-eval");
  if (SHELLS.has(name)) { evaluateShell(args, redirects, ctx, stdinPiped, nested); return; }
  if (name === "source" || name === ".") {
    if (isStdinDevice(rest[0], ctx)) evaluateShellStdin(redirects, ctx, stdinPiped);
    else if (rest[0]) {
      const source = stdinSource(redirects);
      if (source?.heredoc || source?.op === "<<<") evaluateShellStdin(redirects, ctx, stdinPiped);
    }
    return;
  }
  evaluateRunner(name, rest, ctx);
  if (NAME_BUILTINS.has(name)) {
    for (const word of rest) checkSubscriptCode(word.value);
    const source = name === "read" || name === "mapfile" || name === "readarray" ? stdinSource(redirects) : null;
    if (source?.heredoc) checkSubscriptCode(source.heredoc.body);
    else if (source?.op === "<<<" && source.target) checkSubscriptCode(source.target.value);
  }
  if (name === "alias") {
    for (const word of rest) {
      const index = word.value.indexOf("=");
      if (index < 0) continue;
      if (!word.literal) throw new Block("shell-dynamic-command");
      evaluateShellText(word.value.slice(index + 1), ctx);
      defineAlias(ctx, word.value.slice(0, index), aliasWords(word.value.slice(index + 1), ctx));
    }
    return;
  }
  if (name === "hash") {
    // bash `hash -p path name` and zsh `hash name=path` make name run that path.
    const p = rest.findIndex((word) => word.literal && word.value === "-p");
    if (p >= 0 && rest[p + 2]) {
      if (!rest[p + 2].literal) throw new Block("dynamic-command-name");
      defineAlias(ctx, rest[p + 2].value, rest[p + 1].literal ? [rest[p + 1]] : null);
    }
    for (const word of rest) {
      const index = word.value.indexOf("=");
      if (index <= 0) continue;
      if (!word.literal) throw new Block("dynamic-command-name");
      defineAlias(ctx, word.value.slice(0, index), [literalWord(word.value.slice(index + 1))]);
    }
    return;
  }
  if (name === "trap") {
    const code = rest[0];
    if (code && code.value !== "-" && !/^-[lp]$/u.test(code.value)) {
      if (!code.literal) throw new Block("shell-dynamic-command");
      evaluateShellText(code.value, ctx);
    }
    return;
  }
  if (name === "apply_patch" || name === "applypatch") {
    const patch = patchInput(rest, redirects);
    if (patch === null) throw new Block("malformed-payload", "apply_patch input could not be inspected; blocked closed.");
    checkPatch(patch, ctx);
    return;
  }
  if (name === "find") {
    for (let i = 0; i < rest.length; i++) {
      if (!["-exec", "-execdir", "-ok", "-okdir"].includes(rest[i].value)) continue;
      let end = i + 1;
      while (end < rest.length && rest[end].value !== ";" && rest[end].value !== "+") end++;
      evaluateArgv(rest.slice(i + 1, end), [], ctx, false, true);
      i = end;
    }
  }
  if (name === "rg" && rest.some((word) => /^--pre(?:=|$)/u.test(word.value))) throw new Block("read-command-execution");
  if (name === "git") {
    const git = parseGit(rest);
    const subArgs = rest.slice(git.subIndex + 1);
    if (git.sub?.value === "grep" && subArgs.some((word) => /^-O|^--open-files-in-pager(?:=|$)/u.test(word.value))) throw new Block("read-command-execution");
    evaluateGitConfigs(git.configs, subArgs, ctx);
    if (git.sub?.literal && git.sub.value === "config") {
      const stored = gitConfigAssignment(subArgs);
      if (stored) evaluateGitConfigs([stored], [], ctx);
    }
  }

  const sed = name === "sed" ? analyzeSed(rest) : null;
  if (sed?.exec) throw new Block("read-command-execution", "sed e commands execute arbitrary shell commands and are blocked.");

  let pureRead = readOnlyCommands.has(name);
  if (name === "sed") pureRead = Boolean(sed && !sed.inPlace && sed.writes.length === 0 && !sed.uncertain);
  if (name === "awk") pureRead = awkIsPureRead(rest);

  if (isSensitive(name)) {
    if (name === "git") {
      const git = parseGit(rest);
      if (!git.readOnly && rest.some((word) => !word.literal)) throw new Block("sensitive-dynamic-argument");
    } else if (rest.some((word) => !word.literal)) {
      throw new Block("sensitive-dynamic-argument");
    }
  }

  if (!pureRead) {
    const words = name === "git" ? rest.slice(parseGit(rest).subIndex) : rest;
    const canonical = [name, ...words.map((word) => word.value.replace(/\s/gu, "\u001f"))].join(" ");
    for (const rule of commandRules) if (rule.regex.test(canonical)) throw new Block(rule.id, rule.reason);
  }

  if (viaXargs && isSensitive(name)) {
    // Appended (or replaced) words from stdin are only operands when they follow a literal -- separator.
    const separator = rest.findIndex((word) => word.literal && word.value === "--");
    const unsafe = separator < 0 || (replace !== null && rest.slice(0, separator).some((word) => word.value.includes(/** @type {string} */ (replace))));
    if (unsafe) throw new Block("sensitive-dynamic-argument", "xargs appends arguments from standard input to a destructive-capable command; put them after a literal -- separator.");
  }

  for (const { word, kind } of commandTargets(name, rest, ctx, sed, { redirects, stdinPiped })) checkTarget(word, kind, ctx);
  if (!pureRead) scanNestedCommands(name, rest, redirects, ctx, stdinPiped);
  scanInterpreterCode(name, rest, redirects, ctx, { stdinPiped, lenient: nested, appended });

  if (name === "cd" || name === "pushd" || name === "popd") {
    const operands = rest.filter((word) => !(word.literal && /^-[LPe@]+$/u.test(word.value)));
    const target = operands[0];
    // popd, a bare pushd and pushd +N/-N return to a directory from the stack, which is not tracked; zsh `cd old new` substitutes.
    if (name === "popd" || operands.length > 1 || (name === "pushd" && (!target || /^[+-]\d+$/u.test(target.value)))) ctx.cwd = null;
    else if (!target) ctx.cwd = HOME;
    // CDPATH can send a bare relative name elsewhere.
    else if (ctx.cdpath && target.literal && !isAbsolute(target.value) && !/^\.\.?(?:\/|$)/u.test(target.value)) ctx.cwd = null;
    else ctx.cwd = chdirTarget(target, ctx);
  }
}

/** Working directory after changing to `word`: unknown when dynamic, relative to an unknown directory, or missing (the change fails). @param {Word} word @param {Context} ctx */
function chdirTarget(word, ctx) {
  if (!word.literal || word.value === "-" || (ctx.cwd === null && !isAbsolute(word.value))) return null;
  const target = resolve(ctx.cwd ?? ctx.scope, word.value);
  return existsSync(target) ? target : null;
}

/** @param {unknown} command @param {{cwd?: string, scope?: string}} [options] */
export function evaluateCommand(command, options = {}) {
  return withClock(() => evaluateCommandNow(command, options));
}

/** @param {unknown} command @param {{cwd?: string, scope?: string}} options */
function evaluateCommandNow(command, options) {
  if (typeof command !== "string" || command.trim().length === 0) {
    return { allowed: false, ruleId: "missing-command", reason: structural["missing-command"] };
  }
  if (Buffer.byteLength(command, "utf8") > MAX_COMMAND_BYTES) return { allowed: false, ruleId: "guard-timeout", reason: TOO_LARGE_REASON };
  const scope = options.scope ?? process.cwd();
  catRedefined = false;
  dotGlob = /dotglob|globdots|globignore/iu.test(command.replaceAll("_", ""));
  try {
    for (const rule of rawRules) if (rule.regex.test(command)) throw new Block(rule.id, rule.reason);
    const list = parseScript(command, 0);
    // A CDPATH from the environment or set in this command redirects bare relative directory names.
    evaluateList(list, { cwd: options.cwd ?? scope, scope, depth: 0, aliases: new Map(), cdpath: Boolean(process.env.CDPATH) || /cdpath/iu.test(command) });
    return { allowed: true, ruleId: null, reason: null };
  } catch (error) {
    return failure(error);
  }
}

/** @param {unknown} error */
function failure(error) {
  if (error instanceof Block) return { allowed: false, ruleId: error.ruleId, reason: error.reason };
  if (error instanceof ParseError) return { allowed: false, ruleId: "shell-parse-error", reason: `${structural["shell-parse-error"]} (${error.message})` };
  return { allowed: false, ruleId: "guard-error", reason: `Guard evaluation failed; blocked closed: ${error instanceof Error ? error.message : String(error)}` };
}

/** @param {string} value */
function shellQuote(value) {
  return /^[A-Za-z0-9_./=:@%+,-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** @param {unknown} value */
function commandsFrom(value) {
  /** @type {string[]} */
  const commands = [];
  /** @param {unknown} current @param {string} key */
  function walk(current, key = "") {
    const commandKey = key === "command" || key === "cmd" || key === "script";
    if (typeof current === "string" && commandKey) commands.push(current);
    else if (Array.isArray(current) && commandKey && current.every((entry) => typeof entry === "string")) commands.push(current.map(shellQuote).join(" "));
    else if (Array.isArray(current)) current.forEach((entry) => walk(entry));
    else if (current && typeof current === "object") Object.entries(current).forEach(([childKey, child]) => walk(child, childKey));
  }
  walk(value);
  return commands;
}

/** @param {unknown} value */
function patchTexts(value) {
  /** @type {string[]} */
  const patches = [];
  /** @param {unknown} current */
  function walk(current) {
    if (typeof current === "string") { if (current.includes("*** Begin Patch")) patches.push(current); }
    else if (Array.isArray(current)) current.forEach(walk);
    else if (current && typeof current === "object") Object.values(current).forEach(walk);
  }
  walk(value);
  return patches;
}

const ALLOWED = { allowed: true, ruleId: null, reason: null };

/** Evaluate a PreToolUse hook payload. @param {any} payload */
export function evaluatePayload(payload) {
  return withClock(() => evaluatePayloadNow(payload));
}

/** @param {any} payload */
function evaluatePayloadNow(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { allowed: false, ruleId: "malformed-payload", reason: structural["malformed-payload"] };
  }
  const tool = String(payload.tool_name ?? payload.toolName ?? "");
  const input = payload.tool_input ?? payload.toolInput ?? payload.input;
  const scope = typeof payload.cwd === "string" && payload.cwd ? resolve(payload.cwd) : process.cwd();
  /** @type {Context} */
  const ctx = { cwd: scope, scope, depth: 0, aliases: new Map() };
  try {
    if (FILE_TOOLS.has(tool) || tool === "NotebookEdit") {
      const path = tool === "NotebookEdit" ? input?.notebook_path : input?.file_path;
      if (typeof path !== "string" || !path) throw new Block("malformed-payload");
      checkTarget(literalWord(path), "write", ctx);
      return ALLOWED;
    }
    if (/^apply_?patch$/iu.test(tool)) {
      const patches = patchTexts(input);
      if (patches.length === 0) throw new Block("malformed-payload", "apply_patch payload did not contain patch text; blocked closed.");
      patches.forEach((patch) => checkPatch(patch, ctx));
      return ALLOWED;
    }
    const commands = commandsFrom(input);
    if (SHELL_TOOLS.has(tool) || commands.length > 0) {
      if (commands.length === 0) throw new Block("missing-command");
      const workdir = typeof input?.workdir === "string" && input.workdir ? resolve(scope, input.workdir) : scope;
      for (const command of commands) {
        const result = evaluateCommand(command, { scope, cwd: workdir });
        if (!result.allowed) return result;
      }
      return ALLOWED;
    }
    const patches = patchTexts(input);
    if (patches.length > 0) { patches.forEach((patch) => checkPatch(patch, ctx)); return ALLOWED; }
    if (typeof input?.file_path === "string" && input.file_path) { checkTarget(literalWord(input.file_path), "write", ctx); return ALLOWED; }
    throw new Block("malformed-payload");
  } catch (error) {
    return failure(error);
  }
}

async function stdinJson() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 1_000_000) throw new Error("Hook input exceeds 1 MB");
  }
  if (!input.trim()) throw new Error("Hook input is empty");
  return JSON.parse(input);
}

/** @param {string} reason */
function deny(reason) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  })}\n`);
  process.exitCode = 0;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "check") {
    const toolIndex = args.indexOf("--tool-json");
    const commandIndex = args.indexOf("--command");
    const cwdIndex = args.indexOf("--cwd");
    const cwd = cwdIndex >= 0 && args[cwdIndex + 1] ? resolve(args[cwdIndex + 1]) : process.cwd();
    let result;
    if (toolIndex >= 0 && args[toolIndex + 1]) result = evaluatePayload(JSON.parse(args[toolIndex + 1]));
    else if (commandIndex >= 0 && args[commandIndex + 1]) result = evaluateCommand(args[commandIndex + 1], { scope: cwd, cwd });
    else throw new Error("check requires --command <shell-command> [--cwd <dir>] or --tool-json <hook-payload-json>");
    process.stdout.write(`${JSON.stringify({ policyVersion: policy.policyVersion, ...result })}\n`);
    process.exitCode = result.allowed ? 0 : 2;
    return;
  }
  if (command !== "hook") throw new Error("Usage: command-guard.mjs <check|hook> [options]");
  const harnessIndex = args.indexOf("--harness");
  const harness = harnessIndex >= 0 ? args[harnessIndex + 1] : null;
  if (harness !== "codex" && harness !== "claude") throw new Error("hook requires --harness codex or claude");
  try {
    const result = evaluatePayload(await stdinJson());
    if (!result.allowed) deny(`[${result.ruleId}] ${result.reason}`);
  } catch (error) {
    deny(`Malformed hook input; blocked closed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Run the CLI only when executed directly, so evaluateCommand/evaluatePayload can be imported. */
function invokedDirectly() {
  const script = process.argv[1];
  if (!script) return false;
  try { return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return resolve(script) === fileURLToPath(import.meta.url); }
}

if (invokedDirectly()) {
  await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
