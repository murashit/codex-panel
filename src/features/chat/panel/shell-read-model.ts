import { batch, computed, type ReadonlySignal, type Signal, signal } from "@preact/signals";
import { explicitThreadName } from "../../../domain/threads/model";
import { runtimeSnapshotForChatSlices, threadStreamItemsHaveThreadTurns } from "../application/runtime/snapshot";
import type { ChatState } from "../application/state/root-reducer";
import {
  type ThreadStreamRollbackCandidate,
  threadStreamActiveItems,
  threadStreamItems,
  threadStreamRollbackCandidateFromItems,
  threadStreamStableItems,
} from "../application/state/thread-stream";
import { implementPlanTargetFromState } from "../application/turns/plan-implementation";
import { activeTurnId, chatTurnBusy } from "../application/turns/turn-state";
import type { RuntimeSnapshot } from "../domain/runtime/snapshot";
import type { ThreadStreamItem } from "../domain/thread-stream/items";
import { type ForkCandidate, forkCandidatesFromItems, type PlanImplementationTarget } from "../domain/thread-stream/selectors";

export interface ChatPanelShellReadModelBinding {
  readonly readModel: ChatPanelShellReadModel;
  sync(nextState: ChatState): void;
}

interface ChatPanelShellReadModel {
  readonly toolbar: ChatPanelToolbarReadModel;
  readonly goal: ChatPanelGoalReadModel;
  readonly threadStream: ChatPanelThreadStreamReadModel;
  readonly composer: ChatPanelComposerReadModel;
}

