import type { ChatAction, ChatDisclosureBucket } from "../../state/reducer";
import type { PendingRequestBlockSnapshot } from "../../conversation/pending-requests/snapshot";
import type { PendingRequestBlockActions } from "../../conversation/pending-requests/view-model";
import type { DisplayItem } from "../../display/types";
import type { ChatTurnDiffViewState } from "../../turn-diff/model";

export interface ChatMessageStreamActionPort {
  rollbackThread: (threadId: string) => void;
  forkThreadFromTurn: (threadId: string, turnId: string, archiveSource: boolean) => void;
  implementPlan: (item: DisplayItem) => void;
  openTurnDiff: (state: ChatTurnDiffViewState) => void;
}

export interface ChatMessageStreamRequestPort {
  pendingSignature: () => string;
  pendingSnapshot: () => PendingRequestBlockSnapshot;
  pendingActions: () => PendingRequestBlockActions;
  consumePendingAutoFocus: () => boolean;
}

export interface ChatMessageStreamContextPort {
  vaultPath: string;
  setDisclosureOpen: (bucket: ChatDisclosureBucket, id: string, open: boolean) => void;
  setForkActionsItem: (itemId: string | null) => void;
  loadOlderTurns: () => void;
  renderMarkdown: (element: HTMLElement, text: string) => void;
  copyMessageText: (text: string) => void;
  actions: ChatMessageStreamActionPort;
  requests: ChatMessageStreamRequestPort;
}

export interface MessageStreamContextPortOptions {
  vaultPath: string;
  dispatch: (action: ChatAction) => void;
  loadOlderTurns: () => void;
  renderMarkdown: (element: HTMLElement, text: string) => void;
  copyMessageText: (text: string) => void;
  actions: ChatMessageStreamActionPort;
  requests: ChatMessageStreamRequestPort;
}

export function createMessageStreamContextPort(options: MessageStreamContextPortOptions): ChatMessageStreamContextPort {
  return {
    vaultPath: options.vaultPath,
    setDisclosureOpen: (bucket, id, open) => {
      options.dispatch({ type: "ui/disclosure-set", bucket, id, open });
    },
    setForkActionsItem: (itemId) => {
      options.dispatch({ type: "ui/message-fork-actions-set", itemId });
    },
    loadOlderTurns: options.loadOlderTurns,
    renderMarkdown: options.renderMarkdown,
    copyMessageText: options.copyMessageText,
    actions: options.actions,
    requests: options.requests,
  };
}
