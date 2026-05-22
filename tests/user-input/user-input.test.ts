import { describe, expect, it } from "vitest";

import { questionDefaultAnswer, toPendingUserInput, userInputResponse } from "../../src/user-input/model";
import { pendingRequestsSignature } from "../../src/panel/request-state";
import type { ServerRequest } from "../../src/generated/app-server/ServerRequest";

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

describe("user input model", () => {
  it("classifies requestUserInput and builds answers", () => {
    const request: ServerRequest = {
      id: 7,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "item",
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

    const input = expectPresent(toPendingUserInput(request));
    expect(input).toMatchObject({ requestId: 7, method: "item/tool/requestUserInput" });
    expect(questionDefaultAnswer(expectPresent(request.params.questions[0]))).toBe("Recommended");
    expect(userInputResponse(input, { direction: "Recommended" })).toEqual({
      answers: { direction: { answers: ["Recommended"] } },
    });
  });

  it("signs pending request content and drafts deterministically", () => {
    const input = expectPresent(
      toPendingUserInput({
        id: 7,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread",
          turnId: "turn",
          itemId: "item",
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
      }),
    );
    const drafts = new Map([
      ["z", "last"],
      ["a", "first"],
    ]);

    expect(pendingRequestsSignature([], [], drafts)).toBe("");
    expect(pendingRequestsSignature([], [input], drafts)).toBe(
      JSON.stringify({
        approvals: [],
        inputs: [
          {
            id: 7,
            questions: [
              {
                id: "direction",
                header: "Direction",
                question: "Which way?",
                options: ["Recommended"],
              },
            ],
          },
        ],
        drafts: [
          ["a", "first"],
          ["z", "last"],
        ],
      }),
    );
  });
});
