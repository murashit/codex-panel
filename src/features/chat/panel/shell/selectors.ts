import type { ModelMetadata, SkillMetadata } from "../../../../domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { RateLimitSnapshot } from "../../../../domain/runtime/metrics";
import { diagnosticsWithMetadataResourceProbes, type MetadataResourceDiagnostics } from "../../../../domain/server/diagnostics";
import type { Thread } from "../../../../domain/threads/model";
import { explicitThreadName } from "../../../../domain/threads/model";
import { activePanelOperationDecision } from "../../application/panel-operation-policy";
import { threadStreamItemsHaveThreadTurns } from "../../application/runtime/snapshot";
import { activeThreadState, type ChatActiveThreadState, type ChatState, panelThreadProvenance } from "../../application/state/root-reducer";
import { threadStreamItems } from "../../application/state/thread-stream";
import { activeTurnId, chatTurnBusy } from "../../application/turns/turn-state";

const hasThreadTurnsByStream = new WeakMap<ChatState["threadStream"], boolean>();
const composedDiagnosticsByPanel = new WeakMap<
  ChatState["connection"]["serverDiagnostics"],
  WeakMap<MetadataResourceDiagnostics, ChatState["connection"]["serverDiagnostics"]>
>();

export interface ChatPanelToolbarSharedValues {
  readonly activeThreads: {
    readonly threads: readonly Thread[];
    readonly hasMore: boolean;
    readonly isFetching: boolean;
    readonly isFetchingNextPage: boolean;
    readonly error: string | null;
  };
  readonly runtimeConfig: RuntimeConfigSnapshot | null;
  readonly models: readonly ModelMetadata[];
  readonly skills: readonly SkillMetadata[];
  readonly rateLimit: RateLimitSnapshot | null;
  readonly metadataDiagnostics: MetadataResourceDiagnostics;
}

export interface ChatPanelThreadStreamSharedValues {
  readonly threads: readonly Thread[];
}

export interface ChatPanelComposerSharedValues {
  readonly threads: readonly Thread[];
  readonly runtimeConfig: RuntimeConfigSnapshot | null;
  readonly models: readonly ModelMetadata[];
  readonly rateLimit: RateLimitSnapshot | null;
}

export interface ChatPanelToolbarModel {
  readonly threads: readonly Thread[];
  readonly hasMoreThreads: boolean;
  readonly threadListLoading: boolean;
  readonly threadListFetching: boolean;
  readonly isFetchingNextPage: boolean;
  readonly threadListError: string | null;
  readonly activeThreadId: string | null;
  readonly activeThreadSubagent: boolean;
  readonly sideChatStartDisabled: boolean;
  readonly compactDisabled: boolean;
  readonly goalMutationDisabled: boolean;
  readonly activeThreadTokenUsage: ChatActiveThreadState["tokenUsage"];
  readonly turnBusy: boolean;
  readonly availableModels: readonly ModelMetadata[];
  readonly availableSkills: readonly SkillMetadata[];
  readonly initializeResponse: ChatState["connection"]["initializeResponse"];
  readonly rateLimit: RateLimitSnapshot | null;
  readonly runtimeConfig: RuntimeConfigSnapshot | null;
  readonly serverDiagnostics: ChatState["connection"]["serverDiagnostics"];
  readonly runtime: ChatState["runtime"];
  readonly toolbarPanel: ChatState["ui"]["toolbarPanel"];
  readonly archiveConfirmThreadId: ChatState["ui"]["archiveConfirmThreadId"];
  readonly rename: ChatState["ui"]["rename"];
}

export interface ChatPanelGoalModel {
  readonly goal: ChatActiveThreadState["goal"];
  readonly goalMutationsAllowed: boolean;
  readonly goalEditor: ChatState["ui"]["goalEditor"];
  readonly goalObjectiveExpanded: ChatState["ui"]["disclosures"]["goalObjectiveExpanded"];
}

