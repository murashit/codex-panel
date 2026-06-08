import type { Model } from "../../../generated/app-server/v2/Model";
import type { Thread } from "../../../generated/app-server/v2/Thread";
import type { OpenCodexPanelSnapshot } from "../../../workspace/open-panel-snapshot";
import { readRuntimeConfig } from "../../../runtime/config";
import { currentModel } from "../../../runtime/effective-settings";
import { activeTurnId, chatTurnBusy, type ChatState } from "../chat-state";
import type { DisplayItem } from "../display/types";
import type { RestoredThreadState } from "./lifecycle";
import { runtimeSnapshotForChatState } from "./model";

export type ChatPanelSlotSnapshot = string | number | boolean | null;

export function openPanelTurnLifecycle(state: ChatState["turn"]["lifecycle"]): OpenCodexPanelSnapshot["turnLifecycle"] {
  if (state.kind === "running") return { kind: "running", turnId: state.turnId };
  if (state.kind === "starting") return { kind: "starting" };
  return { kind: "idle" };
}

export function latestProposedPlanItem(items: readonly DisplayItem[]): DisplayItem | null {
  return [...items].reverse().find((item) => item.kind === "message" && item.messageKind === "proposedPlan") ?? null;
}

export function toolbarSlotSnapshot(state: ChatState, connected: boolean): ChatPanelSlotSnapshot {
  return signatureParts(
    state.connection.status,
    chatTurnBusy(state),
    state.activeThread.id,
    activeTurnId(state),
    state.runtime.activeModel,
    state.runtime.activeReasoningEffort,
    state.runtime.activeCollaborationMode,
    state.runtime.activeServiceTier,
    state.runtime.activeApprovalPolicy,
    state.runtime.activeApprovalsReviewer,
    state.runtime.activePermissionProfile,
    state.runtime.selectedCollaborationMode,
    state.runtime.requestedServiceTier,
    state.runtime.requestedApprovalsReviewer,
    state.runtime.requestedModel,
    state.runtime.requestedReasoningEffort,
    openDetailsSignature(state.ui.openDetails),
    state.threadList.threadsLoaded,
    threadListSignature(state.threadList.listedThreads),
    modelsSignature(state.connection.availableModels),
    state.connection.effectiveConfig,
    state.connection.rateLimit,
    state.activeThread.tokenUsage,
    state.connection.appServerDiagnostics,
    connected,
  );
}

export function messagesSlotSnapshot(state: ChatState, pendingRequestsSignature: string): ChatPanelSlotSnapshot {
  return signatureParts(
    state.activeThread.id,
    activeTurnId(state),
    state.activeThread.cwd,
    state.transcript.historyCursor,
    state.transcript.loadingHistory,
    chatTurnBusy(state),
    state.ui.messagesPinnedToBottom,
    state.composer.draft.trim().length > 0,
    state.runtime.selectedCollaborationMode,
    displayItemsSignature(state.transcript.displayItems),
    turnDiffsSignature(state.transcript.turnDiffs),
    openDetailsSignature(state.ui.openDetails),
    pendingRequestsSignature,
  );
}

export function goalSlotSnapshot(state: ChatState): ChatPanelSlotSnapshot {
  return signatureParts(state.activeThread.id, state.activeThread.goal);
}

export function composerSlotSnapshot(state: ChatState, activeComposerThreadName: string | null): ChatPanelSlotSnapshot {
  return signatureParts(
    state.composer.draft,
    state.connection.status,
    chatTurnBusy(state),
    state.activeThread.id,
    activeTurnId(state),
    state.runtime.activeModel,
    state.runtime.activeReasoningEffort,
    state.runtime.activeCollaborationMode,
    state.runtime.activeServiceTier,
    state.runtime.activeApprovalsReviewer,
    state.runtime.selectedCollaborationMode,
    state.runtime.requestedServiceTier,
    state.runtime.requestedApprovalsReviewer,
    state.runtime.requestedModel,
    state.runtime.requestedReasoningEffort,
    state.activeThread.tokenUsage,
    state.connection.effectiveConfig,
    currentModel(runtimeSnapshotForChatState({ state }), readRuntimeConfig(state.connection.effectiveConfig)),
    state.connection.availableSkills.length,
    skillsSignature(state.connection.availableSkills),
    modelsSignature(state.connection.availableModels),
    threadListSignature(state.threadList.listedThreads),
    activeComposerThreadName,
  );
}

export function parseRestoredThreadState(state: unknown): RestoredThreadState | null {
  if (!state || typeof state !== "object") return null;
  const record = state as Record<string, unknown>;
  const threadId = record["threadId"];
  if (typeof threadId !== "string" || threadId.trim().length === 0) return null;
  const title = record["threadTitle"];
  return {
    threadId,
    title: typeof title === "string" && title.trim().length > 0 ? title : null,
    explicitName: null,
  };
}

function signatureParts(...values: unknown[]): string {
  return values.map((value) => stableSignature(value)).join("\u001f");
}

function stableSignature(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function openDetailsSignature(openDetails: ReadonlySet<string>): string {
  return [...openDetails].sort().join("\n");
}

function turnDiffsSignature(turnDiffs: ReadonlyMap<string, string>): string {
  return [...turnDiffs]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([turnId, diff]) => `${turnId}:${diff}`)
    .join("\n");
}

function displayItemsSignature(items: readonly DisplayItem[]): string {
  return stableSignature(items);
}

function threadListSignature(threads: readonly Thread[]): string {
  return threads
    .map((thread) =>
      signatureParts(thread.id, thread.name, thread.preview, thread.updatedAt, thread.cliVersion, thread.status, thread.gitInfo),
    )
    .join("\n");
}

function modelsSignature(models: readonly Model[]): string {
  return models.map((model) => stableSignature(model)).join("\n");
}

function skillsSignature(skills: ChatState["connection"]["availableSkills"]): string {
  return skills.map((skill) => stableSignature(skill)).join("\n");
}
