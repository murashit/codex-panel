import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { batch, signal, type Signal } from "@preact/signals";

import type { ChatState } from "../application/state/root-reducer";

export interface ChatPanelShellState {
  connection: Signal<ChatState["connection"]>;
  threadList: Signal<ChatState["threadList"]>;
  activeThread: Signal<ChatState["activeThread"]>;
  runtime: Signal<ChatState["runtime"]>;
  turn: Signal<ChatState["turn"]>;
  messageStream: Signal<ChatState["messageStream"]>;
  requests: Signal<ChatState["requests"]>;
  composer: Signal<ChatState["composer"]>;
  ui: Signal<ChatState["ui"]>;
}

export type ChatPanelToolbarShellState = Pick<ChatState, "connection" | "threadList" | "activeThread" | "runtime" | "turn" | "ui">;

export type ChatPanelGoalShellState = Pick<ChatState, "activeThread" | "ui">;

export type ChatPanelMessageStreamShellState = Pick<ChatState, "activeThread" | "runtime" | "turn" | "messageStream" | "requests" | "ui">;

export type ChatPanelComposerShellState = Pick<
  ChatState,
  "connection" | "threadList" | "activeThread" | "runtime" | "turn" | "messageStream" | "composer"
>;

export const ChatPanelShellStateContext = createContext<ChatPanelShellState | null>(null);

export function createChatPanelShellState(initialState: ChatState): ChatPanelShellState {
  return {
    connection: signal(initialState.connection),
    threadList: signal(initialState.threadList),
    activeThread: signal(initialState.activeThread),
    runtime: signal(initialState.runtime),
    turn: signal(initialState.turn),
    messageStream: signal(initialState.messageStream),
    requests: signal(initialState.requests),
    composer: signal(initialState.composer),
    ui: signal(initialState.ui),
  };
}

export function syncChatPanelShellState(shellState: ChatPanelShellState, nextState: ChatState): void {
  batch(() => {
    if (shellState.connection.value !== nextState.connection) shellState.connection.value = nextState.connection;
    if (shellState.threadList.value !== nextState.threadList) shellState.threadList.value = nextState.threadList;
    if (shellState.activeThread.value !== nextState.activeThread) shellState.activeThread.value = nextState.activeThread;
    if (shellState.runtime.value !== nextState.runtime) shellState.runtime.value = nextState.runtime;
    if (shellState.turn.value !== nextState.turn) shellState.turn.value = nextState.turn;
    if (shellState.messageStream.value !== nextState.messageStream) shellState.messageStream.value = nextState.messageStream;
    if (shellState.requests.value !== nextState.requests) shellState.requests.value = nextState.requests;
    if (shellState.composer.value !== nextState.composer) shellState.composer.value = nextState.composer;
    if (shellState.ui.value !== nextState.ui) shellState.ui.value = nextState.ui;
  });
}

export function toolbarStateFromShellState(shellState: ChatPanelShellState): ChatPanelToolbarShellState {
  return {
    connection: shellState.connection.value,
    threadList: shellState.threadList.value,
    activeThread: shellState.activeThread.value,
    runtime: shellState.runtime.value,
    turn: shellState.turn.value,
    ui: shellState.ui.value,
  };
}

export function goalStateFromShellState(shellState: ChatPanelShellState): ChatPanelGoalShellState {
  return {
    activeThread: shellState.activeThread.value,
    ui: shellState.ui.value,
  };
}

export function messageStreamStateFromShellState(shellState: ChatPanelShellState): ChatPanelMessageStreamShellState {
  return {
    activeThread: shellState.activeThread.value,
    runtime: shellState.runtime.value,
    turn: shellState.turn.value,
    messageStream: shellState.messageStream.value,
    requests: shellState.requests.value,
    ui: shellState.ui.value,
  };
}

export function composerStateFromShellState(shellState: ChatPanelShellState): ChatPanelComposerShellState {
  return {
    connection: shellState.connection.value,
    threadList: shellState.threadList.value,
    activeThread: shellState.activeThread.value,
    runtime: shellState.runtime.value,
    turn: shellState.turn.value,
    messageStream: shellState.messageStream.value,
    composer: shellState.composer.value,
  };
}

export function useChatPanelShellState(): ChatPanelShellState {
  const context = useContext(ChatPanelShellStateContext);
  if (!context) throw new Error("Chat panel shell state is only available inside ChatPanelShell.");
  return context;
}
