import {
  mcpElicitationDraftKey,
  userInputDraftKey,
  userInputOtherDraftKey,
  type PendingApproval,
  type PendingMcpElicitation,
  type PendingRequestId,
  type PendingUserInput,
} from "../../../../domain/pending-requests/model";
import { patchObject } from "../state/patch";

export interface ChatRequestState {
  readonly approvals: readonly PendingApproval[];
  readonly pendingUserInputs: readonly PendingUserInput[];
  readonly pendingMcpElicitations: readonly PendingMcpElicitation[];
  readonly userInputDrafts: ReadonlyMap<string, string>;
  readonly mcpElicitationDrafts: ReadonlyMap<string, string>;
}

export type RequestAction =
  | { type: "request/approval-queued"; approval: PendingApproval }
  | { type: "request/user-input-queued"; input: PendingUserInput }
  | { type: "request/mcp-elicitation-queued"; elicitation: PendingMcpElicitation }
  | { type: "request/user-input-draft-set"; key: string; value: string }
  | { type: "request/mcp-elicitation-draft-set"; key: string; value: string };

export function isRequestAction(action: { type: string }): action is RequestAction {
  switch (action.type) {
    case "request/approval-queued":
    case "request/user-input-queued":
    case "request/mcp-elicitation-queued":
    case "request/user-input-draft-set":
    case "request/mcp-elicitation-draft-set":
      return true;
    default:
      return false;
  }
}

export function initialChatRequestState(): ChatRequestState {
  return {
    approvals: [],
    pendingUserInputs: [],
    pendingMcpElicitations: [],
    userInputDrafts: new Map(),
    mcpElicitationDrafts: new Map(),
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
    case "request/mcp-elicitation-queued":
      if (state.pendingMcpElicitations.some((existing) => existing.requestId === action.elicitation.requestId)) return state;
      return patchObject(state, { pendingMcpElicitations: [...state.pendingMcpElicitations, action.elicitation] });
    case "request/user-input-draft-set":
      return setUserInputDraftSlice(state, action.key, action.value);
    case "request/mcp-elicitation-draft-set":
      return setMcpElicitationDraftSlice(state, action.key, action.value);
  }
}

export function resolveChatRequest(state: ChatRequestState, requestId: PendingRequestId): ChatRequestState {
  const resolvedInputs = state.pendingUserInputs.filter((input) => input.requestId === requestId);
  const resolvedApprovals = state.approvals.filter((approval) => approval.requestId === requestId);
  const resolvedMcpElicitations = state.pendingMcpElicitations.filter((elicitation) => elicitation.requestId === requestId);
  if (resolvedApprovals.length === 0 && resolvedInputs.length === 0 && resolvedMcpElicitations.length === 0) return state;

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
  const mcpDraftKeys = new Set(
    resolvedMcpElicitations.flatMap((elicitation) =>
      elicitation.params.mode === "form" ? elicitation.params.fields.map((field) => mcpElicitationDraftKey(requestId, field.id)) : [],
    ),
  );
  const mcpElicitationDrafts =
    mcpDraftKeys.size === 0
      ? state.mcpElicitationDrafts
      : new Map([...state.mcpElicitationDrafts].filter(([key]) => !mcpDraftKeys.has(key)));
  return patchObject(state, {
    approvals: state.approvals.filter((approval) => approval.requestId !== requestId),
    pendingUserInputs: state.pendingUserInputs.filter((input) => input.requestId !== requestId),
    pendingMcpElicitations: state.pendingMcpElicitations.filter((elicitation) => elicitation.requestId !== requestId),
    userInputDrafts,
    mcpElicitationDrafts,
  });
}

function setUserInputDraftSlice(state: ChatRequestState, key: string, value: string): ChatRequestState {
  if (state.userInputDrafts.get(key) === value) return state;
  return patchObject(state, { userInputDrafts: new Map([...state.userInputDrafts, [key, value]]) });
}

function setMcpElicitationDraftSlice(state: ChatRequestState, key: string, value: string): ChatRequestState {
  if (state.mcpElicitationDrafts.get(key) === value) return state;
  return patchObject(state, { mcpElicitationDrafts: new Map([...state.mcpElicitationDrafts, [key, value]]) });
}
