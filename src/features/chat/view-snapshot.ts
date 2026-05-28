import type { Model } from "../../generated/app-server/v2/Model";
import type { Thread } from "../../generated/app-server/v2/Thread";
import type { OpenCodexPanelSnapshot } from "../../runtime/open-panel-snapshot";
import { currentModel } from "../../runtime/state";
import { readRuntimeConfig } from "../../runtime/config";
import type { ChatPanelSlotSnapshot } from "./ui/shell";
import { activeTurnId, chatTurnBusy, type ChatState } from "./chat-state";
import type { DisplayItem } from "./display/types";
import { runtimeSnapshotForChatState } from "./view-model";
import type { RestoredThreadState } from "./view-lifecycle";

export function openPanelTurnLifecycle(state: ChatState["turnLifecycle"]): OpenCodexPanelSnapshot["turnLifecycle"] {
  if (state.kind === "running") return { kind: "running", turnId: state.turnId };
  if (state.kind === "starting") return { kind: "starting" };
  return { kind: "idle" };
}

export function latestProposedPlanItem(items: readonly DisplayItem[]): DisplayItem | null {
  return [...items].reverse().find((item) => item.kind === "message" && item.role === "assistant" && item.proposedPlan === true) ?? null;
}

export function toolbarSlotSnapshot(state: ChatState, connected: boolean): ChatPanelSlotSnapshot {
  return signatureParts(
    state.status,
    chatTurnBusy(state),
    state.activeThreadId,
    activeTurnId(state),
    state.activeModel,
    state.activeReasoningEffort,
    state.activeCollaborationMode,
    state.activeServiceTier,
    state.activeApprovalPolicy,
    state.activeApprovalsReviewer,
    state.activePermissionProfile,
    state.requestedCollaborationMode,
    state.requestedServiceTier,
    state.requestedApprovalsReviewer,
    state.requestedModel,
    state.requestedReasoningEffort,
    state.runtimePicker,
    openDetailsSignature(state.openDetails),
    state.threadsLoaded,
    threadListSignature(state.listedThreads),
    modelsSignature(state.availableModels),
    state.effectiveConfig,
    state.rateLimit,
    state.tokenUsage,
    state.appServerDiagnostics,
    connected,
  );
}

export function messagesSlotSnapshot(state: ChatState, pendingRequestsSignature: string): ChatPanelSlotSnapshot {
  return signatureParts(
    state.activeThreadId,
    activeTurnId(state),
    state.activeThreadCwd,
    state.historyCursor,
    state.loadingHistory,
    chatTurnBusy(state),
    state.messagesPinnedToBottom,
    state.composerDraft,
    state.requestedCollaborationMode,
    displayItemsSignature(state.displayItems),
    turnDiffsSignature(state.turnDiffs),
    openDetailsSignature(state.openDetails),
    pendingRequestsSignature,
  );
}

export function composerSlotSnapshot(state: ChatState, activeComposerThreadName: string | null): ChatPanelSlotSnapshot {
  return signatureParts(
    state.composerDraft,
    chatTurnBusy(state),
    state.activeThreadId,
    activeTurnId(state),
    currentModel(runtimeSnapshotForChatState({ state }), readRuntimeConfig(state.effectiveConfig)),
    state.availableSkills.length,
    skillsSignature(state.availableSkills),
    modelsSignature(state.availableModels),
    threadListSignature(state.listedThreads),
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

function skillsSignature(skills: ChatState["availableSkills"]): string {
  return skills.map((skill) => stableSignature(skill)).join("\n");
}
