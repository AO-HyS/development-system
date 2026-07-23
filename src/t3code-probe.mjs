// @ts-check

export const requiredT3CodeLifecycleSkills = [
  "wayfinder",
  "grill-with-docs",
  "to-spec",
  "to-tickets",
  "flow-implement",
  "flow-code-review",
];

/** @param {any} report */
export function evaluateT3CodeProbe(report) {
  const observed = report?.observed ?? {};
  const skillAuditHealthy =
    observed.skillAuditHealthy === true ||
    observed.skillAuditHealthy?.healthy === true;
  return (
    observed.routerLoaded === true &&
    skillAuditHealthy &&
    Array.isArray(observed.lifecycleSkills) &&
    requiredT3CodeLifecycleSkills.every((skill) => observed.lifecycleSkills.includes(skill)) &&
    observed.influenceSignatures &&
    requiredT3CodeLifecycleSkills.every((skill) =>
      typeof observed.influenceSignatures[skill] === "string" &&
      observed.influenceSignatures[skill].length > 0
    ) &&
    observed.model === report?.requestedModel?.model &&
    report?.externalState?.gitHeadUnchanged === true &&
    report?.externalState?.gitStatusUnchanged === true
  );
}
