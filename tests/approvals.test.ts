import { describe, expect, it } from "vitest";

import { approvalResponse, approvalSummary, approvalTitle, toPendingApproval } from "../src/approvals/model";
import type { ServerRequest } from "../src/generated/app-server/ServerRequest";

describe("approval model", () => {
  it("classifies command approvals and builds v2 decisions", () => {
    const request: ServerRequest = {
      id: 1,
      method: "item/commandExecution/requestApproval",
      params: {
        command: "npm run build",
        cwd: "/tmp/project",
        threadId: "thread",
        turnId: "turn",
        itemId: "item",
        startedAtMs: 1,
        reason: null,
        commandActions: [],
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: [],
      },
    };
    const approval = toPendingApproval(request);

    expect(approval).not.toBeNull();
    expect(approvalTitle(approval!)).toBe("Command approval");
    expect(approvalSummary(approval!)).toBe("npm run build");
    expect(approvalResponse(approval!, "accept-session")).toEqual({ decision: "acceptForSession" });
  });

  it("builds permission grants only for accept actions", () => {
    const request: ServerRequest = {
      id: 2,
      method: "item/permissions/requestApproval",
      params: {
        cwd: "/tmp/project",
        threadId: "thread",
        turnId: "turn",
        itemId: "item",
        startedAtMs: 1,
        reason: "Need network",
        permissions: { network: { enabled: true }, fileSystem: null },
      },
    };
    const approval = toPendingApproval(request)!;

    expect(approvalResponse(approval, "decline")).toEqual({ permissions: {}, scope: "turn" });
    expect(approvalResponse(approval, "accept")).toEqual({
      permissions: { network: { enabled: true } },
      scope: "turn",
    });
  });

  it("builds action responses for current approval families", () => {
    const requests: Array<{ request: ServerRequest; acceptSession: unknown; cancel: unknown }> = [
      {
        request: {
          id: 3,
          method: "item/commandExecution/requestApproval",
          params: {
            command: "npm test",
            cwd: "/tmp/project",
            threadId: "thread",
            turnId: "turn",
            itemId: "command",
            startedAtMs: 1,
            reason: null,
            commandActions: [],
            proposedExecpolicyAmendment: null,
            proposedNetworkPolicyAmendments: [],
          },
        },
        acceptSession: { decision: "acceptForSession" },
        cancel: { decision: "cancel" },
      },
      {
        request: {
          id: 4,
          method: "item/fileChange/requestApproval",
          params: {
            threadId: "thread",
            turnId: "turn",
            itemId: "file",
            startedAtMs: 1,
            reason: "write",
            grantRoot: "/tmp/project",
          },
        },
        acceptSession: { decision: "acceptForSession" },
        cancel: { decision: "cancel" },
      },
    ];

    for (const { request, acceptSession, cancel } of requests) {
      const approval = toPendingApproval(request)!;
      expect(approvalResponse(approval, "accept-session")).toEqual(acceptSession);
      expect(approvalResponse(approval, "cancel")).toEqual(cancel);
      expect(approvalResponse(approval, "decline")).toEqual({ decision: "decline" });
    }
  });
});
