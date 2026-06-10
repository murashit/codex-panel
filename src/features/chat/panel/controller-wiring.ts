import type { ChatComposerController } from "../composer/controller";
import type { DisplayDetailSection } from "../display/types";
import type { ChatConnectionController } from "../session/connection-controller";
import type { ThreadSelectionActions } from "../threads/thread-selection-controller";
import type { ChatMessageRenderer } from "../ui/message-stream";
import type { ChatControllerCompositionPorts } from "./controller-ports";
import type { ChatViewRenderController } from "./view-render-controller";

export interface ChatControllerCompositionBridges {
  connection: {
    controller: Pick<ChatConnectionController, "ensureConnected" | "refreshThreads" | "refreshSkills"> | null;
  };
  threadSelection: {
    actions: Pick<ThreadSelectionActions, "selectThread"> | null;
  };
  messageViewport: {
    renderer: Pick<ChatMessageRenderer, "forceMessagesToBottom"> | null;
  };
  composerDraft: {
    controller: Pick<ChatComposerController, "setDraft"> | null;
  };
}

export interface ChatControllerCompositionActions {
  client: ChatControllerCompositionPorts["client"] & {
    ensureConnected: () => Promise<void>;
  };
  render: ChatControllerCompositionPorts["render"] & {
    now: () => void;
  };
  status: ChatControllerCompositionPorts["status"] & {
    addSystemMessage: (text: string) => void;
    addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
  };
  scroll: ChatControllerCompositionPorts["scroll"];
  thread: ChatControllerCompositionPorts["thread"] & {
    selectThread: (threadId: string) => Promise<void>;
    refreshThreads: () => Promise<void>;
    refreshSkills: (forceReload?: boolean) => Promise<void>;
  };
  runtime: ChatControllerCompositionPorts["runtime"];
  composer: {
    setText: (text: string) => void;
  };
}

export function createChatControllerCompositionActions(
  ports: ChatControllerCompositionPorts,
  deps: {
    renderController: ChatViewRenderController;
    bridges: ChatControllerCompositionBridges;
  },
): ChatControllerCompositionActions {
  const { bridges, renderController } = deps;
  const render = {
    ...ports.render,
    now: () => {
      renderController.render();
    },
  };
  const status = {
    ...ports.status,
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
      ...ports.client,
      ensureConnected: () => requireCompositionBridge(bridges.connection.controller, "connection bridge").ensureConnected(),
    },
    render,
    status,
    scroll: {
      ...ports.scroll,
      forceBottom: () => {
        ports.scroll.forceBottom();
      },
    },
    thread: {
      ...ports.thread,
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
