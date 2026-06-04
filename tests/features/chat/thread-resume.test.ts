import { describe, expect, it } from "vitest";

import { resumedThreadAction } from "../../../src/features/chat/thread-resume";
import type { Thread } from "../../../src/generated/app-server/v2/Thread";
import type { ThreadResumeResponse } from "../../../src/generated/app-server/v2/ThreadResumeResponse";

describe("chat thread resume helpers", () => {
  it("builds thread resumed actions from response snapshots", () => {
    const existing = threadFixture("existing", "Existing");
    const resumed = threadFixture("thread", "Resumed");
    const loading = { id: "loading", kind: "system" as const, role: "system" as const, text: "Loading thread..." };

    const action = resumedThreadAction({
      response: responseFixture(resumed),
      listedThreads: [existing],
      displayItems: [loading],
    });

    expect(action).toMatchObject({
      type: "thread/resumed",
      thread: resumed,
      cwd: "/vault",
      model: "gpt-5.5",
      reasoningEffort: "high",
      serviceTier: "fast",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      activePermissionProfile: null,
      displayItems: [loading],
    });
    expect(action.listedThreads?.map((thread) => thread.id)).toEqual(["thread", "existing"]);
  });

  it("can build thread start actions without mutating the thread list", () => {
    const resumed = threadFixture("thread", "Started");

    const action = resumedThreadAction({
      response: responseFixture(resumed),
      forceMessagesToBottom: true,
    });

    expect(action).toMatchObject({
      type: "thread/resumed",
      thread: resumed,
      forceMessagesToBottom: true,
    });
    expect(action.listedThreads).toBeUndefined();
  });
});

function responseFixture(thread: Thread): ThreadResumeResponse {
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

function threadFixture(id: string, name: string): Thread {
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
