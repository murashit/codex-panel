import type { ComponentChild as UiNode } from "preact";

import type { ChatTurnLifecycleState } from "../../state/reducer";
import type { PendingRequestSnapshot } from "../../state/selectors";
import type { DisplayItem } from "../../display/types";
import type { PendingRequestMessageActions } from "../pending-request-message";
import type { ChatTurnDiffViewState } from "../turn-diff";

export interface MessageStreamBlock {
  key: string;
  node: UiNode;
}

export type RenderableTextItem = Extract<DisplayItem, { kind: "message" | "system" | "userInputResult" }>;

export interface MessageDetailStateContext {
  openDetails: ReadonlySet<string>;
  onDetailsToggle?: (key: string, open: boolean) => void;
}

export interface MessageContentContext extends MessageDetailStateContext {
  renderMarkdown: (parent: HTMLElement, text: string) => void;
}

export interface MessageActionContext extends MessageDetailStateContext {
  turnLifecycle: ChatTurnLifecycleState;
  copyText?: (text: string) => void;
  canImplementPlanItem?: (item: DisplayItem) => boolean;
  onImplementPlanItem?: (item: DisplayItem) => void;
  canRollbackItem?: (item: DisplayItem) => boolean;
  onRollbackItem?: (item: DisplayItem) => void;
  canForkItem?: (item: DisplayItem) => boolean;
  onForkItem?: (item: DisplayItem, archiveSource: boolean) => void;
}

export interface MessageMetadataContext extends MessageDetailStateContext {
  activeThreadId: string | null;
  workspaceRoot?: string | null;
  openTurnDiff?: (state: ChatTurnDiffViewState) => void;
}

interface MessageStreamLayoutContext {
  activeThreadId: string | null;
  turnLifecycle: ChatTurnLifecycleState;
  historyCursor: string | null;
  loadingHistory: boolean;
  displayItems: readonly DisplayItem[];
  turnDiffs?: ReadonlyMap<string, string>;
  workspaceRoot?: string | null;
  loadOlderTurns: () => void;
  pendingRequests?: PendingRequestBlockContext;
}

export interface MessageItemContext extends MessageContentContext, MessageActionContext, MessageMetadataContext {}

export interface MessageStreamContext extends MessageStreamLayoutContext, MessageItemContext {}

export interface PendingRequestBlockContext {
  signature: string;
  snapshot: () => PendingRequestSnapshot;
  actions: () => PendingRequestMessageActions;
  consumeAutoFocus: () => boolean;
}
