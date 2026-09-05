import { describe, expect, it } from "vitest";
import type { ServerRequest } from "../../../../../../src/app-server/connection/rpc-messages";
import {
  appServerApprovalResponse as approvalResponse,
  appServerApprovalRequest as toPendingApproval,
} from "../../../../../../src/features/chat/app-server/inbound/server-request-adapter";
import type { PendingApproval } from "../../../../../../src/features/chat/domain/pending-requests/model";

type ApprovalRequest = Extract<
  ServerRequest,
  { method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" | "item/permissions/requestApproval" }
>;

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

function approvalActionOptions(approval: PendingApproval) {
  return approval.actionOptions ?? [];
}

function approvalActionLabels(approval: NonNullable<ReturnType<typeof toPendingApproval>>): (string | null)[] {
  return approvalActionOptions(approval).map((option) => option.label);
}

function approvalResponseAt(request: ApprovalRequest, approval: NonNullable<ReturnType<typeof toPendingApproval>>, index: number): unknown {
  const option = expectPresent(approvalActionOptions(approval)[index]);
  return approvalResponse(request, option.action);
}

describe("approval model", () => {
  it("classifies command approvals and builds v2 decisions", () => {
    const request: ApprovalRequest = {
      id: 1,
      method: "item/commandExecution/requestApproval",
      params: {
        kind: "command",
        command: "npm run build",
        cwd: "/tmp/project",
        threadId: "thread",
        turnId: "turn",
        itemId: "item",
        environmentId: null,
        startedAtMs: 1,
        reason: null,
        commandActions: [],
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: [],
        availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
      },
    };
    const approval = expectPresent(toPendingApproval(request));

    expect(approval.title).toBe("Command approval");
    expect(approval.summary).toBe("npm run build");
    expect(approvalActionLabels(approval)).toEqual(["Allow", "Allow session", "Deny", "Cancel"]);
    expect(approvalResponseAt(request, approval, 1)).toEqual({ decision: "acceptForSession" });
  });

  it("distinguishes terminal input approvals from new command execution", () => {
    const request: ApprovalRequest = {
      id: 34,
      method: "item/commandExecution/requestApproval",
      params: {
        kind: "writeStdin",
        threadId: "thread",
        turnId: "turn",
        itemId: "command",
        approvalId: "approval-1",
        environmentId: null,
        startedAtMs: 1,
      },
    };

    const approval = expectPresent(toPendingApproval(request));
    expect(approval).toMatchObject({
      title: "Terminal input approval",
      summary: "Terminal input requested.",
      resultSummary: "Terminal input requested.",
    });
  });

  it("builds permission grants only for accept actions", () => {
    const request: ApprovalRequest = {
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
    expect(approvalResponse(request, "decline")).toEqual({ permissions: {}, scope: "turn" });
    expect(approvalResponse(request, "accept")).toEqual({
      permissions: { network: { enabled: true } },
      scope: "turn",
    });
  });

  it("normalizes omitted file change optional fields before display", () => {
    const approval = expectPresent(
      toPendingApproval({
        id: 29,
        method: "item/fileChange/requestApproval",
        params: {
          threadId: "thread",
          turnId: "turn",
          itemId: "file",
          startedAtMs: 1,
        },
      } as unknown as ServerRequest),
    );

    expect(approval).toMatchObject({ kind: "fileChange", title: "File change approval" });
    expect(approval.summary).toBe("Allow file changes?");
    expect(approval.details).toEqual([]);
  });

  it("uses command approval decisions supplied by app-server", () => {
    const allowRegistryDecision = {
      applyNetworkPolicyAmendment: { network_policy_amendment: { host: "registry.npmjs.org", action: "allow" } },
    } as const;
    const allowApiDecision = {
      applyNetworkPolicyAmendment: { network_policy_amendment: { host: "api.github.com", action: "allow" } },
    } as const;
    const request: ApprovalRequest = {
      id: 30,
      method: "item/commandExecution/requestApproval",
      params: {
        kind: "command",
        command: null,
        cwd: "/tmp/project",
        threadId: "thread",
        turnId: "turn",
        itemId: "command",
        environmentId: null,
        startedAtMs: 1,
        reason: "Needs network access",
        networkApprovalContext: { host: "registry.npmjs.org", protocol: "https" },
        commandActions: [],
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: [],
        availableDecisions: [allowRegistryDecision, allowApiDecision, "decline"],
      },
    };
    const approval = expectPresent(toPendingApproval(request));
    const options = approvalActionOptions(approval);

    expect(options.map((option) => option.label)).toEqual(["Allow network rule", "Allow network rule", "Deny"]);
    expect(new Set(options.map((option) => option.id)).size).toBe(options.length);
    for (const option of options) {
      expect(option.action).toMatchObject({ kind: "approval-option", optionId: option.id });
      expect(option.action).not.toHaveProperty("response");
    }
    expect(approvalResponseAt(request, approval, 0)).toEqual({ decision: allowRegistryDecision });
    expect(approvalResponseAt(request, approval, 1)).toEqual({ decision: allowApiDecision });
    expect(approvalResponseAt(request, approval, 2)).toEqual({ decision: "decline" });
  });

  it("preserves amendment intent alongside command approval responses", () => {
    const allowNetworkDecision = {
      applyNetworkPolicyAmendment: { network_policy_amendment: { host: "registry.npmjs.org", action: "allow" } },
    } as const;
    const denyNetworkDecision = {
      applyNetworkPolicyAmendment: { network_policy_amendment: { host: "example.com", action: "deny" } },
    } as const;
    const acceptExecpolicyDecision = {
      acceptWithExecpolicyAmendment: { execpolicy_amendment: ["npm", "test"] as string[] },
    } as const;
    const request: ApprovalRequest = {
      id: 33,
      method: "item/commandExecution/requestApproval",
      params: {
        kind: "command",
        command: "npm test",
        cwd: "/tmp/project",
        threadId: "thread",
        turnId: "turn",
        itemId: "command",
        environmentId: null,
        startedAtMs: 1,
        reason: null,
        commandActions: [],
        proposedExecpolicyAmendment: ["npm", "test"],
        proposedNetworkPolicyAmendments: [
          { host: "registry.npmjs.org", action: "allow" },
          { host: "example.com", action: "deny" },
        ],
        availableDecisions: [allowNetworkDecision, denyNetworkDecision, acceptExecpolicyDecision],
      },
    };
    const approval = expectPresent(toPendingApproval(request));
    const options = approvalActionOptions(approval);

    expect(options).toEqual([
      expect.objectContaining({
        label: "Allow network rule",
        action: {
          kind: "approval-option",
          optionId: options[0]?.id,
          intent: "accept-session",
        },
      }),
      expect.objectContaining({
        label: "Deny network rule",
        action: {
          kind: "approval-option",
          optionId: options[1]?.id,
          intent: "decline",
        },
      }),
      expect.objectContaining({
        label: "Allow rule",
        action: {
          kind: "approval-option",
          optionId: options[2]?.id,
          intent: "accept-session",
        },
      }),
    ]);
  });

  it("keeps future simple command decisions renderable", () => {
    const futureDecision = "restartWithNetwork";
    const request = {
      id: 32,
      method: "item/commandExecution/requestApproval",
      params: {
        kind: "command",
        command: null,
        cwd: "/tmp/project",
        threadId: "thread",
        turnId: "turn",
        itemId: "command",
        environmentId: null,
        startedAtMs: 1,
        reason: null,
        commandActions: [],
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: [],
        availableDecisions: [futureDecision],
      },
    } as unknown as ApprovalRequest;
    const approval = expectPresent(toPendingApproval(request));
    const options = approvalActionOptions(approval);

    expect(options).toEqual([
      {
        id: "approval-option:0:restartWithNetwork",
        label: "Choose",
        action: { kind: "approval-option", optionId: "approval-option:0:restartWithNetwork", intent: "decline" },
      },
    ]);
    expect(approvalResponseAt(request, approval, 0)).toEqual({ decision: futureDecision });
  });

  it("returns server-offered amendments unchanged without interpreting their opaque payload", () => {
    const decision = { acceptWithExecpolicyAmendment: { futureRule: { tokens: ["npm", "test"] } } };
    const request = {
      id: 35,
      method: "item/commandExecution/requestApproval",
      params: {
        kind: "writeStdin",
        threadId: "thread",
        turnId: "turn",
        itemId: "command",
        environmentId: null,
        startedAtMs: 1,
        availableDecisions: [decision],
      },
    } as unknown as ApprovalRequest;
    const approval = expectPresent(toPendingApproval(request));
    const option = expectPresent(approvalActionOptions(approval)[0]);

    expect(option).toMatchObject({ label: "Allow rule", action: { intent: "accept-session" } });
    expect(approvalResponse(request, option.action)).toEqual({ decision });
  });

  it("adapts a generic command approval decision when app-server omits decisions", () => {
    const request: ApprovalRequest = {
      id: 31,
      method: "item/commandExecution/requestApproval",
      params: {
        kind: "command",
        command: "npm run build",
        cwd: "/tmp/project",
        threadId: "thread",
        turnId: "turn",
        itemId: "command",
        environmentId: null,
        startedAtMs: 1,
        reason: null,
        commandActions: [],
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: [],
      },
    } as ApprovalRequest;
    const approval = expectPresent(toPendingApproval(request));

    expect(approval.actionOptions).toBeNull();
    expect(approvalResponse(request, "accept-session")).toEqual({ decision: "acceptForSession" });
  });

  it("shows approval reasons first in pending request summaries", () => {
    const command = expectPresent(
      toPendingApproval({
        id: 20,
        method: "item/commandExecution/requestApproval",
        params: {
          kind: "command",
          command: "npm run build",
          cwd: "/tmp/project",
          threadId: "thread",
          turnId: "turn",
          itemId: "command",
          environmentId: null,
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

    expect(command.summary).toBe("Needs unsandboxed access\nnpm run build");
    expect(fileChange.summary).toBe("Write outside workspace\ngrant root: /tmp/project");
    expect(permissions.summary.startsWith("Need network\ncwd: /tmp/project")).toBe(true);
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

    expect(approval.details).toEqual([
      { key: "reason", value: "Need network" },
      { key: "cwd", value: "/tmp/project" },
      { key: "network", value: "enabled" },
    ]);
  });

  it("formats command approval request payloads as compact detail rows", () => {
    const approval = expectPresent(
      toPendingApproval({
        id: 25,
        method: "item/commandExecution/requestApproval",
        params: {
          kind: "command",
          command: "rg TODO src && sed -n '1,20p' src/main.ts",
          cwd: "/tmp/project",
          threadId: "thread",
          turnId: "turn",
          itemId: "command",
          environmentId: null,
          startedAtMs: 1,
          reason: "Needs network access",
          networkApprovalContext: { host: "registry.npmjs.org", protocol: "https" },
          commandActions: [
            { type: "search", command: "rg TODO src", query: "TODO", path: "/tmp/project/src" },
            { type: "read", command: "sed -n '1,20p' src/main.ts", name: "main.ts", path: "/tmp/project/src/main.ts" },
            { type: "listFiles", command: "ls", path: null },
          ],
          additionalPermissions: {
            network: { enabled: true },
            fileSystem: {
              read: null,
              write: null,
              entries: [{ path: { type: "path", path: "/tmp/project/generated" }, access: "write" }],
            },
          },
          proposedExecpolicyAmendment: ["rg", "TODO"],
          proposedNetworkPolicyAmendments: [
            { host: "registry.npmjs.org", action: "allow" },
            { host: "example.com", action: "deny" },
          ],
        },
      }),
    );

    expect(approval.details).toEqual([
      { key: "reason", value: "Needs network access" },
      { key: "command", value: "rg TODO src && sed -n '1,20p' src/main.ts" },
      { key: "cwd", value: "/tmp/project" },
      { key: "network", value: "https://registry.npmjs.org" },
      { key: "actions", value: 'search "TODO" in src\nread src/main.ts\nlist files workspace' },
      { key: "additional network", value: "enabled" },
      { key: "additional filesystem", value: "/tmp/project/generated (write)" },
      { key: "future command rule", value: "rg\nTODO" },
      { key: "future network rules", value: "allow registry.npmjs.org\ndeny example.com" },
    ]);
  });

  it("keeps unknown command approval detail payload entries visible", () => {
    const approval = expectPresent(
      toPendingApproval({
        id: 26,
        method: "item/commandExecution/requestApproval",
        params: {
          kind: "command",
          command: null,
          cwd: "/tmp/project",
          threadId: "thread",
          turnId: "turn",
          itemId: "command",
          environmentId: null,
          startedAtMs: 1,
          reason: null,
          commandActions: [{ path: "/tmp/project/src/main.ts" }, "legacy action"],
          proposedExecpolicyAmendment: null,
          proposedNetworkPolicyAmendments: [{ host: "api.github.com" }, { action: "allow" }, "legacy rule"],
        },
      } as unknown as ServerRequest),
    );

    expect(approval.details).toEqual([
      { key: "cwd", value: "/tmp/project" },
      { key: "actions", value: '{\n  "path": "/tmp/project/src/main.ts"\n}\nlegacy action' },
      { key: "future network rules", value: "rule api.github.com\nallow (unknown host)\nlegacy rule" },
    ]);
  });

  it("omits empty approval detail rows", () => {
    const approval = expectPresent(
      toPendingApproval({
        id: 24,
        method: "item/commandExecution/requestApproval",
        params: {
          kind: "command",
          command: "npm test",
          cwd: "/tmp/project",
          threadId: "thread",
          turnId: "turn",
          itemId: "command",
          environmentId: null,
          startedAtMs: 1,
          reason: null,
          commandActions: [],
          proposedExecpolicyAmendment: null,
          proposedNetworkPolicyAmendments: [],
        },
      }),
    );

    expect(approval.details).toEqual([
      { key: "command", value: "npm test" },
      { key: "cwd", value: "/tmp/project" },
    ]);
  });

  it.each([
    {
      name: "command approval",
      request: {
        id: 3,
        method: "item/commandExecution/requestApproval",
        params: {
          kind: "command",
          command: "npm test",
          cwd: "/tmp/project",
          threadId: "thread",
          turnId: "turn",
          itemId: "command",
          environmentId: null,
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
      name: "file change approval",
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
  ] satisfies { name: string; request: ApprovalRequest; acceptSession: unknown; cancel: unknown }[])(
    "builds action responses for $name",
    ({ request, acceptSession, cancel }) => {
      const approval = expectPresent(toPendingApproval(request));
      if (approval.kind === "command") {
        expect(approvalResponseAt(request, approval, 0)).toEqual(acceptSession);
        expect(approvalResponseAt(request, approval, 1)).toEqual(cancel);
        expect(approvalResponseAt(request, approval, 2)).toEqual({ decision: "decline" });
        return;
      }
      expect(approvalResponse(request, "accept-session")).toEqual(acceptSession);
      expect(approvalResponse(request, "cancel")).toEqual(cancel);
      expect(approvalResponse(request, "decline")).toEqual({ decision: "decline" });
    },
  );
});
