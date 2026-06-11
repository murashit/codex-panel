import type { ChatComposerController } from "../conversation/composer/controller";
import type { DisplayDetailSection } from "../display/types";
import type { ChatConnectionController } from "../connection/connection-controller";
import type { ThreadSelectionActions } from "../threads/thread-selection-controller";
import type { ChatControllerCompositionPorts } from "./controller-ports";
import type { ChatViewRenderController } from "./view-render-controller";

type ChatControllerCompositionActionPorts = Pick<
  ChatControllerCompositionPorts,
  "client" | "render" | "status" | "scroll" | "thread" | "state" | "runtime"
>;

export interface ChatControllerCompositionBridges {
  connection: {
    controller: Pick<ChatConnectionController, "ensureConnected" | "refreshThreads" | "refreshSkills"> | null;
  };
  threadSelection: {
    actions: Pick<ThreadSelectionActions, "selectThread"> | null;
  };
  composerDraft: {
    controller: Pick<ChatComposerController, "setDraft"> | null;
  };
}

export interface ChatControllerCompositionActions {
  client: ChatControllerCompositionActionPorts["client"] & {
    ensureConnected: () => Promise<void>;
  };
  render: ChatControllerCompositionActionPorts["render"] & {
    now: () => void;
  };
  status: ChatControllerCompositionActionPorts["status"] & {
    addSystemMessage: (text: string) => void;
    addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
  };
  scroll: ChatControllerCompositionActionPorts["scroll"];
  thread: ChatControllerCompositionActionPorts["thread"] & {
    selectThread: (threadId: string) => Promise<void>;
    refreshThreads: () => Promise<void>;
    refreshSkills: (forceReload?: boolean) => Promise<void>;
  };
  runtime: ChatControllerCompositionActionPorts["runtime"];
  composer: {
    setText: (text: string) => void;
  };
}

export function createChatControllerCompositionActions(
  ports: ChatControllerCompositionActionPorts,
  deps: {
    renderController: ChatViewRenderController;
    bridges: ChatControllerCompositionBridges;
  },
): ChatControllerCompositionActions {
  const { bridges, renderController } = deps;
  const render = {
    panelRoot: ports.render.panelRoot,
    toolbarNode: ports.render.toolbarNode,
    goalNode: ports.render.goalNode,
    messagesNode: ports.render.messagesNode,
    composerNode: ports.render.composerNode,
    closeToolbarPanelOnOutsidePointer: ports.render.closeToolbarPanelOnOutsidePointer,
    schedule: ports.render.schedule,
    now: () => {
      renderController.render();
    },
  };
  const status = {
    set: ports.status.set,
    addSystemMessage: (text: string) => {
      ports.state.stateStore.dispatch({ type: "transcript/system-message-added", item: ports.state.systemItem(text) });
      render.now();
    },
    addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => {
      ports.state.stateStore.dispatch({
        type: "transcript/system-message-added",
        item: ports.state.structuredSystemItem(text, details),
      });
      render.now();
    },
  };

  const threadNavigation = {
    selectThread: (threadId: string) =>
      requireCompositionBridge(bridges.threadSelection.actions, "thread selection bridge").selectThread(threadId),
  };
  const threadRefresh = {
    refreshThreads: () => requireCompositionBridge(bridges.connection.controller, "connection bridge").refreshThreads(),
    refreshSkills: (forceReload?: boolean) =>
      requireCompositionBridge(bridges.connection.controller, "connection bridge").refreshSkills(forceReload),
  };

  return {
    client: {
      getClient: ports.client.getClient,
      setClient: ports.client.setClient,
      clear: ports.client.clear,
      ensureConnected: () => requireCompositionBridge(bridges.connection.controller, "connection bridge").ensureConnected(),
    },
    render,
    status,
    scroll: {
      followBottom: ports.scroll.followBottom,
      preservePosition: ports.scroll.preservePosition,
      forceBottom: () => {
        ports.scroll.forceBottom();
      },
    },
    thread: {
      ensureRestoredThreadLoaded: ports.thread.ensureRestoredThreadLoaded,
      startNewThread: ports.thread.startNewThread,
      loadSharedThreadList: ports.thread.loadSharedThreadList,
      notifyIdentityChanged: ports.thread.notifyIdentityChanged,
      refreshTabHeader: ports.thread.refreshTabHeader,
      ...threadNavigation,
      ...threadRefresh,
    },
    runtime: ports.runtime,
    composer: {
      setText: (text) => {
        requireCompositionBridge(bridges.composerDraft.controller, "composer draft bridge").setDraft(text, {
          focus: true,
        });
        render.now();
      },
    },
  };
}

function requireCompositionBridge<T>(value: T | null, name: string): T {
  if (!value) throw new Error(`Chat controller composition did not initialize ${name}.`);
  return value;
}
