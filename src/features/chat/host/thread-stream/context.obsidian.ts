import type { App, Component } from "obsidian";
import { copyTextWithNotice } from "../../../../shared/obsidian/clipboard.obsidian";
import type { ChatAction } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import { renderStreamMarkdown, ThreadStreamMarkdownRenderer } from "../../ui/thread-stream/markdown-renderer.obsidian";
import type { ChatThreadStreamActions, ChatThreadStreamDependencies, ChatThreadStreamRequests } from "./view-projection";

interface ChatThreadStreamDependencyOptions {
  panelId: string;
  app: App;
  owner: Component;
  stateStore: ChatStateStore;
  vaultPath: string;
  loadOlderTurns: () => void;
  actions: ChatThreadStreamActions;
  requests: ChatThreadStreamRequests;
}

export function createChatThreadStreamDependencies(options: ChatThreadStreamDependencyOptions): ChatThreadStreamDependencies {
  const obsidianMarkdownRenderer = new ThreadStreamMarkdownRenderer({
    app: options.app,
    owner: options.owner,
    vaultPath: options.vaultPath,
    openThread: options.actions.openThreadInAvailableView,
  });
  const dispatch = (action: ChatAction): void => {
    options.stateStore.dispatch(action);
  };

  return {
    panelId: options.panelId,
    vaultPath: options.vaultPath,
    setDisclosureOpen: (bucket, id, open) => {
      dispatch({ type: "ui/disclosure-set", bucket, id, open });
    },
    setForkMenuItem: (itemId) => {
      dispatch({ type: "ui/thread-stream-fork-menu-set", itemId });
    },
    loadOlderTurns: options.loadOlderTurns,
    renderObsidianMarkdown: (element, text) => {
      obsidianMarkdownRenderer.renderObsidianMarkdown(element, text);
    },
    renderStreamMarkdown: (element, text) => {
      renderStreamMarkdown(element, text, {
        app: options.app,
        vaultPath: options.vaultPath,
      });
    },
    copyDialogueText: (text) => {
      void copyTextWithNotice(text, "Copied message.", "Could not copy message.");
    },
    actions: options.actions,
    requests: options.requests,
  };
}
