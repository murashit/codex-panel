import type { ChatAction, ChatState } from "../../state/reducer";
import type { PendingRequestBlockSnapshot } from "../../conversation/pending-requests/snapshot";
import type { DisplayItem } from "../../display/types";
import type { ChatTurnDiffViewState } from "../../turn-diff/model";
import type { PendingRequestBlockActions } from "../pending-request-block";

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
  setOpenDetail: (key: string, open: boolean) => void;
  loadOlderTurns: () => void;
  renderMarkdown: (element: HTMLElement, text: string) => void;
  copyMessageText: (text: string) => void;
  actions: ChatMessageStreamActionPort;
  requests: ChatMessageStreamRequestPort;
}

export interface MessageStreamContextPortOptions {
  vaultPath: string;
  state: () => ChatState;
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
    setOpenDetail: (key, open) => {
      setMessageStreamDetailOpen(options, key, open);
    },
    loadOlderTurns: options.loadOlderTurns,
    renderMarkdown: options.renderMarkdown,
    copyMessageText: options.copyMessageText,
    actions: options.actions,
    requests: options.requests,
  };
}

function setMessageStreamDetailOpen(options: MessageStreamContextPortOptions, key: string, open: boolean): void {
  if (open && key.startsWith("message:fork-actions:")) {
    for (const openKey of options.state().ui.openDetails) {
      if (openKey.startsWith("message:fork-actions:") && openKey !== key) {
        options.dispatch({ type: "ui/detail-open-set", key: openKey, open: false });
      }
    }
  }
  options.dispatch({ type: "ui/detail-open-set", key, open });
}
