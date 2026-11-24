import type { PendingApprovalOption, PendingUserInput, PendingUserInputQuestion } from "./model";

export function defaultPendingApprovalOptions(): PendingApprovalOption[] {
  return [
    { id: "accept", label: "Allow", action: "accept" },
    { id: "accept-session", label: "Allow session", action: "accept-session" },
    { id: "decline", label: "Deny", action: "decline" },
    { id: "cancel", label: "Cancel", action: "cancel" },
  ];
}

export function userInputAnswer(question: PendingUserInputQuestion): string {
  return question.draft ?? question.options?.[0]?.label ?? "";
}

export function answersForPendingUserInput(input: PendingUserInput): Record<string, string> {
  return Object.fromEntries(input.params.questions.map((question) => [question.id, userInputAnswer(question)]));
}
