import { describe, expect, it } from "vitest";

import {
  approvalResponse,
  toPendingApproval,
  type CommandApprovalDecision,
} from "../../../../../src/features/chat/protocol/server-requests/approval";
import {
  approvalActionOptions,
  approvalDetails,
  approvalSummary,
  approvalTitle,
} from "../../../../../src/features/chat/conversation/pending-requests/approval-view";
import type { ServerRequest } from "../../../../../src/app-server/connection/rpc-messages";

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

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
        availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
      },
    };
    const approval = expectPresent(toPendingApproval(request));

    expect(approvalTitle(approval)).toBe("Command approval");
    expect(approvalSummary(approval)).toBe("npm run build");
    expect(approvalActionOptions(approval).map((option) => option.label)).toEqual(["Allow", "Allow session", "Deny", "Cancel"]);
    expect(approvalResponse(approval, expectPresent(approvalActionOptions(approval)[1]).action)).toEqual({ decision: "acceptForSession" });
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
        environmentId: null,
        startedAtMs: 1,
        reason: "Need network",
        permissions: { network: { enabled: true }, fileSystem: null },
      },
    };
    const approval = expectPresent(toPendingApproval(request));

    expect(approvalResponse(approval, "decline")).toEqual({ permissions: {}, scope: "turn" });
    expect(approvalResponse(approval, "accept")).toEqual({
      permissions: { network: { enabled: true } },
      scope: "turn",
    });
  });

  it("uses command approval decisions supplied by app-server", () => {
    const networkDecision = {
      applyNetworkPolicyAmendment: { network_policy_amendment: { host: "registry.npmjs.org", action: "allow" } },
    } satisfies CommandApprovalDecision;
    const request: ServerRequest = {
      id: 30,
      method: "item/commandExecution/requestApproval",
      params: {
        command: null,
        cwd: "/tmp/project",
        threadId: "thread",
        turnId: "turn",
        itemId: "command",
        startedAtMs: 1,
        reason: "Needs network access",
        networkApprovalContext: { host: "registry.npmjs.org", protocol: "https" },
        commandActions: [],
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: [],
        availableDecisions: [networkDecision, "decline"],
      },
    };
    const approval = expectPresent(toPendingApproval(request));
    const options = approvalActionOptions(approval);

    expect(options.map((option) => option.label)).toEqual(["Allow network rule", "Deny"]);
    expect(approvalResponse(approval, expectPresent(options[0]).action)).toEqual({ decision: networkDecision });
    expect(approvalResponse(approval, expectPresent(options[1]).action)).toEqual({ decision: "decline" });
  });

  it("falls back to generic command approval actions when app-server omits decisions", () => {
    const approval = expectPresent(
      toPendingApproval({
        id: 31,
        method: "item/commandExecution/requestApproval",
        params: {
          command: "npm run build",
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
      }),
    );

    expect(approvalActionOptions(approval).map((option) => option.label)).toEqual(["Allow", "Allow session", "Deny", "Cancel"]);
    expect(approvalResponse(approval, "accept-session")).toEqual({ decision: "acceptForSession" });
  });

  it("shows approval reasons first in pending request summaries", () => {
    const command = expectPresent(
      toPendingApproval({
        id: 20,
        method: "item/commandExecution/requestApproval",
        params: {
          command: "npm run build",
          cwd: "/tmp/project",
          threadId: "thread",
          turnId: "turn",
          itemId: "command",
          startedAtMs: 1,
          reason: "Needs unsandboxed access",
          commandActions: [],
          proposedExecpolicyAmendment: null,
          proposedNetworkPolicyAmendments: [],
        },
      }),
    );
    const fileChange = expectPresent(
      toPendingApproval({
        id: 21,
        method: "item/fileChange/requestApproval",
        params: {
          threadId: "thread",
          turnId: "turn",
          itemId: "file",
          startedAtMs: 1,
          reason: "Write outside workspace",
          grantRoot: "/tmp/project",
        },
      }),
    );
    const permissions = expectPresent(
      toPendingApproval({
        id: 22,
        method: "item/permissions/requestApproval",
        params: {
          cwd: "/tmp/project",
          threadId: "thread",
          turnId: "turn",
          itemId: "permissions",
          environmentId: null,
          startedAtMs: 1,
          reason: "Need network",
          permissions: { network: { enabled: true }, fileSystem: null },
        },
      }),
    );

    expect(approvalSummary(command)).toBe("Needs unsandboxed access\nnpm run build");
    expect(approvalSummary(fileChange)).toBe("Write outside workspace\ngrant root: /tmp/project");
    expect(approvalSummary(permissions).startsWith("Need network\ncwd: /tmp/project")).toBe(true);
  });

  it("keeps approval details semantic and omits raw payloads", () => {
    const approval = expectPresent(
      toPendingApproval({
        id: 23,
        method: "item/permissions/requestApproval",
        params: {
          cwd: "/tmp/project",
          threadId: "thread",
          turnId: "turn",
          itemId: "permissions",
          environmentId: null,
          startedAtMs: 1,
          reason: "Need network",
          permissions: { network: { enabled: true }, fileSystem: null },
        },
      }),
    );

    expect(approvalDetails(approval)).toEqual([
      { key: "reason", value: "Need network" },
      { key: "cwd", value: "/tmp/project" },
      { key: "network", value: "enabled" },
    ]);
  });

  it("omits empty approval detail rows", () => {
    const approval = expectPresent(
      toPendingApproval({
        id: 24,
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
      }),
    );

    expect(approvalDetails(approval)).toEqual([
      { key: "command", value: "npm test" },
      { key: "cwd", value: "/tmp/project" },
    ]);
  });

  it("builds action responses for current approval families", () => {
    const requests: { request: ServerRequest; acceptSession: unknown; cancel: unknown }[] = [
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
            availableDecisions: ["acceptForSession", "cancel", "decline"],
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
      const approval = expectPresent(toPendingApproval(request));
      if (approval.method === "item/commandExecution/requestApproval") {
        const options = approvalActionOptions(approval);
        expect(approvalResponse(approval, expectPresent(options[0]).action)).toEqual(acceptSession);
        expect(approvalResponse(approval, expectPresent(options[1]).action)).toEqual(cancel);
        expect(approvalResponse(approval, expectPresent(options[2]).action)).toEqual({ decision: "decline" });
      } else {
        expect(approvalResponse(approval, "accept-session")).toEqual(acceptSession);
        expect(approvalResponse(approval, "cancel")).toEqual(cancel);
        expect(approvalResponse(approval, "decline")).toEqual({ decision: "decline" });
      }
    }
  });
});
