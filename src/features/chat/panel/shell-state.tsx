import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { batch, computed, signal, type ReadonlySignal, type Signal } from "@preact/signals";

import type { RuntimeSnapshot } from "../domain/runtime/snapshot";
import { messageItemsHaveThreadTurns, runtimeSnapshotForChatSlices } from "../application/runtime/snapshot";
import { implementPlanTargetFromState } from "../application/conversation/plan-implementation";
import { activeTurnId, chatTurnBusy } from "../application/conversation/turn-state";
import type { ChatState } from "../application/state/root-reducer";
import {
  messageStreamActiveItems,
  messageStreamItems,
  messageStreamRollbackCandidateFromItems,
  messageStreamStableItems,
  type MessageStreamRollbackCandidate,
} from "../application/state/message-stream";
import type { MessageStreamItem } from "../domain/message-stream/items";
import { forkCandidatesFromItems, type ForkCandidate, type PlanImplementationTarget } from "../domain/message-stream/selectors";

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
  activeThreadId: ReadonlySignal<ChatState["activeThread"]["id"]>;
  activeThreadCwd: ReadonlySignal<ChatState["activeThread"]["cwd"]>;
  activeThreadGoal: ReadonlySignal<ChatState["activeThread"]["goal"]>;
  messageStreamItems: ReadonlySignal<readonly MessageStreamItem[]>;
  messageStreamStableItems: ReadonlySignal<readonly MessageStreamItem[]>;
  messageStreamActiveItems: ReadonlySignal<readonly MessageStreamItem[]>;
  messageStreamRollbackCandidate: ReadonlySignal<MessageStreamRollbackCandidate | null>;
  messageStreamForkCandidates: ReadonlySignal<readonly ForkCandidate[]>;
  messageStreamImplementPlanTarget: ReadonlySignal<PlanImplementationTarget | null>;
  hasThreadTurns: ReadonlySignal<boolean>;
  goalEditor: ReadonlySignal<ChatState["ui"]["goalEditor"]>;
  goalObjectiveExpanded: ReadonlySignal<ChatState["ui"]["disclosures"]["goalObjectiveExpanded"]>;
  toolbarRuntimeSnapshot: ReadonlySignal<RuntimeSnapshot>;
  composerRuntimeSnapshot: ReadonlySignal<RuntimeSnapshot>;
}

export interface ChatPanelToolbarShellState extends Pick<ChatState, "connection" | "threadList" | "runtime" | "ui"> {
  readonly activeThreadId: ChatState["activeThread"]["id"];
  readonly turnBusy: boolean;
  readonly runtimeSnapshot: RuntimeSnapshot;
}

export interface ChatPanelGoalShellState {
  readonly goal: ChatState["activeThread"]["goal"];
  readonly goalEditor: ChatState["ui"]["goalEditor"];
  readonly goalObjectiveExpanded: ChatState["ui"]["disclosures"]["goalObjectiveExpanded"];
}

export interface ChatPanelMessageStreamShellState extends Pick<ChatState, "messageStream" | "requests" | "ui"> {
  readonly activeThreadId: ChatState["activeThread"]["id"];
  readonly activeThreadCwd: ChatState["activeThread"]["cwd"];
  readonly activeTurnId: string | null;
  readonly items: readonly MessageStreamItem[];
  readonly stableItems: readonly MessageStreamItem[];
  readonly activeItems: readonly MessageStreamItem[];
  readonly rollbackCandidate: MessageStreamRollbackCandidate | null;
  readonly forkCandidates: readonly ForkCandidate[];
  readonly implementPlanTarget: PlanImplementationTarget | null;
}

export interface ChatPanelComposerShellState extends Pick<ChatState, "connection" | "threadList" | "runtime" | "composer"> {
  readonly activeThreadId: ChatState["activeThread"]["id"];
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
  const activeThreadIdSignal = computed(() => activeThread.value.id);
  const activeThreadCwd = computed(() => activeThread.value.cwd);
  const activeThreadTokenUsage = computed(() => activeThread.value.tokenUsage);
  const activeThreadGoal = computed(() => activeThread.value.goal);
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
    activeThreadId: activeThreadIdSignal,
    activeThreadCwd,
    activeThreadGoal,
    messageStreamItems: messageItems,
    messageStreamStableItems: computed(() => messageStreamStableItems(messageStream.value)),
    messageStreamActiveItems: computed(() => messageStreamActiveItems(messageStream.value)),
    messageStreamRollbackCandidate: computed(() => (turnBusy.value ? null : messageStreamRollbackCandidateFromItems(messageItems.value))),
    messageStreamForkCandidates: computed(() => (turnBusy.value ? [] : forkCandidatesFromItems(messageItems.value))),
    messageStreamImplementPlanTarget: computed(() =>
      implementPlanTargetFromState({
        activeThread: { id: activeThreadIdSignal.value },
        turn: turn.value,
        runtime: { selectedCollaborationMode: runtime.value.selectedCollaborationMode },
        messageStream: messageStream.value,
      }),
    ),
    hasThreadTurns,
    goalEditor: computed(() => ui.value.goalEditor),
    goalObjectiveExpanded: computed(() => ui.value.disclosures.goalObjectiveExpanded),
    toolbarRuntimeSnapshot: computed(() =>
      runtimeSnapshotForChatSlices({
        runtimeConfig: connection.value.runtimeConfig,
        activeThread: { id: activeThreadIdSignal.value, tokenUsage: activeThreadTokenUsage.value },
        runtime: runtime.value,
        rateLimit: connection.value.rateLimit,
        hasThreadTurns: false,
        availableModels: connection.value.availableModels,
      }),
    ),
    composerRuntimeSnapshot: computed(() =>
      runtimeSnapshotForChatSlices({
        runtimeConfig: connection.value.runtimeConfig,
        activeThread: { id: activeThreadIdSignal.value, tokenUsage: activeThreadTokenUsage.value },
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
    runtime: shellState.runtime.value,
    ui: shellState.ui.value,
    activeThreadId: shellState.activeThreadId.value,
    turnBusy: shellState.turnBusy.value,
    runtimeSnapshot: shellState.toolbarRuntimeSnapshot.value,
  };
}

export function goalStateFromShellState(shellState: ChatPanelShellState): ChatPanelGoalShellState {
  return {
    goal: shellState.activeThreadGoal.value,
    goalEditor: shellState.goalEditor.value,
    goalObjectiveExpanded: shellState.goalObjectiveExpanded.value,
  };
}

export function messageStreamStateFromShellState(shellState: ChatPanelShellState): ChatPanelMessageStreamShellState {
  return {
    messageStream: shellState.messageStream.value,
    requests: shellState.requests.value,
    ui: shellState.ui.value,
    activeThreadId: shellState.activeThreadId.value,
    activeThreadCwd: shellState.activeThreadCwd.value,
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
    runtime: shellState.runtime.value,
    composer: shellState.composer.value,
    activeThreadId: shellState.activeThreadId.value,
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
