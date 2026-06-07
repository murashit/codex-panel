import type { AppServerClient } from "../../../app-server/client";
import { requestedServiceTierRequestValue, type RequestedServiceTier } from "../../../app-server/service-tier";
import type { ModeKind } from "../../../generated/app-server/ModeKind";
import type { ReasoningEffort } from "../../../generated/app-server/ReasoningEffort";
import type { ApprovalsReviewer } from "../../../generated/app-server/v2/ApprovalsReviewer";
import type { ThreadSettingsUpdateParams } from "../../../generated/app-server/v2/ThreadSettingsUpdateParams";
import { collaborationModeToggleMessage, nextCollaborationMode } from "../../../runtime/collaboration-mode";
import { readRuntimeConfig } from "../../../runtime/config";
import {
  autoReviewActive,
  fastModeActive,
  fastServiceTierRequestValue,
  pendingRuntimeSettingPayload,
  requestedTurnRuntimeSettings,
  type RuntimeSnapshot,
} from "../../../runtime/state";
import { modelOverrideMessage, reasoningEffortOverrideMessage } from "../../../runtime/settings";
import type { ChatAction, ChatState, ChatStateStore } from "../chat-state";

type ThreadSettingsUpdate = Omit<ThreadSettingsUpdateParams, "threadId">;

export interface RuntimeSettingsControllerHost {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  runtimeSnapshot: () => RuntimeSnapshot;
  collaborationModeLabel: () => string;
  addSystemMessage: (text: string) => void;
}

export class ChatRuntimeSettingsController {
  constructor(private readonly host: RuntimeSettingsControllerHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }

  async applyPendingThreadSettings(): Promise<boolean> {
    const client = this.host.currentClient();
    const threadId = this.state.activeThread.id;
    if (!client || !threadId) return true;

    const update = this.pendingThreadSettingsUpdate();
    if (Object.keys(update).length === 0) return true;

    try {
      await client.updateThreadSettings(threadId, update);
      this.dispatch({ type: "runtime/pending-thread-settings-committed", update });
      return true;
    } catch (error) {
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async setRequestedModel(model: string | null): Promise<boolean> {
    this.dispatch({ type: "runtime/requested-model-set", model });
    return this.applyPendingThreadSettings();
  }

  async setRequestedModelFromUi(model: string | null): Promise<void> {
    if (!(await this.setRequestedModel(model))) return;
    this.dispatch({ type: "ui/panel-set", panel: null });
    this.host.addSystemMessage(modelOverrideMessage(model));
  }

  async setRequestedReasoningEffort(effort: ReasoningEffort | null): Promise<boolean> {
    this.dispatch({ type: "runtime/requested-effort-set", effort });
    return this.applyPendingThreadSettings();
  }

  async setRequestedReasoningEffortFromUi(effort: ReasoningEffort | null): Promise<void> {
    if (!(await this.setRequestedReasoningEffort(effort))) return;
    this.dispatch({ type: "ui/panel-set", panel: null });
    this.host.addSystemMessage(reasoningEffortOverrideMessage(effort));
  }

  async toggleFastMode(): Promise<void> {
    const snapshot = this.host.runtimeSnapshot();
    const config = readRuntimeConfig(this.state.connection.effectiveConfig);
    const next: RequestedServiceTier = fastModeActive(snapshot, config) ? "off" : "fast";
    this.dispatch({ type: "runtime/requested-service-tier-set", serviceTier: next });
    this.dispatch({ type: "ui/panel-set", panel: null });
    if (!(await this.applyPendingThreadSettings())) return;
    this.host.addSystemMessage(next === "fast" ? "Fast mode on for subsequent turns." : "Fast mode off for subsequent turns.");
  }

  async toggleCollaborationMode(): Promise<void> {
    const next = nextCollaborationMode(this.state.runtime.selectedCollaborationMode);
    await this.setCollaborationMode(next);
  }

  async setCollaborationMode(collaborationMode: ModeKind): Promise<boolean> {
    this.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode });
    this.dispatch({ type: "ui/panel-set", panel: null });
    const applied = await this.applyPendingThreadSettings();
    if (applied) this.host.addSystemMessage(collaborationModeToggleMessage(collaborationMode));
    return applied;
  }

  async toggleAutoReview(): Promise<void> {
    const next: ApprovalsReviewer = autoReviewActive(this.host.runtimeSnapshot(), readRuntimeConfig(this.state.connection.effectiveConfig))
      ? "user"
      : "auto_review";
    this.dispatch({ type: "runtime/requested-approvals-reviewer-set", approvalsReviewer: next });
    this.dispatch({ type: "ui/panel-set", panel: null });
    if (!(await this.applyPendingThreadSettings())) return;
    this.host.addSystemMessage(next === "auto_review" ? "Auto-review on for subsequent turns." : "Auto-review off for subsequent turns.");
  }

  private pendingThreadSettingsUpdate(): ThreadSettingsUpdate {
    const update: ThreadSettingsUpdate = {};
    const state = this.state;
    const snapshot = this.host.runtimeSnapshot();
    const turnSettings = requestedTurnRuntimeSettings(snapshot);

    if (state.runtime.requestedModel.kind !== "unchanged") {
      const model = pendingRuntimeSettingPayload(state.runtime.requestedModel);
      if (model !== undefined) update.model = model;
    }
    if (state.runtime.requestedReasoningEffort.kind !== "unchanged") {
      const effort = pendingRuntimeSettingPayload(state.runtime.requestedReasoningEffort);
      if (effort !== undefined) update.effort = effort;
    }
    if (state.runtime.requestedServiceTier.kind === "set") {
      const serviceTier = requestedServiceTierRequestValue(
        state.runtime.requestedServiceTier.value,
        fastServiceTierRequestValue(snapshot, readRuntimeConfig(state.connection.effectiveConfig)),
      );
      if (serviceTier !== undefined) update.serviceTier = serviceTier;
    } else if (state.runtime.requestedServiceTier.kind === "resetToConfig") {
      update.serviceTier = null;
    }
    if (state.runtime.requestedApprovalsReviewer.kind !== "unchanged") {
      const approvalsReviewer = pendingRuntimeSettingPayload(state.runtime.requestedApprovalsReviewer);
      if (approvalsReviewer !== undefined) update.approvalsReviewer = approvalsReviewer;
    }
    if (state.runtime.selectedCollaborationMode !== state.runtime.activeCollaborationMode) {
      if (turnSettings.warning) {
        this.host.addSystemMessage(`${this.host.collaborationModeLabel()} mode is selected, but ${turnSettings.warning}`);
      } else if (turnSettings.collaborationMode) {
        update.collaborationMode = turnSettings.collaborationMode;
      }
    }
    return update;
  }
}
