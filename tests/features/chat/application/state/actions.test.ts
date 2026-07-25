import { describe, expect, it } from "vitest";
import type { ThreadActivationSnapshot } from "../../../../../src/domain/threads/activation";
import type { Thread } from "../../../../../src/domain/threads/model";
import { resumedThreadAction } from "../../../../../src/features/chat/application/state/actions";

describe("chat thread resume helpers", () => {
  it("builds a panel-only resumed action from a response snapshot", () => {
    const resumed = threadFixture("thread", "Resumed");
    const action = resumedThreadAction({ response: responseFixture(resumed) });

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
    });
    expect(action).not.toHaveProperty("listedThreads");
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
    expect(action).not.toHaveProperty("listedThreads");
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
