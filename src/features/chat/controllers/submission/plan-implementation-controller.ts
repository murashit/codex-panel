import type { AppServerClient } from "../../../../app-server/client";
import type { ChatState, ChatStateStore } from "../../chat-state";
import type { DisplayItem } from "../../display/types";
import { implementPlanCandidateFromState } from "../../plan-implementation";

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
