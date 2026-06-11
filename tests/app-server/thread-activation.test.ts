import { describe, expect, it } from "vitest";

import { threadActivationSnapshotFromAppServerResponse } from "../../src/app-server/thread-activation";
import type { ThreadResumeResponse } from "../../src/generated/app-server/v2/ThreadResumeResponse";
import type { Thread as AppServerThread } from "../../src/generated/app-server/v2/Thread";

describe("app-server thread activation", () => {
  it("maps app-server activation responses into panel-owned snapshots", () => {
    expect(threadActivationSnapshotFromAppServerResponse(responseFixture(threadFixture("thread", "Resumed")))).toMatchObject({
      thread: {
        id: "thread",
        name: "Resumed",
        archived: false,
      },
      cwd: "/vault",
      model: "gpt-5.5",
      serviceTier: "fast",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      activePermissionProfile: null,
      reasoningEffort: "high",
    });
  });
});

function responseFixture(thread: AppServerThread): ThreadResumeResponse {
  return {
    thread,
    model: "gpt-5.5",
    modelProvider: "openai",
    serviceTier: "fast",
    cwd: "/vault",
    runtimeWorkspaceRoots: [],
    instructionSources: [],
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: { type: "readOnly", networkAccess: false },
    activePermissionProfile: null,
    reasoningEffort: "high",
    initialTurnsPage: null,
  };
}

function threadFixture(id: string, name: string): AppServerThread {
  return {
    id,
    sessionId: "session",
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name,
    turns: [],
  };
}
