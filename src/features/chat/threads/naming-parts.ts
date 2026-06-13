import type { ConnectionManager } from "../../../app-server/connection/connection-manager";
import type { AppServerClient } from "../../../app-server/connection/client";
import type { ChatStateStore } from "../state/reducer";
import type { CodexChatHost } from "../chat-host";
import { AutoTitleController } from "./auto-title-controller";
import { ThreadRenameEditorController } from "./rename-editor-controller";

export interface ThreadNamingPartsContext {
  plugin: CodexChatHost;
  stateStore: ChatStateStore;
  client: {
    currentClient: () => AppServerClient | null;
    ensureConnected: () => Promise<void>;
  };
  status: {
    addSystemMessage: (text: string) => void;
  };
}

export interface ThreadNamingPartsRefs {
  connection: ConnectionManager;
}

export interface ThreadNamingParts {
  rename: ThreadRenameEditorController;
  autoTitle: AutoTitleController;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
}

export function createThreadNamingParts(context: ThreadNamingPartsContext, refs: ThreadNamingPartsRefs): ThreadNamingParts {
  const { plugin, stateStore, client, status } = context;
  const rename = new ThreadRenameEditorController({
    stateStore,
    vaultPath: plugin.vaultPath,
    settings: () => plugin.settings,
    ensureConnected: client.ensureConnected,
    currentClient: () => refs.connection.currentClient(),
    addSystemMessage: status.addSystemMessage,
    notifyThreadRenamed: plugin.notifyThreadRenamed.bind(plugin),
  });
  const autoTitle = new AutoTitleController({
    stateStore,
    vaultPath: plugin.vaultPath,
    settings: () => plugin.settings,
    currentClient: client.currentClient,
    notifyThreadRenamed: plugin.notifyThreadRenamed.bind(plugin),
  });

  return {
    rename,
    autoTitle,
    resetThreadTurnPresence: (hadTurns) => {
      autoTitle.resetThreadTurnPresence(hadTurns);
    },
  };
}
