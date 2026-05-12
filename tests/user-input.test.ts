import { describe, expect, it } from "vitest";

import { questionDefaultAnswer, toPendingUserInput, userInputResponse } from "../src/user-input/model";
import type { ServerRequest } from "../src/generated/app-server/ServerRequest";

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

    const input = toPendingUserInput(request);
    expect(input).toMatchObject({ requestId: 7, method: "item/tool/requestUserInput" });
    expect(questionDefaultAnswer(request.params.questions[0])).toBe("Recommended");
    expect(userInputResponse(input!, { direction: "Recommended" })).toEqual({
      answers: { direction: { answers: ["Recommended"] } },
    });
  });
});