interface ChatPanelShellSignals {
  connection: Signal<ChatState["connection"]>;
  threadList: Signal<ChatState["threadList"]>;
  activeThread: Signal<ChatState["activeThread"]>;
  runtime: Signal<ChatState["runtime"]>;
  turn: Signal<ChatState["turn"]>;
  threadStream: Signal<ChatState["threadStream"]>;
  pendingSubmission: Signal<ChatState["pendingSubmission"]>;
  requests: Signal<ChatState["requests"]>;
  composer: Signal<ChatState["composer"]>;
  ui: Signal<ChatState["ui"]>;
  turnBusy: ReadonlySignal<boolean>;
  activeTurnId: ReadonlySignal<string | null>;
  activeThreadId: ReadonlySignal<ChatState["activeThread"]["id"]>;
  activeThreadCwd: ReadonlySignal<ChatState["activeThread"]["cwd"]>;
  activeThreadGoal: ReadonlySignal<ChatState["activeThread"]["goal"]>;
  threadStreamItems: ReadonlySignal<readonly ThreadStreamItem[]>;
  threadStreamStableItems: ReadonlySignal<readonly ThreadStreamItem[]>;
  threadStreamActiveItems: ReadonlySignal<readonly ThreadStreamItem[]>;
  threadStreamRollbackCandidate: ReadonlySignal<ThreadStreamRollbackCandidate | null>;
  threadStreamForkCandidates: ReadonlySignal<readonly ForkCandidate[]>;
  threadStreamImplementPlanTarget: ReadonlySignal<PlanImplementationTarget | null>;
  webSubmissionPending: ReadonlySignal<boolean>;
  threadStreamDisclosures: ReadonlySignal<ChatPanelThreadStreamDisclosureState>;
  threadStreamForkMenuItemId: ReadonlySignal<ChatState["ui"]["threadStreamActionMenu"]["forkMenuItemId"]>;
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
  readonly activeThreadSubagent: ReadonlySignal<boolean>;
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

// Thread stream read model

export interface ChatPanelThreadStreamReadModel {
  readonly activeThreadId: ReadonlySignal<ChatState["activeThread"]["id"]>;
  readonly activeThreadCwd: ReadonlySignal<ChatState["activeThread"]["cwd"]>;
  readonly activeTurnId: ReadonlySignal<string | null>;
  readonly historyCursor: ReadonlySignal<ChatState["threadStream"]["historyCursor"]>;
  readonly loadingHistory: ReadonlySignal<ChatState["threadStream"]["loadingHistory"]>;
  readonly turnDiffs: ReadonlySignal<ChatState["threadStream"]["turnDiffs"]>;
  readonly items: ReadonlySignal<readonly ThreadStreamItem[]>;
  readonly stableItems: ReadonlySignal<readonly ThreadStreamItem[]>;
  readonly activeItems: ReadonlySignal<readonly ThreadStreamItem[]>;
  readonly requests: ReadonlySignal<ChatState["requests"]>;
  readonly disclosures: ReadonlySignal<ChatPanelThreadStreamDisclosureState>;
  readonly forkMenuItemId: ReadonlySignal<ChatState["ui"]["threadStreamActionMenu"]["forkMenuItemId"]>;
  readonly rollbackCandidate: ReadonlySignal<ThreadStreamRollbackCandidate | null>;
  readonly forkCandidates: ReadonlySignal<readonly ForkCandidate[]>;
  readonly implementPlanTarget: ReadonlySignal<PlanImplementationTarget | null>;
}

type ChatPanelThreadStreamDisclosureBucket = Exclude<keyof ChatState["ui"]["disclosures"], "goalObjectiveExpanded">;

type ChatPanelThreadStreamDisclosureState = Pick<ChatState["ui"]["disclosures"], ChatPanelThreadStreamDisclosureBucket>;

// Composer read model

type ChatPanelComposerConnectionState = Pick<ChatState["connection"], "phase" | "runtimeConfig" | "availableModels">;

export interface ChatPanelComposerReadModel {
  readonly connection: {
    readonly phase: ReadonlySignal<ChatPanelComposerConnectionState["phase"]>;
    readonly runtimeConfig: ReadonlySignal<ChatPanelComposerConnectionState["runtimeConfig"]>;
    readonly availableModels: ReadonlySignal<ChatPanelComposerConnectionState["availableModels"]>;
  };
  readonly activeListedThreadName: ReadonlySignal<string | null>;
  readonly sideChatActive: ReadonlySignal<boolean>;
  readonly sideChatSourceTitle: ReadonlySignal<string | null>;
  readonly draft: ReadonlySignal<ChatState["composer"]["draft"]>;
  readonly suggestions: ReadonlySignal<ChatState["composer"]["suggestions"]>;
  readonly selectedSuggestionIndex: ReadonlySignal<ChatState["composer"]["suggestSelected"]>;
  readonly activeThreadId: ReadonlySignal<ChatState["activeThread"]["id"]>;
  readonly activeThreadSubagent: ReadonlySignal<boolean>;
  readonly webSubmissionPending: ReadonlySignal<boolean>;
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
  const threadStream = signal(initialState.threadStream);
  const pendingSubmission = signal(initialState.pendingSubmission);
  const requests = signal(initialState.requests);
  const composer = signal(initialState.composer);
  const ui = signal(initialState.ui);
  const turnBusy = computed(() => chatTurnBusy({ turn: turn.value }));
  const canonicalStreamItems = computed(() => threadStreamItems(threadStream.value));
  const streamItems = computed(() => appendPendingSubmission(canonicalStreamItems.value, pendingSubmission.value));
  const hasThreadTurns = computed(() => threadStreamItemsHaveThreadTurns(canonicalStreamItems.value));
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
    threadStream,
    pendingSubmission,
    requests,
    composer,
    ui,
    turnBusy,
    activeTurnId: computed(() => activeTurnId({ turn: turn.value })),
    activeThreadId: activeThreadIdSignal,
    activeThreadCwd,
    activeThreadGoal,
    threadStreamItems: streamItems,
    threadStreamStableItems: computed(() =>
      threadStream.value.activeSegment
        ? threadStreamStableItems(threadStream.value)
        : appendPendingSubmission(threadStreamStableItems(threadStream.value), pendingSubmission.value),
    ),
    threadStreamActiveItems: computed(() =>
      threadStream.value.activeSegment
        ? appendPendingSubmission(threadStreamActiveItems(threadStream.value), pendingSubmission.value)
        : threadStreamActiveItems(threadStream.value),
    ),
    threadStreamRollbackCandidate: computed(() =>
      turnBusy.value || activeThread.value.lifetime?.kind === "ephemeral" || activeThread.value.provenance?.kind === "subagent"
        ? null
        : threadStreamRollbackCandidateFromItems(canonicalStreamItems.value),
    ),
    threadStreamForkCandidates: computed(() =>
      turnBusy.value || activeThread.value.lifetime?.kind === "ephemeral" || activeThread.value.provenance?.kind === "subagent"
        ? []
        : forkCandidatesFromItems(canonicalStreamItems.value),
    ),
    threadStreamImplementPlanTarget: computed(() =>
      implementPlanTargetFromState({
        activeThread: { id: activeThreadIdSignal.value, provenance: activeThread.value.provenance },
        turn: turn.value,
        runtime: { pending: { collaborationMode: runtime.value.pending.collaborationMode } },
        threadStream: threadStream.value,
      }),
    ),
    webSubmissionPending: computed(() => pendingSubmission.value !== null),
    threadStreamDisclosures: createThreadStreamDisclosuresSignal(ui),
    threadStreamForkMenuItemId: computed(() => ui.value.threadStreamActionMenu.forkMenuItemId),
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
    if (signals.threadStream.value !== nextState.threadStream) signals.threadStream.value = nextState.threadStream;
    if (signals.pendingSubmission.value !== nextState.pendingSubmission) signals.pendingSubmission.value = nextState.pendingSubmission;
    if (signals.requests.value !== nextState.requests) signals.requests.value = nextState.requests;
    if (signals.composer.value !== nextState.composer) signals.composer.value = nextState.composer;
    if (signals.ui.value !== nextState.ui) signals.ui.value = nextState.ui;
  });
}

