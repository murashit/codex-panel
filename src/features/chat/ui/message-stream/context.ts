import type { ComponentChild as UiNode } from "preact";

import type { ChatDisclosureBucket, ChatDisclosureUiState, ChatTurnLifecycleState } from "../../state/reducer";
import type { PendingRequestBlockSnapshot } from "../../conversation/pending-requests/snapshot";
import type { PendingRequestBlockActions } from "../../conversation/pending-requests/view-model";
import type { MessageStreamItem } from "../../message-stream/items";
import type { ChatTurnDiffViewState } from "../../turn-diff/model";

export interface MessageStreamBlock {
  key: string;
  node: UiNode;
}

export type TextMessageStreamItem = Extract<MessageStreamItem, { kind: "message" | "system" | "userInputResult" }>;

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

interface MessageStreamLayoutContext {
  activeThreadId: string | null;
  turnLifecycle: ChatTurnLifecycleState;
  historyCursor: string | null;
  loadingHistory: boolean;
  items: readonly MessageStreamItem[];
  stableItems?: readonly MessageStreamItem[];
  activeItems?: readonly MessageStreamItem[];
  turnDiffs?: ReadonlyMap<string, string>;
  workspaceRoot?: string | null;
  loadOlderTurns: () => void;
  pendingRequests?: PendingRequestBlockContext;
}

export interface TextItemContext extends TextItemContentContext, TextItemActionContext, TextItemMetadataContext {}

export interface MessageStreamContext extends MessageStreamLayoutContext, TextItemContext {}

export interface PendingRequestBlockContext {
  signature: string;
  snapshot: () => PendingRequestBlockSnapshot;
  actions: () => PendingRequestBlockActions;
  consumeAutoFocus: () => boolean;
}
