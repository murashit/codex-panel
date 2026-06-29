import type {
  ApprovalAction,
  McpElicitationAction,
  PendingApproval,
  PendingMcpElicitation,
  PendingRequestId,
  PendingUserInput,
} from "../../../../domain/pending-requests/model";
import type { ChatUiState } from "../state/ui-state";
import type { ChatRequestState } from "./state";

export interface PendingRequestBlockState {
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  pendingMcpElicitations: readonly PendingMcpElicitation[];
  userInputDrafts: ReadonlyMap<string, string>;
  mcpElicitationDrafts: ReadonlyMap<string, string>;
  approvalDetails: ReadonlySet<string>;
}

export interface PendingRequestBlockActions {
  resolveApproval: (requestId: PendingRequestId, action: ApprovalAction) => void;
  resolveUserInput: (requestId: PendingRequestId) => void;
  cancelUserInput: (requestId: PendingRequestId) => void;
  resolveMcpElicitation: (requestId: PendingRequestId, action: McpElicitationAction) => void;
  setApprovalDetailsExpanded?: (requestId: PendingRequestId, expanded: boolean) => void;
  setUserInputDraft: (key: string, value: string) => void;
  setMcpElicitationDraft: (key: string, value: string) => void;
}

interface PendingRequestBlockStateSource {
  readonly requests: ChatRequestState;
  readonly ui: Pick<ChatUiState, "disclosures">;
}

export function pendingRequestBlockStateFromChatState(state: PendingRequestBlockStateSource): PendingRequestBlockState {
  return pendingRequestBlockStateFromRequestState(state.requests, state.ui.disclosures.approvalDetails);
}

export function pendingRequestBlockStateFromRequestState(
  requests: ChatRequestState,
  approvalDetails: ReadonlySet<string>,
): PendingRequestBlockState {
  return {
    approvals: requests.approvals,
    pendingUserInputs: requests.pendingUserInputs,
    pendingMcpElicitations: requests.pendingMcpElicitations,
    userInputDrafts: requests.userInputDrafts,
    mcpElicitationDrafts: requests.mcpElicitationDrafts,
    approvalDetails,
  };
}
