import type { PendingApproval } from "../../protocol/server-requests/approval";
import type { RequestId } from "../../../../app-server/types";
import { userInputDraftKey, userInputOtherDraftKey, type PendingUserInput } from "../../protocol/server-requests/user-input";

export interface ChatRequestState {
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  userInputDrafts: ReadonlyMap<string, string>;
}

export type RequestAction =
  | { type: "request/approval-queued"; approval: PendingApproval }
  | { type: "request/user-input-queued"; input: PendingUserInput }
  | { type: "request/user-input-draft-set"; key: string; value: string };

export function initialChatRequestState(): ChatRequestState {
  return {
    approvals: [],
    pendingUserInputs: [],
    userInputDrafts: new Map(),
  };
}

export function reduceRequestSlice(state: ChatRequestState, action: RequestAction): ChatRequestState {
  switch (action.type) {
    case "request/approval-queued":
      if (state.approvals.some((existing) => existing.requestId === action.approval.requestId)) return state;
      return patchObject(state, { approvals: [...state.approvals, action.approval] });
    case "request/user-input-queued":
      if (state.pendingUserInputs.some((existing) => existing.requestId === action.input.requestId)) return state;
      return patchObject(state, { pendingUserInputs: [...state.pendingUserInputs, action.input] });
    case "request/user-input-draft-set":
      return setUserInputDraftSlice(state, action.key, action.value);
  }
}

export function resolveChatRequest(state: ChatRequestState, requestId: RequestId): ChatRequestState {
  const resolvedInputs = state.pendingUserInputs.filter((input) => input.requestId === requestId);
  const resolvedApprovals = state.approvals.filter((approval) => approval.requestId === requestId);
  if (resolvedApprovals.length === 0 && resolvedInputs.length === 0) return state;

  const draftKeys = new Set(
    resolvedInputs.flatMap((input) =>
      input.params.questions.flatMap((question) => [
        userInputDraftKey(requestId, question.id),
        userInputOtherDraftKey(requestId, question.id),
      ]),
    ),
  );
  const userInputDrafts =
    draftKeys.size === 0 ? state.userInputDrafts : new Map([...state.userInputDrafts].filter(([key]) => !draftKeys.has(key)));
  return patchObject(state, {
    approvals: state.approvals.filter((approval) => approval.requestId !== requestId),
    pendingUserInputs: state.pendingUserInputs.filter((input) => input.requestId !== requestId),
    userInputDrafts,
  });
}

function setUserInputDraftSlice(state: ChatRequestState, key: string, value: string): ChatRequestState {
  if (state.userInputDrafts.get(key) === value) return state;
  return patchObject(state, { userInputDrafts: new Map([...state.userInputDrafts, [key, value]]) });
}

function patchObject<T extends object>(current: T, patch: Partial<T>): T {
  if (Object.entries(patch).every(([key, value]) => Object.is(current[key as keyof T], value))) return current;
  return { ...current, ...patch };
}
