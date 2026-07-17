import { explicitThreadName } from "../../../domain/threads/model";
import { activePanelOperationDecision } from "../application/panel-operation-policy";
import { threadStreamItemsHaveThreadTurns } from "../application/runtime/snapshot";
import { activeThreadState, type ChatActiveThreadState, type ChatState, panelThreadProvenance } from "../application/state/root-reducer";
import { threadStreamItems } from "../application/state/thread-stream";
import { activeTurnId, chatTurnBusy } from "../application/turns/turn-state";

const hasThreadTurnsByStream = new WeakMap<ChatState["threadStream"], boolean>();

export interface ChatPanelToolbarModel {
  readonly threads: ChatState["threadList"]["listedThreads"];
  readonly activeThreadId: string | null;
  readonly activeThreadSubagent: boolean;
  readonly sideChatStartDisabled: boolean;
  readonly compactDisabled: boolean;
  readonly goalMutationDisabled: boolean;
  readonly activeThreadTokenUsage: ChatActiveThreadState["tokenUsage"];
  readonly turnBusy: boolean;
  readonly connection: ChatState["connection"];
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
  readonly activeThreadId: string | null;
  readonly activeThreadCwd: ChatActiveThreadState["cwd"];
  readonly forkAllowed: boolean;
  readonly rollbackAllowed: boolean;
  readonly planImplementationAllowed: boolean;
  readonly turn: ChatState["turn"];
  readonly runtimeCollaborationMode: ChatState["runtime"]["pending"]["collaborationMode"];
  readonly threadStream: ChatState["threadStream"];
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
  readonly runtimeConfig: ChatState["connection"]["runtimeConfig"];
  readonly availableModels: ChatState["connection"]["availableModels"];
  readonly rateLimit: ChatState["connection"]["rateLimit"];
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
  readonly submissionBlockedByPanelPolicy: boolean;
  readonly webSubmissionPending: boolean;
  readonly webSubmissionCancellable: boolean;
  readonly turnBusy: boolean;
  readonly activeTurnId: string | null;
  readonly runtime: ChatState["runtime"];
  readonly hasThreadTurns: boolean;
}

export function selectChatPanelToolbar(state: ChatState): ChatPanelToolbarModel {
  const activeThread = activeThreadState(state);
  return {
    threads: state.threadList.listedThreads,
    activeThreadId: activeThread?.id ?? null,
    activeThreadSubagent: panelThreadProvenance(state)?.kind === "subagent",
    sideChatStartDisabled: activePanelOperationDecision(state, "start-side-chat").kind !== "allowed",
    compactDisabled: activePanelOperationDecision(state, "compact").kind !== "allowed",
    goalMutationDisabled: activePanelOperationDecision(state, "goal-mutation").kind === "blocked",
    activeThreadTokenUsage: activeThread?.tokenUsage ?? null,
    turnBusy: chatTurnBusy(state),
    connection: state.connection,
    runtime: state.runtime,
    toolbarPanel: state.ui.toolbarPanel,
    archiveConfirmThreadId: state.ui.archiveConfirmThreadId,
    rename: state.ui.rename,
  };
}

export function selectChatPanelGoal(state: ChatState): ChatPanelGoalModel {
  return {
    goal: activeThreadState(state)?.goal ?? null,
    goalMutationsAllowed: activePanelOperationDecision(state, "goal-mutation").kind === "allowed",
    goalEditor: state.ui.goalEditor,
    goalObjectiveExpanded: state.ui.disclosures.goalObjectiveExpanded,
  };
}

export function selectChatPanelThreadStream(state: ChatState): ChatPanelThreadStreamModel {
  const activeThread = activeThreadState(state);
  return {
    activeThreadId: activeThread?.id ?? null,
    activeThreadCwd: activeThread?.cwd ?? null,
    forkAllowed: activePanelOperationDecision(state, "fork").kind === "allowed",
    rollbackAllowed: activePanelOperationDecision(state, "rollback").kind === "allowed",
    planImplementationAllowed: activePanelOperationDecision(state, "implement-plan").kind === "allowed",
    turn: state.turn,
    runtimeCollaborationMode: state.runtime.pending.collaborationMode,
    threadStream: state.threadStream,
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

export function selectChatPanelComposer(state: ChatState): ChatPanelComposerModel {
  const activeThread = activeThreadState(state);
  const activeThreadId = activeThread?.id ?? null;
  const lifetime = activeThread?.lifetime;
  return {
    connectionPhase: state.connection.phase,
    runtimeConfig: state.connection.runtimeConfig,
    availableModels: state.connection.availableModels,
    rateLimit: state.connection.rateLimit,
    activeListedThreadName: activeThreadId ? projectedThreadName(state, activeThreadId) : null,
    sideChatActive: lifetime?.kind === "ephemeral",
    sideChatSourceTitle: lifetime?.kind === "ephemeral" ? lifetime.sourceThreadTitle : null,
    draft: state.composer.draft,
    attachmentSavePending: state.composer.pendingAttachmentSaveIds.length > 0,
    suggestions: state.composer.suggestions,
    selectedSuggestionIndex: state.composer.suggestSelected,
    activeThreadId,
    activeThreadTokenUsage: activeThread?.tokenUsage ?? null,
    activeThreadSubagent: panelThreadProvenance(state)?.kind === "subagent",
    submissionBlockedByPanelPolicy: activePanelOperationDecision(state, "submit").kind === "blocked",
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

function projectedThreadName(state: ChatState, threadId: string): string | null {
  const thread = state.threadList.listedThreads.find((item) => item.id === threadId);
  return thread ? explicitThreadName(thread) : null;
}
