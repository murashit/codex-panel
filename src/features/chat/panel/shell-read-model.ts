import { batch, computed, type ReadonlySignal, type Signal, signal } from "@preact/signals";
import { explicitThreadName } from "../../../domain/threads/model";
import { implementPlanTargetFromState } from "../application/conversation/plan-implementation";
import { activeTurnId, chatTurnBusy } from "../application/conversation/turn-state";
import { messageItemsHaveThreadTurns, runtimeSnapshotForChatSlices } from "../application/runtime/snapshot";
import {
  type MessageStreamRollbackCandidate,
  messageStreamActiveItems,
  messageStreamItems,
  messageStreamRollbackCandidateFromItems,
  messageStreamStableItems,
} from "../application/state/message-stream";
import type { ChatState } from "../application/state/root-reducer";
import type { MessageStreamItem } from "../domain/message-stream/items";
import { type ForkCandidate, forkCandidatesFromItems, type PlanImplementationTarget } from "../domain/message-stream/selectors";
import type { RuntimeSnapshot } from "../domain/runtime/snapshot";

export interface ChatPanelShellReadModelBinding {
  readonly readModel: ChatPanelShellReadModel;
  sync(nextState: ChatState): void;
}

interface ChatPanelShellReadModel {
  readonly toolbar: ChatPanelToolbarReadModel;
  readonly goal: ChatPanelGoalReadModel;
  readonly messageStream: ChatPanelMessageStreamReadModel;
  readonly composer: ChatPanelComposerReadModel;
}

interface ChatPanelShellSignals {
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
  messageStreamDisclosures: ReadonlySignal<ChatPanelMessageStreamDisclosureState>;
  messageStreamForkMenuItemId: ReadonlySignal<ChatState["ui"]["messageActionMenu"]["forkMenuItemId"]>;
  hasThreadTurns: ReadonlySignal<boolean>;
  goalEditor: ReadonlySignal<ChatState["ui"]["goalEditor"]>;
  goalObjectiveExpanded: ReadonlySignal<ChatState["ui"]["disclosures"]["goalObjectiveExpanded"]>;
  toolbarRuntimeSnapshot: ReadonlySignal<RuntimeSnapshot>;
  composerRuntimeSnapshot: ReadonlySignal<RuntimeSnapshot>;
}

// Toolbar read model

type ChatPanelToolbarDebugConnectionState = Pick<
  ChatState["connection"],
  "phase" | "statusText" | "initializeResponse" | "rateLimit" | "serverDiagnostics"
>;

interface ChatPanelToolbarDiagnosticState {
  readonly initializeResponse: ChatState["connection"]["initializeResponse"];
  readonly serverDiagnostics: ChatState["connection"]["serverDiagnostics"];
}

interface ChatPanelToolbarDebugState {
  readonly activeThreadId: ChatState["activeThread"]["id"];
  readonly connection: ChatPanelToolbarDebugConnectionState;
  readonly runtimeConfig: ChatState["connection"]["runtimeConfig"];
  readonly runtime: ChatState["runtime"];
  readonly availableModels: ChatState["connection"]["availableModels"];
}

export interface ChatPanelToolbarReadModel {
  readonly threads: ReadonlySignal<ChatState["threadList"]["listedThreads"]>;
  readonly activeThreadId: ReadonlySignal<ChatState["activeThread"]["id"]>;
  readonly turnBusy: ReadonlySignal<boolean>;
  readonly runtimeSnapshot: ReadonlySignal<RuntimeSnapshot>;
  readonly toolbarPanel: ReadonlySignal<ChatState["ui"]["toolbarPanel"]>;
  readonly archiveConfirmThreadId: ReadonlySignal<ChatState["ui"]["archiveConfirmThreadId"]>;
  readonly rename: ReadonlySignal<ChatState["ui"]["rename"]>;
  readonly diagnostics: ReadonlySignal<ChatPanelToolbarDiagnosticState>;
  readonly debug: ReadonlySignal<ChatPanelToolbarDebugState>;
}

// Goal read model

export interface ChatPanelGoalReadModel {
  readonly goal: ReadonlySignal<ChatState["activeThread"]["goal"]>;
  readonly goalEditor: ReadonlySignal<ChatState["ui"]["goalEditor"]>;
  readonly goalObjectiveExpanded: ReadonlySignal<ChatState["ui"]["disclosures"]["goalObjectiveExpanded"]>;
}

// Message stream read model

