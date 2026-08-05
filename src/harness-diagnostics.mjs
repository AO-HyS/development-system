// @ts-check

/**
 * Classify a failed harness process without persisting raw provider output.
 * @param {{harness:string, exitCode:number|null, stdout?:string, stderr?:string, errorCode?:string|null}} observation
 */
export function classifyHarnessFailure(observation) {
  if (observation.exitCode === 0 && !observation.errorCode) return null;
  const combined = `${observation.stdout ?? ""}\n${observation.stderr ?? ""}`;
  const base = { harness: observation.harness, exitCode: observation.exitCode, retryable: true };

  if (/Authentication failed|Please log in using \/login|FACTORY_API_KEY|Not logged in/i.test(combined)) {
    return {
      ...base,
      code: observation.harness === "factory" ? "FACTORY_AUTH_REQUIRED" : "HARNESS_AUTH_REQUIRED",
      category: "authentication",
      summary: observation.harness === "factory"
        ? "Factory authentication is required; run /login in the exact probed binary or provide a valid FACTORY_API_KEY."
        : "Harness authentication is required for the exact probed binary.",
    };
  }
  if (observation.errorCode === "ETIMEDOUT") {
    return { ...base, code: "HARNESS_TIMEOUT", category: "timeout", summary: "Harness execution exceeded its operational deadline." };
  }
  if (observation.errorCode === "ENOENT") {
    return { ...base, code: "HARNESS_BINARY_MISSING", category: "binary", retryable: false, summary: "The configured harness executable does not exist." };
  }
  if (/EACCES|permission denied|operation not permitted/i.test(combined)) {
    return { ...base, code: "HARNESS_PERMISSION_DENIED", category: "permission", retryable: false, summary: "The harness process lacks permission to execute the requested probe." };
  }
  return {
    ...base,
    code: "HARNESS_RUNTIME_FAILED",
    category: "runtime",
    summary: "The harness process exited unsuccessfully; inspect the local provider log without publishing secrets.",
  };
}

/**
 * Classify an exit-zero probe whose required behavioral assertion was not observed.
 * @param {{harness:string, catalogued:boolean, loaded:boolean, influenced:boolean}} observation
 */
export function classifyProbeAssertionFailure(observation) {
  const base = { harness: observation.harness, exitCode: 0, retryable: true };
  if (!observation.catalogued) {
    return { ...base, code: "HARNESS_CATALOG_ASSERTION_FAILED", category: "catalog", summary: "The harness exited successfully but did not expose the required skill in its catalog response." };
  }
  if (!observation.loaded) {
    return { ...base, code: "HARNESS_LOAD_ASSERTION_FAILED", category: "load", summary: "The harness exited successfully but did not prove that it loaded the required skill." };
  }
  if (!observation.influenced) {
    return { ...base, code: "HARNESS_INFLUENCE_ASSERTION_FAILED", category: "influence", summary: "The harness exited successfully but the required skill behavior signature was absent." };
  }
  return null;
}

/**
 * Keep live response text only when every subprocess for that harness succeeded.
 * @param {{response:string, catalogResponse:string, scannerErrors:string[], failures:Array<unknown>}} evidence
 */
export function sanitizeProbeEvidence(evidence) {
  if (evidence.failures.some(Boolean)) {
    return { response: "", catalogResponse: "", scannerErrors: [] };
  }
  return {
    response: evidence.response,
    catalogResponse: evidence.catalogResponse,
    scannerErrors: evidence.scannerErrors,
  };
}
