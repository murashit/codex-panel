import type { ServerRequest } from "../../src/app-server/connection/rpc-messages";

type UserInputRequest = Extract<ServerRequest, { method: "item/tool/requestUserInput" }>;
export function userInputRequestFixture(
  id: number,
  params: Pick<UserInputRequest["params"], "isBlocking"> & Partial<UserInputRequest["params"]>,
): UserInputRequest {
  return {
    id,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-active",
      turnId: "turn-active",
      itemId: "input-1",
      questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
      autoResolutionMs: null,
      ...params,
    },
  };
}

export function commandApprovalRequestFixture(
  id: number,
  params: Partial<Omit<Extract<ServerRequest, { method: "item/commandExecution/requestApproval" }>["params"], "kind">> = {},
): Extract<ServerRequest, { method: "item/commandExecution/requestApproval" }> {
  return {
    id,
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
      availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
      ...params,
    },
  };
}

export function permissionsApprovalRequestFixture(
  id: number,
  params: Partial<Extract<ServerRequest, { method: "item/permissions/requestApproval" }>["params"]> = {},
): Extract<ServerRequest, { method: "item/permissions/requestApproval" }> {
  return {
    id,
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
      ...params,
    },
  };
}
