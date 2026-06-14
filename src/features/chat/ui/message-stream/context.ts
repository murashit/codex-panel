import type { ComponentChild as UiNode } from "preact";

import type { ChatDisclosureBucket, ChatDisclosureUiState, ChatTurnLifecycleState } from "../../application/state/reducer";
import type { PendingRequestBlockActions } from "../../application/pending-requests/block";
import type { PendingRequestBlockSnapshot } from "../../presentation/pending-requests/snapshot";
import type { MessageStreamItem } from "../../domain/message-stream/items";
import type { TextMessageStreamItem } from "../../presentation/message-stream/text-view";
import type { ChatTurnDiffViewState } from "../../domain/turn-diff";

export interface MessageStreamBlock {
  key: string;
  node: UiNode;
}

export type { TextMessageStreamItem };

export interface TextItemDetailStateContext {
  disclosures: ChatDisclosureUiState;
  onDisclosureToggle?: (bucket: ChatDisclosureBucket, id: string, open: boolean) => void;
}

export interface TextItemContentContext extends TextItemDetailStateContext {
  renderMarkdown: (parent: HTMLElement, text: string) => void;
}

export interface TextItemActionContext extends TextItemDetailStateContext {
  turnLifecycle: ChatTurnLifecycleState;
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
  turnLifecycle: ChatTurnLifecycleState;
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
