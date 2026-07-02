import type { ChatMessageStreamActiveSegment, ChatMessageStreamState } from "./message-stream";
import { type ChatAction, type ChatState, chatReducer, createChatState } from "./root-reducer";
import { cloneDisclosureUiState } from "./ui-state";

export interface ChatStateStore {
  getState(): ChatState;
  dispatch(action: ChatAction): ChatState;
  subscribe(listener: () => void): () => void;
}

export function createChatStateStore(initialState: ChatState = createChatState()): ChatStateStore {
  let current = cloneChatState(initialState);
  const listeners = new Set<() => void>();
  return {
    getState: () => current,
    dispatch(action) {
      const next = chatReducer(current, action);
      if (next === current) return current;
      current = next;
      for (const listener of listeners) listener();
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function cloneChatState(state: ChatState): ChatState {
  return {
    connection: {
      ...state.connection,
      availableModels: [...state.connection.availableModels],
      availableSkills: [...state.connection.availableSkills],
      availablePermissionProfiles: state.connection.availablePermissionProfiles.map((profile) => ({ ...profile })),
    },
    threadList: {
      listedThreads: [...state.threadList.listedThreads],
      threadsLoaded: state.threadList.threadsLoaded,
    },
    activeThread: { ...state.activeThread },
    runtime: { ...state.runtime },
    turn: { lifecycle: state.turn.lifecycle },
    messageStream: cloneMessageStreamState(state.messageStream),
    requests: {
      approvals: [...state.requests.approvals],
      pendingUserInputs: [...state.requests.pendingUserInputs],
      pendingMcpElicitations: [...state.requests.pendingMcpElicitations],
      userInputDrafts: new Map(state.requests.userInputDrafts),
      mcpElicitationDrafts: new Map(state.requests.mcpElicitationDrafts),
    },
    composer: {
      ...state.composer,
      suggestions: [...state.composer.suggestions],
    },
    ui: {
      toolbarPanel: state.ui.toolbarPanel,
      archiveConfirmThreadId: state.ui.archiveConfirmThreadId,
      rename: { ...state.ui.rename },
      goalEditor: { ...state.ui.goalEditor },
      messageActionMenu: { ...state.ui.messageActionMenu },
      disclosures: cloneDisclosureUiState(state.ui.disclosures),
    },
  };
}

function cloneMessageStreamState(state: ChatMessageStreamState): ChatMessageStreamState {
  return {
    stableItems: [...state.stableItems],
    activeSegment: cloneActiveSegment(state.activeSegment),
    turnDiffs: new Map(state.turnDiffs),
    historyCursor: state.historyCursor,
    loadingHistory: state.loadingHistory,
    reportedLogs: new Set(state.reportedLogs),
  };
}

function cloneActiveSegment(segment: ChatMessageStreamActiveSegment | null): ChatMessageStreamActiveSegment | null {
  if (!segment) return null;
  return {
    turnId: segment.turnId,
    items: [...segment.items],
    indexById: new Map(segment.indexById),
    indexBySourceItemId: new Map(segment.indexBySourceItemId),
  };
}
