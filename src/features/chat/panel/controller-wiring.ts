import type { ChatServerDiagnosticsActions } from "../server-actions/diagnostics-actions";
import type { ChatServerMetadataActions } from "../server-actions/metadata-actions";
import type { ChatComposerController } from "../composer/controller";
import type { ChatInboundController } from "../inbound/controller";
import type { RestoredThreadController } from "../threads/restored-thread-controller";
import type { ChatConnectionController } from "../session/connection-controller";
import type { ThreadRenameController } from "../threads/thread-rename-controller";
import type { ThreadResumeController } from "../threads/thread-resume-controller";
import type { ThreadSelectionActions } from "../threads/thread-selection-controller";
import type { ChatMessageRenderer } from "../ui/message-stream";
import type { ChatControllerCompositionPorts } from "./controller-ports";
import type { ChatViewRenderController } from "./view-render-controller";

export interface ChatControllerCompositionRefs {
  renderController: ChatViewRenderController;
  controller: ChatInboundController | null;
  connectionController: ChatConnectionController | null;
  threadSelection: ThreadSelectionActions | null;
  threadRename: ThreadRenameController | null;
  threadResume: ThreadResumeController | null;
  restoredThread: RestoredThreadController | null;
  serverMetadata: ChatServerMetadataActions | null;
  serverDiagnostics: ChatServerDiagnosticsActions | null;
  messageRenderer: ChatMessageRenderer | null;
  composerController: ChatComposerController | null;
}

export interface ChatControllerCompositionActions {
  client: ChatControllerCompositionPorts["client"] & {
    ensureConnected: () => Promise<void>;
  };
  render: ChatControllerCompositionPorts["render"] & {
    now: () => void;
    shellSlots: () => void;
  };
  status: ChatControllerCompositionPorts["status"] & {
    addSystemMessage: (text: string) => void;
    addStructuredSystemMessage: (text: string, details: Parameters<ChatInboundController["addStructuredSystemMessage"]>[1]) => void;
  };
  scroll: ChatControllerCompositionPorts["scroll"];
  thread: ChatControllerCompositionPorts["thread"] & {
    selectThread: (threadId: string) => Promise<void>;
    resumeThread: (threadId: string) => Promise<void>;
    refreshThreads: () => Promise<void>;
    refreshSkills: (forceReload?: boolean) => Promise<void>;
    publishAppServerMetadataSnapshot: () => void;
    resetTurnPresence: (hadTurns: boolean) => void;
    restorePlaceholder: (restoredThreadState: Parameters<RestoredThreadController["restore"]>[0]) => void;
    clearRestoredLifecycle: () => void;
  };
  runtime: ChatControllerCompositionPorts["runtime"] & {
    mcpStatusLines: () => Promise<string[]>;
  };
  composer: {
    setText: (text: string) => void;
  };
}

export function createChatControllerCompositionActions(
  ports: ChatControllerCompositionPorts,
  refs: ChatControllerCompositionRefs,
): ChatControllerCompositionActions {
  const render = {
    ...ports.render,
    now: () => {
      refs.renderController.render();
    },
    shellSlots: () => {
      refs.renderController.renderShellSlots();
    },
  };
  const status = {
    ...ports.status,
    addSystemMessage: (text: string) => {
      requireCompositionRef(refs.controller, "inbound controller").addSystemMessage(text);
      render.now();
    },
    addStructuredSystemMessage: (text: string, details: Parameters<ChatInboundController["addStructuredSystemMessage"]>[1]) => {
      requireCompositionRef(refs.controller, "inbound controller").addStructuredSystemMessage(text, details);
      render.now();
    },
  };

  const threadNavigation = {
    selectThread: (threadId: string) => requireCompositionRef(refs.threadSelection, "thread selection controller").selectThread(threadId),
    resumeThread: (threadId: string) => requireCompositionRef(refs.threadResume, "thread resume controller").resumeThread(threadId),
  };
  const threadRefresh = {
    refreshThreads: () => requireCompositionRef(refs.connectionController, "connection controller").refreshThreads(),
    refreshSkills: (forceReload?: boolean) =>
      requireCompositionRef(refs.connectionController, "connection controller").refreshSkills(forceReload),
    publishAppServerMetadataSnapshot: () => {
      requireCompositionRef(refs.serverMetadata, "server metadata actions").publishAppServerMetadataSnapshot();
    },
  };
  const threadLifecycle = {
    resetTurnPresence: (hadTurns: boolean) => {
      requireCompositionRef(refs.threadRename, "thread rename controller").resetThreadTurnPresence(hadTurns);
    },
    restorePlaceholder: (restoredThreadState: Parameters<RestoredThreadController["restore"]>[0]) => {
      requireCompositionRef(refs.restoredThread, "restored thread controller").restore(restoredThreadState);
    },
    clearRestoredLifecycle: () => {
      requireCompositionRef(refs.restoredThread, "restored thread controller").clear();
    },
  };

  return {
    client: {
      ...ports.client,
      ensureConnected: () => requireCompositionRef(refs.connectionController, "connection controller").ensureConnected(),
    },
    render,
    status,
    scroll: {
      ...ports.scroll,
      forceBottom: () => {
        ports.scroll.forceBottom();
        requireCompositionRef(refs.messageRenderer, "message renderer").forceMessagesToBottom();
      },
    },
    thread: {
      ...ports.thread,
      ...threadNavigation,
      ...threadRefresh,
      ...threadLifecycle,
    },
    runtime: {
      ...ports.runtime,
      mcpStatusLines: () => requireCompositionRef(refs.serverDiagnostics, "server diagnostics actions").mcpStatusLines(),
    },
    composer: {
      setText: (text) => {
        requireCompositionRef(refs.composerController, "composer controller").setDraft(text, { focus: true, renderIfDetached: true });
      },
    },
  };
}

export function requireCompositionRef<T>(value: T | null, name: string): T {
  if (!value) throw new Error(`Chat controller composition did not initialize ${name}.`);
  return value;
}
