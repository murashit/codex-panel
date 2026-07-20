import { describe, expect, it } from "vitest";
import type { ThreadActivationSnapshot } from "../../../../../src/domain/threads/activation";
import type { Thread } from "../../../../../src/domain/threads/model";
import { resumedThreadAction, resumedThreadActionFromActiveRuntime } from "../../../../../src/features/chat/application/state/actions";

describe("chat thread resume helpers", () => {
  it("builds thread resumed actions from response snapshots", () => {
    const existing = threadFixture("existing", "Existing");
    const resumed = threadFixture("thread", "Resumed");
    const loading = { id: "loading", kind: "system" as const, role: "system" as const, text: "Loading thread..." };

    const action = resumedThreadActionFromActiveRuntime({
      thread: resumed,
      runtime: {
        model: "gpt-5.5",
        reasoningEffort: "high",
        serviceTier: "fast",
        serviceTierKnown: true,
        approvalPolicyKnown: true,
        sandboxPolicyKnown: true,
        permissionProfileKnown: true,
        approvalsReviewer: "user",
        approvalPolicy: "on-request",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: ["/vault"],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
        activePermissionProfile: { id: ":workspace", extends: null },
      },
      listedThreads: [existing],
      items: [loading],
    });

    expect(action).toMatchObject({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      thread: resumed,
      model: "gpt-5.5",
      reasoningEffort: "high",
      serviceTier: "fast",
      serviceTierKnown: true,
      approvalsReviewer: "user",
      approvalPolicy: "on-request",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["/vault"],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      activePermissionProfile: { id: ":workspace", extends: null },
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
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: "on-request",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["/vault"],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      activePermissionProfile: { id: ":workspace", extends: null },
      thread: resumed,
      preserveRequestedRuntimeSettings: true,
    });
    expect(action.listedThreads).toBeUndefined();
  });

  it("keeps resumed subagent threads out of the ordinary thread list", () => {
    const existing = threadFixture("existing", "Existing");
    const subagent = {
      ...threadFixture("child", "Child"),
      provenance: {
        kind: "subagent" as const,
        subagentKind: "thread-spawn" as const,
        parentThreadId: "parent",
        sessionId: "session",
        depth: 1,
        agentNickname: "Scout",
        agentRole: "explorer",
      },
    };

    const action = resumedThreadAction({ response: responseFixture(subagent), listedThreads: [existing] });

    expect(action.thread.provenance).toEqual(subagent.provenance);
    expect(action.listedThreads).toEqual([existing]);
  });
});

function responseFixture(thread: Thread): ThreadActivationSnapshot {
  return {
    thread,
    model: "gpt-5.5",
    serviceTier: "fast",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalsReviewer: "user",
    reasoningEffort: "high",
    approvalPolicy: "on-request",
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: ["/vault"],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
    activePermissionProfile: { id: ":workspace", extends: null },
  };
}

function threadFixture(id: string, name: string): Thread {
  return {
    id,
    preview: "",
    name,
    archived: false,
    provenance: { kind: "interactive" },
    createdAt: 1,
    updatedAt: 1,
  };
}
