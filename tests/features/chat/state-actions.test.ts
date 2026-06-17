import { describe, expect, it } from "vitest";

import { resumedThreadActionFromActiveRuntime, resumedThreadAction } from "../../../src/features/chat/application/state/actions";
import type { ThreadActivationSnapshot } from "../../../src/domain/threads/activation";
import type { Thread } from "../../../src/domain/threads/model";

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

    const action = resumedThreadAction({
      response: responseFixture(resumed),
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