export interface ChatPanelMessageStreamReadModel {
  readonly activeThreadId: ReadonlySignal<ChatState["activeThread"]["id"]>;
  readonly activeThreadCwd: ReadonlySignal<ChatState["activeThread"]["cwd"]>;
  readonly activeTurnId: ReadonlySignal<string | null>;
  readonly historyCursor: ReadonlySignal<ChatState["messageStream"]["historyCursor"]>;
  readonly loadingHistory: ReadonlySignal<ChatState["messageStream"]["loadingHistory"]>;
  readonly turnDiffs: ReadonlySignal<ChatState["messageStream"]["turnDiffs"]>;
  readonly items: ReadonlySignal<readonly MessageStreamItem[]>;
  readonly stableItems: ReadonlySignal<readonly MessageStreamItem[]>;
  readonly activeItems: ReadonlySignal<readonly MessageStreamItem[]>;
  readonly requests: ReadonlySignal<ChatState["requests"]>;
  readonly disclosures: ReadonlySignal<ChatPanelMessageStreamDisclosureState>;
  readonly forkMenuItemId: ReadonlySignal<ChatState["ui"]["messageActionMenu"]["forkMenuItemId"]>;
  readonly rollbackCandidate: ReadonlySignal<MessageStreamRollbackCandidate | null>;
  readonly forkCandidates: ReadonlySignal<readonly ForkCandidate[]>;
  readonly implementPlanTarget: ReadonlySignal<PlanImplementationTarget | null>;
}

type ChatPanelMessageStreamDisclosureBucket = Exclude<keyof ChatState["ui"]["disclosures"], "goalObjectiveExpanded">;

type ChatPanelMessageStreamDisclosureState = Pick<ChatState["ui"]["disclosures"], ChatPanelMessageStreamDisclosureBucket>;

// Composer read model

type ChatPanelComposerConnectionState = Pick<ChatState["connection"], "phase" | "runtimeConfig" | "availableModels">;

export interface ChatPanelComposerReadModel {
  readonly connection: {
    readonly phase: ReadonlySignal<ChatPanelComposerConnectionState["phase"]>;
    readonly runtimeConfig: ReadonlySignal<ChatPanelComposerConnectionState["runtimeConfig"]>;
    readonly availableModels: ReadonlySignal<ChatPanelComposerConnectionState["availableModels"]>;
  };
  readonly activeListedThreadName: ReadonlySignal<string | null>;
  readonly draft: ReadonlySignal<ChatState["composer"]["draft"]>;
  readonly suggestions: ReadonlySignal<ChatState["composer"]["suggestions"]>;
  readonly selectedSuggestionIndex: ReadonlySignal<ChatState["composer"]["suggestSelected"]>;
  readonly activeThreadId: ReadonlySignal<ChatState["activeThread"]["id"]>;
  readonly turnBusy: ReadonlySignal<boolean>;
  readonly activeTurnId: ReadonlySignal<string | null>;
  readonly runtimeSnapshot: ReadonlySignal<RuntimeSnapshot>;
}

export function createChatPanelShellReadModelBinding(initialState: ChatState): ChatPanelShellReadModelBinding {
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
  const signals: ChatPanelShellSignals = {
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
        runtime: { pending: { collaborationMode: runtime.value.pending.collaborationMode } },
        messageStream: messageStream.value,
      }),
    ),
    messageStreamDisclosures: createMessageStreamDisclosuresSignal(ui),
    messageStreamForkMenuItemId: computed(() => ui.value.messageActionMenu.forkMenuItemId),
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
  const readModel = shellReadModelFromSignals(signals);
  return {
    readModel,
    sync: (nextState) => {
      syncShellSignals(signals, nextState);
    },
  };
}

function syncShellSignals(signals: ChatPanelShellSignals, nextState: ChatState): void {
  batch(() => {
    if (signals.connection.value !== nextState.connection) signals.connection.value = nextState.connection;
    if (signals.threadList.value !== nextState.threadList) signals.threadList.value = nextState.threadList;
    if (signals.activeThread.value !== nextState.activeThread) signals.activeThread.value = nextState.activeThread;
    if (signals.runtime.value !== nextState.runtime) signals.runtime.value = nextState.runtime;
    if (signals.turn.value !== nextState.turn) signals.turn.value = nextState.turn;
    if (signals.messageStream.value !== nextState.messageStream) signals.messageStream.value = nextState.messageStream;
    if (signals.requests.value !== nextState.requests) signals.requests.value = nextState.requests;
    if (signals.composer.value !== nextState.composer) signals.composer.value = nextState.composer;
    if (signals.ui.value !== nextState.ui) signals.ui.value = nextState.ui;
  });
}

function shellReadModelFromSignals(signals: ChatPanelShellSignals): ChatPanelShellReadModel {
  return {
    toolbar: toolbarReadModelFromSignals(signals),
    goal: goalReadModelFromSignals(signals),
    messageStream: messageStreamReadModelFromSignals(signals),
    composer: composerReadModelFromSignals(signals),
  };
}

