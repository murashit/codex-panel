import { describe, expect, it } from "vitest";
import type { ServerRequest } from "../../../../../../src/app-server/connection/rpc-messages";
import {
  appServerUserInputResponse,
  appServerUserInputRequest as toPendingUserInput,
} from "../../../../../../src/features/chat/app-server/inbound/server-request-adapter";

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

describe("user input model", () => {
  it("classifies requestUserInput and adapts answers", () => {
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
        autoResolutionMs: null,
      },
    };

    const input = expectPresent(toPendingUserInput(request));
    expect(input).toMatchObject({ requestId: 7 });
    expect(appServerUserInputResponse(input.params.questions, { direction: "Recommended" })).toEqual({
      answers: { direction: { answers: ["Recommended"] } },
    });
  });
});
