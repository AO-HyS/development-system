// @ts-check

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Bind live skill evidence to one exact installed catalog across the lock and
 * both harness mirrors.
 *
 * @param {{installedLock: unknown, codexCatalog: unknown, factoryCatalog: unknown}} input
 */
export function resolveSkillProbeMetadata(input) {
  const installedLock = record(input.installedLock) ? input.installedLock : {};
  const codexCatalog = record(input.codexCatalog) ? input.codexCatalog : {};
  const factoryCatalog = record(input.factoryCatalog) ? input.factoryCatalog : {};
  const sourceCommit = "sourceCommit" in installedLock ? installedLock.sourceCommit : undefined;
  if (typeof sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error("Installed skill lock has no exact source commit");
  }

  const versions = {
    lock: "catalogVersion" in installedLock ? installedLock.catalogVersion : undefined,
    codex: "catalogVersion" in codexCatalog ? codexCatalog.catalogVersion : undefined,
    factory: "catalogVersion" in factoryCatalog ? factoryCatalog.catalogVersion : undefined,
  };
  for (const [surface, version] of Object.entries(versions)) {
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`Installed ${surface} skill catalog has no valid version`);
    }
  }
  if (new Set(Object.values(versions)).size !== 1) {
    throw new Error("Installed skill catalog versions do not match across lock, Codex, and Factory");
  }

  return { sourceCommit, catalogVersion: versions.lock };
}
