import type { AppServerClient } from "../../../../app-server/connection/client";
import type { ThreadOperations } from "../../../threads/thread-operations";
import type { ThreadTitleService } from "../../../threads/thread-title-service";
import type { GoalActions } from "./goal-actions";
import { createSelectionActions } from "./selection-actions";
import type { ChatResumeWorkTracker, ChatViewDeferredTasks } from "../lifecycle";
import type { ChatStateStore } from "../state/store";
import type { PluginSettingsRef, ThreadCatalogFacade, WorkspacePanels } from "../ports/chat-host";
import type { AutoTitleController } from "./auto-title-controller";
import { ThreadRenameEditorController } from "./rename-editor-controller";
import { createThreadManagementActions, type ThreadManagementActions, type ThreadManagementActionsHost } from "./thread-management-actions";
import { createThreadLifecycleParts } from "./lifecycle-parts";

interface ThreadPartsContext {
  settingsRef: PluginSettingsRef;
  workspace: Pick<WorkspacePanels, "focusThreadInOpenView" | "openThreadInNewView">;
  threadCatalog: Pick<ThreadCatalogFacade, "refreshFromOpenSurface">;
  state: {
    stateStore: ChatStateStore;
  };
  client: {
    getClient: () => AppServerClient | null;
    ensureConnected: () => Promise<void>;
  };
  lifecycle: {
    deferredTasks: ChatViewDeferredTasks;
    resumeWork: ChatResumeWorkTracker;
    getOpened: () => boolean;
    getClosing: () => boolean;
  };
  thread: {
    fetchActiveThreads: () => Promise<void>;
    notifyIdentityChanged: () => void;
    refreshTabHeader: () => void;
  };
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
  };
  liveState: {
    refresh: () => void;
  };
  scroll: {
    preservePosition: () => void;
    forceBottom: () => void;
  };
  goals: GoalActions;
  autoTitle: AutoTitleController;
  operations: ThreadOperations;
  titleService: ThreadTitleService;
}

export function createThreadParts(context: ThreadPartsContext) {
  const {
    settingsRef,
    workspace,
    threadCatalog,
    state,
    thread,
    status,
    liveState,
    scroll,
    client,
    lifecycle,
    goals,
    autoTitle,
    operations,
    titleService,
  } = context;
  const stateStore = state.stateStore;
  const currentClient = client.getClient;

  const rename = new ThreadRenameEditorController({
    stateStore,
    ensureConnected: client.ensureConnected,
    addSystemMessage: status.addSystemMessage,
    operations,
    titleService,
  });
  const threadLifecycle = createThreadLifecycleParts({
    settingsRef,
    stateStore,
    client: {
      currentClient,
      ensureConnected: client.ensureConnected,
    },
    lifecycle,
    thread: {
      notifyIdentityChanged: thread.notifyIdentityChanged,
      refreshTabHeader: thread.refreshTabHeader,
    },
    status,
    liveState,
    scroll,
    goals,
    resetThreadTurnPresence: (hadTurns) => {
      autoTitle.resetThreadTurnPresence(hadTurns);
    },
  });
  const { history, restoration, resume, identity } = threadLifecycle;
  const createManagementActions = (composer: { setText: (text: string) => void }): ThreadManagementActions => {
    const threadManagementHost: ThreadManagementActionsHost = {
      stateStore,
      vaultPath: settingsRef.vaultPath,
      operations,
      ensureConnected: client.ensureConnected,
      currentClient,
      addSystemMessage: status.addSystemMessage,
      setStatus: status.set,
      setComposerText: composer.setText,
      openThreadInNewView: (threadId) => workspace.openThreadInNewView(threadId),
      openThreadInCurrentPanel: (threadId) => resume.resumeThread(threadId),
      notifyActiveThreadIdentityChanged: () => {
        thread.notifyIdentityChanged();
      },
      refreshAfterThreadMutation: async () => {
        await thread.fetchActiveThreads();
        threadCatalog.refreshFromOpenSurface();
      },
    };
    return createThreadManagementActions(threadManagementHost);
  };

  return {
    history,
    createManagementActions,
    goals,
    restoration,
    resume,
    identity,
    rename,
    autoTitle,
  };
}

interface ThreadSelectionActionsContext {
  workspace: Pick<WorkspacePanels, "focusThreadInOpenView">;
  state: {
    stateStore: ChatStateStore;
  };
  status: {
    addSystemMessage: (text: string) => void;
  };
  thread: {
    resumeThread: (threadId: string) => Promise<void>;
  };
}

export function createThreadSelectionActions(
  context: ThreadSelectionActionsContext,
  refs: {
    closeForThreadSelection: () => void;
  },
) {
  const { workspace, thread, status } = context;
  const stateStore = context.state.stateStore;

  return createSelectionActions({
    stateStore,
    closeForThreadSelection: refs.closeForThreadSelection,
    focusThreadInOpenView: workspace.focusThreadInOpenView,
    resumeThread: thread.resumeThread,
    addSystemMessage: status.addSystemMessage,
  });
}
