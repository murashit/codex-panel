export type RequestId = string | number;

interface UserInputRequestLike {
  id: RequestId;
  method: string;
  params: unknown;
}

interface AppServerUserInputRequest extends UserInputRequestLike {
  method: "item/tool/requestUserInput";
  params: PendingUserInputParams;
}

interface PendingUserInputParams {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: PendingUserInputQuestion[];
}

export interface PendingUserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: PendingUserInputOption[] | null;
}

interface PendingUserInputOption {
  label: string;
  description: string;
}

interface UserInputResponse {
  answers: Record<string, { answers: string[] }>;
}

export interface PendingUserInput {
  requestId: RequestId;
  method: "item/tool/requestUserInput";
  params: PendingUserInputParams;
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

export function questionDefaultAnswer(question: PendingUserInputQuestion): string {
  return question.options?.[0]?.label ?? "";
}

export function userInputDraftKey(requestId: RequestId, questionId: string): string {
  return `${String(requestId)}:${questionId}`;
}

export function userInputOtherDraftKey(requestId: RequestId, questionId: string): string {
  return `${String(requestId)}:${questionId}:other`;
}

export function answersForPendingUserInput(input: PendingUserInput, drafts: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries(
    input.params.questions.map((question) => [
      question.id,
      drafts.get(userInputDraftKey(input.requestId, question.id)) ?? questionDefaultAnswer(question),
    ]),
  );
}
