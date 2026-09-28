/** Test runner configuration path patterns. */
const TEST_CONFIG_SOURCES = [
  "(?:^|/)(?:vitest|jest|playwright|cypress)\\.config\\.[cm]?[jt]s$",
  "(?:^|/)vitest\\.workspace\\.[cm]?[jt]s$",
  "(?:^|/)karma\\.conf\\.[cm]?js$",
  "(?:^|/)\\.mocharc(?:\\.[a-z]+)?$",
  "(?:^|/)(?:pytest\\.ini|conftest\\.py)$",
];

/** Automated test file and test runner configuration path patterns, in match order. */
export const TEST_FILE_PATTERN_SOURCES = Object.freeze([
  "(?:^|/)(?:__tests__|__snapshots__|tests?|e2e|cypress|[A-Za-z0-9_-]*Tests)/(?:[^/]+/)*[^/]+\\.(?:[cm]?[jt]sx?|py|go|swift|rb|snap|json)$",
  "\\.(?:test|spec)\\.[cm]?[jt]sx?$",
  "(?:^|/)[^/]*Tests?\\.swift$",
  "\\.snap$",
  ...TEST_CONFIG_SOURCES,
  "(?:^|/)test_[^/]*\\.py$",
  "_test\\.(?:py|go)$",
]);

/** The TEST_FILE_PATTERN_SOURCES entries that describe runner configuration rather than test files. @type {ReadonlySet<string>} */
export const TEST_CONFIG_PATTERN_SOURCES = new Set(TEST_CONFIG_SOURCES);

/** @type {ReadonlyArray<RegExp>} */
export const TEST_FILE_PATTERNS = Object.freeze(TEST_FILE_PATTERN_SOURCES.map((source) => new RegExp(source)));

/**
 * @param {string} path Repository-relative path with forward slashes.
 * @returns {boolean}
 */
export function isTestPath(path) {
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Instructions that direct an agent to write or run automated tests. Shared with the release builders'
 * gardener check. Negation is action-scoped: see negatedClause.
 * @type {ReadonlyArray<RegExp>}
 */
export const directiveTestInstructions = Object.freeze([
  /\b(?:pnpm|npm|yarn|bun)(?: run)? test(?::[\w-]+)?\b/gi, /then tests\b/gi, /focused tests/gi, /A test covers/gi, /test coverage/gi,
  /\b(?:add|write|create|require|keep|preserve)s? (?:a |new |focused |more |the |existing )?(?:unit |e2e |regression |integration )?(?:tests?|test files|test suites?)\b/gi,
  /\brun (?:the |all |your |existing |focused )?(?:unit |e2e |integration |regression )?tests\b/gi,
  /\b(?:vitest|jest|playwright test|node --test|pytest)\b/gi,
  /missing tests/gi, /\btest executor\b/gi,
  /\btestab(?:le|ility)\b/gi, /\btest (?:surface|seams?|locality)\b/gi, /\bunit\/contract\/integration\b/gi,
  /\bunit, integration\b/gi, /\bexecuted tests\b/gi,
]);

/**
 * The imperative subset of directiveTestInstructions that check-no-tests applies to product documents:
 * test commands (runner invocations included) and requests to write, keep or run tests. Mentions (bare
 * tool names, "testable", "test surface", coverage) describe rather than direct and stay release-gardener only.
 * @type {ReadonlyArray<RegExp>}
 */
export const documentTestDirectives = Object.freeze([
  /\b(?:pnpm|npm|yarn|bun)(?: run)? test(?::[\w-]+)?\b/gi, /then tests\b/gi, /focused tests/gi,
  /\b(?:add|write|create|require|keep|preserve)s? (?:a |new |focused |more |the |existing )?(?:unit |e2e |regression |integration )?(?:tests?|test files|test suites?)\b/gi,
  /\brun (?:the |all |your |existing |focused )?(?:unit |e2e |integration |regression )?tests\b/gi,
  /\brun (?:npx |bunx |yarn |pnpm (?:exec |dlx )?)?(?:vitest|jest|mocha|playwright test|node --test|pytest)\b/gi,
  /\b(?:npx|bunx|yarn|pnpm exec|pnpm dlx) (?:vitest|jest|mocha|playwright test)\b/gi,
]);

/**
 * A directive is allowed only when a negation sits directly before the matched action, with at most one
 * word between ("do not write a regression test").
 * @param {string} before Text of the line preceding the match.
 */
export const negatedClause = (/** @type {string} */ before) => /(?:\b(?:no|not|never|without|nor|avoid)\b|n't\b)(?:\s+\w+)?\s*$/i.test(before);

/**
 * Removes inline Markdown delimiters (code backticks, `**`/`__`/`*`/`_` emphasis, `[text](url)` links)
 * so negation matching sees the prose. Used only for matching; findings report the original line.
 * @param {string} line
 */
function stripInlineMarkdown(line) {
  return line
    .replaceAll(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replaceAll("`", "")
    .replaceAll(/\*+/gu, "")
    .replaceAll(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, "");
}

/**
 * Lines of `text` that direct an agent to write or run automated tests and are not negated.
 * @param {string} text
 * @param {ReadonlyArray<RegExp>} [patterns] Defaults to documentTestDirectives.
 * @returns {Array<{line: number, text: string}>} 1-based line numbers.
 */
export function findTestDirectives(text, patterns = documentTestDirectives) {
  /** @type {Array<{line: number, text: string}>} */
  const hits = [];
  text.split("\n").forEach((line, index) => {
    const plain = stripInlineMarkdown(line);
    const hit = patterns.some((pattern) =>
      [...plain.matchAll(pattern)].some((match) => !negatedClause(plain.slice(0, match.index))));
    if (hit) hits.push({ line: index + 1, text: line });
  });
  return hits;
}
