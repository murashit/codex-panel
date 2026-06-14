import { describe, expect, it } from "vitest";

import type { ThreadActivationResponse, ThreadActivationSnapshot } from "../../../../src/app-server/services/thread-activation";
import {
  resumedThreadActionFromActiveRuntime,
  resumedThreadActionFromAppServerResponse,
} from "../../../../src/features/chat/application/threads/resume";
import type { Thread } from "../../../../src/domain/threads/model";

describe("chat thread resume helpers", () => {
  it("builds thread resumed actions from response snapshots", () => {
    const existing = threadFixture("existing", "Existing");
    const resumed = threadFixture("thread", "Resumed");
    const loading = { id: "loading", kind: "system" as const, role: "system" as const, text: "Loading thread..." };

    const action = resumedThreadActionFromActiveRuntime({
      thread: resumed,
      cwd: "/vault",
      runtime: {
        activeModel: "gpt-5.5",
        activeReasoningEffort: "high",
        activeServiceTier: "fast",
        activeApprovalPolicy: "on-request",
        activeApprovalsReviewer: "user",
        activePermissionProfile: null,
      },
      listedThreads: [existing],
      items: [loading],
    });

    expect(action).toMatchObject({
      type: "active-thread/resumed",
      thread: resumed,
      cwd: "/vault",
      model: "gpt-5.5",
      reasoningEffort: "high",
      serviceTier: "fast",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      activePermissionProfile: null,
      items: [loading],
    });
    expect(action.listedThreads?.map((thread) => thread.id)).toEqual(["thread", "existing"]);
  });

  it("can build thread start actions without mutating the thread list", () => {
    const resumed = threadFixture("thread", "Started");

    const action = resumedThreadActionFromAppServerResponse({
      response: responseRecordFixture(resumed),
      preserveRequestedRuntimeSettings: true,
    });

    expect(action).toMatchObject({
      type: "active-thread/resumed",
      thread: resumed,
      preserveRequestedRuntimeSettings: true,
    });
    expect(action.listedThreads).toBeUndefined();
  });
});

function responseFixture(thread: Thread): ThreadActivationSnapshot {
  return {
    thread,
    model: "gpt-5.5",
    serviceTier: "fast",
    cwd: "/vault",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    activePermissionProfile: null,
    reasoningEffort: "high",
  };
}

function responseRecordFixture(thread: Thread): ThreadActivationResponse {
  return {
    ...responseFixture(thread),
    thread: {
      id: thread.id,
      sessionId: thread.id,
      forkedFromId: null,
      parentThreadId: null,
      preview: thread.preview,
      ephemeral: false,
      modelProvider: "openai",
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      status: { type: "idle" },
      path: null,
      cwd: "/vault",
      cliVersion: "codex-cli 0.0.0",
      source: "unknown",
      threadSource: null,
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: thread.name,
      turns: [],
    },
  };
}

function threadFixture(id: string, name: string): Thread {
  return {
    id,
    preview: "",
    name,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
  };
}
