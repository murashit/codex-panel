import type { AppServerClient } from "../../app-server/client";
import { chatTurnBusy, type ChatState, type ChatStateStore } from "./chat-state";
import type { DisplayItem } from "./display/types";

const IMPLEMENT_PLAN_PROMPT = "Please implement this plan.";

export interface PlanImplementationControllerHost {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  ensureConnected: () => Promise<void>;
  sendTurnText: (text: string) => Promise<void>;
}

export class PlanImplementationController {
  constructor(private readonly host: PlanImplementationControllerHost) {}

  canImplement(item: DisplayItem): boolean {
    return item.id === implementPlanCandidateFromState(this.state)?.id;
  }

  async implement(item: DisplayItem): Promise<void> {
    if (!this.canImplement(item)) return;
    await this.host.ensureConnected();
    if (!this.host.currentClient() || !this.state.activeThreadId) return;

    this.host.stateStore.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" });
    this.host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
    await this.host.sendTurnText(IMPLEMENT_PLAN_PROMPT);
  }

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }
}

export function implementPlanCandidateFromState(
  state: Pick<ChatState, "activeThreadId" | "turnLifecycle" | "composerDraft" | "requestedCollaborationMode" | "displayItems">,
): DisplayItem | null {
  if (
    !state.activeThreadId ||
    chatTurnBusy(state) ||
    state.composerDraft.trim().length > 0 ||
    state.requestedCollaborationMode !== "plan"
  ) {
    return null;
  }
  return (
    [...state.displayItems].reverse().find((item) => item.kind === "message" && item.role === "assistant" && item.proposedPlan === true) ??
    null
  );
}
