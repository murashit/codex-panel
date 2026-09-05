import { describe, expect, it } from "vitest";

import { threadActivationSnapshotFromAppServerResponse } from "../../../src/app-server/services/threads";
import type { Thread as AppServerThread } from "../../../src/generated/app-server/v2/Thread";
import type { ThreadResumeResponse } from "../../../src/generated/app-server/v2/ThreadResumeResponse";

describe("app-server thread activation", () => {
  it("maps app-server activation responses into panel-owned snapshots", () => {
    const snapshot = threadActivationSnapshotFromAppServerResponse(
      responseFixture({ ...threadFixture("thread", "Resumed"), canAcceptDirectInput: false }),
    );

    expect(snapshot).toMatchObject({
      thread: {
        id: "thread",
        name: "Resumed",
        archived: false,
      },
      canAcceptDirectInput: false,
      model: "gpt-5.5",
      serviceTier: "fast",
      approvalsReviewer: "user",
      reasoningEffort: "high",
      approvalPolicy: "on-request",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      activePermissionProfile: null,
    });
  });
});

function responseFixture(thread: AppServerThread): ThreadResumeResponse {
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
    turnsBackwardsCursor: null,
    itemsBackwardsCursor: null,
  };
}

function threadFixture(id: string, name: string): AppServerThread {
  return {
    id,
    extra: null,
    sessionId: "session",
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    historyMode: "paginated",
    projectId: null,
    modelProvider: "openai",
    model: null,
    reasoningEffort: null,
    createdAt: 1,
    updatedAt: 1,
    recencyAt: null,
    section: null,
    sectionEnteredAt: null,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
    source: "unknown",
    canAcceptDirectInput: null,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name,
    turns: [],
  };
}
