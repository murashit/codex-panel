import { describe, expect, it } from "vitest";
import type { ServerRequest } from "../../../../../src/app-server/connection/rpc-messages";
import {
  type ApprovalServerRequest,
  createApprovalRequestCoordinator,
} from "../../../../../src/features/chat/app-server/inbound/approval-request-coordinator";

describe("approval request coordinator", () => {
  it("coalesces only one verified parent-child pair", () => {
    const coordinator = createApprovalRequestCoordinator();
    const child = commandApprovalRequest(1, "child-a", "child-turn-a", "command");
    const sibling = commandApprovalRequest(2, "child-b", "child-turn-b", "command");
    const parent = commandApprovalRequest(3, "parent", "parent-turn", "command");

    expect(coordinator.register(child, "tracked-subagent", "parent-turn").kind).toBe("new");
    expect(coordinator.register(sibling, "tracked-subagent", "parent-turn").kind).toBe("new");
    expect(coordinator.register(parent, "active", "parent-turn").kind).toBe("new");
  });

  it("uses approvalId to distinguish callbacks that share an item", () => {
    const coordinator = createApprovalRequestCoordinator();
    const child = commandApprovalRequest(1, "child", "child-turn", "command", "callback-a");
    const parent = commandApprovalRequest(2, "parent", "parent-turn", "command", "callback-b");

    coordinator.register(child, "tracked-subagent", "parent-turn");

    expect(coordinator.register(parent, "active", "parent-turn").kind).toBe("new");
  });

  it("coalesces the child copy when the parent request arrives first", () => {
    const coordinator = createApprovalRequestCoordinator();
    const parent = commandApprovalRequest(1, "parent", "parent-turn", "command");
    const child = commandApprovalRequest(2, "child", "child-turn", "command");

    coordinator.register(parent, "active", "parent-turn");

    expect(coordinator.register(child, "tracked-subagent", "parent-turn")).toEqual({
      kind: "coalesced",
      logicalRequestId: 1,
    });
  });

  it("does not coalesce requests with incompatible decision mappings", () => {
    const coordinator = createApprovalRequestCoordinator();
    const child = commandApprovalRequest(1, "child", "child-turn", "command");
    const parent = commandApprovalRequest(2, "parent", "parent-turn", "command", null, ["decline", "cancel"]);

    coordinator.register(child, "tracked-subagent", "parent-turn");

    expect(coordinator.register(parent, "active", "parent-turn").kind).toBe("new");
  });

  it("locks one decision and maps it through a late twin request", () => {
    const coordinator = createApprovalRequestCoordinator();
    const child = commandApprovalRequest(1, "child", "child-turn", "command");
    const parent = commandApprovalRequest(2, "parent", "parent-turn", "command");
    coordinator.register(child, "tracked-subagent", "parent-turn");

    const plan = coordinator.decide(1, "decline");
    expect(plan).toEqual({ action: "decline", deliveries: [{ requestId: 1, response: { decision: "decline" } }] });
    coordinator.markSettled(1);
    coordinator.markUiResolved(1);

    expect(coordinator.register(parent, "active", "parent-turn")).toEqual({
      kind: "answered",
      deliveries: [{ requestId: 2, response: { decision: "decline" } }],
    });
  });

  it("retains only unsettled endpoints after a partial delivery", () => {
    const coordinator = createApprovalRequestCoordinator();
    const child = commandApprovalRequest(1, "child", "child-turn", "command");
    const parent = commandApprovalRequest(2, "parent", "parent-turn", "command");
    coordinator.register(child, "tracked-subagent", "parent-turn");
    coordinator.register(parent, "active", "parent-turn");

    coordinator.decide(1, "accept");
    coordinator.markSettled(1);
    coordinator.markUiResolved(1);

    expect(coordinator.automaticDeliveries()).toEqual([{ requestId: 2, response: { decision: "accept" } }]);
  });

  it("reports unresolved UI state when the parent turn changes", () => {
    const coordinator = createApprovalRequestCoordinator();
    const child = commandApprovalRequest(1, "child", "child-turn", "command");
    coordinator.register(child, "tracked-subagent", "parent-turn");

    expect(coordinator.reconcile("next-turn", new Set([1]))).toEqual([1]);

    expect(coordinator.decide(1, "decline")).toBeNull();
  });

  it("silently drops completed transport state when the parent turn changes", () => {
    const coordinator = createApprovalRequestCoordinator();
    const child = commandApprovalRequest(1, "child", "child-turn", "command");
    coordinator.register(child, "tracked-subagent", "parent-turn");
    coordinator.decide(1, "accept");
    coordinator.markSettled(1);
    coordinator.markUiResolved(1);

    expect(coordinator.reconcile("next-turn", new Set())).toEqual([]);

    expect(coordinator.automaticDeliveries()).toEqual([]);
    expect(coordinator.decide(1, "decline")).toBeNull();
  });
});

function commandApprovalRequest(
  id: number,
  threadId: string,
  turnId: string,
  itemId: string,
  approvalId: string | null = null,
  availableDecisions: Extract<
    ApprovalServerRequest,
    { method: "item/commandExecution/requestApproval" }
  >["params"]["availableDecisions"] = ["accept", "acceptForSession", "decline", "cancel"],
): ApprovalServerRequest {
  return {
    id,
    method: "item/commandExecution/requestApproval",
    params: {
      kind: "command",
      command: "npm test",
      cwd: "/tmp/project",
      threadId,
      turnId,
      itemId,
      approvalId,
      environmentId: null,
      startedAtMs: 1,
      reason: null,
      commandActions: [],
      proposedExecpolicyAmendment: null,
      proposedNetworkPolicyAmendments: [],
      availableDecisions,
    },
  } satisfies Extract<ServerRequest, { method: "item/commandExecution/requestApproval" }>;
}
