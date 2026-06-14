import type { ComponentChild as UiNode } from "preact";

import type { ApprovalAction, PendingRequestId } from "../../domain/pending-requests/model";
import type { PendingRequestBlockSnapshot } from "../../presentation/pending-requests/snapshot";
import type { MessageStreamItem } from "../../domain/message-stream/items";
import type { TextMessageStreamItem } from "../../presentation/message-stream/text-view";
import type { ChatTurnDiffViewState } from "../../domain/turn-diff";

export interface MessageStreamBlock {
  key: string;
  node: UiNode;
}

export type { TextMessageStreamItem };

type MessageStreamDisclosureBucket =
  | "toolResults"
  | "activityGroups"
  | "agentDetails"
  | "textDetails"
  | "userMessageExpanded"
  | "goalObjectiveExpanded"
  | "approvalDetails";

export interface MessageStreamDisclosureState {
  toolResults: ReadonlySet<string>;
  activityGroups: ReadonlySet<string>;
  agentDetails: ReadonlySet<string>;
  textDetails: ReadonlySet<string>;
  userMessageExpanded: ReadonlySet<string>;
  goalObjectiveExpanded: ReadonlySet<string>;
  approvalDetails: ReadonlySet<string>;
}

export type MessageStreamTurnLifecycleState =
  | { kind: "idle" }
  | { kind: "starting"; pendingTurnStart: unknown }
  | { kind: "running"; turnId: string };

export interface PendingRequestBlockActions {
  resolveApproval: (requestId: PendingRequestId, action: ApprovalAction) => void;
  resolveUserInput: (requestId: PendingRequestId) => void;
  cancelUserInput: (requestId: PendingRequestId) => void;
  setApprovalDetailsExpanded?: (requestId: PendingRequestId, expanded: boolean) => void;
  setUserInputDraft: (key: string, value: string) => void;
}

export interface TextItemDetailStateContext {
  disclosures: MessageStreamDisclosureState;
  onDisclosureToggle?: (bucket: MessageStreamDisclosureBucket, id: string, open: boolean) => void;
}

export interface TextItemContentContext extends TextItemDetailStateContext {
  renderMarkdown: (parent: HTMLElement, text: string) => void;
}

export interface TextItemActionContext extends TextItemDetailStateContext {
  turnLifecycle: MessageStreamTurnLifecycleState;
  forkActionsItemId: string | null;
  onForkActionsToggle?: (itemId: string | null) => void;
  copyText?: (text: string) => void;
  canImplementPlanItem?: (item: MessageStreamItem) => boolean;
  onImplementPlanItem?: (item: MessageStreamItem) => void;
  canRollbackItem?: (item: MessageStreamItem) => boolean;
  onRollbackItem?: (item: MessageStreamItem) => void;
  canForkItem?: (item: MessageStreamItem) => boolean;
  onForkItem?: (item: MessageStreamItem, archiveSource: boolean) => void;
}

export interface TextItemMetadataContext extends TextItemDetailStateContext {
  activeThreadId: string | null;
  workspaceRoot?: string | null;
  openTurnDiff?: (state: ChatTurnDiffViewState) => void;
}

interface MessageStreamRenderContext {
  activeThreadId: string | null;
  turnLifecycle: MessageStreamTurnLifecycleState;
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
