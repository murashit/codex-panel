import type { ComponentChild as UiNode } from "preact";

import type { ApprovalAction, McpElicitationAction, PendingRequestId } from "../../domain/pending-requests/model";
import type { PendingRequestBlockSnapshot } from "../../presentation/pending-requests/snapshot";
import type { MessageStreamForkTarget } from "../../presentation/message-stream/text-view";
import type { PlanImplementationTarget } from "../../domain/message-stream/selectors";
import type { ChatTurnDiffViewState } from "../../domain/turn-diff";

export interface MessageStreamBlock {
  key: string;
  node: UiNode;
}

type MessageStreamDisclosureBucket =
  | "details"
  | "activityGroups"
  | "textDetails"
  | "userMessageExpanded"
  | "goalObjectiveExpanded"
  | "approvalDetails";

export interface MessageStreamDisclosureState {
  details: ReadonlySet<string>;
  activityGroups: ReadonlySet<string>;
  textDetails: ReadonlySet<string>;
  userMessageExpanded: ReadonlySet<string>;
  goalObjectiveExpanded: ReadonlySet<string>;
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

export interface TextItemDetailStateContext {
  disclosures: MessageStreamDisclosureState;
  onDisclosureToggle?: (bucket: MessageStreamDisclosureBucket, id: string, open: boolean) => void;
}

export interface TextItemContentContext extends TextItemDetailStateContext {
  renderObsidianMarkdown: (parent: HTMLElement, text: string) => void;
  renderStreamMarkdown: (parent: HTMLElement, text: string) => void;
}

export interface TextItemActionContext extends TextItemDetailStateContext {
  forkMenuItemId: string | null;
  onForkMenuToggle?: (itemId: string | null) => void;
  copyText?: (text: string) => void;
  onImplementPlan?: (target: PlanImplementationTarget) => void;
  onRollback?: () => void;
  onFork?: (target: MessageStreamForkTarget, archiveSource: boolean) => void;
}

export interface TextItemMetadataContext extends TextItemDetailStateContext {
  activeThreadId: string | null;
  workspaceRoot?: string | null;
  openTurnDiff?: (state: ChatTurnDiffViewState) => void;
}

interface MessageStreamRenderContext {
  activeThreadId: string | null;
  workspaceRoot?: string | null;
  loadOlderTurns: () => void;
  pendingRequests?: PendingRequestBlockContext;
}

export interface TextItemContext extends TextItemContentContext, TextItemActionContext, TextItemMetadataContext {}

export interface MessageStreamContext extends MessageStreamRenderContext, TextItemContext {}

export interface PendingRequestBlockContext {
  signature: string;
  snapshot: () => PendingRequestBlockSnapshot;
  actions: () => PendingRequestBlockActions;
  consumeAutoFocus: () => boolean;
}
