import type { ChatAction, ChatState } from "../../state/reducer";
import type { ChatMessageStreamActionPort, ChatMessageStreamContextPort, ChatMessageStreamRequestPort } from "./context-builder";

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