export interface ChatPanelThreadStreamModel {
  readonly threads: readonly Thread[];
  readonly activeThreadId: string | null;
  readonly forkAllowed: boolean;
  readonly rollbackAllowed: boolean;
  readonly planImplementationAllowed: boolean;
  readonly turn: ChatState["turn"];
  readonly runtimeCollaborationMode: ChatState["runtime"]["pending"]["collaborationMode"];
  readonly threadStream: ChatState["threadStream"];
  readonly subagentActivity: ChatState["subagentActivity"];
  readonly pendingSubmission: ChatState["pendingSubmission"];
  readonly requests: ChatState["requests"];
  readonly disclosureDetails: ChatState["ui"]["disclosures"]["details"];
  readonly disclosureActivityGroups: ChatState["ui"]["disclosures"]["activityGroups"];
  readonly disclosureTextDetails: ChatState["ui"]["disclosures"]["textDetails"];
  readonly disclosureUserDialogueExpanded: ChatState["ui"]["disclosures"]["userDialogueExpanded"];
  readonly disclosureApprovalDetails: ChatState["ui"]["disclosures"]["approvalDetails"];
  readonly forkMenuItemId: ChatState["ui"]["threadStreamActionMenu"]["forkMenuItemId"];
}

export interface ChatPanelComposerModel {
  readonly connectionPhase: ChatState["connection"]["phase"];
  readonly runtimeConfig: RuntimeConfigSnapshot | null;
  readonly availableModels: readonly ModelMetadata[];
  readonly rateLimit: RateLimitSnapshot | null;
  readonly activeListedThreadName: string | null;
  readonly sideChatActive: boolean;
  readonly sideChatSourceTitle: string | null;
  readonly draft: ChatState["composer"]["draft"];
  readonly attachmentSavePending: boolean;
  readonly suggestions: ChatState["composer"]["suggestions"];
  readonly selectedSuggestionIndex: ChatState["composer"]["suggestSelected"];
  readonly activeThreadId: string | null;
  readonly activeThreadTokenUsage: ChatActiveThreadState["tokenUsage"];
  readonly activeThreadSubagent: boolean;
  readonly canAcceptDirectInput: ChatActiveThreadState["canAcceptDirectInput"];
  readonly submissionBlockedByPanelPolicy: boolean;
  readonly runtimeSettingsDisabled: boolean;
  readonly webSubmissionPending: boolean;
  readonly webSubmissionCancellable: boolean;
  readonly turnBusy: boolean;
  readonly activeTurnId: string | null;
  readonly runtime: ChatState["runtime"];
  readonly hasThreadTurns: boolean;
}

export function selectChatPanelToolbar(state: ChatState, shared: ChatPanelToolbarSharedValues): ChatPanelToolbarModel {
  const activeThread = activeThreadState(state);
  const threads = shared.activeThreads;
  return {
    threads: threads.threads,
    hasMoreThreads: threads.hasMore,
    threadListLoading: threads.isFetching && threads.threads.length === 0,
    threadListFetching: threads.isFetching,
    isFetchingNextPage: threads.isFetchingNextPage,
    threadListError: threads.error,
    activeThreadId: activeThread?.id ?? null,
    activeThreadSubagent: panelThreadProvenance(state)?.kind === "subagent",
    sideChatStartDisabled: !activeThread || activePanelOperationDecision(state, "start-side-chat").kind !== "allowed",
    compactDisabled: !activeThread || activePanelOperationDecision(state, "compact").kind !== "allowed",
    goalMutationDisabled: activePanelOperationDecision(state, "goal-mutation").kind === "blocked",
    activeThreadTokenUsage: activeThread?.tokenUsage ?? null,
    turnBusy: chatTurnBusy(state),
    availableModels: shared.models,
    availableSkills: shared.skills,
    initializeResponse: state.connection.initializeResponse,
    rateLimit: shared.rateLimit,
    runtimeConfig: shared.runtimeConfig,
    serverDiagnostics: composedDiagnostics(state.connection.serverDiagnostics, shared.metadataDiagnostics),
    runtime: state.runtime,
    toolbarPanel: state.ui.toolbarPanel,
    archiveConfirmThreadId: state.ui.archiveConfirmThreadId,
    rename: state.ui.rename,
  };
}

function composedDiagnostics(
  panel: ChatState["connection"]["serverDiagnostics"],
  metadata: MetadataResourceDiagnostics,
): ChatState["connection"]["serverDiagnostics"] {
  let byMetadata = composedDiagnosticsByPanel.get(panel);
  if (!byMetadata) {
    byMetadata = new WeakMap();
    composedDiagnosticsByPanel.set(panel, byMetadata);
  }
  const cached = byMetadata.get(metadata);
  if (cached) return cached;
  const composed = diagnosticsWithMetadataResourceProbes(panel, metadata);
  byMetadata.set(metadata, composed);
  return composed;
}

