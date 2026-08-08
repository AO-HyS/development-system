import assert from "node:assert/strict";
import test from "node:test";

import {
  createT3ImplementationHandoff,
  prepareTicketPublication,
  publishApprovedTickets,
  validateVerticalTicketSlices,
  verifyT3HandoffFreshness,
} from "../src/working-backwards-handoff.mjs";

const repository = { identity: "acme/example", baseRevision: "abc123" };
const artifacts = [
  { id: "WB:structure-outline", role: "structure-outline", status: "approved", contentHash: "sha256:outline" },
  { id: "WB:ticket-map", role: "ticket-map", status: "approved", contentHash: "sha256:tickets" },
];
const ticketMap = {
  status: "approved",
  tickets: [
    { id: "slice-a", title: "Visible result", outcome: "The user sees the result", acceptanceCriteria: ["The result is shown"], checks: ["focused slice test"], dependsOn: [] },
    { id: "slice-b", title: "Follow-up result", outcome: "The user can refine the result", acceptanceCriteria: ["Refinement is retained"], dependsOn: ["slice-a"] },
  ],
};

test("vertical slices expose dependency order, native blockers, and frontier", () => {
  const result = validateVerticalTicketSlices(ticketMap);

  assert.equal(result.ok, true);
  assert.deepEqual(result.dependencyOrder, ["slice-a", "slice-b"]);
  assert.deepEqual(result.frontier, ["slice-a"]);
  assert.deepEqual(result.blockingEdges, [{ from: "slice-a", to: "slice-b" }]);
});

test("publication intent is deterministic and has no external or implementation authority", () => {
  const first = prepareTicketPublication({ ticketMap, approvedArtifacts: artifacts, repository, workflowId: "WB" });
  const second = prepareTicketPublication({ ticketMap, approvedArtifacts: artifacts, repository, workflowId: "WB" });

  assert.equal(first.ok, true);
  assert.equal(first.intentId, second.intentId);
  assert.deepEqual(first.externalSideEffects, []);
  assert.equal(first.publicationAuthorized, false);
  assert.equal(first.implementationAuthorized, false);
  assert.equal(first.pushAuthorized, false);
});

test("explicit publication creates issues in dependency order and never grants delivery", async () => {
  const intent = prepareTicketPublication({ ticketMap, approvedArtifacts: artifacts, repository, workflowId: "WB" });
  const calls = [];
  const publication = await publishApprovedTickets({
    intent,
    publicationApproval: true,
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
  const intent = prepareTicketPublication({ ticketMap, approvedArtifacts: artifacts, repository, workflowId: "WB" });
  const handoff = createT3ImplementationHandoff({
    intent,
    ticketMap,
    approvedArtifacts: artifacts,
    repository,
    trackerState: { status: "published", issues: [{ sliceId: "slice-a", id: "LIN-1", status: "ready-for-agent" }, { sliceId: "slice-b", id: "LIN-2", status: "blocked" }] },
    checks: ["focused slice test", "typecheck"],
    risks: ["tracker state must remain current"],
  });

  assert.equal(handoff.visibility, "private");
  assert.deepEqual(handoff.approvedArtifacts.map((artifact) => artifact.id), ["WB:structure-outline", "WB:ticket-map"]);
  assert.equal(handoff.repository.identity, repository.identity);
  assert.equal(handoff.repository.baseRevision, repository.baseRevision);
  assert.deepEqual(handoff.frontier, ["slice-a"]);
  assert.equal(handoff.firstTerminalSliceId, "slice-a");
  assert.equal(handoff.implementationAuthorized, false);
  assert.equal(handoff.requiresImplementPreview, true);
  assert.deepEqual(handoff.externalSideEffects, []);
});

test("freshness verification fails closed on repository, tracker, and artifact drift", () => {
  const intent = prepareTicketPublication({ ticketMap, approvedArtifacts: artifacts, repository, workflowId: "WB" });
  const trackerState = { status: "published", issues: [{ sliceId: "slice-a", id: "LIN-1", status: "ready-for-agent" }, { sliceId: "slice-b", id: "LIN-2", status: "blocked" }] };
  const handoff = createT3ImplementationHandoff({ intent, ticketMap, approvedArtifacts: artifacts, repository, trackerState });
  const stale = verifyT3HandoffFreshness({
    handoff,
    repository: { identity: repository.identity, baseRevision: "different" },
    trackerState: { ...trackerState, issues: [...trackerState.issues, { sliceId: "slice-c", id: "LIN-3", status: "ready-for-agent" }] },
    approvedArtifacts: [{ ...artifacts[0], status: "approved", contentHash: "sha256:changed" }, artifacts[1]],
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
  const intent = prepareTicketPublication({ ticketMap, approvedArtifacts: artifacts, repository });
  let calls = 0;
  await assert.rejects(
    publishApprovedTickets({ intent, tracker: { async createIssue() { calls += 1; return { id: "never" }; } } }),
    /Explicit ticket publication authorization/,
  );
  assert.equal(calls, 0);
});

