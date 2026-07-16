import { type ChatAction, type ChatState, chatReducer, createChatState } from "./root-reducer";
import type { ChatThreadStreamActiveSegment, ChatThreadStreamState } from "./thread-stream";
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
    },
    activeThread: { ...state.activeThread },
    restoration: { ...state.restoration },
    runtime: { ...state.runtime },
    turn: { lifecycle: state.turn.lifecycle },
    threadStream: cloneThreadStreamState(state.threadStream),
    pendingSubmission: state.pendingSubmission ? { ...state.pendingSubmission, item: { ...state.pendingSubmission.item } } : null,
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
      threadStreamActionMenu: { ...state.ui.threadStreamActionMenu },
      disclosures: cloneDisclosureUiState(state.ui.disclosures),
    },
  };
}

function cloneThreadStreamState(state: ChatThreadStreamState): ChatThreadStreamState {
  return {
    stableItems: [...state.stableItems],
    activeSegment: cloneActiveSegment(state.activeSegment),
    turnDiffs: new Map(state.turnDiffs),
    historyCursor: state.historyCursor,
    loadingHistory: state.loadingHistory,
    reportedLogs: new Set(state.reportedLogs),
  };
}

function cloneActiveSegment(segment: ChatThreadStreamActiveSegment | null): ChatThreadStreamActiveSegment | null {
  if (!segment) return null;
  return {
    turnId: segment.turnId,
    items: [...segment.items],
    indexById: new Map(segment.indexById),
    indexBySourceItemId: new Map(segment.indexBySourceItemId),
  };
}
