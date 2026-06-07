import type { RequestId } from "../../../../generated/app-server/RequestId";

export function userInputDraftKey(requestId: RequestId, questionId: string): string {
  return `${String(requestId)}:${questionId}`;
}

export function userInputOtherDraftKey(requestId: RequestId, questionId: string): string {
  return `${String(requestId)}:${questionId}:other`;
}
