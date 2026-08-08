import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createT3ImplementationHandoff,
  prepareTicketPublication,
  publishApprovedTickets,
  validateVerticalTicketSlices,
  verifyT3HandoffFreshness,
} from "../src/working-backwards-handoff.mjs";
import { createWorkingBackwardsGateReceipt } from "../src/working-backwards-gates.mjs";

const repository = { identity: "acme/example", baseRevision: "abc123" };
/** @param {unknown} value @returns {unknown} */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stable(entry)]));
}
/** @param {unknown} value */
function hash(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stable(value))).digest("hex")}`;
}
const ticketMap = {
  status: "approved",
  tickets: [
    { id: "slice-a", title: "Visible result", outcome: "The user sees the result", acceptanceCriteria: ["The result is shown"], checks: ["focused slice test"], dependsOn: [], fitsFreshContext: true, demonstrable: true },
    { id: "slice-b", title: "Follow-up result", outcome: "The user can refine the result", acceptanceCriteria: ["Refinement is retained"], dependsOn: ["slice-a"], fitsFreshContext: true, verifiable: true },
  ],
};
const artifacts = [
  ["product-contract", { outcome: "approved" }],
  ["domain-technical-design", { design: "approved" }],
  ["structure-outline", { slices: ["slice-a", "slice-b"] }],
  ["ticket-map", ticketMap],
].map(([role, content]) => ({ id: `WB:${role}`, role, status: "approved", content, contentHash: hash(content), sourceRevision: "abc123", lineage: { dependsOn: [], governedBy: [], sourceRevision: "abc123" } }));
const gateReceipts = ["product", "technical", "implementationMap"].map((gate) => createWorkingBackwardsGateReceipt({ workflowId: "WB", gate, repositoryRevision: "abc123", artifacts, approvedAt: "2026-08-08T00:00:00.000Z" }));

test("vertical slices expose dependency order, native blockers, and frontier", () => {
  const result = validateVerticalTicketSlices(ticketMap);

  assert.equal(result.ok, true);
  assert.deepEqual(result.dependencyOrder, ["slice-a", "slice-b"]);
  assert.deepEqual(result.frontier, ["slice-a"]);
  assert.deepEqual(result.blockingEdges, [{ from: "slice-a", to: "slice-b" }]);
});
test("publication intent is deterministic and has no external or implementation authority", () => {
  const first = prepareTicketPublication({ ticketMap, approvedArtifacts: artifacts, repository, workflowId: "WB", gateReceipts });
  const second = prepareTicketPublication({ ticketMap, approvedArtifacts: artifacts, repository, workflowId: "WB", gateReceipts });

  assert.equal(first.ok, true);
  assert.equal(first.intentId, second.intentId);
  assert.deepEqual(first.externalSideEffects, []);
  assert.equal(first.publicationAuthorized, false);
  assert.equal(first.implementationAuthorized, false);
  assert.equal(first.pushAuthorized, false);
});

test("explicit publication creates issues in dependency order and never grants delivery", async () => {
  const intent = prepareTicketPublication({ ticketMap, approvedArtifacts: artifacts, repository, workflowId: "WB", gateReceipts });
  const calls = [];
  const publication = await publishApprovedTickets({
    intent,
    publicationApproval: { authorized: true, intentId: intent.intentId },
    authority: { async consumeIntent() { return true; } },
    tracker: {
      async createIssue(issue) {
        calls.push(issue);
        return { id: `LIN-${calls.length}`, status: "ready-for-agent" };
      },
    },
  });

  assert.deepEqual(calls.map((call) => call.sliceId), ["slice-a", "slice-b"]);
  assert.deepEqual(calls[1].dependsOn, ["LIN-1"]);
  assert.equal(publication.publicationAuthorized, true);
  assert.equal(publication.implementationAuthorized, false);
  assert.equal(publication.repositoryWritesAuthorized, false);
  assert.equal(publication.promotionAuthorized, false);
});

test("handoff is private, compact, and still requires Implement Preview", () => {
  const intent = prepareTicketPublication({ ticketMap, approvedArtifacts: artifacts, repository, workflowId: "WB", gateReceipts });
  const handoff = createT3ImplementationHandoff({
    intent,
    ticketMap,
    approvedArtifacts: artifacts,
    gateReceipts,
    repository,
    trackerState: { status: "published", issues: [{ sliceId: "slice-a", id: "LIN-1", status: "ready-for-agent" }, { sliceId: "slice-b", id: "LIN-2", status: "blocked" }] },
    checks: ["focused slice test", "typecheck"],
    risks: ["tracker state must remain current"],
  });

  assert.equal(handoff.visibility, "private");
  assert.deepEqual(handoff.approvedArtifacts.map((artifact) => artifact.id), artifacts.map((artifact) => artifact.id));
  assert.equal(handoff.repository.identity, repository.identity);
  assert.equal(handoff.repository.baseRevision, repository.baseRevision);
  assert.deepEqual(handoff.frontier, ["slice-a"]);
  assert.equal(handoff.firstTerminalSliceId, "slice-a");
  assert.equal(handoff.implementationAuthorized, false);
  assert.equal(handoff.requiresImplementPreview, true);
  assert.deepEqual(handoff.externalSideEffects, []);
});

test("freshness verification fails closed on repository, tracker, and artifact drift", () => {
  const intent = prepareTicketPublication({ ticketMap, approvedArtifacts: artifacts, repository, workflowId: "WB", gateReceipts });
  const trackerState = { status: "published", issues: [{ sliceId: "slice-a", id: "LIN-1", status: "ready-for-agent" }, { sliceId: "slice-b", id: "LIN-2", status: "blocked" }] };
  const handoff = createT3ImplementationHandoff({ intent, ticketMap, approvedArtifacts: artifacts, gateReceipts, repository, trackerState });
  const stale = verifyT3HandoffFreshness({
    handoff,
    repository: { identity: repository.identity, baseRevision: "different" },
    trackerState: { ...trackerState, issues: [...trackerState.issues, { sliceId: "slice-c", id: "LIN-3", status: "ready-for-agent" }] },
    approvedArtifacts: [{ ...artifacts[0], status: "approved", contentHash: "sha256:changed" }, artifacts[1]],
    gateReceipts,
  });

  assert.equal(stale.ok, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.requiresRefresh, true);
  assert.equal(stale.implementationAuthorized, false);
  assert.match(stale.drift.join(" "), /repository base revision drift/);
  assert.match(stale.drift.join(" "), /tracker state drift/);
  assert.match(stale.drift.join(" "), /governing artifact drift/);
});

test("publication approval is not implied and denied publication does not call tracker", async () => {
  const intent = prepareTicketPublication({ ticketMap, approvedArtifacts: artifacts, repository, workflowId: "WB", gateReceipts });
  let calls = 0;
  await assert.rejects(
    publishApprovedTickets({ intent, tracker: { async createIssue() { calls += 1; return { id: "never" }; } } }),
    /Explicit ticket publication authorization must bind the exact intent ID/,
  );
  assert.equal(calls, 0);
});
