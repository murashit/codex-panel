import type { AppServerClient } from "../../../../app-server/client";
import { closePanelsAction, setRequestedCollaborationModeDefaultAction } from "../../chat-state-actions";
import { activeThreadId, canImplementPlan } from "../../chat-state-selectors";
import type { ChatStateStore } from "../../chat-state";
import type { DisplayItem } from "../../display/types";

const IMPLEMENT_PLAN_PROMPT = "Please implement this plan.";

interface PlanImplementationConnectionPort {
  currentClient(): AppServerClient | null;
  ensureConnected(): Promise<void>;
}

interface PlanImplementationSubmissionPort {
  sendTurnText(text: string): Promise<void>;
}

export interface PlanImplementationControllerHost {
  stateStore: ChatStateStore;
  connection: PlanImplementationConnectionPort;
  submission: PlanImplementationSubmissionPort;
}

export class PlanImplementationController {
  constructor(private readonly host: PlanImplementationControllerHost) {}

  canImplement(item: DisplayItem): boolean {
    return canImplementPlan(this.host.stateStore.getState(), item);
  }

  async implement(item: DisplayItem): Promise<void> {
    if (!this.canImplement(item)) return;
    await this.host.connection.ensureConnected();
    if (!this.host.connection.currentClient() || !activeThreadId(this.host.stateStore.getState())) return;

    this.host.stateStore.dispatch(setRequestedCollaborationModeDefaultAction());
    this.host.stateStore.dispatch(closePanelsAction());
    await this.host.submission.sendTurnText(IMPLEMENT_PLAN_PROMPT);
  }
}
