import { describe, expect, it } from "vitest";

import {
  initialChatRequestState,
  resolveChatRequest,
  type ChatRequestState,
} from "../../../../../src/features/chat/application/pending-requests/state";

describe("chat pending request state", () => {
  it("ignores stale request resolutions", () => {
    const state = initialChatRequestState();

    expect(resolveChatRequest(state, 99)).toEqual(state);
  });

  it("preserves user input drafts when resolving an approval", () => {
    const state: ChatRequestState = {
      approvals: [
        {
          requestId: 1,
          kind: "command",
          turnId: "turn",
          title: "Command approval",
          summary: "pwd",
          resultSummary: "pwd",
          details: [{ key: "command", value: "pwd" }],
          responses: { accept: {}, acceptSession: {}, decline: {}, cancel: {} },
          actionOptions: null,
        },
      ],
      pendingUserInputs: [],
      pendingMcpElicitations: [],
      userInputDrafts: new Map([["2:note", "draft"]]),
      mcpElicitationDrafts: new Map(),
    };

    const next = resolveChatRequest(state, 1);

    expect(next.approvals).toEqual([]);
    expect([...next.userInputDrafts]).toEqual([["2:note", "draft"]]);
  });
});
