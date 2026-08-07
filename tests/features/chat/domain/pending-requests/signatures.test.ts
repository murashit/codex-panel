import { describe, expect, it } from "vitest";

import type { PendingUserInput } from "../../../../../src/features/chat/domain/pending-requests/model";
import {
  pendingRequestFocusSignature,
  pendingRequestsSignature,
} from "../../../../../src/features/chat/domain/pending-requests/signatures";

describe("pending request signatures", () => {
  it("signs visible request content and sorted drafts deterministically", () => {
    const input: PendingUserInput = {
      requestId: 7,
      autoResolutionAtMs: null,
      params: {
        turnId: "turn",
        isBlocking: true,
        questions: [
          {
            id: "direction",
            header: "Direction",
            question: "Which way?",
            isOther: true,
            isSecret: false,
            options: [{ label: "Recommended", description: "Use the default path" }],
          },
        ],
      },
    };
    const drafts = new Map([
      ["z", "last"],
      ["a", "first"],
    ]);

    expect(pendingRequestsSignature([], [], [], drafts, new Map())).toBe("");
    expect(pendingRequestFocusSignature([], [], [])).toBe("");
    expect(pendingRequestFocusSignature([], [input], [])).toBe(JSON.stringify({ approvals: [], inputs: [{ id: 7 }], mcpElicitations: [] }));
    expect(pendingRequestsSignature([], [input], [], drafts, new Map())).toBe(
      JSON.stringify({
        approvals: [],
        inputs: [
          {
            id: 7,
            autoResolutionAtMs: null,
            questions: [{ id: "direction", header: "Direction", question: "Which way?", options: ["Recommended"] }],
          },
        ],
        mcpElicitations: [],
        drafts: [
          ["a", "first"],
          ["z", "last"],
        ],
        mcpDrafts: [],
      }),
    );
  });
});
