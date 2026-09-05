import { mcpElicitationDraftKey, userInputDraftKey, userInputOtherDraftKey } from "../../domain/pending-requests/drafts";
import type { PendingApproval, PendingMcpElicitation, PendingRequestId, PendingUserInput } from "../../domain/pending-requests/model";
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
  | { type: "request/user-input-auto-resolution-extended"; requestId: PendingRequestId; autoResolutionAtMs: number }
  | { type: "request/mcp-elicitation-queued"; elicitation: PendingMcpElicitation }
  | { type: "request/user-input-draft-set"; key: string; value: string }
  | { type: "request/mcp-elicitation-draft-set"; key: string; value: string };

export function isRequestAction(action: { type: string }): action is RequestAction {
  switch (action.type) {
    case "request/approval-queued":
    case "request/user-input-queued":
    case "request/user-input-auto-resolution-extended":
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
    case "request/user-input-auto-resolution-extended":
      return patchObject(state, {
        pendingUserInputs: state.pendingUserInputs.map((input) =>
          input.requestId === action.requestId ? { ...input, autoResolutionAtMs: action.autoResolutionAtMs } : input,
        ),
      });
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
  const hasResolvedApproval = state.approvals.some((approval) => approval.requestId === requestId);
  const resolvedMcpElicitations = state.pendingMcpElicitations.filter((elicitation) => elicitation.requestId === requestId);
  if (!hasResolvedApproval && resolvedInputs.length === 0 && resolvedMcpElicitations.length === 0) return state;

  let userInputDrafts: Map<string, string> | null = null;
  for (const input of resolvedInputs) {
    for (const question of input.params.questions) {
      userInputDrafts ??= new Map(state.userInputDrafts);
      userInputDrafts.delete(userInputDraftKey(requestId, question.id));
      userInputDrafts.delete(userInputOtherDraftKey(requestId, question.id));
    }
  }
  let mcpElicitationDrafts: Map<string, string> | null = null;
  for (const elicitation of resolvedMcpElicitations) {
    if (elicitation.params.mode !== "form") continue;
    for (const field of elicitation.params.fields) {
      mcpElicitationDrafts ??= new Map(state.mcpElicitationDrafts);
      mcpElicitationDrafts.delete(mcpElicitationDraftKey(requestId, field.id));
    }
  }
  return patchObject(state, {
    approvals: state.approvals.filter((approval) => approval.requestId !== requestId),
    pendingUserInputs: state.pendingUserInputs.filter((input) => input.requestId !== requestId),
    pendingMcpElicitations: state.pendingMcpElicitations.filter((elicitation) => elicitation.requestId !== requestId),
    userInputDrafts: userInputDrafts ?? state.userInputDrafts,
    mcpElicitationDrafts: mcpElicitationDrafts ?? state.mcpElicitationDrafts,
  });
}

function setUserInputDraftSlice(state: ChatRequestState, key: string, value: string): ChatRequestState {
  if (state.userInputDrafts.get(key) === value) return state;
  return patchObject(state, { userInputDrafts: new Map(state.userInputDrafts).set(key, value) });
}

function setMcpElicitationDraftSlice(state: ChatRequestState, key: string, value: string): ChatRequestState {
  if (state.mcpElicitationDrafts.get(key) === value) return state;
  return patchObject(state, { mcpElicitationDrafts: new Map(state.mcpElicitationDrafts).set(key, value) });
}
