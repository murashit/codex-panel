import type { AppServerClient } from "../../../../app-server/connection/client";
import type { ChatStateStore } from "../state/store";
import type { PluginSettingsRef, ThreadSurfaceBroadcaster } from "../ports/chat-host";
import { AutoTitleController } from "./auto-title-controller";
import { ThreadRenameEditorController } from "./rename-editor-controller";

export interface ThreadNamingPartsContext {
  settingsRef: PluginSettingsRef;
  threadSurfaces: ThreadSurfaceBroadcaster;
  stateStore: ChatStateStore;
  client: {
    currentClient: () => AppServerClient | null;
    ensureConnected: () => Promise<void>;
  };
  status: {
    addSystemMessage: (text: string) => void;
  };
}

export interface ThreadNamingParts {
  rename: ThreadRenameEditorController;
  autoTitle: AutoTitleController;
}

export function createThreadNamingParts(context: ThreadNamingPartsContext): ThreadNamingParts {
  const { settingsRef, threadSurfaces, stateStore, client, status } = context;
  const rename = new ThreadRenameEditorController({
    stateStore,
    vaultPath: settingsRef.vaultPath,
    settings: () => settingsRef.settings,
    ensureConnected: client.ensureConnected,
    currentClient: client.currentClient,
    addSystemMessage: status.addSystemMessage,
    notifyThreadRenamed: (threadId, name) => {
      threadSurfaces.notifyThreadRenamed(threadId, name);
    },
  });
  const autoTitle = new AutoTitleController({
    stateStore,
    vaultPath: settingsRef.vaultPath,
    settings: () => settingsRef.settings,
    currentClient: client.currentClient,
    notifyThreadRenamed: (threadId, name) => {
      threadSurfaces.notifyThreadRenamed(threadId, name);
    },
  });

  return {
    rename,
    autoTitle,
  };
}
