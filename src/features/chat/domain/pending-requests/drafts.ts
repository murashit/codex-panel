import type { PendingApprovalOption, PendingRequestId, PendingUserInput, PendingUserInputQuestion } from "./model";

export function defaultPendingApprovalOptions(): PendingApprovalOption[] {
  return [
    { id: "accept", label: "Allow", action: "accept" },
    { id: "accept-session", label: "Allow session", action: "accept-session" },
    { id: "decline", label: "Deny", action: "decline" },
    { id: "cancel", label: "Cancel", action: "cancel" },
  ];
}

export function questionDefaultAnswer(question: PendingUserInputQuestion): string {
  return question.options?.[0]?.label ?? "";
}

export function userInputDraftKey(requestId: PendingRequestId, questionId: string): string {
  return pendingRequestDerivedKey(requestId, questionId);
}

export function userInputOtherDraftKey(requestId: PendingRequestId, questionId: string): string {
  return pendingRequestDerivedKey(requestId, `${questionId}:other`);
}

export function pendingRequestDerivedKeyPrefix(requestId: PendingRequestId): string {
  return `${String(requestId)}:`;
}

function pendingRequestDerivedKey(requestId: PendingRequestId, suffix: string): string {
  return `${pendingRequestDerivedKeyPrefix(requestId)}${suffix}`;
}

export function answersForPendingUserInput(input: PendingUserInput, drafts: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries(
    input.params.questions.map((question) => [
      question.id,
      drafts.get(userInputDraftKey(input.requestId, question.id)) ?? questionDefaultAnswer(question),
    ]),
  );
}
