import { describe, expect, it } from "vitest";

import { threadActivationSnapshotFromAppServerResponse } from "../../src/app-server/threads";
import type { Thread as ThreadRecord } from "../../src/generated/app-server/v2/Thread";
import type { ThreadResumeResponse } from "../../src/generated/app-server/v2/ThreadResumeResponse";

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
      approvalsReviewer: "user",
      reasoningEffort: "high",
    });
  });
});

function responseFixture(thread: ThreadRecord): ThreadResumeResponse {
  return {
    thread,
    model: "gpt-5.5",
    modelProvider: "openai",
    serviceTier: "fast",
    approvalPolicy: "on-request",
    cwd: "/vault",
    runtimeWorkspaceRoots: [],
    instructionSources: [],
    approvalsReviewer: "user",
    activePermissionProfile: null,
    sandbox: { type: "readOnly", networkAccess: false },
    reasoningEffort: "high",
    multiAgentMode: "explicitRequestOnly",
    initialTurnsPage: null,
  };
}

function threadFixture(id: string, name: string): ThreadRecord {
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
    recencyAt: null,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
    source: "unknown",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name,
    turns: [],
  };
}
