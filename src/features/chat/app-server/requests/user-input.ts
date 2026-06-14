import type { PendingRequestId, PendingUserInput, PendingUserInputParams } from "../../domain/pending-requests/model";

interface UserInputRequestLike {
  id: PendingRequestId;
  method: string;
  params: unknown;
}

interface AppServerUserInputRequest extends UserInputRequestLike {
  method: "item/tool/requestUserInput";
  params: PendingUserInputParams;
}

interface UserInputResponse {
  answers: Record<string, { answers: string[] }>;
}

export function toPendingUserInput(request: UserInputRequestLike): PendingUserInput | null {
  if (request.method !== "item/tool/requestUserInput") return null;
  const userInputRequest = request as AppServerUserInputRequest;
  return {
    requestId: userInputRequest.id,
    method: userInputRequest.method,
    params: userInputRequest.params,
  };
}

export function userInputResponse(input: PendingUserInput, answers: Record<string, string>): UserInputResponse {
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
