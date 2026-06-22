import type {
  ApprovalAction,
  McpElicitationAction,
  PendingApproval,
  PendingMcpElicitation,
  PendingRequestId,
  PendingUserInput,
} from "../../../../domain/pending-requests/model";
import type { ChatRequestState } from "./state";
import type { ChatUiState } from "../state/ui-state";

export type { PendingRequestId } from "../../../../domain/pending-requests/model";

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
  return {
    approvals: state.requests.approvals,
    pendingUserInputs: state.requests.pendingUserInputs,
    pendingMcpElicitations: state.requests.pendingMcpElicitations,
    userInputDrafts: state.requests.userInputDrafts,
    mcpElicitationDrafts: state.requests.mcpElicitationDrafts,
    approvalDetails: state.ui.disclosures.approvalDetails,
  };
}
