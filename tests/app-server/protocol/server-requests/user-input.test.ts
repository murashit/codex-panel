import { describe, expect, it } from "vitest";
import type { ServerRequest } from "../../../../src/app-server/connection/rpc-messages";
import {
  appServerUserInputResponse,
  appServerUserInputRequest as toPendingUserInput,
} from "../../../../src/app-server/protocol/server-requests";
import { answersForPendingUserInput, questionDefaultAnswer } from "../../../../src/domain/pending-requests/model";

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
        autoResolutionMs: null,
      },
    };

    const input = expectPresent(toPendingUserInput(request));
    expect(input).toMatchObject({ requestId: 7 });
    expect(questionDefaultAnswer(expectPresent(request.params.questions[0]))).toBe("Recommended");
    expect(answersForPendingUserInput(input, new Map())).toEqual({ direction: "Recommended" });
    expect(answersForPendingUserInput(input, new Map([["7:direction", "Left"]]))).toEqual({ direction: "Left" });
    expect(appServerUserInputResponse(input.params.questions, { direction: "Recommended" })).toEqual({
      answers: { direction: { answers: ["Recommended"] } },
    });
  });
});
