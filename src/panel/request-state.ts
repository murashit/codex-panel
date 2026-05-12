import type { RequestId } from "../generated/app-server/RequestId";
import type { DisplayDetailSection, DisplayItem } from "../display/types";
import type { PendingUserInput } from "../user-input/model";

export function userInputDraftKey(requestId: RequestId, questionId: string): string {
  return `${String(requestId)}:${questionId}`;
}

export function userInputOtherDraftKey(requestId: RequestId, questionId: string): string {
  return `${String(requestId)}:${questionId}:other`;
}

export function clearUserInputDrafts(drafts: Map<string, string>, input: PendingUserInput): void {
  for (const question of input.params.questions) {
    drafts.delete(userInputDraftKey(input.requestId, question.id));
    drafts.delete(userInputOtherDraftKey(input.requestId, question.id));
  }
}

export function createUserInputResultItem(
  input: PendingUserInput,
  answers: Record<string, string>,
  status: "submitted" | "cancelled",
): DisplayItem {
  const questionCount = input.params.questions.length;
  const label = questionCount === 1 ? "1 question" : `${questionCount} questions`;
  const details: DisplayDetailSection[] = input.params.questions.map((question) => ({
    title: question.header || question.id,
    rows: [
      { key: "question", value: question.question },
      ...(status === "submitted" ? [{ key: "answer", value: answers[question.id] ?? "" }] : []),
    ],
  }));
  return {
    id: `user-input-${status}-${String(input.requestId)}`,
    kind: "userInputResult",
    role: "tool",
    text: status === "submitted" ? `Input submitted for ${label}.` : `Input request cancelled for ${label}.`,
    turnId: input.params.turnId,
    markdown: false,
    state: status === "submitted" ? "completed" : "failed",
    details,
  };
}
