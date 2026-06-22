import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { batch, computed, signal, type ReadonlySignal, type Signal } from "@preact/signals";

import type { RuntimeSnapshot } from "../domain/runtime/snapshot";
import { messageItemsHaveThreadTurns, runtimeSnapshotForChatSlices } from "../application/runtime/snapshot";
import { activeTurnId, chatTurnBusy, type ChatState } from "../application/state/root-reducer";
import {
  messageStreamActiveItems,
  messageStreamItems,
  messageStreamRollbackCandidateFromItems,
  messageStreamStableItems,
  type MessageStreamRollbackCandidate,
} from "../application/state/message-stream";
import type { MessageStreamItem } from "../domain/message-stream/items";
import {
  forkCandidatesFromItems,
  latestImplementablePlanTargetFromItems,
  type ForkCandidate,
  type PlanImplementationTarget,
} from "../domain/message-stream/selectors";

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
  turnBusy: ReadonlySignal<boolean>;
  activeTurnId: ReadonlySignal<string | null>;
  messageStreamItems: ReadonlySignal<readonly MessageStreamItem[]>;
  messageStreamStableItems: ReadonlySignal<readonly MessageStreamItem[]>;
  messageStreamActiveItems: ReadonlySignal<readonly MessageStreamItem[]>;
  messageStreamRollbackCandidate: ReadonlySignal<MessageStreamRollbackCandidate | null>;
  messageStreamForkCandidates: ReadonlySignal<readonly ForkCandidate[]>;
  messageStreamImplementPlanTarget: ReadonlySignal<PlanImplementationTarget | null>;
  hasThreadTurns: ReadonlySignal<boolean>;
  composerRuntimeSnapshot: ReadonlySignal<RuntimeSnapshot>;
}

export type ChatPanelToolbarShellState = Pick<ChatState, "connection" | "threadList" | "activeThread" | "runtime" | "turn" | "ui">;

export type ChatPanelGoalShellState = Pick<ChatState, "activeThread" | "ui">;

export interface ChatPanelMessageStreamShellState extends Pick<ChatState, "activeThread" | "messageStream" | "requests" | "ui"> {
  readonly activeTurnId: string | null;
  readonly items: readonly MessageStreamItem[];
  readonly stableItems: readonly MessageStreamItem[];
  readonly activeItems: readonly MessageStreamItem[];
  readonly rollbackCandidate: MessageStreamRollbackCandidate | null;
  readonly forkCandidates: readonly ForkCandidate[];
  readonly implementPlanTarget: PlanImplementationTarget | null;
}

export interface ChatPanelComposerShellState extends Pick<
  ChatState,
  "connection" | "threadList" | "activeThread" | "runtime" | "composer"
> {
  readonly turnBusy: boolean;
  readonly activeTurnId: string | null;
  readonly runtimeSnapshot: RuntimeSnapshot;
}

export const ChatPanelShellStateContext = createContext<ChatPanelShellState | null>(null);

export function createChatPanelShellState(initialState: ChatState): ChatPanelShellState {
  const connection = signal(initialState.connection);
  const threadList = signal(initialState.threadList);
  const activeThread = signal(initialState.activeThread);
  const runtime = signal(initialState.runtime);
  const turn = signal(initialState.turn);
  const messageStream = signal(initialState.messageStream);
  const requests = signal(initialState.requests);
  const composer = signal(initialState.composer);
  const ui = signal(initialState.ui);
  const turnBusy = computed(() => chatTurnBusy({ turn: turn.value }));
  const messageItems = computed(() => messageStreamItems(messageStream.value));
  const hasThreadTurns = computed(() => messageItemsHaveThreadTurns(messageItems.value));
  return {
    connection,
    threadList,
    activeThread,
    runtime,
    turn,
    messageStream,
    requests,
    composer,
    ui,
    turnBusy,
    activeTurnId: computed(() => activeTurnId({ turn: turn.value })),
    messageStreamItems: messageItems,
    messageStreamStableItems: computed(() => messageStreamStableItems(messageStream.value)),
    messageStreamActiveItems: computed(() => messageStreamActiveItems(messageStream.value)),
    messageStreamRollbackCandidate: computed(() => (turnBusy.value ? null : messageStreamRollbackCandidateFromItems(messageItems.value))),
    messageStreamForkCandidates: computed(() => (turnBusy.value ? [] : forkCandidatesFromItems(messageItems.value))),
    messageStreamImplementPlanTarget: computed(() => {
      if (!activeThread.value.id || turnBusy.value || runtime.value.selectedCollaborationMode !== "plan") return null;
      return latestImplementablePlanTargetFromItems(messageItems.value);
    }),
    hasThreadTurns,
    composerRuntimeSnapshot: computed(() =>
      runtimeSnapshotForChatSlices({
        runtimeConfig: connection.value.runtimeConfig,
        activeThread: activeThread.value,
        runtime: runtime.value,
        rateLimit: connection.value.rateLimit,
        hasThreadTurns: hasThreadTurns.value,
        availableModels: connection.value.availableModels,
      }),
    ),
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
    messageStream: shellState.messageStream.value,
    requests: shellState.requests.value,
    ui: shellState.ui.value,
    activeTurnId: shellState.activeTurnId.value,
    items: shellState.messageStreamItems.value,
    stableItems: shellState.messageStreamStableItems.value,
    activeItems: shellState.messageStreamActiveItems.value,
    rollbackCandidate: shellState.messageStreamRollbackCandidate.value,
    forkCandidates: shellState.messageStreamForkCandidates.value,
    implementPlanTarget: shellState.messageStreamImplementPlanTarget.value,
  };
}

export function composerStateFromShellState(shellState: ChatPanelShellState): ChatPanelComposerShellState {
  return {
    connection: shellState.connection.value,
    threadList: shellState.threadList.value,
    activeThread: shellState.activeThread.value,
    runtime: shellState.runtime.value,
    composer: shellState.composer.value,
    turnBusy: shellState.turnBusy.value,
    activeTurnId: shellState.activeTurnId.value,
    runtimeSnapshot: shellState.composerRuntimeSnapshot.value,
  };
}

export function useChatPanelShellState(): ChatPanelShellState {
  const context = useContext(ChatPanelShellStateContext);
  if (!context) throw new Error("Chat panel shell state is only available inside ChatPanelShell.");
  return context;
}