export function selectChatPanelGoal(state: ChatState): ChatPanelGoalModel {
  return {
    goal: activeThreadState(state)?.goal ?? null,
    goalMutationsAllowed: activePanelOperationDecision(state, "goal-mutation").kind === "allowed",
    goalEditor: state.ui.goalEditor,
    goalObjectiveExpanded: state.ui.disclosures.goalObjectiveExpanded,
  };
}

export function selectChatPanelThreadStream(state: ChatState, shared: ChatPanelThreadStreamSharedValues): ChatPanelThreadStreamModel {
  const activeThread = activeThreadState(state);
  return {
    threads: shared.threads,
    activeThreadId: activeThread?.id ?? null,
    forkAllowed: activePanelOperationDecision(state, "fork").kind === "allowed",
    rollbackAllowed: activePanelOperationDecision(state, "rollback").kind === "allowed",
    planImplementationAllowed: activePanelOperationDecision(state, "implement-plan").kind === "allowed",
    turn: state.turn,
    runtimeCollaborationMode: state.runtime.pending.collaborationMode,
    threadStream: state.threadStream,
    subagentActivity: state.subagentActivity,
    pendingSubmission: state.pendingSubmission,
    requests: state.requests,
    disclosureDetails: state.ui.disclosures.details,
    disclosureActivityGroups: state.ui.disclosures.activityGroups,
    disclosureTextDetails: state.ui.disclosures.textDetails,
    disclosureUserDialogueExpanded: state.ui.disclosures.userDialogueExpanded,
    disclosureApprovalDetails: state.ui.disclosures.approvalDetails,
    forkMenuItemId: state.ui.threadStreamActionMenu.forkMenuItemId,
  };
}

export function selectChatPanelComposer(state: ChatState, shared: ChatPanelComposerSharedValues): ChatPanelComposerModel {
  const activeThread = activeThreadState(state);
  const activeThreadId = activeThread?.id ?? null;
  const lifetime = activeThread?.lifetime;
  return {
    connectionPhase: state.connection.phase,
    runtimeConfig: shared.runtimeConfig,
    availableModels: shared.models,
    rateLimit: shared.rateLimit,
    activeListedThreadName: activeThreadId ? projectedThreadName(shared, activeThreadId) : null,
    sideChatActive: lifetime?.kind === "ephemeral",
    sideChatSourceTitle: lifetime?.kind === "ephemeral" ? lifetime.sourceThreadTitle : null,
    draft: state.composer.draft,
    attachmentSavePending: state.composer.pendingAttachmentSaveIds.length > 0,
    suggestions: state.composer.suggestions,
    selectedSuggestionIndex: state.composer.suggestSelected,
    activeThreadId,
    activeThreadTokenUsage: activeThread?.tokenUsage ?? null,
    activeThreadSubagent: panelThreadProvenance(state)?.kind === "subagent",
    canAcceptDirectInput: activeThread?.canAcceptDirectInput ?? null,
    submissionBlockedByPanelPolicy: activePanelOperationDecision(state, "submit").kind === "blocked",
    runtimeSettingsDisabled: activePanelOperationDecision(state, "thread-settings").kind !== "allowed",
    webSubmissionPending: state.pendingSubmission !== null,
    webSubmissionCancellable: state.pendingSubmission?.phase === "cancellable",
    turnBusy: chatTurnBusy(state),
    activeTurnId: activeTurnId(state),
    runtime: state.runtime,
    hasThreadTurns: hasThreadTurns(state.threadStream),
  };
}

function hasThreadTurns(threadStream: ChatState["threadStream"]): boolean {
  const cached = hasThreadTurnsByStream.get(threadStream);
  if (cached !== undefined) return cached;
  const result = threadStreamItemsHaveThreadTurns(threadStreamItems(threadStream));
  hasThreadTurnsByStream.set(threadStream, result);
  return result;
}

function projectedThreadName(shared: ChatPanelComposerSharedValues, threadId: string): string | null {
  const thread = shared.threads.find((item) => item.id === threadId);
  return thread ? explicitThreadName(thread) : null;
}
