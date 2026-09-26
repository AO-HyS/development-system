/** Automated test file and test runner configuration path patterns, in match order. */
export const TEST_FILE_PATTERN_SOURCES = Object.freeze([
  "(?:^|/)(?:__tests__|__snapshots__|tests?|e2e|cypress|[A-Za-z0-9_-]*Tests)/(?:[^/]+/)*[^/]+\\.(?:[cm]?[jt]sx?|py|go|swift|rb|snap|json)$",
  "\\.(?:test|spec)\\.[cm]?[jt]sx?$",
  "(?:^|/)[^/]*Tests?\\.swift$",
  "\\.snap$",
  "(?:^|/)(?:vitest|jest|playwright|cypress)\\.config\\.[cm]?[jt]s$",
  "(?:^|/)vitest\\.workspace\\.[cm]?[jt]s$",
  "(?:^|/)karma\\.conf\\.[cm]?js$",
  "(?:^|/)\\.mocharc(?:\\.[a-z]+)?$",
  "(?:^|/)(?:pytest\\.ini|conftest\\.py)$",
  "(?:^|/)test_[^/]*\\.py$",
  "_test\\.(?:py|go)$",
]);

/** @type {ReadonlyArray<RegExp>} */
export const TEST_FILE_PATTERNS = Object.freeze(TEST_FILE_PATTERN_SOURCES.map((source) => new RegExp(source)));

/**
 * @param {string} path Repository-relative path with forward slashes.
 * @returns {boolean}
 */
export function isTestPath(path) {
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(path));
}
