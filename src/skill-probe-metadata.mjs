// @ts-check

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Bind live skill evidence to one exact installed catalog across the lock and
 * the Codex surface. T3 Code consumes the same Codex-compatible installation
 * and therefore does not maintain a second catalog mirror.
 *
 * @param {{installedLock: unknown, codexCatalog: unknown}} input
 */
export function resolveSkillProbeMetadata(input) {
  const installedLock = record(input.installedLock) ? input.installedLock : {};
  const codexCatalog = record(input.codexCatalog) ? input.codexCatalog : {};
  const sourceCommit = "sourceCommit" in installedLock ? installedLock.sourceCommit : undefined;
  if (typeof sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error("Installed skill lock has no exact source commit");
  }

  const versions = {
    lock: "catalogVersion" in installedLock ? installedLock.catalogVersion : undefined,
    codex: "catalogVersion" in codexCatalog ? codexCatalog.catalogVersion : undefined,
  };
  for (const [surface, version] of Object.entries(versions)) {
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`Installed ${surface} skill catalog has no valid version`);
    }
  }
  if (new Set(Object.values(versions)).size !== 1) {
    throw new Error("Installed skill catalog versions do not match across lock and Codex");
  }

  return { sourceCommit, catalogVersion: /** @type {string} */ (versions.lock) };
}