function appendPendingSubmission(
  items: readonly ThreadStreamItem[],
  pendingSubmission: ChatState["pendingSubmission"],
): readonly ThreadStreamItem[] {
  return pendingSubmission ? [...items, pendingSubmission.item] : items;
}

function shellReadModelFromSignals(signals: ChatPanelShellSignals): ChatPanelShellReadModel {
  return {
    toolbar: toolbarReadModelFromSignals(signals),
    goal: goalReadModelFromSignals(signals),
    threadStream: threadStreamReadModelFromSignals(signals),
    composer: composerReadModelFromSignals(signals),
  };
}

function toolbarReadModelFromSignals(signals: ChatPanelShellSignals): ChatPanelToolbarReadModel {
  return {
    threads: computed(() => signals.threadList.value.listedThreads),
    activeThreadId: signals.activeThreadId,
    activeThreadSubagent: computed(() => signals.activeThread.value.provenance?.kind === "subagent"),
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

function threadStreamReadModelFromSignals(signals: ChatPanelShellSignals): ChatPanelThreadStreamReadModel {
  return {
    activeThreadId: signals.activeThreadId,
    activeThreadCwd: signals.activeThreadCwd,
    activeTurnId: signals.activeTurnId,
    historyCursor: computed(() => signals.threadStream.value.historyCursor),
    loadingHistory: computed(() => signals.threadStream.value.loadingHistory),
    turnDiffs: computed(() => signals.threadStream.value.turnDiffs),
    items: signals.threadStreamItems,
    stableItems: signals.threadStreamStableItems,
    activeItems: signals.threadStreamActiveItems,
    requests: signals.requests,
    disclosures: signals.threadStreamDisclosures,
    forkMenuItemId: signals.threadStreamForkMenuItemId,
    rollbackCandidate: signals.threadStreamRollbackCandidate,
    forkCandidates: signals.threadStreamForkCandidates,
    implementPlanTarget: signals.threadStreamImplementPlanTarget,
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
    sideChatActive: computed(() => signals.activeThread.value.lifetime?.kind === "ephemeral"),
    sideChatSourceTitle: computed(() => {
      const lifetime = signals.activeThread.value.lifetime;
      return lifetime?.kind === "ephemeral" ? lifetime.sourceThreadTitle : null;
    }),
    draft: computed(() => signals.composer.value.draft),
    suggestions: computed(() => signals.composer.value.suggestions),
    selectedSuggestionIndex: computed(() => signals.composer.value.suggestSelected),
    activeThreadId: signals.activeThreadId,
    activeThreadSubagent: computed(() => signals.activeThread.value.provenance?.kind === "subagent"),
    webSubmissionPending: signals.webSubmissionPending,
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

function createThreadStreamDisclosuresSignal(ui: Signal<ChatState["ui"]>): ReadonlySignal<ChatPanelThreadStreamDisclosureState> {
  let previous: ChatPanelThreadStreamDisclosureState | null = null;
  return computed(() => {
    const disclosures = ui.value.disclosures;
    if (
      previous &&
      previous.details === disclosures.details &&
      previous.activityGroups === disclosures.activityGroups &&
      previous.textDetails === disclosures.textDetails &&
      previous.userDialogueExpanded === disclosures.userDialogueExpanded &&
      previous.approvalDetails === disclosures.approvalDetails
    ) {
      return previous;
    }
    previous = {
      details: disclosures.details,
      activityGroups: disclosures.activityGroups,
      textDetails: disclosures.textDetails,
      userDialogueExpanded: disclosures.userDialogueExpanded,
      approvalDetails: disclosures.approvalDetails,
    };
    return previous;
  });
}
