import { describe, expect, it } from "vitest";

import {
  initialChatRequestState,
  resolveChatRequest,
  type ChatRequestState,
} from "../../../../../src/features/chat/conversation/pending-requests/state";

describe("chat pending request state", () => {
  it("ignores stale request resolutions", () => {
    const state = initialChatRequestState();

    expect(resolveChatRequest(state, 99)).toBe(state);
  });

  it("preserves user input drafts when resolving an approval", () => {
    const state: ChatRequestState = {
      approvals: [
        {
          requestId: 1,
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thread",
            turnId: "turn",
            itemId: "command",
            command: "pwd",
            cwd: "/tmp",
            reason: null,
            startedAtMs: 1,
          },
        },
      ],
      pendingUserInputs: [],
      userInputDrafts: new Map([["2:note", "draft"]]),
    };

    const next = resolveChatRequest(state, 1);

    expect(next.approvals).toEqual([]);
    expect(next.userInputDrafts).toBe(state.userInputDrafts);
  });
});