function toolbarReadModelFromSignals(signals: ChatPanelShellSignals): ChatPanelToolbarReadModel {
  return {
    threads: computed(() => signals.threadList.value.listedThreads),
    activeThreadId: signals.activeThreadId,
    turnBusy: signals.turnBusy,
    runtimeSnapshot: signals.toolbarRuntimeSnapshot,
    toolbarPanel: computed(() => signals.ui.value.toolbarPanel),
    archiveConfirmThreadId: computed(() => signals.ui.value.archiveConfirmThreadId),
    rename: computed(() => signals.ui.value.rename),
    diagnostics: computed(() => toolbarDiagnosticState(signals.connection.value)),
    debug: computed(() => toolbarDebugState(signals, signals.connection.value)),
  };
}

function toolbarDiagnosticState(connection: ChatState["connection"]): ChatPanelToolbarDiagnosticState {
  return {
    initializeResponse: connection.initializeResponse,
    serverDiagnostics: connection.serverDiagnostics,
  };
}

function toolbarDebugState(signals: ChatPanelShellSignals, connection: ChatState["connection"]): ChatPanelToolbarDebugState {
  return {
    activeThreadId: signals.activeThreadId.value,
    connection: {
      phase: connection.phase,
      statusText: connection.statusText,
      initializeResponse: connection.initializeResponse,
      rateLimit: connection.rateLimit,
      serverDiagnostics: connection.serverDiagnostics,
    },
    runtimeConfig: connection.runtimeConfig,
    runtime: signals.runtime.value,
    availableModels: connection.availableModels,
  };
}

function goalReadModelFromSignals(signals: ChatPanelShellSignals): ChatPanelGoalReadModel {
  return {
    goal: signals.activeThreadGoal,
    goalEditor: signals.goalEditor,
    goalObjectiveExpanded: signals.goalObjectiveExpanded,
  };
}

function messageStreamReadModelFromSignals(signals: ChatPanelShellSignals): ChatPanelMessageStreamReadModel {
  return {
    activeThreadId: signals.activeThreadId,
    activeThreadCwd: signals.activeThreadCwd,
    activeTurnId: signals.activeTurnId,
    historyCursor: computed(() => signals.messageStream.value.historyCursor),
    loadingHistory: computed(() => signals.messageStream.value.loadingHistory),
    turnDiffs: computed(() => signals.messageStream.value.turnDiffs),
    items: signals.messageStreamItems,
    stableItems: signals.messageStreamStableItems,
    activeItems: signals.messageStreamActiveItems,
    requests: signals.requests,
    disclosures: signals.messageStreamDisclosures,
    forkMenuItemId: signals.messageStreamForkMenuItemId,
    rollbackCandidate: signals.messageStreamRollbackCandidate,
    forkCandidates: signals.messageStreamForkCandidates,
    implementPlanTarget: signals.messageStreamImplementPlanTarget,
  };
}

function composerReadModelFromSignals(signals: ChatPanelShellSignals): ChatPanelComposerReadModel {
  return {
    connection: {
      phase: computed(() => signals.connection.value.phase),
      runtimeConfig: computed(() => signals.connection.value.runtimeConfig),
      availableModels: computed(() => signals.connection.value.availableModels),
    },
    activeListedThreadName: computed(() => activeListedThreadName(signals)),
    draft: computed(() => signals.composer.value.draft),
    suggestions: computed(() => signals.composer.value.suggestions),
    selectedSuggestionIndex: computed(() => signals.composer.value.suggestSelected),
    activeThreadId: signals.activeThreadId,
    turnBusy: signals.turnBusy,
    activeTurnId: signals.activeTurnId,
    runtimeSnapshot: signals.composerRuntimeSnapshot,
  };
}

function activeListedThreadName(signals: ChatPanelShellSignals): string | null {
  const threadId = signals.activeThreadId.value;
  if (!threadId) return null;
  return projectedThreadName(signals, threadId);
}

function projectedThreadName(signals: ChatPanelShellSignals, threadId: string): string | null {
  const thread = signals.threadList.value.listedThreads.find((item) => item.id === threadId);
  return thread ? explicitThreadName(thread) : null;
}

function createMessageStreamDisclosuresSignal(ui: Signal<ChatState["ui"]>): ReadonlySignal<ChatPanelMessageStreamDisclosureState> {
  let previous: ChatPanelMessageStreamDisclosureState | null = null;
  return computed(() => {
    const disclosures = ui.value.disclosures;
    if (
      previous &&
      previous.details === disclosures.details &&
      previous.activityGroups === disclosures.activityGroups &&
      previous.textDetails === disclosures.textDetails &&
      previous.userMessageExpanded === disclosures.userMessageExpanded &&
      previous.approvalDetails === disclosures.approvalDetails
    ) {
      return previous;
    }
    previous = {
      details: disclosures.details,
      activityGroups: disclosures.activityGroups,
      textDetails: disclosures.textDetails,
      userMessageExpanded: disclosures.userMessageExpanded,
      approvalDetails: disclosures.approvalDetails,
    };
    return previous;
  });
}
