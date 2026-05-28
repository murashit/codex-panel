import type { RequestId } from "../../../generated/app-server/RequestId";
import type { ServerRequest } from "../../../generated/app-server/ServerRequest";
import type { ToolRequestUserInputParams } from "../../../generated/app-server/v2/ToolRequestUserInputParams";
import type { ToolRequestUserInputQuestion } from "../../../generated/app-server/v2/ToolRequestUserInputQuestion";
import type { ToolRequestUserInputResponse } from "../../../generated/app-server/v2/ToolRequestUserInputResponse";
import { userInputDraftKey } from "./drafts";

export type UserInputRequest = Extract<ServerRequest, { method: "item/tool/requestUserInput" }>;

export interface PendingUserInput {
  requestId: RequestId;
  method: UserInputRequest["method"];
  params: ToolRequestUserInputParams;
}

export function toPendingUserInput(request: ServerRequest): PendingUserInput | null {
  if (request.method !== "item/tool/requestUserInput") return null;
  return {
    requestId: request.id,
    method: request.method,
    params: request.params,
  };
}

export function userInputResponse(input: PendingUserInput, answers: Record<string, string>): ToolRequestUserInputResponse {
  return {
    answers: Object.fromEntries(
      input.params.questions.map((question) => [
        question.id,
        {
          answers: [answers[question.id] ?? ""],
        },
      ]),
    ),
  };
}

export function questionDefaultAnswer(question: ToolRequestUserInputQuestion): string {
  return question.options?.[0]?.label ?? "";
}

export function answersForPendingUserInput(input: PendingUserInput, drafts: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries(
    input.params.questions.map((question) => [
      question.id,
      drafts.get(userInputDraftKey(input.requestId, question.id)) ?? questionDefaultAnswer(question),
    ]),
  );
}
