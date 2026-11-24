import type {
  McpElicitationFieldEdit,
  PendingApproval,
  PendingMcpElicitation,
  PendingMcpElicitationField,
  PendingRequestId,
  PendingUserInput,
} from "../../domain/pending-requests/model";
import { patchObject } from "../state/patch";

export interface ChatRequestState {
  readonly approvals: readonly PendingApproval[];
  readonly pendingUserInputs: readonly PendingUserInput[];
  readonly pendingMcpElicitations: readonly PendingMcpElicitation[];
}

export type RequestAction =
  | { type: "request/approval-queued"; approval: PendingApproval }
  | { type: "request/user-input-queued"; input: PendingUserInput }
  | { type: "request/user-input-timeout-failed"; input: PendingUserInput }
  | { type: "request/mcp-elicitation-queued"; elicitation: PendingMcpElicitation }
  | {
      type: "request/user-input-draft-set";
      requestId: PendingRequestId;
      questionId: string;
      value: string;
      other?: boolean;
      autoResolutionAtMs: number | null;
    }
  | { type: "request/mcp-elicitation-field-set"; requestId: PendingRequestId; fieldId: string; edit: McpElicitationFieldEdit };

export function initialChatRequestState(): ChatRequestState {
  return {
    approvals: [],
    pendingUserInputs: [],
    pendingMcpElicitations: [],
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
    case "request/user-input-timeout-failed":
      if (!state.pendingUserInputs.includes(action.input)) return state;
      return patchObject(state, {
        pendingUserInputs: state.pendingUserInputs.map((item) => (item === action.input ? { ...item, autoResolutionAtMs: null } : item)),
      });
    case "request/mcp-elicitation-queued":
      if (state.pendingMcpElicitations.some((existing) => existing.requestId === action.elicitation.requestId)) return state;
      return patchObject(state, { pendingMcpElicitations: [...state.pendingMcpElicitations, action.elicitation] });
    case "request/user-input-draft-set": {
      const input = state.pendingUserInputs.find((item) => item.requestId === action.requestId);
      const question = input?.params.questions.find((item) => item.id === action.questionId);
      if (!input || !question) return state;
      const edited = { ...question, draft: action.value, ...(action.other ? { otherDraft: action.value } : {}) };
      const questions = input.params.questions.map((item) => (item === question ? edited : item));
      const updated = { ...input, autoResolutionAtMs: action.autoResolutionAtMs, params: { ...input.params, questions } };
      return patchObject(state, { pendingUserInputs: state.pendingUserInputs.map((item) => (item === input ? updated : item)) });
    }
    case "request/mcp-elicitation-field-set": {
      const elicitation = state.pendingMcpElicitations.find((item) => item.requestId === action.requestId);
      if (elicitation?.params.mode !== "form") return state;
      const field = elicitation.params.fields.find((item) => item.id === action.fieldId);
      if (!field) return state;
      const editedField = editMcpElicitationField(field, action.edit);
      if (editedField === field) return state;
      const updated = {
        ...elicitation,
        params: { ...elicitation.params, fields: elicitation.params.fields.map((item) => (item === field ? editedField : item)) },
      };
      return patchObject(state, {
        pendingMcpElicitations: state.pendingMcpElicitations.map((item) => (item === elicitation ? updated : item)),
      });
    }
  }
}

export function resolveChatRequest(state: ChatRequestState, requestId: PendingRequestId): ChatRequestState {
  const approvals = state.approvals.filter((item) => item.requestId !== requestId);
  const pendingUserInputs = state.pendingUserInputs.filter((item) => item.requestId !== requestId);
  const pendingMcpElicitations = state.pendingMcpElicitations.filter((item) => item.requestId !== requestId);
  if (
    approvals.length === state.approvals.length &&
    pendingUserInputs.length === state.pendingUserInputs.length &&
    pendingMcpElicitations.length === state.pendingMcpElicitations.length
  )
    return state;
  return { approvals, pendingUserInputs, pendingMcpElicitations };
}

function editMcpElicitationField(field: PendingMcpElicitationField, edit: McpElicitationFieldEdit): PendingMcpElicitationField {
  if (field.value === edit.value) return field;
  switch (field.type) {
    case "string":
    case "number":
    case "integer":
      return edit.type === field.type ? { ...field, value: edit.value } : field;
    case "boolean":
      return edit.type === field.type ? { ...field, value: edit.value } : field;
    case "single-select":
      return edit.type === field.type ? { ...field, value: edit.value } : field;
    case "multi-select":
      return edit.type === field.type ? { ...field, value: edit.value } : field;
  }
}
