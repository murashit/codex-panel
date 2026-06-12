import type { AppServerClient } from "../../app-server/client";
import type { DisplayDetailSection, DisplayItem } from "./display/types";
import type { ChatStateStore } from "./state/reducer";
import type { ChatViewRenderController } from "./panel/view-render-controller";

interface ChatControllerCompositionActionPorts {
  client: {
    getClient: () => AppServerClient | null;
    setClient: (client: AppServerClient | null) => void;
    clear: () => void;
  };
  render: {
    panelRoot: () => HTMLElement | null;
    closeToolbarPanelOnOutsidePointer: (event: PointerEvent) => void;
    schedule: () => void;
  };
  state: {
    stateStore: ChatStateStore;
    systemItem: (text: string) => DisplayItem;
    structuredSystemItem: (text: string, details: DisplayDetailSection[]) => DisplayItem;
  };
  status: {
    set: (status: string) => void;
  };
  scroll: {
    forceBottom: () => void;
    followBottom: () => void;
    preservePosition: () => void;
  };
  thread: {
    ensureRestoredThreadLoaded: () => Promise<boolean>;
    startNewThread: () => Promise<void>;
    loadSharedThreadList: () => Promise<void>;
    notifyIdentityChanged: () => void;
    refreshTabHeader: () => void;
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
  composer: {
    setText: (text: string) => void;
  };
}

export function createChatControllerCompositionActions(
  ports: ChatControllerCompositionActionPorts,
  deps: {
    renderController: ChatViewRenderController;
    ensureConnected: () => Promise<void>;
    refreshThreads: () => Promise<void>;
    refreshSkills: (forceReload?: boolean) => Promise<void>;
    selectThread: (threadId: string) => Promise<void>;
    setComposerText: (text: string) => void;
  },
): ChatControllerCompositionActions {
  const { renderController } = deps;
  const render = {
    panelRoot: ports.render.panelRoot,
    closeToolbarPanelOnOutsidePointer: ports.render.closeToolbarPanelOnOutsidePointer,
    schedule: ports.render.schedule,
    now: () => {
      renderController.render();
    },
  };
  const status = {
    set: ports.status.set,
    addSystemMessage: (text: string) => {
      ports.state.stateStore.dispatch({ type: "message-stream/system-item-added", item: ports.state.systemItem(text) });
      render.now();
    },
    addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => {
      ports.state.stateStore.dispatch({
        type: "message-stream/system-item-added",
        item: ports.state.structuredSystemItem(text, details),
      });
      render.now();
    },
  };

  return {
    client: {
      getClient: ports.client.getClient,
      setClient: ports.client.setClient,
      clear: ports.client.clear,
      ensureConnected: deps.ensureConnected,
    },
    render,
    status,
    scroll: ports.scroll,
    thread: {
      ensureRestoredThreadLoaded: ports.thread.ensureRestoredThreadLoaded,
      startNewThread: ports.thread.startNewThread,
      loadSharedThreadList: ports.thread.loadSharedThreadList,
      notifyIdentityChanged: ports.thread.notifyIdentityChanged,
      refreshTabHeader: ports.thread.refreshTabHeader,
      selectThread: deps.selectThread,
      refreshThreads: deps.refreshThreads,
      refreshSkills: deps.refreshSkills,
    },
    composer: {
      setText: (text) => {
        deps.setComposerText(text);
        render.now();
      },
    },
  };
}
